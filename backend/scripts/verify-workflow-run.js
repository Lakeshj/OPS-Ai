/**
 * End-to-end engine check against the real database. Creates a throwaway
 * workflow that exercises branching, skipping, Merge and the item nodes,
 * executes it, prints every step, then deletes it.
 *
 * Run: node scripts/verify-workflow-run.js
 */
const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/database");
const { executeRun } = require("../services/workflowEngine.service");

const definition = {
  version: 1,
  nodes: [
    { id: "trigger-1", type: "trigger", position: { x: 0, y: 0 }, data: { label: "Start" } },
    {
      id: "set-1",
      type: "set",
      position: { x: 200, y: 0 },
      data: {
        label: "Seed rows",
        mappings: [
          { key: "rows", value: '[{"page":"/","clicks":9},{"page":"/a","clicks":2},{"page":"/a","clicks":2}]' },
          { key: "threshold", value: "5" },
        ],
      },
    },
    { id: "split-1", type: "splitOut", position: { x: 400, y: 0 }, data: { fieldName: "rows" } },
    { id: "dedupe-1", type: "removeDuplicates", position: { x: 600, y: 0 }, data: { fieldName: "page" } },
    { id: "sort-1", type: "sort", position: { x: 800, y: 0 }, data: { fieldName: "clicks", direction: "desc" } },
    {
      id: "cond-1",
      type: "condition",
      position: { x: 1000, y: 0 },
      data: { left: "{{steps.dedupe-1.count}}", operator: "gt", right: "1" },
    },
    { id: "agg-1", type: "aggregate", position: { x: 1200, y: -100 }, data: { operation: "sum", fieldName: "clicks" } },
    { id: "skipped-1", type: "limit", position: { x: 1200, y: 100 }, data: { maxItems: 1 } },
    { id: "merge-1", type: "merge", position: { x: 1400, y: 0 }, data: { mode: "append" } },
    {
      id: "code-1",
      type: "code",
      position: { x: 1500, y: 0 },
      data: {
        mode: "all",
        code: "console.log('items in', items.length);\nreturn items.map(i => ({ total: i.value, label: 'clicks' }));",
      },
    },
    { id: "result-1", type: "result", position: { x: 1600, y: 0 }, data: { mapFrom: "{{steps.agg-1.value}}" } },
  ],
  edges: [
    { id: "e1", source: "trigger-1", target: "set-1" },
    { id: "e2", source: "set-1", target: "split-1" },
    { id: "e3", source: "split-1", target: "dedupe-1" },
    { id: "e4", source: "dedupe-1", target: "sort-1" },
    { id: "e5", source: "sort-1", target: "cond-1" },
    { id: "e6", source: "cond-1", target: "agg-1", sourceHandle: "true" },
    { id: "e7", source: "cond-1", target: "skipped-1", sourceHandle: "false" },
    { id: "e8", source: "agg-1", target: "merge-1" },
    { id: "e9", source: "skipped-1", target: "merge-1" },
    { id: "e10", source: "merge-1", target: "code-1" },
    { id: "e11", source: "code-1", target: "result-1" },
  ],
};

const main = async () => {
  const [workspaces] = await pool.execute("SELECT id FROM workspaces LIMIT 1");
  const [users] = await pool.execute("SELECT id FROM users LIMIT 1");
  if (workspaces.length === 0 || users.length === 0) {
    console.error("Need at least one workspace and user in the database.");
    process.exit(1);
  }

  const workflowId = uuidv4();
  const runId = uuidv4();

  await pool.execute(
    `INSERT INTO workflows (id, workspace_id, name, description, definition_json, status, created_by)
     VALUES (?, ?, ?, ?, ?, 'draft', ?)`,
    [
      workflowId,
      workspaces[0].id,
      `__engine-verify-${Date.now()}`,
      "temporary",
      JSON.stringify(definition),
      users[0].id,
    ]
  );
  await pool.execute(
    `INSERT INTO workflow_runs (id, workflow_id, status, input_json, created_by)
     VALUES (?, ?, 'queued', ?, ?)`,
    [runId, workflowId, JSON.stringify({ message: "verify" }), users[0].id]
  );

  try {
    const result = await executeRun(runId);
    console.log(`\nrun status: ${result.status}`);
    console.log(`final output: ${JSON.stringify(result.output)}`);

    const [steps] = await pool.execute(
      `SELECT node_id, node_type, status, attempts, input_json, output_json, error
       FROM workflow_run_steps WHERE run_id = ? ORDER BY created_at ASC, started_at ASC`,
      [runId]
    );

    // mysql2 returns JSON columns already parsed on some server versions.
    const asJson = (value, fallback) => {
      if (value == null) return fallback;
      if (typeof value === "object") return value;
      try {
        return JSON.parse(value);
      } catch {
        return fallback;
      }
    };

    console.log("\nsteps:");
    for (const step of steps) {
      const input = asJson(step.input_json, {});
      const output = asJson(step.output_json, null);
      const summary =
        output && typeof output === "object"
          ? Object.entries(output)
              .filter(([k]) => k !== "items")
              .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 40)}`)
              .join(" ")
          : JSON.stringify(output);
      console.log(
        `  ${step.status.padEnd(9)} ${step.node_id.padEnd(10)} ${String(
          step.node_type
        ).padEnd(16)} attempts=${step.attempts} itemsIn=${
          input.itemsIn ?? "-"
        } resolved=${JSON.stringify(input.resolved ?? null).slice(0, 90)}`
      );
      if (summary) console.log(`             out: ${summary.slice(0, 140)}`);
      if (step.error) console.log(`             err: ${step.error}`);
    }
  } finally {
    await pool.execute("DELETE FROM workflows WHERE id = ?", [workflowId]);
    await pool.end();
  }
};

main().catch((err) => {
  console.error("verification failed:", err);
  process.exit(1);
});
