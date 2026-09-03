const { v4: uuidv4 } = require("uuid");
const { validateSwitchEdges } = require("../../services/workflowDynamicPorts.service");
const {
  validateScheduleNodeData,
  ensureRecurrenceAnchors,
  getNextScheduleOccurrences,
  formatOccurrencePreview,
  normalizeScheduleNodeData,
  resolveTimezone,
} = require("../../utils/scheduleRecurrence");
const { pool } = require("../../config/database");
const AppError = require("../../utils/AppError");
const { assertWorkspaceAccess } = require("../../services/authorization.service");

const ALLOWED_NODE_TYPES = new Set([
  "trigger",
  "schedule",
  "webhook",
  "ai",
  "bot",
  "http",
  "splitOut",
  "filter",
  "limit",
  "sort",
  "removeDuplicates",
  "aggregate",
  "merge",
  "code",
  "condition",
  "set",
  "document",
  "spreadsheet",
  "email",
  "result",
  "wait",
  "loop",
  "noop",
  "integration",
]);

const parseJson = (value, fallback = null) => {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const formatWorkflow = (row) => ({
  id: row.id,
  workspaceId: row.workspace_id,
  name: row.name,
  description: row.description,
  definition: parseJson(row.definition_json, { version: 1, nodes: [], edges: [] }),
  status: row.status,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const formatRun = (row) => ({
  id: row.id,
  workflowId: row.workflow_id,
  status: row.status,
  input: parseJson(row.input_json, null),
  output: parseJson(row.output_json, null),
  error: row.error,
  waitingNodeId: row.waiting_node_id || null,
  resumeAt: row.resume_at || null,
  hasDefinitionSnapshot: row.definition_snapshot_json != null,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

const formatStep = (row) => ({
  id: row.id,
  runId: row.run_id,
  nodeId: row.node_id,
  executionIndex: row.execution_index ?? 0,
  nodeType: row.node_type,
  status: row.status,
  attempts: row.attempts ?? 0,
  input: parseJson(row.input_json, null),
  output: parseJson(row.output_json, null),
  error: row.error,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  createdAt: row.created_at,
});

const emptyDefinition = () => ({
  version: 1,
  nodes: [],
  edges: [],
});

const validateDefinition = (definition) => {
  if (!definition || typeof definition !== "object") {
    throw new AppError("definition is required", 400, "VALIDATION_ERROR");
  }
  const nodes = Array.isArray(definition.nodes) ? definition.nodes : null;
  const edges = Array.isArray(definition.edges) ? definition.edges : null;
  if (!nodes || !edges) {
    throw new AppError(
      "definition.nodes and definition.edges are required arrays",
      400,
      "VALIDATION_ERROR"
    );
  }
  for (const node of nodes) {
    const type = node.type || node.data?.nodeType;
    if (!ALLOWED_NODE_TYPES.has(type)) {
      throw new AppError(
        `Unsupported node type: ${type}`,
        400,
        "VALIDATION_ERROR"
      );
    }
  }
  const switchErrors = validateSwitchEdges(definition);
  if (switchErrors.length > 0) {
    throw new AppError(switchErrors[0], 400, "VALIDATION_ERROR");
  }
  const { buildGraph } = require("../../services/workflowEngine.service");
  const {
    validateControlledCycles,
  } = require("../../services/workflowLoopGraph.service");
  const cycleCheck = validateControlledCycles(buildGraph(definition));
  if (!cycleCheck.ok) {
    throw new AppError(cycleCheck.errors[0], 400, "VALIDATION_ERROR");
  }
};

const findScheduleNodesInDefinition = (definition) => {
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  return nodes.filter((n) => (n.type || n.data?.nodeType) === "schedule");
};

const validateSchedulesForActivation = (definition) => {
  const errors = [];
  for (const node of findScheduleNodesInDefinition(definition)) {
    errors.push(...validateScheduleNodeData(node.data, definition));
  }
  if (errors.length > 0) {
    throw new AppError(errors[0], 400, "VALIDATION_ERROR");
  }
};

const prepareDefinitionForActivation = (definition, activationTime = new Date()) => {
  const nodes = (definition.nodes || []).map((node) => {
    const type = node.type || node.data?.nodeType;
    if (type !== "schedule") return node;
    return {
      ...node,
      data: ensureRecurrenceAnchors(node.data || {}, activationTime),
    };
  });
  return { ...definition, nodes };
};

const listByWorkspace = async (workspaceId, authUser) => {
  await assertWorkspaceAccess(authUser, workspaceId);
  const [rows] = await pool.execute(
    `SELECT * FROM workflows
     WHERE workspace_id = ?
     ORDER BY updated_at DESC`,
    [workspaceId]
  );
  return rows.map(formatWorkflow);
};

const listAll = async (authUser) => {
  if (authUser.role === "Admin" || authUser.role === "Project Manager") {
    const [rows] = await pool.execute(
      `SELECT * FROM workflows ORDER BY updated_at DESC`
    );
    return rows.map(formatWorkflow);
  }

  const [rows] = await pool.execute(
    `SELECT w.*
     FROM workflows w
     INNER JOIN workspace_users wu
       ON wu.workspace_id = w.workspace_id AND wu.user_id = ?
     ORDER BY w.updated_at DESC`,
    [authUser.userId]
  );
  return rows.map(formatWorkflow);
};

const getById = async (id, authUser) => {
  const [rows] = await pool.execute(`SELECT * FROM workflows WHERE id = ?`, [id]);
  if (rows.length === 0) {
    throw new AppError("Workflow not found", 404, "NOT_FOUND");
  }
  await assertWorkspaceAccess(authUser, rows[0].workspace_id);
  return formatWorkflow(rows[0]);
};

const create = async ({ name, description, workspaceId, definition }, authUser) => {
  await assertWorkspaceAccess(authUser, workspaceId);
  const def = definition || emptyDefinition();
  validateDefinition(def);

  const id = uuidv4();
  await pool.execute(
    `INSERT INTO workflows
      (id, workspace_id, name, description, definition_json, status, created_by)
     VALUES (?, ?, ?, ?, ?, 'draft', ?)`,
    [
      id,
      workspaceId,
      name,
      description || null,
      JSON.stringify(def),
      authUser.userId,
    ]
  );
  return getById(id, authUser);
};

const update = async (id, payload, authUser) => {
  const existing = await getById(id, authUser);
  const name = payload.name ?? existing.name;
  const description =
    payload.description !== undefined ? payload.description : existing.description;
  const status = payload.status ?? existing.status;
  let definition =
    payload.definition !== undefined ? payload.definition : existing.definition;

  if (payload.definition !== undefined) {
    validateDefinition(definition);
  }

  const activating =
    status === "active" &&
    (existing.status !== "active" || payload.definition !== undefined);
  if (status === "active") {
    validateSchedulesForActivation(definition);
    if (activating) {
      definition = prepareDefinitionForActivation(definition);
    }
  }

  await pool.execute(
    `UPDATE workflows
     SET name = ?, description = ?, definition_json = ?, status = ?
     WHERE id = ?`,
    [name, description || null, JSON.stringify(definition), status, id]
  );
  const updated = await getById(id, authUser);
  try {
    const {
      registerWorkflow,
      unregisterWorkflow,
    } = require("../../services/workflowScheduler.service");
    const [row] = await pool.execute(
      `SELECT id, status, definition_json FROM workflows WHERE id = ?`,
      [id]
    );
    if (row[0]) {
      if (row[0].status === "active") registerWorkflow(row[0]);
      else unregisterWorkflow(id);
    }
  } catch {
    // scheduler is optional at boot
  }
  return updated;
};

const remove = async (id, authUser) => {
  await getById(id, authUser);
  try {
    const { unregisterWorkflow } = require("../../services/workflowScheduler.service");
    unregisterWorkflow(id);
  } catch {
    // scheduler optional
  }
  await pool.execute(`DELETE FROM workflows WHERE id = ?`, [id]);
  return { success: true };
};

const startRun = async (workflowId, input, authUser, idempotencyKey = null) => {
  const workflow = await getById(workflowId, authUser);

  // A repeated webhook delivery reuses the original run instead of
  // processing the same payload twice.
  if (idempotencyKey) {
    const [existing] = await pool.execute(
      `SELECT id FROM workflow_runs WHERE workflow_id = ? AND idempotency_key = ?`,
      [workflowId, idempotencyKey]
    );
    if (existing.length > 0) {
      return getRunById(existing[0].id, authUser);
    }
  }

  const runId = uuidv4();
  const jobId = uuidv4();
  const definitionSnapshot = workflow.definition || emptyDefinition();

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO workflow_runs
        (id, workflow_id, status, idempotency_key, input_json, definition_snapshot_json, created_by)
       VALUES (?, ?, 'queued', ?, ?, ?, ?)`,
      [
        runId,
        workflowId,
        idempotencyKey,
        JSON.stringify(input ?? {}),
        JSON.stringify(definitionSnapshot),
        authUser.userId,
      ]
    );
    await connection.execute(
      `INSERT INTO workflow_jobs (id, run_id, status, available_at)
       VALUES (?, ?, 'queued', CURRENT_TIMESTAMP)`,
      [jobId, runId]
    );
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    // Two identical webhooks can race past the check above; the unique index
    // is the real guard, so fall back to the run that won.
    if (idempotencyKey && err?.code === "ER_DUP_ENTRY") {
      const [existing] = await pool.execute(
        `SELECT id FROM workflow_runs WHERE workflow_id = ? AND idempotency_key = ?`,
        [workflowId, idempotencyKey]
      );
      if (existing.length > 0) return getRunById(existing[0].id, authUser);
    }
    throw err;
  } finally {
    connection.release();
  }

  return getRunById(runId, authUser);
};

const getRunById = async (runId, authUser) => {
  const [rows] = await pool.execute(
    `SELECT r.*, w.workspace_id
     FROM workflow_runs r
     INNER JOIN workflows w ON w.id = r.workflow_id
     WHERE r.id = ?`,
    [runId]
  );
  if (rows.length === 0) {
    throw new AppError("Workflow run not found", 404, "NOT_FOUND");
  }
  await assertWorkspaceAccess(authUser, rows[0].workspace_id);
  const run = formatRun(rows[0]);
  const [steps] = await pool.execute(
    `SELECT * FROM workflow_run_steps WHERE run_id = ? ORDER BY created_at ASC`,
    [runId]
  );

  const { getActiveWaitForRun } = require("../../services/workflowWait.service");
  const activeWait = await getActiveWaitForRun(runId);
  const waitInfo = activeWait
    ? {
        resumeMode: activeWait.resumeMode,
        resumeMechanism: activeWait.resumeMechanism,
        signalledAt: activeWait.signalledAt,
        waitStatus: activeWait.status,
        // Authorized users only — never exposed on public endpoints.
        externalResumeToken:
          activeWait.resumeMode === "external" &&
          activeWait.status === "waiting" &&
          activeWait.externalResumeToken
            ? activeWait.externalResumeToken
            : null,
      }
    : null;

  return {
    ...run,
    steps: steps.map(formatStep),
    wait: waitInfo,
  };
};

const listRuns = async (workflowId, authUser) => {
  await getById(workflowId, authUser);
  const [rows] = await pool.execute(
    `SELECT * FROM workflow_runs
     WHERE workflow_id = ?
     ORDER BY created_at DESC
     LIMIT 100`,
    [workflowId]
  );
  return rows.map(formatRun);
};

const {
  executePartial,
  getNodeInputPreview,
  buildExpressionPreviewContext,
  buildGraph,
} = require("../../services/workflowEngine.service");
const { resolveExpression } = require("../../services/workflowNodes.service");
const {
  ExpressionReferenceError,
  REASONS,
} = require("../../services/workflowExpression.service");
const editorSession = require("../../services/workflowEditorSession.service");
const {
  propagateDownstreamDirty,
  markNodesDirty,
} = require("../../services/workflowGraphInvalidation.service");

const executeNodeStep = async (workflowId, nodeId, body, authUser) => {
  const workflow = await getById(workflowId, authUser);
  const definition = body?.definition || workflow.definition;
  const input = body?.input ?? {};
  const userId = authUser.userId;

  editorSession.setSessionInput(workflowId, userId, input);
  const session = editorSession.prepareSessionForDefinition(
    workflowId,
    userId,
    definition
  );

  const partial = await executePartial({
    definition,
    input,
    targetNodeId: nodeId,
    mode: "step",
    session,
  });

  for (const [id, result] of Object.entries(partial.results)) {
    if (!result.cached) {
      editorSession.setNodeResult(workflowId, userId, id, result, definition);
    }
  }

  const graph = buildGraph(definition);
  const updatedSession = editorSession.getSession(workflowId, userId);
  propagateDownstreamDirty(updatedSession, graph, nodeId, "re_executed", {
    stopAtPinned: false,
  });

  return {
    ...partial,
    session: editorSession.formatSession(
      editorSession.getSession(workflowId, userId)
    ),
  };
};

const runToNode = async (workflowId, nodeId, body, authUser) => {
  const workflow = await getById(workflowId, authUser);
  const definition = body?.definition || workflow.definition;
  const input = body?.input ?? {};
  const userId = authUser.userId;

  editorSession.setSessionInput(workflowId, userId, input);
  const session = editorSession.prepareSessionForDefinition(
    workflowId,
    userId,
    definition
  );

  const partial = await executePartial({
    definition,
    input,
    targetNodeId: nodeId,
    mode: "run-to",
    session,
  });

  for (const [id, result] of Object.entries(partial.results)) {
    if (!result.cached) {
      editorSession.setNodeResult(workflowId, userId, id, result, definition);
    }
  }

  const graph = buildGraph(definition);
  const updatedSession = editorSession.getSession(workflowId, userId);
  propagateDownstreamDirty(updatedSession, graph, nodeId, "re_executed", {
    stopAtPinned: false,
  });

  return {
    ...partial,
    session: editorSession.formatSession(
      editorSession.getSession(workflowId, userId)
    ),
  };
};

const executePrevious = async (workflowId, nodeId, body, authUser) => {
  const workflow = await getById(workflowId, authUser);
  const definition = body?.definition || workflow.definition;
  const input = body?.input ?? {};
  const userId = authUser.userId;

  editorSession.setSessionInput(workflowId, userId, input);
  const session = editorSession.prepareSessionForDefinition(
    workflowId,
    userId,
    definition
  );

  const partial = await executePartial({
    definition,
    input,
    targetNodeId: nodeId,
    mode: "upstream",
    session,
  });

  for (const [id, result] of Object.entries(partial.results)) {
    if (!result.cached) {
      editorSession.setNodeResult(workflowId, userId, id, result, definition);
    }
  }

  const updatedSession = editorSession.getSession(workflowId, userId);
  markNodesDirty(updatedSession, [nodeId], "upstream_executed");

  return {
    ...partial,
    session: editorSession.formatSession(
      editorSession.getSession(workflowId, userId)
    ),
  };
};

const getNodeInput = async (workflowId, nodeId, authUser, definitionOverride) => {
  await getById(workflowId, authUser);
  const userId = authUser.userId;
  const workflow = await getById(workflowId, authUser);
  const definition = definitionOverride || workflow.definition;
  const session = editorSession.prepareSessionForDefinition(
    workflowId,
    userId,
    definition
  );
  return getNodeInputPreview(definition, session, nodeId, session.input || {});
};

const invalidateEditorSession = async (workflowId, body, authUser) => {
  await getById(workflowId, authUser);
  const workflow = await getById(workflowId, authUser);
  const definition = body?.definition || workflow.definition;
  const userId = authUser.userId;
  return editorSession.invalidateEditorSession(
    workflowId,
    userId,
    definition,
    body?.event
  );
};

const getEditorSession = async (workflowId, authUser) => {
  await getById(workflowId, authUser);
  return editorSession.formatSession(
    editorSession.getSession(workflowId, authUser.userId)
  );
};

const REASON_TO_PREVIEW_STATUS = {
  [REASONS.TARGET_NOT_EXECUTED]: "UPSTREAM_NOT_EXECUTED",
  [REASONS.TARGET_NOT_IN_PATH]: "BROKEN_REFERENCE",
  [REASONS.PROVENANCE_MISSING]: "BROKEN_REFERENCE",
  [REASONS.PROVENANCE_AMBIGUOUS]: "AMBIGUOUS",
  [REASONS.ITEM_INDEX_OUT_OF_RANGE]: "BROKEN_REFERENCE",
  [REASONS.INVALID_REFERENCE]: "INVALID_EXPRESSION",
};

const previewExpression = async (workflowId, nodeId, body, authUser) => {
  const workflow = await getById(workflowId, authUser);
  const definition = body?.definition || workflow.definition;
  const expression = String(body?.expression ?? "");
  const itemIndex =
    body?.itemIndex != null && Number.isInteger(Number(body.itemIndex))
      ? Number(body.itemIndex)
      : 0;
  const userId = authUser.userId;
  const session = editorSession.prepareSessionForDefinition(
    workflowId,
    userId,
    definition
  );
  const runInput = body?.input ?? session.input ?? {};

  const { context, itemIndex: safeIndex, pinnedNodeIds, staleNodeIds } =
    buildExpressionPreviewContext(
      definition,
      session,
      nodeId,
      itemIndex,
      runInput
    );

  const usesPinned = [...pinnedNodeIds].some((id) =>
    expression.includes(`steps.${id}`)
  );

  const referencedStepIds = [
    ...expression.matchAll(/steps\.([A-Za-z][\w-]*)/g),
  ].map((match) => match[1]);
  const staleReference = referencedStepIds.find(
    (id) => staleNodeIds.includes(id) && !pinnedNodeIds.has(id)
  );
  if (staleReference) {
    return {
      status: "STALE_CACHE",
      message:
        "Referenced step has changed. Run it again to preview the current value.",
      targetNodeId: staleReference,
      itemIndex: safeIndex,
      usesPinnedData: usesPinned,
    };
  }

  if (!expression.includes("{{")) {
    return {
      status: "IDLE",
      itemIndex: safeIndex,
      usesPinnedData: usesPinned,
    };
  }

  try {
    const value = resolveExpression(expression, context);
    if (value === "" || value == null) {
      return {
        status: "NO_DATA",
        value,
        itemIndex: safeIndex,
        usesPinnedData: usesPinned,
      };
    }
    return {
      status: "RESOLVED",
      value,
      itemIndex: safeIndex,
      usesPinnedData: usesPinned,
    };
  } catch (err) {
    if (err instanceof ExpressionReferenceError) {
      return {
        status: REASON_TO_PREVIEW_STATUS[err.reason] || "INVALID_EXPRESSION",
        reason: err.reason,
        message: err.message,
        targetNodeId: err.targetNodeId,
        itemIndex: safeIndex,
        usesPinnedData: usesPinned,
      };
    }
    return {
      status: "INVALID_EXPRESSION",
      message: err instanceof Error ? err.message : "Invalid expression",
      itemIndex: safeIndex,
      usesPinnedData: usesPinned,
    };
  }
};

const previewScheduleOccurrences = async (workflowId, body, authUser) => {
  const workflow = await getById(workflowId, authUser);
  const definition = body?.definition || workflow.definition;
  const nodeId = body?.nodeId;
  let data;
  if (body?.scheduleRules) {
    data = normalizeScheduleNodeData({
      scheduleRules: body.scheduleRules,
      timezone: body.timezone,
      cron: body.cron,
    });
  } else {
    const node = (definition?.nodes || []).find((n) => n.id === nodeId);
    if (!node) {
      throw new AppError("Schedule node not found", 404, "NOT_FOUND");
    }
    data = normalizeScheduleNodeData(node.data || {});
  }

  const errors = validateScheduleNodeData(data, definition);
  if (errors.length > 0) {
    throw new AppError(errors[0], 400, "VALIDATION_ERROR");
  }

  const count = Math.min(Number(body?.count) || 5, 10);
  const previews = (data.scheduleRules || []).map((rule) => {
    const zone = resolveTimezone(rule, data, definition);
    const occurrences = getNextScheduleOccurrences(rule, {
      count,
      nodeData: data,
      definition,
      anchor: rule.recurrenceAnchor,
    });
    return {
      ruleId: rule.id,
      timezone: zone,
      occurrences: occurrences.map((dt) => ({
        iso: dt.toISO(),
        label: formatOccurrencePreview(dt, zone),
      })),
    };
  });

  return { previews, count };
};

const cancelRun = async (runId, authUser) => {
  const run = await getRunById(runId, authUser);
  if (!["queued", "running", "waiting"].includes(run.status)) {
    throw new AppError(
      `Cannot cancel a run in status "${run.status}"`,
      400,
      "VALIDATION_ERROR"
    );
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `UPDATE workflow_waits
       SET status = 'cancelled'
       WHERE run_id = ? AND status IN ('waiting', 'claimed')`,
      [runId]
    );
    await connection.execute(
      `UPDATE workflow_jobs
       SET status = 'done', locked_at = NULL, locked_by = NULL
       WHERE run_id = ? AND status IN ('queued', 'locked')`,
      [runId]
    );
    await connection.execute(
      `UPDATE workflow_runs
       SET status = 'cancelled',
           finished_at = CURRENT_TIMESTAMP,
           waiting_node_id = NULL,
           resume_at = NULL
       WHERE id = ? AND status IN ('queued', 'running', 'waiting')`,
      [runId]
    );
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
  return getRunById(runId, authUser);
};

/**
 * Authenticated manual resume — signals wait; worker continues same run.
 * Does not execute the workflow inline.
 */
const resumeRun = async (workflowId, runId, authUser) => {
  const workflow = await getById(workflowId, authUser);
  const run = await getRunById(runId, authUser);
  if (run.workflowId !== workflow.id) {
    throw new AppError("Run does not belong to this workflow", 404, "NOT_FOUND");
  }
  if (run.status !== "waiting") {
    throw new AppError(
      `Cannot resume a run in status "${run.status}"`,
      400,
      "VALIDATION_ERROR"
    );
  }

  const { requestWaitResume, WAIT_MODES } = require("../../services/workflowWait.service");
  const result = await requestWaitResume({
    runId,
    mechanism: WAIT_MODES.MANUAL,
    actorUserId: authUser.userId,
  });

  if (!result.ok) {
    if (result.code === "WRONG_MODE") {
      throw new AppError(
        "This wait is not configured for manual resume",
        400,
        "VALIDATION_ERROR"
      );
    }
    if (result.code === "CANCELLED") {
      throw new AppError("Run was cancelled", 400, "VALIDATION_ERROR");
    }
    throw new AppError("Wait cannot be resumed", 400, "VALIDATION_ERROR");
  }

  return {
    accepted: true,
    idempotent: Boolean(result.idempotent),
    runId: result.runId,
    run: await getRunById(runId, authUser),
  };
};

/**
 * Public external resume by opaque token — no auth session.
 * Always returns generic outcomes suitable for anonymous callers.
 */
const resumeByExternalToken = async (rawToken) => {
  const { requestWaitResume, WAIT_MODES } = require("../../services/workflowWait.service");
  if (!rawToken || typeof rawToken !== "string" || rawToken.length > 512) {
    return { status: 404, body: { ok: false, code: "INVALID" } };
  }

  const result = await requestWaitResume({
    mechanism: WAIT_MODES.EXTERNAL,
    token: rawToken,
  });

  if (!result.ok) {
    return { status: 404, body: { ok: false, code: "INVALID" } };
  }

  return {
    status: 202,
    body: {
      ok: true,
      accepted: true,
      idempotent: Boolean(result.idempotent),
    },
  };
};

module.exports = {
  listAll,
  listByWorkspace,
  getById,
  create,
  update,
  remove,
  startRun,
  getRunById,
  listRuns,
  cancelRun,
  resumeRun,
  resumeByExternalToken,
  executeNodeStep,
  runToNode,
  executePrevious,
  getNodeInput,
  getEditorSession,
  previewExpression,
  previewScheduleOccurrences,
  invalidateEditorSession,
  emptyDefinition,
};
