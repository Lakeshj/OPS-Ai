require("dotenv").config();
const mysql = require("mysql2/promise");
const config = require("../config");

(async () => {
  const c = await mysql.createConnection({
    host: config.db.host,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
  });
  const [rows] = await c.query(
    `SELECT id, name, type, workspace_id, created_at, updated_at,
            LEFT(secret_json, 20) AS secret_prefix,
            LEFT(COALESCE(config_json,''), 120) AS config_prefix
     FROM workflow_credentials
     WHERE name LIKE ? OR LOWER(name) LIKE ?
     ORDER BY updated_at DESC`,
    ["%SocialChamps%", "%socialchamps%"]
  );
  console.log("MATCHES", rows.length);
  console.log(JSON.stringify(rows, null, 2));

  const [idx] = await c.query("SHOW INDEX FROM workflow_credentials");
  console.log(
    "INDEXES",
    idx.map((r) => ({
      Key_name: r.Key_name,
      Column_name: r.Column_name,
      Non_unique: r.Non_unique,
      Seq: r.Seq_in_index,
    }))
  );

  // Find any same-name pairs across types (would block migration if we only drop old unique)
  const [dupes] = await c.query(
    `SELECT workspace_id, LOWER(TRIM(name)) AS nkey, GROUP_CONCAT(DISTINCT type) AS types, COUNT(*) AS c
     FROM workflow_credentials
     GROUP BY workspace_id, LOWER(TRIM(name))
     HAVING c > 1`
  );
  console.log("CROSS_OR_SAME_NAME_DUPES", dupes);

  const [sameType] = await c.query(
    `SELECT workspace_id, type, LOWER(TRIM(name)) AS nkey, COUNT(*) AS c
     FROM workflow_credentials
     GROUP BY workspace_id, type, LOWER(TRIM(name))
     HAVING c > 1`
  );
  console.log("SAME_TYPE_DUPES", sameType);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
