/**
 * Prepare isolated opsai_smoke DB for workflow smoke suite.
 *
 * Clones production table definitions via SHOW CREATE TABLE (includes foreign
 * keys / ON DELETE CASCADE). CREATE TABLE LIKE is not used — it omits FKs, so
 * DELETE FROM workflows left orphan workflow_jobs and 10A/10B drainJobs failed.
 *
 * Does NOT copy workflows/runs/jobs (no shared queue with a live worker).
 * Seeds one user + workspace, copies schema_migrations, then applies any
 * pending canonical migrations onto opsai_smoke.
 *
 * Usage: node scripts/prepare-opsai-smoke-db.js
 * Then:  DB_NAME=opsai_smoke npm run test:workflows
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const mysql = require("mysql2/promise");

const LIVE = process.env.SMOKE_SOURCE_DB || "opsai";
const SMOKE = process.env.SMOKE_DB_NAME || "opsai_smoke";
const ident = (name) => `\`${String(name).replace(/`/g, "")}\``;

async function copyRow(c, table, whereSql, whereParams) {
  const [cols] = await c.query(`SHOW COLUMNS FROM ${ident(LIVE)}.${ident(table)}`);
  const names = cols.map((x) => x.Field);
  const [rows] = await c.query(
    `SELECT * FROM ${ident(LIVE)}.${ident(table)} ${whereSql}`,
    whereParams
  );
  if (!rows.length) return 0;
  for (const row of rows) {
    await c.query(
      `INSERT IGNORE INTO ${ident(SMOKE)}.${ident(table)} (${names
        .map(ident)
        .join(",")}) VALUES (${names.map(() => "?").join(",")})`,
      names.map((n) => row[n])
    );
  }
  return rows.length;
}

async function applyPendingMigrations(c, database) {
  await c.query(`USE ${ident(database)}`);
  await c.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
  const [appliedRows] = await c.query("SELECT name FROM schema_migrations");
  const applied = new Set(appliedRows.map((row) => row.name));
  const migrationsDirectory = path.join(__dirname, "../migrations");
  const files = fs
    .readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const migrationFile of files) {
    if (applied.has(migrationFile)) continue;
    const sql = fs.readFileSync(
      path.join(migrationsDirectory, migrationFile),
      "utf8"
    );
    console.log("Applying", migrationFile, "to", database);
    await c.query(sql);
    await c.execute("INSERT INTO schema_migrations (name) VALUES (?)", [
      migrationFile,
    ]);
  }
}

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    multipleStatements: true,
  });

  await c.query(`DROP DATABASE IF EXISTS ${ident(SMOKE)}`);
  await c.query(
    `CREATE DATABASE ${ident(SMOKE)} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
  );

  const [tables] = await c.query(
    `SELECT table_name AS name
       FROM information_schema.tables
      WHERE table_schema = ? AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
    [LIVE]
  );
  console.log("cloning table DDL (with FKs)", tables.length);

  await c.query("SET FOREIGN_KEY_CHECKS = 0");
  await c.query(`USE ${ident(SMOKE)}`);
  for (const row of tables) {
    const [createRows] = await c.query(
      `SHOW CREATE TABLE ${ident(LIVE)}.${ident(row.name)}`
    );
    const ddl = createRows[0]["Create Table"];
    if (!ddl) {
      throw new Error(`SHOW CREATE TABLE failed for ${row.name}`);
    }
    await c.query(ddl);
  }
  await c.query("SET FOREIGN_KEY_CHECKS = 1");

  const [migTables] = await c.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = ? AND table_name = 'schema_migrations' LIMIT 1`,
    [SMOKE]
  );
  if (migTables.length) {
    await c.query(
      `INSERT INTO ${ident(SMOKE)}.schema_migrations SELECT * FROM ${ident(LIVE)}.schema_migrations`
    );
  }

  await copyRow(c, "users", "LIMIT 1", []);
  const [users] = await c.query(`SELECT id FROM ${ident(SMOKE)}.users LIMIT 1`);
  if (users[0]) {
    try {
      await copyRow(c, "workspaces", "WHERE created_by = ? LIMIT 1", [
        users[0].id,
      ]);
    } catch {
      await copyRow(c, "workspaces", "LIMIT 1", []);
    }
    try {
      await copyRow(c, "workspace_users", "WHERE user_id = ? LIMIT 5", [
        users[0].id,
      ]);
    } catch (e) {
      console.log("workspace_users skip", e.message);
    }
  }

  await applyPendingMigrations(c, SMOKE);

  const [fkRows] = await c.query(
    `SELECT COUNT(*) AS c
       FROM information_schema.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = ?`,
    [SMOKE]
  );
  const [jobFk] = await c.query(
    `SELECT rc.DELETE_RULE AS deleteRule
       FROM information_schema.REFERENTIAL_CONSTRAINTS rc
       JOIN information_schema.KEY_COLUMN_USAGE kcu
         ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
        AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
      WHERE rc.CONSTRAINT_SCHEMA = ?
        AND kcu.TABLE_NAME = 'workflow_jobs'
        AND kcu.REFERENCED_TABLE_NAME = 'workflow_runs'`,
    [SMOKE]
  );
  if (!jobFk.length || String(jobFk[0].deleteRule).toUpperCase() !== "CASCADE") {
    throw new Error(
      "opsai_smoke is missing workflow_jobs → workflow_runs ON DELETE CASCADE"
    );
  }

  const [count] = await c.query(
    "SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = ?",
    [SMOKE]
  );
  console.log(
    "opsai_smoke ready tables=",
    count[0].c,
    "fks=",
    fkRows[0].c,
    "user=",
    users[0]?.id || null
  );
  await c.end();
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
