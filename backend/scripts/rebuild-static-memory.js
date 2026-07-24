const { pool } = require("../config/database");
const {
  rebuildWorkspaceStaticMemory,
} = require("../services/documentProcessing.service");

const rebuild = async () => {
  const [rows] = await pool.query(`
    SELECT DISTINCT workspace_id
    FROM workspace_documents
    WHERE status = 'ready'
  `);

  for (const row of rows) {
    await rebuildWorkspaceStaticMemory(row.workspace_id);
    console.log(`Rebuilt static memory for ${row.workspace_id}`);
  }
};

rebuild()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
