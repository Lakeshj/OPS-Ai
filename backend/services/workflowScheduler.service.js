const cron = require("node-cron");
const { pool } = require("../config/database");
const workflowsService = require("../modules/workflows/workflows.service");
const { rulesToCrons } = require("../utils/scheduleRules");

const jobs = new Map();

const parseJson = (value, fallback = null) => {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const findScheduleNodes = (definition) => {
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  return nodes.filter((n) => (n.type || n.data?.nodeType) === "schedule");
};

const fireScheduledRun = async (workflowId) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, status, created_by FROM workflows WHERE id = ? AND status = 'active'`,
      [workflowId]
    );
    if (rows.length === 0) return;

    await workflowsService.startRun(
      workflowId,
      { source: "schedule", firedAt: new Date().toISOString() },
      { userId: rows[0].created_by, role: "system" }
    );
  } catch (err) {
    console.error(
      `[workflow-scheduler] Failed to start run for ${workflowId}:`,
      err.message
    );
  }
};

const unregisterWorkflow = (workflowId) => {
  const existing = jobs.get(workflowId);
  if (!existing) return;
  for (const task of existing) {
    try {
      task.stop();
    } catch {
      // ignore
    }
  }
  jobs.delete(workflowId);
};

const registerWorkflow = (workflow) => {
  unregisterWorkflow(workflow.id);
  if (workflow.status !== "active") return;

  const definition = parseJson(workflow.definition_json, { nodes: [] });
  const scheduleNodes = findScheduleNodes(definition);
  if (scheduleNodes.length === 0) return;

  const tasks = [];
  for (const node of scheduleNodes) {
    const data = node.data || {};
    if (data.disabled) continue;
    const crons = rulesToCrons(data);
    for (const expr of crons) {
      if (!cron.validate(expr)) {
        console.warn(
          `[workflow-scheduler] Invalid cron "${expr}" on workflow ${workflow.id}`
        );
        continue;
      }
      const task = cron.schedule(expr, () => fireScheduledRun(workflow.id), {
        timezone: data.timezone || definition.settings?.timezone || "UTC",
      });
      tasks.push(task);
    }
  }

  if (tasks.length > 0) {
    jobs.set(workflow.id, tasks);
  }
};

const refreshAll = async () => {
  const [rows] = await pool.execute(
    `SELECT id, status, definition_json FROM workflows WHERE status = 'active'`
  );
  const activeIds = new Set(rows.map((r) => r.id));
  for (const id of jobs.keys()) {
    if (!activeIds.has(id)) unregisterWorkflow(id);
  }
  for (const row of rows) {
    registerWorkflow(row);
  }
};

let refreshTimer = null;

const startWorkflowScheduler = () => {
  refreshAll().catch((err) => {
    console.error("[workflow-scheduler] Initial refresh failed:", err.message);
  });
  refreshTimer = setInterval(() => {
    refreshAll().catch((err) => {
      console.error("[workflow-scheduler] Refresh failed:", err.message);
    });
  }, 60_000);
};

const stopWorkflowScheduler = () => {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  for (const id of [...jobs.keys()]) unregisterWorkflow(id);
};

module.exports = {
  startWorkflowScheduler,
  stopWorkflowScheduler,
  refreshAll,
  registerWorkflow,
  unregisterWorkflow,
  fireScheduledRun,
};
