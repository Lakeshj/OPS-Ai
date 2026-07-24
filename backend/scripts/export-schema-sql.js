/**
 * Regenerates mysql/opsai.sql from the live database schema (+ light seed).
 * Usage: node scripts/export-schema-sql.js
 * Loads credentials from backend/.env (never prints them).
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const mysql = require("mysql2/promise");

const OUT = path.join(__dirname, "../../mysql/opsai.sql");

const header = `-- OpsAi full schema dump (auto-generated)
-- Import: mysql -u root -p < mysql/opsai.sql
-- Then optionally: cd backend && npm run db:migrate  (safe if schema_migrations is seeded)

CREATE DATABASE IF NOT EXISTS \`opsai\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE \`opsai\`;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';

`;

const footer = `
SET FOREIGN_KEY_CHECKS = 1;
`;

(async () => {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "opsai",
  });

  const [tableRows] = await pool.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
  const tables = tableRows
    .map((row) => Object.values(row)[0])
    .sort((a, b) => String(a).localeCompare(String(b)));

  let body = "";
  for (const table of tables) {
    const [createRows] = await pool.query(`SHOW CREATE TABLE \`${table}\``);
    const createSql = createRows[0]["Create Table"] || createRows[0]["Create View"];
    body += `\n-- ----------------------------\n-- Table: ${table}\n-- ----------------------------\n`;
    body += `DROP TABLE IF EXISTS \`${table}\`;\n`;
    body += `${createSql};\n`;
  }

  // Minimal seed so a fresh install can log in + has AI settings defaults.
  // Password hash matches previous dump admin@example.com (bcrypt).
  body += `
-- ----------------------------
-- Seed: users (change passwords in production)
-- ----------------------------
INSERT INTO \`users\` (\`id\`, \`name\`, \`email\`, \`password\`, \`role\`, \`created_at\`, \`updated_at\`)
VALUES
  ('fd5fa0ec-0b36-4530-a685-1460e984c4a6', 'Admin user', 'admin@example.com', '$2b$10$TR74E3ClZpDGBuljfwIXLe8MPXBs7uhOov.hD9SibObeMUuNBL4NG', 'Admin', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE \`email\` = VALUES(\`email\`);

`;

  // Seed schema_migrations so migrate.js knows these were applied via dump
  const migrationsDir = path.join(__dirname, "../migrations");
  if (fs.existsSync(migrationsDir) && tables.includes("schema_migrations")) {
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    if (files.length) {
      body += `-- ----------------------------\n-- Seed: schema_migrations\n-- ----------------------------\n`;
      for (const file of files) {
        body += `INSERT IGNORE INTO \`schema_migrations\` (\`name\`) VALUES (${JSON.stringify(
          file
        )});\n`;
      }
      body += "\n";
    }
  }

  // Prefer live admin_ai_settings row if present; else ignore
  if (tables.includes("admin_ai_settings")) {
    const [settings] = await pool.query(
      "SELECT id, summary_model, evaluation_model, evaluation_prompt FROM admin_ai_settings WHERE id = 1 LIMIT 1"
    );
    if (settings[0]) {
      const s = settings[0];
      body += `-- ----------------------------\n-- Seed: admin_ai_settings\n-- ----------------------------\n`;
      body += `INSERT INTO \`admin_ai_settings\` (\`id\`, \`summary_model\`, \`evaluation_model\`, \`evaluation_prompt\`)
VALUES (1, ${pool.escape(s.summary_model)}, ${pool.escape(
        s.evaluation_model
      )}, ${pool.escape(s.evaluation_prompt)})
ON DUPLICATE KEY UPDATE
  \`summary_model\` = VALUES(\`summary_model\`),
  \`evaluation_model\` = VALUES(\`evaluation_model\`),
  \`evaluation_prompt\` = VALUES(\`evaluation_prompt\`);\n\n`;
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, header + body + footer, "utf8");
  console.log(`Wrote ${OUT}`);
  console.log(`Tables: ${tables.length}`);
  console.log(tables.join(", "));
  await pool.end();
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
