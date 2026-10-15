/**
 * Verify workflow_credentials.type includes google_ads and meta_ads
 * on the current DB and on a throwaway fresh migrate.
 * Does not print secrets.
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const mysql = require("mysql2/promise");

const REQUIRED = [
  "bearer",
  "api_key_header",
  "basic",
  "query_param",
  "google_gsc",
  "google_ga4",
  "google_gmail",
  "google_sheets",
  "oauth2",
  "google_ads",
  "meta_ads",
];

const connectionConfig = () => ({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  multipleStatements: true,
});

const enumValues = (type) => {
  const text = String(type || "");
  return [...text.matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
};

const assertEnum = (label, type) => {
  const values = enumValues(type);
  const missing = REQUIRED.filter((name) => !values.includes(name));
  if (missing.length) {
    throw new Error(`${label}: missing ${missing.join(", ")}`);
  }
  if (!/NOT NULL/i.test(String(type)) && !values.length) {
    throw new Error(`${label}: empty type definition`);
  }
  console.log(`${label}: ok (${values.join(",")})`);
};

const applyMigrations = async (connection) => {
  const dir = path.join(__dirname, "../migrations");
  const files = fs.readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (name)
    )
  `);
  const [appliedRows] = await connection.query("SELECT name FROM schema_migrations");
  const applied = new Set(appliedRows.map((row) => row.name));
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    await connection.query(sql);
    await connection.execute("INSERT INTO schema_migrations (name) VALUES (?)", [file]);
  }
};

(async () => {
  const currentName = process.env.DB_NAME || "opsai";
  const current = await mysql.createConnection({
    ...connectionConfig(),
    database: currentName,
  });
  try {
    await applyMigrations(current);
    const [cols] = await current.query(
      "SHOW COLUMNS FROM workflow_credentials LIKE 'type'"
    );
    assertEnum(`upgraded ${currentName}`, cols[0]?.Type);
    if (!/NO/i.test(String(cols[0]?.Null))) {
      throw new Error("type must remain NOT NULL");
    }
  } finally {
    await current.end();
  }

  const freshName = "opsai_enum_fresh_027";
  const admin = await mysql.createConnection(connectionConfig());
  try {
    await admin.query(`DROP DATABASE IF EXISTS \`${freshName}\``);
    await admin.query(
      `CREATE DATABASE \`${freshName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
    );
  } finally {
    await admin.end();
  }

  const fresh = await mysql.createConnection({
    ...connectionConfig(),
    database: freshName,
  });
  try {
    await fresh.query(`
      CREATE TABLE users (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255),
        role ENUM('Admin', 'Project Manager', 'Employee') NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      );
      CREATE TABLE workspaces (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_by VARCHAR(36) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE workspace_users (
        workspace_id VARCHAR(36),
        user_id VARCHAR(36),
        PRIMARY KEY (workspace_id, user_id),
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE folders (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        workspace_id VARCHAR(36) NOT NULL,
        created_by VARCHAR(36) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE chat_threads (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        workspace_id VARCHAR(36) NOT NULL,
        folder_id VARCHAR(36),
        created_by VARCHAR(36) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE chat_messages (
        id VARCHAR(36) PRIMARY KEY,
        thread_id VARCHAR(36) NOT NULL,
        content TEXT NOT NULL,
        is_user_message BOOLEAN NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
      );
      CREATE TABLE keyword_assistants (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        task_type VARCHAR(255) NOT NULL,
        prompt_template TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      );
    `);
    await applyMigrations(fresh);
    const [cols] = await fresh.query(
      "SHOW COLUMNS FROM workflow_credentials LIKE 'type'"
    );
    assertEnum("fresh opsai_enum_fresh_027", cols[0]?.Type);
  } finally {
    await fresh.end();
    const cleanup = await mysql.createConnection(connectionConfig());
    try {
      await cleanup.query(`DROP DATABASE IF EXISTS \`${freshName}\``);
    } finally {
      await cleanup.end();
    }
  }
})().catch((error) => {
  console.error("Enum verification failed:", error.message);
  process.exitCode = 1;
});
