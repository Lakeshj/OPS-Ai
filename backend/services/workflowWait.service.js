/**
 * Durable Wait (Part 8A / 8A.1 / 8B).
 * Time / manual / external resume converge on the same claim → worker path.
 */

const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/database");
const { redactHeaders } = require("../utils/workflowDebug");
const { encryptSecret, decryptSecret } = require("./secretBox.service");

/** Default lease before a claimed wait / locked job may be reclaimed (ms). */
const WAIT_CLAIM_LEASE_MS =
  Number(process.env.WORKFLOW_WAIT_CLAIM_LEASE_MS) || 5 * 60 * 1000;

const WAIT_MODES = Object.freeze({
  TIME: "time",
  MANUAL: "manual",
  EXTERNAL: "external",
});

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

/** Normalize Wait node resume mode (default: time). */
const resolveWaitMode = (nodeData = {}) => {
  const raw = String(
    nodeData.resumeMode || nodeData.waitMode || nodeData.mode || WAIT_MODES.TIME
  )
    .toLowerCase()
    .trim();
  if (raw === "manual") return WAIT_MODES.MANUAL;
  if (raw === "external") return WAIT_MODES.EXTERNAL;
  return WAIT_MODES.TIME;
};

/**
 * Absolute resume instant from Wait node data (TIME mode only).
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

/** 256-bit opaque token (base64url). */
const generateResumeToken = () => crypto.randomBytes(32).toString("base64url");

const hashResumeToken = (rawToken) =>
  crypto.createHash("sha256").update(String(rawToken), "utf8").digest("hex");

const sealResumeToken = (rawToken) => encryptSecret({ t: String(rawToken) });

const unsealResumeToken = (ciphertext) => {
  if (!ciphertext) return null;
  try {
    const payload = decryptSecret(ciphertext);
    return payload && typeof payload.t === "string" ? payload.t : null;
  } catch {
    return null;
  }
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
 * requeues job for resumeAt (TIME) or holds until signalled (MANUAL/EXTERNAL).
 */
const suspendRunAtWait = async ({
  runId,
  workflowId,
  nodeId,
  stepId,
  resumeAt = null,
  resumeMode = WAIT_MODES.TIME,
  resumeTokenHash = null,
  resumeTokenCiphertext = null,
  snapshot,
  jobId = null,
}) => {
  const waitId = uuidv4();
  const mode = resolveWaitMode({ resumeMode });
  const resumeDate =
    resumeAt == null
      ? null
      : resumeAt instanceof Date
        ? resumeAt
        : new Date(String(resumeAt));
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.execute(
      `INSERT INTO workflow_waits
        (id, run_id, workflow_id, node_id, step_id, status, resume_mode,
         resume_token_hash, resume_token_ciphertext, resume_at, snapshot_json)
       VALUES (?, ?, ?, ?, ?, 'waiting', ?, ?, ?, ?, ?)`,
      [
        waitId,
        runId,
        workflowId,
        nodeId,
        stepId,
        mode,
        resumeTokenHash,
        resumeTokenCiphertext,
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
            resumeMode: mode,
            resumeAt: resumeDate ? resumeDate.toISOString() : null,
            nodeId,
            // Never include raw token here.
          }),
          stepId,
        ]
      );
    }

    // TIME: schedule job for resumeAt. MANUAL/EXTERNAL: park far future until signal.
    const availableAt =
      resumeDate || new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000);

    if (jobId) {
      await connection.execute(
        `UPDATE workflow_jobs
         SET status = 'queued',
             locked_at = NULL,
             locked_by = NULL,
             available_at = ?,
             attempts = 0
         WHERE id = ?`,
        [availableAt, jobId]
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
        [availableAt, runId]
      );
    }

    await connection.commit();
    return {
      id: waitId,
      runId,
      nodeId,
      resumeAt: resumeDate ? resumeDate.toISOString() : null,
      resumeMode: mode,
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
 * MANUAL/EXTERNAL waits get resume_at set by requestWaitResume (signal).
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
         AND resume_at IS NOT NULL
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
           claimed_at = CURRENT_TIMESTAMP,
           resume_mechanism = COALESCE(resume_mechanism, resume_mode)
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
      resume_mechanism: wait.resume_mechanism || wait.resume_mode,
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};

/**
 * Signal a waiting run to become due — does NOT execute the workflow.
 * Common path for MANUAL (auth) and EXTERNAL (token) resume.
 *
 * Atomic: wait stays `waiting`, resume_at → NOW, job available now.
 * Worker then claims via claimDueWaitForRun.
 */
const requestWaitResume = async ({
  runId = null,
  waitId = null,
  mechanism,
  actorUserId = null,
  token = null,
  now = new Date(),
}) => {
  const mech = String(mechanism || "").toLowerCase();
  if (mech !== WAIT_MODES.MANUAL && mech !== WAIT_MODES.EXTERNAL) {
    return { ok: false, code: "INVALID_MECHANISM" };
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    let wait = null;
    if (mech === WAIT_MODES.EXTERNAL) {
      if (!token || typeof token !== "string") {
        await connection.rollback();
        return { ok: false, code: "INVALID_TOKEN" };
      }
      const tokenHash = hashResumeToken(token);
      const [rows] = await connection.execute(
        `SELECT *
         FROM workflow_waits
         WHERE resume_token_hash = ?
         LIMIT 1
         FOR UPDATE`,
        [tokenHash]
      );
      if (rows.length === 0) {
        await connection.rollback();
        return { ok: false, code: "INVALID_TOKEN" };
      }
      wait = rows[0];
    } else {
      const [rows] = await connection.execute(
        waitId
          ? `SELECT * FROM workflow_waits WHERE id = ? AND run_id = ? LIMIT 1 FOR UPDATE`
          : `SELECT * FROM workflow_waits
             WHERE run_id = ? AND status IN ('waiting', 'claimed', 'resumed')
             ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        waitId ? [waitId, runId] : [runId]
      );
      if (rows.length === 0) {
        await connection.rollback();
        return { ok: false, code: "NOT_FOUND" };
      }
      wait = rows[0];
    }

    // Idempotent: already past waiting
    if (wait.status === "claimed" || wait.status === "resumed") {
      await connection.commit();
      return {
        ok: true,
        idempotent: true,
        runId: wait.run_id,
        waitId: wait.id,
        status: wait.status,
      };
    }

    if (wait.status === "cancelled" || wait.status === "failed") {
      await connection.rollback();
      return { ok: false, code: mech === WAIT_MODES.EXTERNAL ? "INVALID_TOKEN" : "NOT_RESUMABLE" };
    }

    if (wait.status !== "waiting") {
      await connection.rollback();
      return { ok: false, code: "NOT_RESUMABLE" };
    }

    // Mode gate
    if (mech === WAIT_MODES.MANUAL && wait.resume_mode !== WAIT_MODES.MANUAL) {
      await connection.rollback();
      return { ok: false, code: "WRONG_MODE" };
    }
    if (mech === WAIT_MODES.EXTERNAL && wait.resume_mode !== WAIT_MODES.EXTERNAL) {
      await connection.rollback();
      return { ok: false, code: "INVALID_TOKEN" };
    }

    // Cancel race: run must still be waiting
    const [runRows] = await connection.execute(
      `SELECT id, status FROM workflow_runs WHERE id = ? FOR UPDATE`,
      [wait.run_id]
    );
    if (runRows.length === 0 || runRows[0].status !== "waiting") {
      await connection.rollback();
      return {
        ok: false,
        code:
          mech === WAIT_MODES.EXTERNAL
            ? "INVALID_TOKEN"
            : runRows[0]?.status === "cancelled"
              ? "CANCELLED"
              : "NOT_RESUMABLE",
      };
    }

    // Already signalled (idempotent wake)
    if (wait.signalled_at && wait.resume_at && new Date(wait.resume_at) <= now) {
      await connection.execute(
        `UPDATE workflow_jobs
         SET status = 'queued',
             locked_at = NULL,
             locked_by = NULL,
             available_at = LEAST(available_at, ?),
             attempts = 0
         WHERE run_id = ? AND status IN ('queued', 'locked')`,
        [now, wait.run_id]
      );
      await connection.commit();
      return {
        ok: true,
        idempotent: true,
        runId: wait.run_id,
        waitId: wait.id,
        status: "signalled",
      };
    }

    await connection.execute(
      `UPDATE workflow_waits
       SET resume_at = ?,
           signalled_at = ?,
           resume_mechanism = ?,
           resumed_by = COALESCE(?, resumed_by)
       WHERE id = ? AND status = 'waiting'`,
      [now, now, mech, actorUserId, wait.id]
    );

    await connection.execute(
      `UPDATE workflow_runs
       SET resume_at = ?
       WHERE id = ? AND status = 'waiting'`,
      [now, wait.run_id]
    );

    await connection.execute(
      `UPDATE workflow_jobs
       SET status = 'queued',
           locked_at = NULL,
           locked_by = NULL,
           available_at = ?,
           attempts = 0
       WHERE run_id = ? AND status IN ('queued', 'locked')`,
      [now, wait.run_id]
    );

    await connection.commit();
    return {
      ok: true,
      idempotent: false,
      runId: wait.run_id,
      waitId: wait.id,
      status: "signalled",
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};

/** Load active waiting row for a run (authorized UI). */
const getActiveWaitForRun = async (runId) => {
  const [rows] = await pool.execute(
    `SELECT *
     FROM workflow_waits
     WHERE run_id = ? AND status IN ('waiting', 'claimed', 'resumed')
     ORDER BY created_at DESC
     LIMIT 1`,
    [runId]
  );
  if (rows.length === 0) return null;
  const wait = rows[0];
  return {
    id: wait.id,
    runId: wait.run_id,
    workflowId: wait.workflow_id,
    nodeId: wait.node_id,
    status: wait.status,
    resumeMode: wait.resume_mode,
    resumeAt: wait.resume_at,
    resumeMechanism: wait.resume_mechanism,
    resumedBy: wait.resumed_by,
    signalledAt: wait.signalled_at,
    resumedAt: wait.resumed_at,
    hasExternalToken: Boolean(wait.resume_token_hash),
    // Decrypt only for authorized callers — never log this.
    externalResumeToken: wait.resume_token_ciphertext
      ? unsealResumeToken(wait.resume_token_ciphertext)
      : null,
  };
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

/**
 * In-memory signal for manual/external resume (Part 8B).
 * Sets resumeAt=now while status stays waiting — worker claims later.
 */
const signalWaitInMemory = (store, waitId, run, mechanism, now = new Date()) => {
  const row = store.get(waitId);
  if (!row) return { ok: false, code: "NOT_FOUND" };
  if (row.status === "claimed" || row.status === "resumed") {
    return { ok: true, idempotent: true, status: row.status };
  }
  if (row.status === "cancelled") {
    return { ok: false, code: "INVALID_TOKEN" };
  }
  if (run.status !== "waiting") {
    return { ok: false, code: "NOT_RESUMABLE" };
  }
  if (mechanism === "manual" && row.resumeMode !== "manual") {
    return { ok: false, code: "WRONG_MODE" };
  }
  if (mechanism === "external" && row.resumeMode !== "external") {
    return { ok: false, code: "INVALID_TOKEN" };
  }
  if (row.tokenHash && mechanism === "external") {
    // caller already matched hash
  }
  if (row.signalledAt && row.resumeAt && new Date(row.resumeAt) <= now) {
    return { ok: true, idempotent: true, status: "signalled" };
  }
  row.resumeAt = now;
  row.signalledAt = now;
  row.resumeMechanism = mechanism;
  store.set(waitId, row);
  run.resumeAt = now;
  return { ok: true, idempotent: false, status: "signalled", runId: run.id };
};

/**
 * Lookup wait by token hash (in-memory external resume).
 */
const findWaitByTokenHashInMemory = (store, tokenHash) => {
  for (const row of store.values()) {
    if (row.tokenHash === tokenHash) return row;
  }
  return null;
};

module.exports = {
  WAIT_UNITS_MS,
  WAIT_CLAIM_LEASE_MS,
  WAIT_MODES,
  resolveWaitMode,
  computeWaitResumeAt,
  generateResumeToken,
  hashResumeToken,
  sealResumeToken,
  unsealResumeToken,
  serializeSchedulerState,
  buildExecutionSnapshot,
  sanitizeBinaryRef,
  sanitizeItem,
  suspendRunAtWait,
  claimDueWaitForRun,
  requestWaitResume,
  getActiveWaitForRun,
  getRecoverableWaitForRun,
  updateWaitProgressSnapshot,
  markWaitResumed,
  cancelWaitsForRun,
  reclaimStaleClaimedWaits,
  claimWaitInMemory,
  reclaimStaleClaimInMemory,
  cancelOrClaimRaceInMemory,
  signalWaitInMemory,
  findWaitByTokenHashInMemory,
  parseJson,
};
