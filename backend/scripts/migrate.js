const fs = require("fs/promises");
const path = require("path");
const mysql = require("mysql2/promise");
const config = require("../config");

const migrationsDirectory = path.join(__dirname, "../migrations");

const getMigrationFiles = async () => {
  const entries = await fs.readdir(migrationsDirectory, {
    withFileTypes: true,
  });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
};

const migrate = async () => {
  const connection = await mysql.createConnection({
    host: config.db.host,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    multipleStatements: true,
  });

  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    const [appliedRows] = await connection.query(
      "SELECT name FROM schema_migrations"
    );
    const applied = new Set(appliedRows.map((row) => row.name));
    const migrationFiles = await getMigrationFiles();

    for (const migrationFile of migrationFiles) {
      if (applied.has(migrationFile)) {
        console.log(`Skipping ${migrationFile} (already applied)`);
        continue;
      }

      const migrationPath = path.join(migrationsDirectory, migrationFile);
      const sql = await fs.readFile(migrationPath, "utf8");

      console.log(`Applying ${migrationFile}`);
      await connection.query(sql);
      await connection.execute(
        "INSERT INTO schema_migrations (name) VALUES (?)",
        [migrationFile]
      );
      console.log(`Applied ${migrationFile}`);
    }
  } finally {
    await connection.end();
  }
};

migrate().catch((error) => {
  console.error("Database migration failed:", error.message);
  process.exitCode = 1;
});
