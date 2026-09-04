const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/database");
const { executeRun } = require("../services/workflowEngine.service");
const { definition, WORKFLOW_NAME } = require("./seed-realtime-seo-pulse-workflow");

(async () => {
  const [rows] = await pool.execute(
    `SELECT id FROM workflows WHERE name = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1`,
    [WORKFLOW_NAME]
  );
  if (!rows.length) throw new Error("seed first");
  const workflowId = rows[0].id;
  const [users] = await pool.execute(`SELECT id FROM users LIMIT 1`);
  const runId = uuidv4();
  await pool.execute(
    `INSERT INTO workflow_runs
      (id, workflow_id, workflow_name_snapshot, status, input_json, definition_snapshot_json, created_by)
     VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
    [runId, workflowId, WORKFLOW_NAME, JSON.stringify({}), JSON.stringify(definition), users[0].id]
  );
  await pool.execute(
    `INSERT INTO workflow_jobs (id, run_id, status, available_at) VALUES (?, ?, 'queued', CURRENT_TIMESTAMP)`,
    [uuidv4(), runId]
  );
  const st = await executeRun(runId);
  const [runRows] = await pool.execute(
    `SELECT status, error, output_json FROM workflow_runs WHERE id = ?`,
    [runId]
  );
  const out =
    typeof runRows[0].output_json === "string"
      ? JSON.parse(runRows[0].output_json)
      : runRows[0].output_json;
  const callable = out?.__callableReturnItems || [];
  const summary = callable.find((i) => i?.json?.kind === "summary")?.json;
  console.log(
    JSON.stringify(
      {
        status: st.status,
        error: runRows[0].error,
        result: out?.result,
        summary: summary
          ? {
              boardSize: summary.boardSize,
              tierCounts: summary.tierCounts,
              alerts: summary.alerts,
              totalClicksOnBoard: summary.totalClicksOnBoard,
            }
          : null,
        rowCount: callable.filter((i) => i?.json?.kind === "row").length,
      },
      null,
      2
    )
  );
  process.exit(st.status === "succeeded" ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
