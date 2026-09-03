/**
 * Durable time-based Wait (Part 8A / 8A.1).
 * Authoritative resumeAt in DB; no long setTimeout as source of truth.
 */

const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/database");
const { redactHeaders } = require("../utils/workflowDebug");

/** Default lease before a claimed wait / locked job may be reclaimed (ms). */
const WAIT_CLAIM_LEASE_MS =
  Number(process.env.WORKFLOW_WAIT_CLAIM_LEASE_MS) || 5 * 60 * 1000;

const WAIT_UNITS_MS = {
  seconds: 1000,
  second: 1000,
  minutes: 60 * 1000,
  minute: 60 * 1000,
  hours: 60 * 60 * 1000,
  hour: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

const parseJson = (value, fallback = null) => {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

/**
 * Absolute resume instant from Wait node data.
 * Prefer waitUntil (ISO); else amount + unit from `now`.
 */
const computeWaitResumeAt = (nodeData = {}, now = new Date()) => {
  const until = nodeData.waitUntil || nodeData.resumeAt;
  if (until) {
    const dt = new Date(String(until));
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  const amount = Math.max(0, Number(nodeData.waitAmount ?? nodeData.amount ?? 5));
  const unit = String(nodeData.waitUnit || nodeData.unit || "minutes").toLowerCase();
  const ms = WAIT_UNITS_MS[unit];
  if (!ms) {
    throw new Error(
      `Wait: unsupported unit "${unit}" — use seconds, minutes, hours, or days`
    );
  }
  return new Date(now.getTime() + amount * ms);
};

const serializeSchedulerState = (scheduler) => ({
  edgeState: [...(scheduler.edgeState || new Map()).entries()],
  nodeState: [...(scheduler.nodeState || new Map()).entries()],
  loopCounts: [...(scheduler.loopCounts || new Map()).entries()],
});

/**
 * Binary durability policy (Part 8A.1):
 * - Keep storageKey / filePath / mimeType / fileName refs (SUPPORTED IF EXTERNAL FILE EXISTS)
 * - Drop Buffer / base64 data payloads (NOT DURABLE across process restart)
 */
const sanitizeBinaryRef = (binary) => {
  if (!binary || typeof binary !== "object") return undefined;
  const out = {};
  for (const [key, entry] of Object.entries(binary)) {
    if (!entry || typeof entry !== "object") continue;
    const ref = {};
    if (entry.storageKey != null) ref.storageKey = entry.storageKey;
    if (entry.filePath != null) ref.filePath = entry.filePath;
    if (entry.mimeType != null) ref.mimeType = entry.mimeType;
    if (entry.fileName != null) ref.fileName = entry.fileName;
    if (entry.id != null) ref.id = entry.id;
    // Explicitly omit data / buffer / base64
    if (Object.keys(ref).length > 0) out[key] = ref;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

const sanitizeItem = (item) => {
  if (!item || typeof item !== "object") return item;
  const next = { ...item };
  if (next.binary) {
    const cleaned = sanitizeBinaryRef(next.binary);
    if (cleaned) next.binary = cleaned;
    else delete next.binary;
  }
  return next;
};

const sanitizeItemsMap = (items) => {
  if (!items || typeof items !== "object") return {};
  const out = {};
  for (const [nodeId, list] of Object.entries(items)) {
    out[nodeId] = Array.isArray(list) ? list.map(sanitizeItem) : list;
  }
  return out;
};

const sanitizePortOutputs = (portOutputs) => {
  if (!portOutputs || typeof portOutputs !== "object") return {};
  const out = {};
  for (const [nodeId, ports] of Object.entries(portOutputs)) {
    if (!ports || typeof ports !== "object") {
      out[nodeId] = ports;
      continue;
    }
    const portMap = {};
    for (const [portId, list] of Object.entries(ports)) {
      portMap[portId] = Array.isArray(list) ? list.map(sanitizeItem) : list;
    }
    out[nodeId] = portMap;
  }
  return out;
};

/**
 * Strip decrypted credential material from step debug shapes.
 * Credential IDs on node data are fine; Authorization header values are not.
 */
const sanitizeStepValue = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sanitizeStepValue);
  const out = { ...value };
  if (out.headers && typeof out.headers === "object") {
    out.headers = redactHeaders(out.headers);
  }
  if (out.requestHeaders && typeof out.requestHeaders === "object") {
    out.requestHeaders = redactHeaders(out.requestHeaders);
  }
  // Never persist decrypted credential payloads if a handler left them on output.
  if (out.credentialSecret != null) delete out.credentialSecret;
  if (out.decryptedCredential != null) delete out.decryptedCredential;
  if (out.apiKey != null && typeof out.apiKey === "string") {
    out.apiKey = "***redacted***";
  }
  return out;
};

const sanitizeSteps = (steps) => {
  if (!steps || typeof steps !== "object") return {};
  const out = {};
  for (const [id, value] of Object.entries(steps)) {
    out[id] = sanitizeStepValue(value);
  }
  return out;
};

const buildExecutionSnapshot = ({
  waitNodeId,
  waitStepId,
  waitInputItems,
  context,
  scheduler,
  finalOutput,
  runErrors,
  waitCompleted = false,
}) => ({
  version: 1,
  waitNodeId,
  waitStepId,
  waitCompleted: Boolean(waitCompleted),
  waitInputItems: (waitInputItems || []).map(sanitizeItem),
  context: {
    input: context.input || {},
    steps: sanitizeSteps(context.steps || {}),
    items: sanitizeItemsMap(context.items || {}),
    portOutputs: sanitizePortOutputs(context.portOutputs || {}),
  },
  scheduler: serializeSchedulerState(scheduler),
  finalOutput: finalOutput ?? null,
  runErrors: runErrors || [],
});

/**
 * Suspend production run at Wait. Persists wait row + snapshot, sets run WAITING,
 * requeues job for resumeAt. Atomic transaction — crash mid-txn rolls back.
 */
const suspendRunAtWait = async ({
  runId,
  workflowId,
  nodeId,
  stepId,
  resumeAt,
  snapshot,
  jobId = null,
}) => {
  const waitId = uuidv4();
  const resumeDate =
    resumeAt instanceof Date ? resumeAt : new Date(String(resumeAt));
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.execute(
      `INSERT INTO workflow_waits
        (id, run_id, workflow_id, node_id, step_id, status, resume_at, snapshot_json)
       VALUES (?, ?, ?, ?, ?, 'waiting', ?, ?)`,
      [
        waitId,
        runId,
        workflowId,
        nodeId,
        stepId,
        resumeDate,
        JSON.stringify(snapshot),
      ]
    );

    await connection.execute(
      `UPDATE workflow_runs
       SET status = 'waiting',
           waiting_node_id = ?,
           resume_at = ?,
           finished_at = NULL,
           error = NULL
       WHERE id = ? AND status IN ('running', 'queued')`,
      [nodeId, resumeDate, runId]
    );

    if (stepId) {
      await connection.execute(
        `UPDATE workflow_run_steps
         SET status = 'waiting',
             output_json = ?,
             finished_at = NULL
         WHERE id = ?`,
        [
          JSON.stringify({
            waiting: true,
            resumeAt: resumeDate.toISOString(),
            nodeId,
          }),
          stepId,
        ]
      );
    }

    // Release worker lock; schedule same job for absolute resumeAt.
    // Reset attempts so Wait wake cycles do not burn MAX_ATTEMPTS.
    if (jobId) {
      await connection.execute(
        `UPDATE workflow_jobs
         SET status = 'queued',
             locked_at = NULL,
             locked_by = NULL,
             available_at = ?,
             attempts = 0
         WHERE id = ?`,
        [resumeDate, jobId]
      );
    } else {
      await connection.execute(
        `UPDATE workflow_jobs
         SET status = 'queued',
             locked_at = NULL,
             locked_by = NULL,
             available_at = ?,
             attempts = 0
         WHERE run_id = ? AND status IN ('locked', 'queued')`,
        [resumeDate, runId]
      );
    }

    await connection.commit();
    return {
      id: waitId,
      runId,
      nodeId,
      resumeAt: resumeDate.toISOString(),
      status: "waiting",
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};

/**
 * Atomic claim of a due wait for a run.
 * WAITING → claimed only if resume_at <= now and still waiting.
 */
const claimDueWaitForRun = async (runId, claimToken, now = new Date()) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `SELECT *
       FROM workflow_waits
       WHERE run_id = ?
         AND status = 'waiting'
         AND resume_at <= ?
       ORDER BY resume_at ASC
       LIMIT 1
       FOR UPDATE`,
      [runId, now]
    );

    if (rows.length === 0) {
      await connection.commit();
      return null;
    }

    const wait = rows[0];
    const [updated] = await connection.execute(
      `UPDATE workflow_waits
       SET status = 'claimed',
           claim_token = ?,
           claimed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'waiting'`,
      [claimToken, wait.id]
    );

    if (!updated.affectedRows) {
      await connection.commit();
      return null;
    }

    const [runUpdated] = await connection.execute(
      `UPDATE workflow_runs
       SET status = 'running',
           waiting_node_id = NULL,
           resume_at = NULL
       WHERE id = ? AND status = 'waiting'`,
      [runId]
    );

    // Cancel won the race — do not proceed with resume.
    if (!runUpdated.affectedRows) {
      await connection.execute(
        `UPDATE workflow_waits
         SET status = 'cancelled'
         WHERE id = ? AND status = 'claimed'`,
        [wait.id]
      );
      await connection.commit();
      return null;
    }

    await connection.commit();
    return {
      ...wait,
      snapshot: parseJson(wait.snapshot_json, {}),
      status: "claimed",
      claim_token: claimToken,
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};

/**
 * Mid-resume crash recovery: open claimed wait, or resumed wait with progress
 * snapshot (waitCompleted) while run is still non-terminal.
 */
const getRecoverableWaitForRun = async (runId) => {
  const [claimed] = await pool.execute(
    `SELECT *
     FROM workflow_waits
     WHERE run_id = ? AND status = 'claimed'
     ORDER BY claimed_at DESC
     LIMIT 1`,
    [runId]
  );
  if (claimed.length > 0) {
    const wait = claimed[0];
    return {
      ...wait,
      snapshot: parseJson(wait.snapshot_json, {}),
      recoveryMode: "claimed",
    };
  }

  const [resumed] = await pool.execute(
    `SELECT *
     FROM workflow_waits
     WHERE run_id = ? AND status = 'resumed'
     ORDER BY resumed_at DESC
     LIMIT 1`,
    [runId]
  );
  if (resumed.length > 0) {
    const wait = resumed[0];
    const snapshot = parseJson(wait.snapshot_json, {});
    if (snapshot.waitCompleted) {
      return {
        ...wait,
        snapshot,
        recoveryMode: "progress",
      };
    }
  }
  return null;
};

/** Persist post-Wait progress so crash-after-resume can continue without cold start. */
const updateWaitProgressSnapshot = async (waitId, snapshot) => {
  await pool.execute(
    `UPDATE workflow_waits
     SET snapshot_json = ?
     WHERE id = ?`,
    [JSON.stringify(snapshot), waitId]
  );
};

/** Mark wait resumed after Wait node successfully completes post-claim. */
const markWaitResumed = async (waitId, stepId = null, output = null) => {
  await pool.execute(
    `UPDATE workflow_waits
     SET status = 'resumed', resumed_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'claimed'`,
    [waitId]
  );
  if (stepId) {
    await pool.execute(
      `UPDATE workflow_run_steps
       SET status = 'succeeded',
           output_json = ?,
           finished_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [JSON.stringify(output ?? { waited: true }), stepId]
    );
  }
};

/** Cancel any active waits for a run (cancellation support). */
const cancelWaitsForRun = async (runId) => {
  await pool.execute(
    `UPDATE workflow_waits
     SET status = 'cancelled'
     WHERE run_id = ? AND status IN ('waiting', 'claimed')`,
    [runId]
  );
  await pool.execute(
    `UPDATE workflow_jobs
     SET status = 'done', locked_at = NULL, locked_by = NULL
     WHERE run_id = ? AND status IN ('queued', 'locked')`,
    [runId]
  );
};

/**
 * Reclaim claimed waits whose lease expired (crash after claim, before progress).
 * Resets wait → waiting and run → waiting so the next due claim can resume.
 */
const reclaimStaleClaimedWaits = async (
  leaseMs = WAIT_CLAIM_LEASE_MS,
  now = new Date()
) => {
  const cutoff = new Date(now.getTime() - leaseMs);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT id, run_id
       FROM workflow_waits
       WHERE status = 'claimed'
         AND claimed_at IS NOT NULL
         AND claimed_at < ?
       FOR UPDATE`,
      [cutoff]
    );
    for (const row of rows) {
      await connection.execute(
        `UPDATE workflow_waits
         SET status = 'waiting', claim_token = NULL, claimed_at = NULL
         WHERE id = ? AND status = 'claimed'`,
        [row.id]
      );
      await connection.execute(
        `UPDATE workflow_runs
         SET status = 'waiting'
         WHERE id = ? AND status = 'running'`,
        [row.run_id]
      );
      await connection.execute(
        `UPDATE workflow_jobs
         SET status = 'queued',
             locked_at = NULL,
             locked_by = NULL,
             available_at = LEAST(available_at, CURRENT_TIMESTAMP)
         WHERE run_id = ? AND status = 'locked'`,
        [row.run_id]
      );
    }
    await connection.commit();
    return rows.length;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};

/**
 * In-memory CAS helper for tests — simulates claimDueWaitForRun race.
 * store: Map(waitId → { status, resumeAt, runId, ... })
 */
const claimWaitInMemory = (store, waitId, claimToken, now = new Date()) => {
  const row = store.get(waitId);
  if (!row || row.status !== "waiting") return null;
  const resumeAt = row.resumeAt instanceof Date ? row.resumeAt : new Date(row.resumeAt);
  if (resumeAt.getTime() > now.getTime()) return null;
  row.status = "claimed";
  row.claimToken = claimToken;
  row.claimedAt = now;
  store.set(waitId, row);
  return { ...row };
};

/**
 * In-memory lease reclaim for tests (crash-after-claim recovery).
 */
const reclaimStaleClaimInMemory = (
  store,
  waitId,
  leaseMs,
  now = new Date(),
  runStore = null
) => {
  const row = store.get(waitId);
  if (!row || row.status !== "claimed" || !row.claimedAt) return false;
  const claimedAt =
    row.claimedAt instanceof Date ? row.claimedAt : new Date(row.claimedAt);
  if (now.getTime() - claimedAt.getTime() < leaseMs) return false;
  row.status = "waiting";
  row.claimToken = null;
  row.claimedAt = null;
  store.set(waitId, row);
  if (runStore && row.runId) {
    const run = runStore.get(row.runId);
    if (run && run.status === "running") {
      run.status = "waiting";
      runStore.set(row.runId, run);
    }
  }
  return true;
};

/**
 * Cancel vs claim race (in-memory): only one final state wins.
 * Returns { claimed, cancelled }.
 */
const cancelOrClaimRaceInMemory = (store, waitId, run, action, claimToken, now) => {
  if (action === "cancel") {
    if (run.status === "cancelled") return { claimed: false, cancelled: true };
    const row = store.get(waitId);
    if (row && (row.status === "waiting" || row.status === "claimed")) {
      row.status = "cancelled";
      store.set(waitId, row);
    }
    run.status = "cancelled";
    return { claimed: false, cancelled: true };
  }
  if (run.status === "cancelled") return { claimed: false, cancelled: true };
  const claimed = claimWaitInMemory(store, waitId, claimToken, now);
  if (!claimed) return { claimed: false, cancelled: run.status === "cancelled" };
  if (run.status !== "waiting") {
    // Run already left waiting (e.g. cancel won) — undo claim.
    const row = store.get(waitId);
    if (row) {
      row.status = "cancelled";
      store.set(waitId, row);
    }
    return { claimed: false, cancelled: true };
  }
  run.status = "running";
  return { claimed: true, cancelled: false };
};

module.exports = {
  WAIT_UNITS_MS,
  WAIT_CLAIM_LEASE_MS,
  computeWaitResumeAt,
  serializeSchedulerState,
  buildExecutionSnapshot,
  sanitizeBinaryRef,
  sanitizeItem,
  suspendRunAtWait,
  claimDueWaitForRun,
  getRecoverableWaitForRun,
  updateWaitProgressSnapshot,
  markWaitResumed,
  cancelWaitsForRun,
  reclaimStaleClaimedWaits,
  claimWaitInMemory,
  reclaimStaleClaimInMemory,
  cancelOrClaimRaceInMemory,
  parseJson,
};
