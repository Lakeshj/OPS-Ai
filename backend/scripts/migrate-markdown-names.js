const fs = require("fs/promises");
const path = require("path");
const zlib = require("zlib");
const { promisify } = require("util");
const { pool } = require("../config/database");
const {
  buildMarkdownStorageKey,
  toAbsolutePath,
  removeIfExists,
} = require("../services/documentStorage.service");

const gunzip = promisify(zlib.gunzip);

const migrate = async () => {
  const [rows] = await pool.query(
    `
    SELECT *
    FROM workspace_documents
    WHERE status = 'ready' AND markdown_storage_key IS NOT NULL
    `
  );

  for (const doc of rows) {
    const oldKey = doc.markdown_storage_key;
    const newKey = buildMarkdownStorageKey(
      doc.workspace_id,
      doc.id,
      doc.original_name
    );

    if (oldKey === newKey) continue;

    const abs = toAbsolutePath(oldKey);
    let text;
    try {
      const buf = await fs.readFile(abs);
      text = oldKey.endsWith(".gz")
        ? (await gunzip(buf)).toString("utf8")
        : buf.toString("utf8");
    } catch (error) {
      console.log("skip missing", oldKey);
      continue;
    }

    const buffer = Buffer.from(text, "utf8");
    const newAbs = toAbsolutePath(newKey);
    await fs.mkdir(path.dirname(newAbs), { recursive: true });
    await fs.writeFile(newAbs, buffer);
    await pool.execute(
      `
      UPDATE workspace_documents
      SET markdown_storage_key = ?, size_bytes = ?, storage_key = NULL
      WHERE id = ?
      `,
      [newKey, buffer.length, doc.id]
    );
    await removeIfExists(oldKey);
    console.log("migrated", doc.original_name, "->", newKey, buffer.length);
  }
};

migrate()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
