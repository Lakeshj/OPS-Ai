/** Quick smoke: execute the seeded "comparison list" workflow once. */
const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/database");
const { executeRun } = require("../services/workflowEngine.service");
const { definition, WORKFLOW_NAME } = require("./seed-comparison-list-workflow");

(async () => {
  const [rows] = await pool.execute(
    `SELECT id FROM workflows WHERE name = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1`,
    [WORKFLOW_NAME]
  );
  if (!rows.length) throw new Error("comparison list workflow not found — run seed first");
  const workflowId = rows[0].id;
  const [users] = await pool.execute(`SELECT id FROM users LIMIT 1`);
  const runId = uuidv4();
  await pool.execute(
    `INSERT INTO workflow_runs
      (id, workflow_id, workflow_name_snapshot, status, input_json, definition_snapshot_json, created_by)
     VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
    [
      runId,
      workflowId,
      WORKFLOW_NAME,
      JSON.stringify({}),
      JSON.stringify(definition),
      users[0].id,
    ]
  );
  await pool.execute(
    `INSERT INTO workflow_jobs (id, run_id, status, available_at)
     VALUES (?, ?, 'queued', CURRENT_TIMESTAMP)`,
    [uuidv4(), runId]
  );

  const st = await executeRun(runId);
  const [runRows] = await pool.execute(
    `SELECT status, error, output_json FROM workflow_runs WHERE id = ?`,
    [runId]
  );
  const raw = runRows[0].output_json;
  const out = typeof raw === "string" ? JSON.parse(raw) : raw;
  console.log(
    JSON.stringify(
      {
        workflowId,
        runId,
        status: st.status,
        error: runRows[0].error,
        matchCount: Array.isArray(out?.result)
          ? out.result.length
          : Array.isArray(out?.items)
            ? out.items.length
            : out,
        output: out,
      },
      null,
      2
    )
  );
  process.exit(st.status === "succeeded" ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
