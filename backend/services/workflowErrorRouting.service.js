/**
 * Part 11A — Durable Error Workflow / failure routing foundation.
 * Source FAILED → durable dispatch → independent Error run (async).
 */
const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/database");
const AppError = require("../utils/AppError");

const ERROR_WORKFLOW_SOURCE = "error_workflow";
const DISPATCH_STATUSES = Object.freeze({
  PENDING: "pending",
  CLAIMED: "claimed",
  DISPATCHED: "dispatched",
  UNAVAILABLE: "unavailable",
  FAILED: "failed",
});
const OUTCOME = Object.freeze({
  TARGET_UNAVAILABLE: "TARGET_UNAVAILABLE",
  ERROR_WORKFLOW_NOT_CALLABLE: "ERROR_WORKFLOW_NOT_CALLABLE",
  CROSS_WORKSPACE: "CROSS_WORKSPACE",
  SUPPRESSED: "SUPPRESSED",
  DISPATCHED: "DISPATCHED",
});

const CLAIM_LEASE_MS =
  Number(process.env.WORKFLOW_ERROR_DISPATCH_LEASE_MS) || 60_000;
const RECONCILE_LOOKBACK_HOURS =
  Number(process.env.WORKFLOW_ERROR_RECONCILE_LOOKBACK_HOURS) || 24;

const parseJson = (value, fallback = null) => {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const sanitizeMessage = (raw) => {
  let msg = String(raw || "Workflow failed").slice(0, 2000);
  msg = msg.replace(
    /(api[_-]?key|authorization|bearer|password|secret|token)\s*[:=]\s*\S+/gi,
    "$1=[redacted]"
  );
  return msg;
};

const sanitizeCode = (raw) => {
  if (raw == null || raw === "") return "WORKFLOW_FAILED";
  return String(raw).slice(0, 128);
};

/**
 * Callable contract for Error Workflow targets: exactly one Error Trigger.
 * Result is NOT required (unlike Execute Workflow callables).
 */
const validateErrorWorkflow = (definition) => {
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  const triggers = nodes.filter(
    (n) => (n.type || n.data?.nodeType) === "errorTrigger"
  );
  const errors = [];
  if (triggers.length === 0) {
    errors.push("Error Workflow requires exactly one Error Trigger");
  } else if (triggers.length > 1) {
    errors.push("Error Workflow must have exactly one Error Trigger");
  }
  return {
    valid: errors.length === 0,
    errorTriggerNodeId: triggers[0]?.id || null,
    errors,
  };
};

const assertErrorWorkflowTarget = async (
  sourceWorkflowId,
  errorWorkflowId,
  { connection = pool } = {}
) => {
  if (!errorWorkflowId) {
    throw new AppError("errorWorkflowId is required", 400, "VALIDATION_ERROR");
  }
  if (String(errorWorkflowId) === String(sourceWorkflowId)) {
    throw new AppError(
      "A workflow cannot use itself as its Error Workflow",
      400,
      "ERROR_WORKFLOW_SELF"
    );
  }
  const [srcRows] = await connection.execute(
    `SELECT id, workspace_id, deleted_at FROM workflows WHERE id = ?`,
    [sourceWorkflowId]
  );
  const [tgtRows] = await connection.execute(
    `SELECT id, workspace_id, deleted_at, definition_json, name, status
     FROM workflows WHERE id = ?`,
    [errorWorkflowId]
  );
  if (!srcRows.length || srcRows[0].deleted_at) {
    throw new AppError("Source workflow not found", 404, "NOT_FOUND");
  }
  if (!tgtRows.length || tgtRows[0].deleted_at) {
    throw new AppError(
      "Error Workflow not found",
      404,
      "ERROR_WORKFLOW_NOT_FOUND"
    );
  }
  if (srcRows[0].workspace_id !== tgtRows[0].workspace_id) {
    throw new AppError(
      "Error Workflow must belong to the same workspace",
      403,
      "FORBIDDEN"
    );
  }
  const definition = parseJson(tgtRows[0].definition_json, {
    version: 1,
    nodes: [],
    edges: [],
  });
  const callability = validateErrorWorkflow(definition);
  if (!callability.valid) {
    throw new AppError(
      callability.errors[0] || "Error Workflow is not callable",
      400,
      "ERROR_WORKFLOW_NOT_CALLABLE"
    );
  }
  return { target: tgtRows[0], definition, callability };
};

/**
 * Internal setter for tests / 11B foundation (no UI).
 */
const setWorkflowErrorWorkflowId = async (
  workflowId,
  errorWorkflowId,
  authUser
) => {
  const { assertWorkspaceAccess } = require("./authorization.service");
  const [rows] = await pool.execute(
    `SELECT * FROM workflows WHERE id = ? AND deleted_at IS NULL`,
    [workflowId]
  );
  if (!rows.length) {
    throw new AppError("Workflow not found", 404, "NOT_FOUND");
  }
  await assertWorkspaceAccess(authUser, rows[0].workspace_id);
  if (errorWorkflowId == null || errorWorkflowId === "") {
    await pool.execute(
      `UPDATE workflows SET error_workflow_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [workflowId]
    );
    return { workflowId, errorWorkflowId: null };
  }
  await assertErrorWorkflowTarget(workflowId, errorWorkflowId);
  await pool.execute(
    `UPDATE workflows
     SET error_workflow_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [errorWorkflowId, workflowId]
  );
  return { workflowId, errorWorkflowId };
};

const loadFailedStepMeta = async (runId, connection = pool) => {
  const [rows] = await connection.execute(
    `SELECT node_id, node_type, execution_index, error, finished_at
     FROM workflow_run_steps
     WHERE run_id = ? AND status = 'failed'
     ORDER BY finished_at DESC, created_at DESC
     LIMIT 1`,
    [runId]
  );
  return rows[0] || null;
};

const resolveNodeName = (definition, nodeId) => {
  if (!nodeId) return null;
  const node = (definition?.nodes || []).find((n) => n.id === nodeId);
  if (!node) return null;
  return (
    node.data?.label ||
    node.data?.name ||
    node.data?.displayName ||
    nodeId
  );
};

const buildSafeFailureEvent = async ({
  runRow,
  workflowRow,
  definition,
  err = null,
  connection = pool,
}) => {
  const step = await loadFailedStepMeta(runRow.id, connection);
  const nodeId =
    err?.failedNodeId != null
      ? err.failedNodeId
      : step?.node_id != null
        ? step.node_id
        : null;
  const executionIndex =
    err?.failedExecutionIndex != null
      ? Number(err.failedExecutionIndex)
      : step?.execution_index != null
        ? Number(step.execution_index)
        : null;
  const nodeType =
    err?.failedNodeType ||
    step?.node_type ||
    null;
  const input = parseJson(runRow.input_json, {});
  const triggerSource =
    typeof input?.source === "string" && input.source
      ? input.source
      : "manual";

  return {
    event: "workflow_failed",
    workflow: {
      id: runRow.workflow_id,
      name:
        runRow.workflow_name_snapshot ||
        workflowRow?.name ||
        "Untitled workflow",
    },
    execution: {
      runId: runRow.id,
      rootRunId: runRow.root_run_id || runRow.id,
      triggerSource,
      startedAt: runRow.started_at || runRow.created_at || null,
      failedAt: runRow.finished_at || new Date().toISOString(),
    },
    failure: {
      nodeId,
      nodeName: resolveNodeName(definition, nodeId),
      nodeType,
      executionIndex:
        executionIndex == null || Number.isNaN(executionIndex)
          ? null
          : executionIndex,
      code: sanitizeCode(err?.code || err?.errorCode || null),
      message: sanitizeMessage(
        err?.message || step?.error || runRow.error || "Workflow failed"
      ),
    },
  };
};

/**
 * Ensure durable dispatch intent for a terminal FAILED run.
 * Idempotent on source_run_id UNIQUE.
 */
const ensureErrorDispatchForFailedRun = async (
  runId,
  { err = null, connection = null } = {}
) => {
  const ownConnection = !connection;
  const conn = connection || (await pool.getConnection());
  try {
    if (ownConnection) await conn.beginTransaction();

    const [rows] = await conn.execute(
      `SELECT r.*, w.name AS live_name, w.workspace_id, w.deleted_at AS workflow_deleted_at
       FROM workflow_runs r
       INNER JOIN workflows w ON w.id = r.workflow_id
       WHERE r.id = ?
       FOR UPDATE`,
      [runId]
    );
    if (!rows.length) {
      if (ownConnection) await conn.commit();
      return null;
    }
    const run = rows[0];
    if (run.status !== "failed") {
      if (ownConnection) await conn.commit();
      return null;
    }
    if (Number(run.suppress_error_routing) === 1) {
      if (ownConnection) await conn.commit();
      return { skipped: true, reason: OUTCOME.SUPPRESSED };
    }
    if (!run.error_workflow_id_snapshot) {
      if (ownConnection) await conn.commit();
      return null;
    }

    const [existing] = await conn.execute(
      `SELECT * FROM workflow_error_dispatches WHERE source_run_id = ?`,
      [runId]
    );
    if (existing.length) {
      if (ownConnection) await conn.commit();
      return { dispatch: existing[0], reused: true };
    }

    const definition = parseJson(
      run.definition_snapshot_json,
      { version: 1, nodes: [], edges: [] }
    );
    const event = await buildSafeFailureEvent({
      runRow: run,
      workflowRow: { name: run.live_name },
      definition,
      err,
      connection: conn,
    });

    const dispatchId = uuidv4();
    try {
      await conn.execute(
        `INSERT INTO workflow_error_dispatches
          (id, source_run_id, error_workflow_id, status, event_json)
         VALUES (?, ?, ?, 'pending', ?)`,
        [
          dispatchId,
          runId,
          run.error_workflow_id_snapshot,
          JSON.stringify(event),
        ]
      );
    } catch (insertErr) {
      if (insertErr?.code === "ER_DUP_ENTRY") {
        const [again] = await conn.execute(
          `SELECT * FROM workflow_error_dispatches WHERE source_run_id = ?`,
          [runId]
        );
        if (ownConnection) await conn.commit();
        return { dispatch: again[0], reused: true };
      }
      throw insertErr;
    }

    if (ownConnection) await conn.commit();
    const [created] = await pool.execute(
      `SELECT * FROM workflow_error_dispatches WHERE id = ?`,
      [dispatchId]
    );
    return { dispatch: created[0], reused: false };
  } catch (e) {
    if (ownConnection) await conn.rollback();
    throw e;
  } finally {
    if (ownConnection) conn.release();
  }
};

/**
 * Mark run failed and atomically record dispatch intent when configured.
 */
const markRunFailedAndEnsureDispatch = async (
  runId,
  message,
  { err = null } = {}
) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `UPDATE workflow_runs
       SET status = 'failed',
           error = ?,
           finished_at = CURRENT_TIMESTAMP,
           waiting_node_id = NULL,
           waiting_reason = NULL,
           resume_at = NULL
       WHERE id = ? AND status IN ('queued', 'running', 'waiting')`,
      [String(message || "Workflow failed").slice(0, 4000), runId]
    );
    await ensureErrorDispatchForFailedRun(runId, { err, connection });
    await connection.commit();
  } catch (e) {
    await connection.rollback();
    throw e;
  } finally {
    connection.release();
  }
};

const reclaimStaleErrorDispatchClaims = async (
  leaseMs = CLAIM_LEASE_MS,
  now = new Date()
) => {
  const cutoff = new Date(now.getTime() - leaseMs);
  const [result] = await pool.execute(
    `UPDATE workflow_error_dispatches
     SET status = 'pending',
         claim_token = NULL,
         claimed_at = NULL,
         claimed_by = NULL
     WHERE status = 'claimed'
       AND error_run_id IS NULL
       AND claimed_at IS NOT NULL
       AND claimed_at < ?`,
    [cutoff]
  );
  return result.affectedRows || 0;
};

const claimNextErrorDispatch = async (workerId = "worker") => {
  await reclaimStaleErrorDispatchClaims();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT * FROM workflow_error_dispatches
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE`
    );
    if (!rows.length) {
      await connection.commit();
      return null;
    }
    const row = rows[0];
    const token = `${workerId}-${uuidv4().slice(0, 8)}`;
    await connection.execute(
      `UPDATE workflow_error_dispatches
       SET status = 'claimed',
           claim_token = ?,
           claimed_at = CURRENT_TIMESTAMP,
           claimed_by = ?
       WHERE id = ? AND status = 'pending'`,
      [token, workerId, row.id]
    );
    await connection.commit();
    return { ...row, claim_token: token, status: "claimed", claimed_by: workerId };
  } catch (e) {
    await connection.rollback();
    throw e;
  } finally {
    connection.release();
  }
};

const createOrReuseErrorRun = async (dispatch) => {
  if (dispatch.error_run_id) {
    return { errorRunId: dispatch.error_run_id, reused: true };
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [locked] = await connection.execute(
      `SELECT * FROM workflow_error_dispatches WHERE id = ? FOR UPDATE`,
      [dispatch.id]
    );
    if (!locked.length) {
      await connection.rollback();
      return null;
    }
    const d = locked[0];
    if (d.error_run_id) {
      await connection.commit();
      return { errorRunId: d.error_run_id, reused: true };
    }

    const targetId = d.error_workflow_id;
    const [srcRows] = await connection.execute(
      `SELECT r.*, w.workspace_id AS source_workspace_id
       FROM workflow_runs r
       INNER JOIN workflows w ON w.id = r.workflow_id
       WHERE r.id = ?`,
      [d.source_run_id]
    );
    const sourceRun = srcRows[0];
    if (!sourceRun) {
      await connection.execute(
        `UPDATE workflow_error_dispatches
         SET status = 'unavailable',
             outcome_code = ?,
             last_error = 'Source run missing',
             dispatched_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [OUTCOME.TARGET_UNAVAILABLE, d.id]
      );
      await connection.commit();
      return { unavailable: true, outcome: OUTCOME.TARGET_UNAVAILABLE };
    }

    const [tgtRows] = await connection.execute(
      `SELECT * FROM workflows WHERE id = ?`,
      [targetId]
    );
    const target = tgtRows[0];
    if (!target || target.deleted_at) {
      await connection.execute(
        `UPDATE workflow_error_dispatches
         SET status = 'unavailable',
             outcome_code = ?,
             last_error = 'Error Workflow deleted or missing',
             dispatched_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [OUTCOME.TARGET_UNAVAILABLE, d.id]
      );
      await connection.commit();
      return { unavailable: true, outcome: OUTCOME.TARGET_UNAVAILABLE };
    }
    if (target.workspace_id !== sourceRun.source_workspace_id) {
      await connection.execute(
        `UPDATE workflow_error_dispatches
         SET status = 'unavailable',
             outcome_code = ?,
             last_error = 'Cross-workspace Error Workflow',
             dispatched_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [OUTCOME.CROSS_WORKSPACE, d.id]
      );
      await connection.commit();
      return { unavailable: true, outcome: OUTCOME.CROSS_WORKSPACE };
    }

    const definition = parseJson(target.definition_json, {
      version: 1,
      nodes: [],
      edges: [],
    });
    const callability = validateErrorWorkflow(definition);
    if (!callability.valid) {
      await connection.execute(
        `UPDATE workflow_error_dispatches
         SET status = 'unavailable',
             outcome_code = ?,
             last_error = ?,
             dispatched_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          OUTCOME.ERROR_WORKFLOW_NOT_CALLABLE,
          callability.errors[0] || "not callable",
          d.id,
        ]
      );
      await connection.commit();
      return { unavailable: true, outcome: OUTCOME.ERROR_WORKFLOW_NOT_CALLABLE };
    }

    const event = parseJson(d.event_json, {});
    const errorRunId = uuidv4();
    const jobId = uuidv4();
    const inputPayload = {
      source: ERROR_WORKFLOW_SOURCE,
      errorEvent: event,
      sourceRunId: d.source_run_id,
      dispatchId: d.id,
    };

    await connection.execute(
      `INSERT INTO workflow_runs
        (id, workflow_id, workflow_name_snapshot, status, input_json,
         definition_snapshot_json, created_by, suppress_error_routing,
         root_run_id)
       VALUES (?, ?, ?, 'queued', ?, ?, ?, 1, ?)`,
      [
        errorRunId,
        target.id,
        target.name || null,
        JSON.stringify(inputPayload),
        JSON.stringify(definition),
        sourceRun.created_by,
        errorRunId,
      ]
    );
    await connection.execute(
      `INSERT INTO workflow_jobs (id, run_id, status, available_at)
       VALUES (?, ?, 'queued', CURRENT_TIMESTAMP)`,
      [jobId, errorRunId]
    );
    await connection.execute(
      `UPDATE workflow_error_dispatches
       SET error_run_id = ?,
           status = 'dispatched',
           outcome_code = ?,
           dispatched_at = CURRENT_TIMESTAMP,
           last_error = NULL
       WHERE id = ?`,
      [errorRunId, OUTCOME.DISPATCHED, d.id]
    );
    await connection.commit();
    return { errorRunId, reused: false, jobId };
  } catch (e) {
    await connection.rollback();
    throw e;
  } finally {
    connection.release();
  }
};

const processErrorDispatch = async (dispatch) => {
  try {
    const result = await createOrReuseErrorRun(dispatch);
    return result;
  } catch (err) {
    await pool.execute(
      `UPDATE workflow_error_dispatches
       SET status = 'pending',
           claim_token = NULL,
           claimed_at = NULL,
           claimed_by = NULL,
           last_error = ?
       WHERE id = ? AND status = 'claimed' AND error_run_id IS NULL`,
      [String(err.message || err).slice(0, 2000), dispatch.id]
    );
    throw err;
  }
};

const processPendingErrorDispatches = async (limit = 5, workerId = "worker") => {
  let processed = 0;
  for (let i = 0; i < limit; i += 1) {
    const claim = await claimNextErrorDispatch(workerId);
    if (!claim) break;
    await processErrorDispatch(claim);
    processed += 1;
  }
  return processed;
};

/**
 * Recover failed runs that have a snapshot target but missing dispatch intent.
 */
const reconcileMissingErrorDispatches = async (limit = 20) => {
  const [rows] = await pool.execute(
    `SELECT r.id
     FROM workflow_runs r
     LEFT JOIN workflow_error_dispatches d ON d.source_run_id = r.id
     WHERE r.status = 'failed'
       AND r.suppress_error_routing = 0
       AND r.error_workflow_id_snapshot IS NOT NULL
       AND d.id IS NULL
       AND r.finished_at IS NOT NULL
       AND r.finished_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${Math.max(
         1,
         Math.min(RECONCILE_LOOKBACK_HOURS, 168)
       )} HOUR)
     ORDER BY r.finished_at ASC
     LIMIT ${Math.max(1, Math.min(Number(limit) || 20, 100))}`
  );
  const results = [];
  for (const row of rows) {
    results.push(await ensureErrorDispatchForFailedRun(row.id));
  }
  return results;
};

const getDispatchForSourceRun = async (sourceRunId) => {
  const [rows] = await pool.execute(
    `SELECT * FROM workflow_error_dispatches WHERE source_run_id = ?`,
    [sourceRunId]
  );
  return rows[0] || null;
};

const getDispatchForErrorRun = async (errorRunId) => {
  const [rows] = await pool.execute(
    `SELECT * FROM workflow_error_dispatches WHERE error_run_id = ?`,
    [errorRunId]
  );
  return rows[0] || null;
};

/**
 * Safe bidirectional Error Workflow lineage for Part 11C.
 * Auth is enforced by the caller via getRunById first.
 */
const buildErrorRoutingSummary = async (runRow, authUser) => {
  const {
    formatLineageRun,
    resolveWorkflowNames,
  } = require("./workflowSubworkflow.service");
  const { assertWorkspaceAccess } = require("./authorization.service");

  const runId = runRow.id;
  let dispatch = await getDispatchForSourceRun(runId);
  let role = "none";
  if (dispatch) {
    role = "source";
  } else {
    dispatch = await getDispatchForErrorRun(runId);
    if (dispatch) role = "handler";
  }

  if (!dispatch) {
    return {
      role: "none",
      dispatch: null,
      sourceRun: null,
      errorRun: null,
      targetWorkflow: null,
      openSourceRunPath: null,
      openErrorRunPath: null,
      openSourceWorkflowPath: null,
      openErrorWorkflowPath: null,
    };
  }

  // Load peer runs in same workspace only.
  const [srcRows] = await pool.execute(
    `SELECT r.*, w.workspace_id, w.name AS workflow_live_name, w.deleted_at
     FROM workflow_runs r
     INNER JOIN workflows w ON w.id = r.workflow_id
     WHERE r.id = ?`,
    [dispatch.source_run_id]
  );
  const sourceRow = srcRows[0] || null;
  if (sourceRow) {
    await assertWorkspaceAccess(authUser, sourceRow.workspace_id);
  }

  let errorRow = null;
  if (dispatch.error_run_id) {
    const [errRows] = await pool.execute(
      `SELECT r.*, w.workspace_id, w.name AS workflow_live_name, w.deleted_at
       FROM workflow_runs r
       INNER JOIN workflows w ON w.id = r.workflow_id
       WHERE r.id = ?`,
      [dispatch.error_run_id]
    );
    errorRow = errRows[0] || null;
    if (errorRow) {
      await assertWorkspaceAccess(authUser, errorRow.workspace_id);
      if (
        sourceRow &&
        errorRow.workspace_id !== sourceRow.workspace_id
      ) {
        throw new AppError("Forbidden", 403, "FORBIDDEN");
      }
    }
  }

  const targetWorkflowId =
    dispatch.error_workflow_id ||
    errorRow?.workflow_id ||
    null;
  const nameIds = [
    sourceRow?.workflow_id,
    errorRow?.workflow_id,
    targetWorkflowId,
  ].filter(Boolean);
  const names = await resolveWorkflowNames(nameIds);

  const sourceRun = sourceRow
    ? formatLineageRun(sourceRow, names.get(sourceRow.workflow_id))
    : null;
  const errorRun = errorRow
    ? formatLineageRun(errorRow, names.get(errorRow.workflow_id))
    : null;

  let targetWorkflow = null;
  if (targetWorkflowId) {
    const info = names.get(targetWorkflowId) || {
      name: null,
      deleted: true,
    };
    // Prefer historical name from error run snapshot when target deleted.
    const historicalName =
      errorRun?.workflowName ||
      sourceRun?.workflowName ||
      null;
    targetWorkflow = {
      id: targetWorkflowId,
      name: info.deleted
        ? errorRow?.workflow_name_snapshot ||
          info.name ||
          historicalName ||
          "Deleted workflow"
        : info.name ||
          errorRow?.workflow_name_snapshot ||
          "Untitled workflow",
      deleted: Boolean(info.deleted),
    };
  }

  const openSourceRunPath = sourceRun
    ? `/workflows/${sourceRun.workflowId}?runId=${encodeURIComponent(sourceRun.runId)}`
    : null;
  const openErrorRunPath = errorRun
    ? `/workflows/${errorRun.workflowId}?runId=${encodeURIComponent(errorRun.runId)}`
    : null;
  const openSourceWorkflowPath =
    sourceRun && !sourceRun.workflowDeleted
      ? `/workflows/${sourceRun.workflowId}`
      : null;
  const openErrorWorkflowPath =
    targetWorkflow && !targetWorkflow.deleted
      ? `/workflows/${targetWorkflow.id}`
      : null;

  return {
    role,
    dispatch: {
      id: dispatch.id,
      status: dispatch.status,
      outcomeCode: dispatch.outcome_code || null,
      errorWorkflowId: dispatch.error_workflow_id || null,
      sourceRunId: dispatch.source_run_id,
      errorRunId: dispatch.error_run_id || null,
      createdAt: dispatch.created_at || null,
      dispatchedAt: dispatch.dispatched_at || null,
      // Safe truncated note only — never event_json / claim_token.
      lastError: dispatch.last_error
        ? String(dispatch.last_error).slice(0, 300)
        : null,
    },
    sourceRun,
    errorRun,
    targetWorkflow,
    openSourceRunPath,
    openErrorRunPath,
    openSourceWorkflowPath,
    openErrorWorkflowPath,
  };
};

module.exports = {
  ERROR_WORKFLOW_SOURCE,
  DISPATCH_STATUSES,
  OUTCOME,
  validateErrorWorkflow,
  assertErrorWorkflowTarget,
  setWorkflowErrorWorkflowId,
  buildSafeFailureEvent,
  ensureErrorDispatchForFailedRun,
  markRunFailedAndEnsureDispatch,
  reclaimStaleErrorDispatchClaims,
  claimNextErrorDispatch,
  createOrReuseErrorRun,
  processErrorDispatch,
  processPendingErrorDispatches,
  reconcileMissingErrorDispatches,
  getDispatchForSourceRun,
  getDispatchForErrorRun,
  buildErrorRoutingSummary,
  sanitizeMessage,
  sanitizeCode,
};
