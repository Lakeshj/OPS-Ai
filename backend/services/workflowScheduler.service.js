const cron = require("node-cron");
const { DateTime } = require("luxon");
const { pool } = require("../config/database");
const workflowsService = require("../modules/workflows/workflows.service");
const {
  normalizeScheduleNodeData,
  validateScheduleNodeData,
  classifyScheduleStrategy,
  ruleToCron,
  getNextScheduleOccurrence,
  resolveTimezone,
  computeBoundedDelayMs,
  buildScheduleIdempotencyKey,
  MAX_SCHEDULER_WAKE_MS,
  SCHEDULE_STRATEGIES,
} = require("../utils/scheduleRecurrence");

/** workflowId -> Map(registrationKey -> { stop(), nextAt?, timer? }) */
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

const registrationKey = (workflowId, nodeId, ruleId) =>
  `${workflowId}:${nodeId}:${ruleId}`;

const fireScheduledRun = async (
  workflowId,
  nodeId,
  ruleId,
  occurrence,
  timezone
) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, status, created_by FROM workflows WHERE id = ? AND status = 'active'`,
      [workflowId]
    );
    if (rows.length === 0) return;

    const dt =
      occurrence instanceof DateTime
        ? occurrence
        : DateTime.fromISO(String(occurrence), { zone: timezone || "UTC" });
    const zone = timezone || dt.zoneName || "UTC";
    const idempotencyKey = buildScheduleIdempotencyKey(
      workflowId,
      nodeId,
      ruleId,
      dt,
      zone
    );
    await workflowsService.startRun(
      workflowId,
      {
        source: "schedule",
        firedAt: new Date().toISOString(),
        scheduledAt: dt.toISO(),
        scheduleNodeId: nodeId,
        ruleId,
        timezone: zone,
        localOccurrence: idempotencyKey.split(":").slice(4).join(":"),
      },
      { userId: rows[0].created_by, role: "system" },
      idempotencyKey
    );
  } catch (err) {
    console.error(
      `[workflow-scheduler] Failed to start run for ${workflowId}:`,
      err.message
    );
  }
};

const stopRegistration = (reg) => {
  try {
    reg.stop();
  } catch {
    // ignore
  }
};

const unregisterWorkflow = (workflowId) => {
  const existing = jobs.get(workflowId);
  if (!existing) return;
  for (const reg of existing.values()) {
    stopRegistration(reg);
  }
  jobs.delete(workflowId);
};

const reconcileAnchoredRule = (
  regRef,
  workflow,
  node,
  rule,
  definition,
  afterOverride
) => {
  if (regRef.stopped) return;
  if (regRef.timer) {
    clearTimeout(regRef.timer);
    regRef.timer = null;
  }

  const zone = resolveTimezone(rule, node.data, definition);
  const anchor = rule.recurrenceAnchor;
  const now = regRef.clock();
  const after = afterOverride || now.minus({ seconds: 1 });
  const next = getNextScheduleOccurrence(rule, {
    after,
    anchor,
    nodeData: node.data,
    definition,
  });

  if (!next) {
    regRef.nextAt = null;
    regRef.pendingDelayMs = null;
    return;
  }

  regRef.nextAt = next.toISO();
  const msUntil = next.toMillis() - now.toMillis();
  // Due when ≤1s remaining; otherwise sleep min(remaining, MAX_WAKE).
  regRef.pendingDelayMs = computeBoundedDelayMs(next.toMillis(), now.toMillis());

  if (msUntil <= 1000) {
    regRef.timer = setTimeout(async () => {
      if (regRef.stopped) return;
      await fireScheduledRun(workflow.id, node.id, rule.id, next, zone);
      if (regRef.stopped) return;
      reconcileAnchoredRule(
        regRef,
        workflow,
        node,
        rule,
        definition,
        next.plus({ seconds: 1 })
      );
    }, 0);
    return;
  }

  regRef.timer = setTimeout(() => {
    reconcileAnchoredRule(regRef, workflow, node, rule, definition);
  }, regRef.pendingDelayMs);
};

const scheduleAnchoredRule = (workflow, node, rule, definition, options = {}) => {
  const zone = resolveTimezone(rule, node.data, definition);
  const regRef = {
    timer: null,
    nextAt: null,
    pendingDelayMs: null,
    stopped: false,
    clock: options.clock || (() => DateTime.now().setZone(zone)),
    stop() {
      this.stopped = true;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
    },
  };

  reconcileAnchoredRule(regRef, workflow, node, rule, definition);
  return regRef;
};

const scheduleCronRule = (workflow, node, rule, definition) => {
  const zone = resolveTimezone(rule, node.data, definition);
  const expr = ruleToCron(rule);
  if (!expr || !cron.validate(expr)) return null;

  let stopped = false;
  const task = cron.schedule(
    expr,
    async () => {
      if (stopped) return;
      const after = DateTime.now().setZone(zone).minus({ seconds: 1 });
      const next = getNextScheduleOccurrence(rule, {
        after,
        nodeData: node.data,
        definition,
      });
      if (!next) return;
      await fireScheduledRun(workflow.id, node.id, rule.id, next, zone);
    },
    { timezone: zone }
  );

  return {
    stop() {
      stopped = true;
      try {
        task.stop();
      } catch {
        // ignore
      }
    },
  };
};

const registerWorkflow = (workflow) => {
  unregisterWorkflow(workflow.id);
  if (workflow.status !== "active") return;

  const definition = parseJson(workflow.definition_json, { nodes: [] });
  const scheduleNodes = findScheduleNodes(definition);
  if (scheduleNodes.length === 0) return;

  const validationErrors = [];
  for (const node of scheduleNodes) {
    validationErrors.push(
      ...validateScheduleNodeData(node.data, definition).map(
        (e) => `${node.id}: ${e}`
      )
    );
  }
  if (validationErrors.length > 0) {
    console.error(
      `[workflow-scheduler] Skipping workflow ${workflow.id} — invalid schedule: ${validationErrors[0]}`
    );
    return;
  }

  const registrations = new Map();

  for (const node of scheduleNodes) {
    const data = normalizeScheduleNodeData(node.data);
    if (data.disabled) continue;
    const rules = data.scheduleRules || [];
    for (const rule of rules) {
      const key = registrationKey(workflow.id, node.id, rule.id);
      const strategy = classifyScheduleStrategy(rule);
      const reg =
        strategy === SCHEDULE_STRATEGIES.ANCHORED
          ? scheduleAnchoredRule(workflow, { ...node, data }, rule, definition)
          : scheduleCronRule(workflow, { ...node, data }, rule, definition);
      if (reg) registrations.set(key, reg);
    }
  }

  if (registrations.size > 0) {
    jobs.set(workflow.id, registrations);
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

const getRegisteredWorkflowIds = () => [...jobs.keys()];

const getRegistrationCount = (workflowId) =>
  jobs.get(workflowId)?.size || 0;

const getRegistrationKeys = (workflowId) =>
  [...(jobs.get(workflowId)?.keys() || [])];

const getAnchoredRegistrationState = (workflowId, nodeId, ruleId) => {
  const reg = jobs.get(workflowId)?.get(registrationKey(workflowId, nodeId, ruleId));
  if (!reg) return null;
  return {
    nextAt: reg.nextAt || null,
    pendingDelayMs: reg.pendingDelayMs ?? null,
    stopped: Boolean(reg.stopped),
  };
};

module.exports = {
  startWorkflowScheduler,
  stopWorkflowScheduler,
  refreshAll,
  registerWorkflow,
  unregisterWorkflow,
  fireScheduledRun,
  getRegisteredWorkflowIds,
  getRegistrationCount,
  getRegistrationKeys,
  getAnchoredRegistrationState,
  registrationKey,
  reconcileAnchoredRule,
  scheduleAnchoredRule,
  MAX_SCHEDULER_WAKE_MS,
};
