/**
 * Part 10A — Sub-workflow execution foundation (internal orchestration).
 *
 * Parent and child are separate durable workflow_runs. Parent waits via
 * workflow_run_dependencies (not Wait-node rows). Invocation is idempotent
 * per (parentRunId, parentNodeId, parentExecutionIndex).
 */

const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/database");
const AppError = require("../utils/AppError");
const { assertWorkspaceAccess } = require("./authorization.service");
const {
  buildExecutionSnapshot,
  normalizeWaitSnapshot,
} = require("./workflowWait.service");

const MAX_SUBWORKFLOW_DEPTH = 10;
const WAITING_REASON_CHILD = "child_run";
const WAITING_REASON_WAIT_NODE = "wait_node";
const SUBWORKFLOW_SOURCE = "subworkflow";
const CHILD_CANCELLED_CODE = "CHILD_RUN_CANCELLED";
const CHILD_FAILED_CODE = "CHILD_RUN_FAILED";

const TERMINAL_RUN = new Set(["succeeded", "failed", "cancelled"]);
const ACTIVE_RUN = new Set(["queued", "running", "waiting"]);

const parseJson = (value, fallback = null) => {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const toItem = (raw) => {
  if (raw == null) return { json: null };
  if (typeof raw === "object" && !Array.isArray(raw)) {
    if (
      Object.prototype.hasOwnProperty.call(raw, "json") ||
      Object.prototype.hasOwnProperty.call(raw, "binary")
    ) {
      const item = { json: raw.json ?? null };
      if (raw.binary != null) item.binary = raw.binary;
      if (raw.pairedItem !== undefined) item.pairedItem = raw.pairedItem;
      return item;
    }
    return { json: raw };
  }
  return { json: raw };
};

/** Canonical WorkflowItem[] for invocation input/output. */
const normalizeInvocationItems = (inputItems) => {
  if (inputItems == null) return [];
  if (!Array.isArray(inputItems)) {
    throw new AppError(
      "Sub-workflow inputItems must be a WorkflowItem[]",
      400,
      "VALIDATION_ERROR"
    );
  }
  return inputItems.map(toItem);
};

/** Strip pairedItem at parent↔child boundary (transformation boundary). */
const boundaryItems = (items) =>
  normalizeInvocationItems(items).map((it) => {
    const next = { json: it.json ?? null };
    if (it.binary != null) next.binary = it.binary;
    return next;
  });

const countResultNodes = (definition) => {
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  return nodes.filter((n) => (n.type || n.data?.nodeType) === "result");
};

const countWorkflowTriggerNodes = (definition) => {
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  return nodes.filter(
    (n) => (n.type || n.data?.nodeType) === "workflowTrigger"
  );
};

const isReachableFrom = (definition, fromId, toId) => {
  if (!fromId || !toId) return false;
  if (fromId === toId) return true;
  const edges = Array.isArray(definition?.edges) ? definition.edges : [];
  const outgoing = new Map();
  for (const e of edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source).push(e.target);
  }
  const seen = new Set();
  const queue = [fromId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of outgoing.get(id) || []) {
      if (next === toId) return true;
      if (!seen.has(next)) queue.push(next);
    }
  }
  return false;
};

/**
 * V1 callable contract (authoritative).
 * Exactly one Workflow Trigger, exactly one Result, Result reachable from Trigger.
 */
const validateCallableWorkflow = (definition) => {
  const triggers = countWorkflowTriggerNodes(definition);
  const results = countResultNodes(definition);
  const errors = [];

  if (triggers.length === 0) {
    errors.push("Callable workflow requires exactly one Workflow Trigger");
  } else if (triggers.length > 1) {
    errors.push("Callable workflow must have exactly one Workflow Trigger");
  }

  if (results.length === 0) {
    errors.push("Callable workflow requires exactly one Result node");
  } else if (results.length > 1) {
    errors.push("Callable workflow must have exactly one Result node");
  }

  const workflowTriggerNodeId = triggers.length === 1 ? triggers[0].id : null;
  const resultNodeId = results.length === 1 ? results[0].id : null;

  if (
    workflowTriggerNodeId &&
    resultNodeId &&
    !isReachableFrom(definition, workflowTriggerNodeId, resultNodeId)
  ) {
    errors.push("Result must be reachable from Workflow Trigger");
  }

  return {
    valid: errors.length === 0,
    workflowTriggerNodeId,
    resultNodeId,
    errors,
  };
};

/**
 * Throws AppError when definition is not callable.
 */
const assertCallableChildDefinition = (definition) => {
  const check = validateCallableWorkflow(definition);
  if (!check.valid) {
    const message = check.errors[0] || "Workflow is not callable";
    const code =
      /Trigger/.test(message) && !/reachable/i.test(message)
        ? "SUBWORKFLOW_ENTRY_REQUIRED"
        : "SUBWORKFLOW_AMBIGUOUS_OUTPUT";
    throw new AppError(message, 400, code);
  }
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  const resultNode = nodes.find((n) => n.id === check.resultNodeId);
  return {
    resultNode,
    workflowTriggerNodeId: check.workflowTriggerNodeId,
    resultNodeId: check.resultNodeId,
  };
};

const loadRunRow = async (runId, connection = pool) => {
  const [rows] = await connection.execute(
    `SELECT r.*, w.workspace_id, w.definition_json AS live_definition_json,
            w.name AS workflow_live_name, w.deleted_at
     FROM workflow_runs r
     INNER JOIN workflows w ON w.id = r.workflow_id
     WHERE r.id = ?`,
    [runId]
  );
  return rows[0] || null;
};

const loadWorkflowRow = async (workflowId, connection = pool) => {
  const [rows] = await connection.execute(
    `SELECT * FROM workflows WHERE id = ?`,
    [workflowId]
  );
  return rows[0] || null;
};

const isLiveWorkflowRow = (row) =>
  row && (row.deleted_at == null || row.deleted_at === undefined);

const childWorkflowNotFound = () =>
  new AppError(
    "Child workflow not found",
    404,
    "CHILD_WORKFLOW_NOT_FOUND"
  );

const getRunDepth = async (runId, connection = pool) => {
  let depth = 0;
  let current = runId;
  const seen = new Set();
  while (current) {
    if (seen.has(current)) break;
    seen.add(current);
    const row = await loadRunRow(current, connection);
    if (!row?.parent_run_id) break;
    depth += 1;
    current = row.parent_run_id;
    if (depth > MAX_SUBWORKFLOW_DEPTH + 2) break;
  }
  return depth;
};

const collectAncestorWorkflowIds = async (runId, connection = pool) => {
  const ids = [];
  let current = runId;
  const seen = new Set();
  while (current) {
    if (seen.has(current)) break;
    seen.add(current);
    const row = await loadRunRow(current, connection);
    if (!row) break;
    ids.push(row.workflow_id);
    current = row.parent_run_id;
  }
  return ids;
};

const assertRecursionAndDepth = async ({
  parentRunId,
  childWorkflowId,
  connection = pool,
}) => {
  const parentDepth = await getRunDepth(parentRunId, connection);
  if (parentDepth + 1 > MAX_SUBWORKFLOW_DEPTH) {
    throw new AppError(
      `Sub-workflow depth limit exceeded (max ${MAX_SUBWORKFLOW_DEPTH})`,
      400,
      "SUBWORKFLOW_DEPTH"
    );
  }
  const ancestorWorkflowIds = await collectAncestorWorkflowIds(
    parentRunId,
    connection
  );
  if (ancestorWorkflowIds.includes(childWorkflowId)) {
    throw new AppError(
      "Recursive sub-workflow invocation is not allowed",
      400,
      "SUBWORKFLOW_RECURSION"
    );
  }
};

/**
 * Authoritative callable return items for a succeeded child run.
 *
 * Priority:
 * 1. Exactly one succeeded Result step's `__callableReturnItems`
 *    (incoming WorkflowItem[] at Result — Part 10B.1)
 * 2. Compatibility cache: run.output.__subworkflowItems
 *    (written once from the same source at child success)
 *
 * Multiple succeeded Result occurrences → ambiguous (never silently pick latest).
 * Do not treat Result's mapFrom scalar / derived wrapper `items` as business return.
 */
const extractResultItemsFromRun = async (runRow, definition) => {
  const check = validateCallableWorkflow(definition);
  if (!check.valid) {
    assertCallableChildDefinition(definition);
  }
  const resultNodeId = check.resultNodeId;

  if (resultNodeId) {
    const [steps] = await pool.execute(
      `SELECT execution_index, output_json, status
       FROM workflow_run_steps
       WHERE run_id = ? AND node_id = ? AND status = 'succeeded'
       ORDER BY execution_index ASC`,
      [runRow.id, resultNodeId]
    );
    if (steps.length > 1) {
      const err = new Error(
        "Callable Result executed more than once; return is ambiguous"
      );
      err.code = "SUBWORKFLOW_AMBIGUOUS_OUTPUT";
      throw err;
    }
    if (steps.length === 1) {
      const stepOut = parseJson(steps[0].output_json, null);
      if (stepOut && Array.isArray(stepOut.__callableReturnItems)) {
        return boundaryItems(stepOut.__callableReturnItems);
      }
    }
  }

  const output = parseJson(runRow.output_json, null);
  if (output && Array.isArray(output.__subworkflowItems)) {
    return boundaryItems(output.__subworkflowItems);
  }
  return [];
};

const getSubworkflowResult = async (childRunId) => {
  const row = await loadRunRow(childRunId);
  if (!row) {
    throw new AppError("Child workflow run not found", 404, "NOT_FOUND");
  }
  const definition = parseJson(
    row.definition_snapshot_json || row.live_definition_json,
    { version: 1, nodes: [], edges: [] }
  );
  const status = row.status;
  if (status === "succeeded") {
    let items = [];
    try {
      items = await extractResultItemsFromRun(row, definition);
    } catch (err) {
      return {
        status: "failed",
        items: [],
        error: {
          code: err.code || "SUBWORKFLOW_AMBIGUOUS_OUTPUT",
          message: err.message || "Ambiguous child output",
          childRunId,
          childWorkflowId: row.workflow_id,
        },
      };
    }
    return {
      status: "succeeded",
      items,
      error: null,
      childRunId,
      childWorkflowId: row.workflow_id,
    };
  }
  if (status === "cancelled") {
    return {
      status: "cancelled",
      items: [],
      error: {
        code: CHILD_CANCELLED_CODE,
        message: "Child workflow run was cancelled",
        childRunId,
        childWorkflowId: row.workflow_id,
      },
    };
  }
  if (status === "failed") {
    return {
      status: "failed",
      items: [],
      error: {
        code: CHILD_FAILED_CODE,
        message: String(row.error || "Child workflow run failed").slice(0, 2000),
        childRunId,
        childWorkflowId: row.workflow_id,
      },
    };
  }
  return {
    status,
    items: [],
    error: null,
    childRunId,
    childWorkflowId: row.workflow_id,
  };
};

const getChildRuns = async (parentRunId) => {
  const [rows] = await pool.execute(
    `SELECT id, workflow_id, workflow_name_snapshot, status, parent_run_id, parent_node_id,
            parent_execution_index, root_run_id, error, started_at, finished_at, created_at
     FROM workflow_runs
     WHERE parent_run_id = ?
     ORDER BY created_at ASC`,
    [parentRunId]
  );
  return rows.map((r) => ({
    id: r.id,
    workflowId: r.workflow_id,
    workflowNameSnapshot: r.workflow_name_snapshot || null,
    status: r.status,
    parentRunId: r.parent_run_id,
    parentNodeId: r.parent_node_id,
    parentExecutionIndex: r.parent_execution_index,
    rootRunId: r.root_run_id,
    error: r.error,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    createdAt: r.created_at,
  }));
};

const findChildByInvocation = async (
  parentRunId,
  parentNodeId,
  parentExecutionIndex,
  connection = pool
) => {
  const [rows] = await connection.execute(
    `SELECT * FROM workflow_runs
     WHERE parent_run_id = ?
       AND parent_node_id = ?
       AND parent_execution_index = ?
     LIMIT 1`,
    [parentRunId, parentNodeId, Number(parentExecutionIndex) || 0]
  );
  return rows[0] || null;
};

/**
 * Part 10C — Safe run lineage for workspace UX.
 * No credentials, tokens, snapshots, or dependency row dumps.
 */
const resolveWorkflowNames = async (workflowIds) => {
  const ids = [...new Set((workflowIds || []).filter(Boolean))];
  const map = new Map();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await pool.execute(
    `SELECT id, name, status, deleted_at FROM workflows WHERE id IN (${placeholders})`,
    ids
  );
  for (const row of rows) {
    map.set(row.id, {
      name: row.name,
      status: row.status,
      deleted: row.deleted_at != null,
    });
  }
  for (const id of ids) {
    if (!map.has(id)) {
      map.set(id, { name: null, status: null, deleted: true });
    }
  }
  return map;
};

const formatLineageRun = (row, nameInfo) => {
  const deleted = Boolean(nameInfo?.deleted);
  const snapshotName = row.workflow_name_snapshot || row.workflowNameSnapshot || null;
  const liveName = nameInfo?.name || null;
  let workflowName;
  if (deleted) {
    workflowName = snapshotName || liveName || "Deleted workflow";
  } else {
    workflowName = liveName || snapshotName || "Untitled workflow";
  }
  return {
    runId: row.id || row.runId,
    workflowId: row.workflow_id || row.workflowId,
    workflowName,
    workflowDeleted: deleted,
    status: row.status,
    waitingReason: row.waiting_reason || row.waitingReason || null,
    waitingNodeId: row.waiting_node_id || row.waitingNodeId || null,
    resumeAt: row.resume_at || row.resumeAt || null,
    parentRunId: row.parent_run_id || row.parentRunId || null,
    parentNodeId: row.parent_node_id || row.parentNodeId || null,
    parentExecutionIndex:
      row.parent_execution_index == null && row.parentExecutionIndex == null
        ? null
        : Number(row.parent_execution_index ?? row.parentExecutionIndex) || 0,
    rootRunId: row.root_run_id || row.rootRunId || null,
    startedAt: row.started_at || row.startedAt || null,
    finishedAt: row.finished_at || row.finishedAt || null,
    createdAt: row.created_at || row.createdAt || null,
    error: row.error ? String(row.error).slice(0, 500) : null,
  };
};

/**
 * Authorized lineage for a run. Walks ancestors via parent_run_id (≤ depth)
 * and lists direct children in created order.
 */
const buildRunLineage = async (runId, authUser) => {
  const row = await loadRunRow(runId);
  if (!row) {
    throw new AppError("Workflow run not found", 404, "NOT_FOUND");
  }
  await assertWorkspaceAccess(authUser, row.workspace_id);

  const ancestors = [];
  let currentParentId = row.parent_run_id;
  const seen = new Set([runId]);
  for (let depth = 0; depth < MAX_SUBWORKFLOW_DEPTH && currentParentId; depth += 1) {
    if (seen.has(currentParentId)) break;
    seen.add(currentParentId);
    const parent = await loadRunRow(currentParentId);
    if (!parent) break;
    if (parent.workspace_id !== row.workspace_id) break;
    ancestors.unshift(parent);
    currentParentId = parent.parent_run_id;
  }

  const childrenRaw = await getChildRuns(runId);
  const workflowIds = [
    row.workflow_id,
    ...ancestors.map((a) => a.workflow_id),
    ...childrenRaw.map((c) => c.workflowId),
  ];
  const names = await resolveWorkflowNames(workflowIds);

  const self = formatLineageRun(row, names.get(row.workflow_id));
  const ancestorRuns = ancestors.map((a) =>
    formatLineageRun(a, names.get(a.workflow_id))
  );
  const children = childrenRaw.map((c) =>
    formatLineageRun(
      {
        id: c.id,
        workflow_id: c.workflowId,
        workflow_name_snapshot: c.workflowNameSnapshot,
        status: c.status,
        parent_run_id: c.parentRunId,
        parent_node_id: c.parentNodeId,
        parent_execution_index: c.parentExecutionIndex,
        root_run_id: c.rootRunId,
        error: c.error,
        started_at: c.startedAt,
        finished_at: c.finishedAt,
        created_at: c.createdAt,
      },
      names.get(c.workflowId)
    )
  );

  const breadcrumb = [...ancestorRuns, self].map((r) => ({
    runId: r.runId,
    workflowId: r.workflowId,
    workflowName: r.workflowName,
    workflowDeleted: r.workflowDeleted,
    status: r.status,
  }));

  return {
    run: self,
    ancestors: ancestorRuns,
    children,
    breadcrumb,
    rootRunId: self.rootRunId || self.runId,
  };
};

/**
 * Safe summary for one Execute Workflow occurrence (parent step → child).
 */
const getChildInvocationSummary = async (
  parentRunId,
  parentNodeId,
  parentExecutionIndex,
  authUser
) => {
  const parent = await loadRunRow(parentRunId);
  if (!parent) {
    throw new AppError("Workflow run not found", 404, "NOT_FOUND");
  }
  await assertWorkspaceAccess(authUser, parent.workspace_id);

  const child = await findChildByInvocation(
    parentRunId,
    parentNodeId,
    parentExecutionIndex
  );
  if (!child) return null;

  const childFull = await loadRunRow(child.id);
  if (!childFull) return null;
  if (childFull.workspace_id !== parent.workspace_id) {
    throw new AppError("Forbidden", 403, "FORBIDDEN");
  }

  const names = await resolveWorkflowNames([childFull.workflow_id]);
  const summary = formatLineageRun(
    childFull,
    names.get(childFull.workflow_id)
  );

  let childWait = null;
  if (childFull.status === "waiting") {
    try {
      const { getActiveWaitForRun } = require("./workflowWait.service");
      const active = await getActiveWaitForRun(childFull.id);
      if (active) {
        childWait = {
          resumeMode: active.resumeMode || null,
          waitStatus: active.status || null,
          resumeAt: active.resumeAt || null,
        };
      }
    } catch {
      childWait = null;
    }
  }

  return {
    ...summary,
    parentRunId,
    parentNodeId,
    parentExecutionIndex: Number(parentExecutionIndex) || 0,
    childWait,
    // Soft-deleted child: open historical run; hide live definition.
    openRunPath: `/workflows/${summary.workflowId}?runId=${encodeURIComponent(summary.runId)}`,
    openWorkflowPath: summary.workflowDeleted
      ? null
      : `/workflows/${summary.workflowId}`,
  };
};

const parkParentJob = async (parentRunId, jobId, connection) => {
  // TIMESTAMP max is 2038 — park with a bounded far-future interval (same idea as Wait hold).
  if (jobId) {
    await connection.execute(
      `UPDATE workflow_jobs
       SET status = 'queued',
           locked_at = NULL,
           locked_by = NULL,
           available_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 30 DAY),
           attempts = 0
       WHERE id = ?`,
      [jobId]
    );
  } else {
    await connection.execute(
      `UPDATE workflow_jobs
       SET status = 'queued',
           locked_at = NULL,
           locked_by = NULL,
           available_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 30 DAY),
           attempts = 0
       WHERE run_id = ? AND status IN ('locked', 'queued')`,
      [parentRunId]
    );
  }
};

const wakeParentJob = async (parentRunId, connection = pool) => {
  await connection.execute(
    `UPDATE workflow_jobs
     SET status = 'queued',
         locked_at = NULL,
         locked_by = NULL,
         available_at = CURRENT_TIMESTAMP,
         attempts = 0
     WHERE run_id = ? AND status IN ('queued', 'locked')`,
    [parentRunId]
  );
};

const suspendParentForChild = async ({
  parentRunId,
  parentNodeId,
  parentExecutionIndex,
  parentStepId = null,
  childRunId,
  snapshot,
  jobId = null,
}) => {
  const depId = uuidv4();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [existing] = await connection.execute(
      `SELECT id, status FROM workflow_run_dependencies
       WHERE parent_run_id = ? AND parent_node_id = ? AND parent_execution_index = ?
       LIMIT 1 FOR UPDATE`,
      [parentRunId, parentNodeId, Number(parentExecutionIndex) || 0]
    );

    if (existing.length > 0) {
      if (existing[0].status === "waiting") {
        await connection.execute(
          `UPDATE workflow_run_dependencies
           SET snapshot_json = ?, child_run_id = ?, parent_step_id = COALESCE(?, parent_step_id)
           WHERE id = ?`,
          [
            JSON.stringify(snapshot),
            childRunId,
            parentStepId,
            existing[0].id,
          ]
        );
      }
    } else {
      await connection.execute(
        `INSERT INTO workflow_run_dependencies
          (id, parent_run_id, child_run_id, parent_node_id, parent_execution_index,
           parent_step_id, status, snapshot_json)
         VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?)`,
        [
          depId,
          parentRunId,
          childRunId,
          parentNodeId,
          Number(parentExecutionIndex) || 0,
          parentStepId,
          JSON.stringify(snapshot),
        ]
      );
    }

    await connection.execute(
      `UPDATE workflow_runs
       SET status = 'waiting',
           waiting_node_id = ?,
           waiting_reason = ?,
           resume_at = NULL,
           finished_at = NULL,
           error = NULL
       WHERE id = ? AND status IN ('running', 'queued', 'waiting')`,
      [parentNodeId, WAITING_REASON_CHILD, parentRunId]
    );

    if (parentStepId) {
      await connection.execute(
        `UPDATE workflow_run_steps
         SET status = 'waiting',
             output_json = ?,
             finished_at = NULL
         WHERE id = ?`,
        [
          JSON.stringify({
            waiting: true,
            waitingReason: WAITING_REASON_CHILD,
            childRunId,
            parentNodeId,
            parentExecutionIndex: Number(parentExecutionIndex) || 0,
          }),
          parentStepId,
        ]
      );
    }

    await parkParentJob(parentRunId, jobId, connection);
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};

const invokeSubworkflow = async ({
  parentRunId,
  parentNodeId,
  parentExecutionIndex = 0,
  parentStepId = null,
  childWorkflowId,
  inputItems,
  parentSnapshot,
  authUser,
  jobId = null,
  childDefinitionOverride = null,
}) => {
  if (!parentRunId || !parentNodeId || !childWorkflowId) {
    throw new AppError(
      "parentRunId, parentNodeId, and childWorkflowId are required",
      400,
      "VALIDATION_ERROR"
    );
  }
  const execIndex = Number(parentExecutionIndex) || 0;
  const items = normalizeInvocationItems(inputItems);

  const parent = await loadRunRow(parentRunId);
  if (!parent) {
    throw new AppError("Parent workflow run not found", 404, "NOT_FOUND");
  }
  await assertWorkspaceAccess(authUser, parent.workspace_id);

  const childWf = await loadWorkflowRow(childWorkflowId);
  if (!childWf || !isLiveWorkflowRow(childWf)) {
    throw childWorkflowNotFound();
  }
  if (childWf.workspace_id !== parent.workspace_id) {
    throw new AppError(
      "Sub-workflow must belong to the same workspace",
      403,
      "FORBIDDEN"
    );
  }
  await assertWorkspaceAccess(authUser, childWf.workspace_id);

  const childDefinition =
    childDefinitionOverride ||
    parseJson(childWf.definition_json, { version: 1, nodes: [], edges: [] });
  assertCallableChildDefinition(childDefinition);
  await assertRecursionAndDepth({ parentRunId, childWorkflowId });

  const existing = await findChildByInvocation(
    parentRunId,
    parentNodeId,
    execIndex
  );
  if (existing) {
    if (parentSnapshot && ACTIVE_RUN.has(existing.status)) {
      await suspendParentForChild({
        parentRunId,
        parentNodeId,
        parentExecutionIndex: execIndex,
        parentStepId,
        childRunId: existing.id,
        snapshot: parentSnapshot,
        jobId,
      });
      return {
        reused: true,
        childRunId: existing.id,
        status: "waiting",
        waiting: true,
      };
    }
    if (parentSnapshot && TERMINAL_RUN.has(existing.status)) {
      await notifyParentOfChildTerminal(existing.id);
    }
    return {
      reused: true,
      childRunId: existing.id,
      status: existing.status,
      waiting: ACTIVE_RUN.has(existing.status),
      terminal: TERMINAL_RUN.has(existing.status),
    };
  }

  const rootRunId = parent.root_run_id || parent.id;
  const childRunId = uuidv4();
  const childJobId = uuidv4();
  const inputPayload = {
    source: SUBWORKFLOW_SOURCE,
    items,
    parentRunId,
    parentNodeId,
    parentExecutionIndex: execIndex,
  };
  const suppressErrorRouting = Number(parent.suppress_error_routing) === 1 ? 1 : 0;
  const childErrorSnapshot = suppressErrorRouting
    ? null
    : childWf.error_workflow_id || null;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await assertRecursionAndDepth({
      parentRunId,
      childWorkflowId,
      connection,
    });

    try {
      await connection.execute(
        `INSERT INTO workflow_runs
          (id, workflow_id, workflow_name_snapshot, error_workflow_id_snapshot,
           suppress_error_routing, parent_run_id, parent_node_id,
           parent_execution_index, root_run_id, status, input_json,
           definition_snapshot_json, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
        [
          childRunId,
          childWorkflowId,
          childWf.name || null,
          childErrorSnapshot,
          suppressErrorRouting,
          parentRunId,
          parentNodeId,
          execIndex,
          rootRunId,
          JSON.stringify(inputPayload),
          JSON.stringify(childDefinition),
          authUser.userId,
        ]
      );
    } catch (err) {
      if (err?.code === "ER_DUP_ENTRY") {
        await connection.rollback();
        const raced = await findChildByInvocation(
          parentRunId,
          parentNodeId,
          execIndex
        );
        if (raced) {
          if (parentSnapshot && ACTIVE_RUN.has(raced.status)) {
            await suspendParentForChild({
              parentRunId,
              parentNodeId,
              parentExecutionIndex: execIndex,
              parentStepId,
              childRunId: raced.id,
              snapshot: parentSnapshot,
              jobId,
            });
          }
          return {
            reused: true,
            childRunId: raced.id,
            status: raced.status,
            waiting: ACTIVE_RUN.has(raced.status),
          };
        }
        throw err;
      }
      throw err;
    }

    await connection.execute(
      `INSERT INTO workflow_jobs (id, run_id, status, available_at)
       VALUES (?, ?, 'queued', CURRENT_TIMESTAMP)`,
      [childJobId, childRunId]
    );
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  if (parentSnapshot) {
    await suspendParentForChild({
      parentRunId,
      parentNodeId,
      parentExecutionIndex: execIndex,
      parentStepId,
      childRunId,
      snapshot: parentSnapshot,
      jobId,
    });
  }

  return {
    reused: false,
    childRunId,
    status: parentSnapshot ? "waiting" : "queued",
    waiting: Boolean(parentSnapshot),
  };
};

const notifyParentOfChildTerminal = async (childRunId) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [deps] = await connection.execute(
      `SELECT * FROM workflow_run_dependencies
       WHERE child_run_id = ? FOR UPDATE`,
      [childRunId]
    );
    if (deps.length === 0) {
      await connection.commit();
      return { woke: false, reason: "no_dependency" };
    }
    const dep = deps[0];
    if (dep.status !== "waiting") {
      await connection.commit();
      return { woke: false, reason: "already_settled", idempotent: true };
    }

    const child = await loadRunRow(childRunId, connection);
    if (!child || !TERMINAL_RUN.has(child.status)) {
      await connection.commit();
      return { woke: false, reason: "child_not_terminal" };
    }

    const nextDepStatus =
      child.status === "succeeded"
        ? "completed"
        : child.status === "cancelled"
          ? "cancelled"
          : "failed";

    await connection.execute(
      `UPDATE workflow_run_dependencies
       SET status = ?, completed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'waiting'`,
      [nextDepStatus, dep.id]
    );

    const [parentRows] = await connection.execute(
      `SELECT id, status, waiting_reason FROM workflow_runs WHERE id = ? FOR UPDATE`,
      [dep.parent_run_id]
    );
    if (
      parentRows.length > 0 &&
      parentRows[0].status === "waiting" &&
      parentRows[0].waiting_reason === WAITING_REASON_CHILD
    ) {
      await connection.execute(
        `UPDATE workflow_runs
         SET resume_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'waiting'`,
        [dep.parent_run_id]
      );
      await wakeParentJob(dep.parent_run_id, connection);
    }

    await connection.commit();
    return { woke: true, parentRunId: dep.parent_run_id, depStatus: nextDepStatus };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};

const reconcileOrphanedChildWaits = async (limit = 50) => {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const [rows] = await pool.execute(
    `SELECT d.child_run_id
     FROM workflow_run_dependencies d
     INNER JOIN workflow_runs c ON c.id = d.child_run_id
     INNER JOIN workflow_runs p ON p.id = d.parent_run_id
     WHERE d.status = 'waiting'
       AND c.status IN ('succeeded', 'failed', 'cancelled')
       AND p.status = 'waiting'
       AND p.waiting_reason = ?
     ORDER BY d.updated_at ASC
     LIMIT ${safeLimit}`,
    [WAITING_REASON_CHILD]
  );
  const results = [];
  for (const row of rows) {
    results.push(await notifyParentOfChildTerminal(row.child_run_id));
  }
  return results;
};

const claimDueChildDependency = async (parentRunId, claimToken) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    let [deps] = await connection.execute(
      `SELECT d.*
       FROM workflow_run_dependencies d
       INNER JOIN workflow_runs c ON c.id = d.child_run_id
       WHERE d.parent_run_id = ?
         AND d.status IN ('completed', 'failed', 'cancelled')
         AND c.status IN ('succeeded', 'failed', 'cancelled')
       ORDER BY d.completed_at ASC
       LIMIT 1
       FOR UPDATE`,
      [parentRunId]
    );

    if (deps.length === 0) {
      const [stuck] = await connection.execute(
        `SELECT d.*, c.status AS child_status
         FROM workflow_run_dependencies d
         INNER JOIN workflow_runs c ON c.id = d.child_run_id
         WHERE d.parent_run_id = ?
           AND d.status = 'waiting'
           AND c.status IN ('succeeded', 'failed', 'cancelled')
         LIMIT 1
         FOR UPDATE`,
        [parentRunId]
      );
      if (stuck.length === 0) {
        await connection.commit();
        return null;
      }
      const st = stuck[0];
      const next =
        st.child_status === "succeeded"
          ? "completed"
          : st.child_status === "cancelled"
            ? "cancelled"
            : "failed";
      await connection.execute(
        `UPDATE workflow_run_dependencies
         SET status = ?, completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
         WHERE id = ?`,
        [next, st.id]
      );
      deps = [{ ...st, status: next }];
    }

    const dep = deps[0];
    const [parentRows] = await connection.execute(
      `SELECT * FROM workflow_runs WHERE id = ? FOR UPDATE`,
      [parentRunId]
    );
    if (
      parentRows.length === 0 ||
      parentRows[0].status !== "waiting" ||
      parentRows[0].waiting_reason !== WAITING_REASON_CHILD
    ) {
      await connection.commit();
      return null;
    }

    await connection.execute(
      `UPDATE workflow_runs
       SET status = 'running',
           waiting_node_id = NULL,
           waiting_reason = NULL,
           resume_at = NULL
       WHERE id = ? AND status = 'waiting'`,
      [parentRunId]
    );

    await connection.execute(
      `UPDATE workflow_run_dependencies
       SET wake_token = ?, woken_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [claimToken || null, dep.id]
    );

    await connection.commit();

    const childResult = await getSubworkflowResult(dep.child_run_id);
    return {
      id: dep.id,
      parentRunId,
      childRunId: dep.child_run_id,
      parentNodeId: dep.parent_node_id,
      parentExecutionIndex: dep.parent_execution_index,
      parentStepId: dep.parent_step_id,
      depStatus: dep.status,
      snapshot: normalizeWaitSnapshot(parseJson(dep.snapshot_json, {})),
      childResult,
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};

const cancelActiveChildRuns = async (parentRunId) => {
  const children = await getChildRuns(parentRunId);
  const cancelled = [];
  for (const child of children) {
    if (!ACTIVE_RUN.has(child.status)) continue;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `UPDATE workflow_waits
         SET status = 'cancelled'
         WHERE run_id = ? AND status IN ('waiting', 'claimed')`,
        [child.id]
      );
      await connection.execute(
        `UPDATE workflow_jobs
         SET status = 'done', locked_at = NULL, locked_by = NULL
         WHERE run_id = ? AND status IN ('queued', 'locked')`,
        [child.id]
      );
      await connection.execute(
        `UPDATE workflow_runs
         SET status = 'cancelled',
             finished_at = CURRENT_TIMESTAMP,
             waiting_node_id = NULL,
             waiting_reason = NULL,
             resume_at = NULL
         WHERE id = ? AND status IN ('queued', 'running', 'waiting')`,
        [child.id]
      );
      await connection.execute(
        `UPDATE workflow_run_dependencies
         SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP
         WHERE child_run_id = ? AND status = 'waiting'`,
        [child.id]
      );
      await connection.commit();
      cancelled.push(child.id);
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
    await cancelActiveChildRuns(child.id);
    await notifyParentOfChildTerminal(child.id);
  }
  return cancelled;
};

const buildChildWaitSnapshot = (options) => {
  const base = buildExecutionSnapshot({
    waitNodeId: options.parentNodeId || options.waitNodeId,
    waitStepId: options.parentStepId || options.waitStepId,
    waitExecutionIndex:
      options.parentExecutionIndex != null
        ? options.parentExecutionIndex
        : options.waitExecutionIndex,
    waitInputItems: options.waitInputItems || options.inputItems || [],
    context: options.context,
    scheduler: options.scheduler,
    finalOutput: options.finalOutput,
    runErrors: options.runErrors,
    waitCompleted: false,
  });
  return {
    ...base,
    kind: "child_wait",
    childWait: {
      parentNodeId: options.parentNodeId || options.waitNodeId,
      parentExecutionIndex:
        options.parentExecutionIndex != null
          ? Number(options.parentExecutionIndex) || 0
          : Number(options.waitExecutionIndex) || 0,
      parentStepId: options.parentStepId || options.waitStepId || null,
      childRunId: options.childRunId || null,
    },
  };
};

module.exports = {
  MAX_SUBWORKFLOW_DEPTH,
  WAITING_REASON_CHILD,
  WAITING_REASON_WAIT_NODE,
  SUBWORKFLOW_SOURCE,
  CHILD_CANCELLED_CODE,
  CHILD_FAILED_CODE,
  normalizeInvocationItems,
  validateCallableWorkflow,
  assertCallableChildDefinition,
  extractResultItemsFromRun,
  getSubworkflowResult,
  getChildRuns,
  invokeSubworkflow,
  suspendParentForChild,
  notifyParentOfChildTerminal,
  reconcileOrphanedChildWaits,
  claimDueChildDependency,
  cancelActiveChildRuns,
  buildChildWaitSnapshot,
  findChildByInvocation,
  assertRecursionAndDepth,
  getRunDepth,
  boundaryItems,
  isReachableFrom,
  buildRunLineage,
  getChildInvocationSummary,
};
