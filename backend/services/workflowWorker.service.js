const os = require("os");
const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/database");
const { executeRun } = require("./workflowEngine.service");
const {
  reclaimStaleClaimedWaits,
  WAIT_CLAIM_LEASE_MS,
} = require("./workflowWait.service");

const WORKER_ID =
  process.env.WORKFLOW_WORKER_ID ||
  `${os.hostname()}-${process.pid}-${uuidv4().slice(0, 8)}`;
const POLL_MS = Number(process.env.WORKFLOW_WORKER_POLL_MS) || 1500;
const MAX_ATTEMPTS = Number(process.env.WORKFLOW_JOB_MAX_ATTEMPTS) || 3;
const JOB_LOCK_LEASE_MS =
  Number(process.env.WORKFLOW_JOB_LOCK_LEASE_MS) || WAIT_CLAIM_LEASE_MS;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let loopPromise = null;
let stopping = false;

/**
 * Reclaim jobs stuck in locked after a worker crash.
 * Without this, claimed waits with locked jobs hang forever.
 */
const reclaimStaleLockedJobs = async (
  leaseMs = JOB_LOCK_LEASE_MS,
  now = new Date()
) => {
  const cutoff = new Date(now.getTime() - leaseMs);
  const [result] = await pool.execute(
    `UPDATE workflow_jobs
     SET status = 'queued',
         locked_at = NULL,
         locked_by = NULL,
         available_at = LEAST(available_at, CURRENT_TIMESTAMP)
     WHERE status = 'locked'
       AND locked_at IS NOT NULL
       AND locked_at < ?`,
    [cutoff]
  );
  return result.affectedRows || 0;
};

const reclaimStaleWork = async (now = new Date()) => {
  await reclaimStaleLockedJobs(JOB_LOCK_LEASE_MS, now);
  await reclaimStaleClaimedWaits(WAIT_CLAIM_LEASE_MS, now);
};

const claimNextJob = async () => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `SELECT id, run_id, attempts
       FROM workflow_jobs
       WHERE status = 'queued' AND available_at <= CURRENT_TIMESTAMP
       ORDER BY available_at ASC
       LIMIT 1
       FOR UPDATE`
    );

    if (rows.length === 0) {
      await connection.commit();
      return null;
    }

    const job = rows[0];
    await connection.execute(
      `UPDATE workflow_jobs
       SET status = 'locked',
           locked_at = CURRENT_TIMESTAMP,
           locked_by = ?,
           attempts = attempts + 1
       WHERE id = ?`,
      [WORKER_ID, job.id]
    );
    await connection.commit();
    return { ...job, attempts: job.attempts + 1 };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};

const markJobDone = async (jobId) => {
  await pool.execute(
    `UPDATE workflow_jobs SET status = 'done', locked_at = NULL WHERE id = ?`,
    [jobId]
  );
};

const markJobFailedOrRetry = async (job, errorMessage) => {
  if (job.attempts >= MAX_ATTEMPTS) {
    await pool.execute(
      `UPDATE workflow_jobs SET status = 'failed', locked_at = NULL WHERE id = ?`,
      [job.id]
    );
    await pool.execute(
      `UPDATE workflow_runs
       SET status = 'failed',
           error = COALESCE(error, ?),
           finished_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status IN ('queued', 'running')`,
      [errorMessage, job.run_id]
    );
    return;
  }

  await pool.execute(
    `UPDATE workflow_jobs
     SET status = 'queued',
         locked_at = NULL,
         locked_by = NULL,
         available_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 5 SECOND)
     WHERE id = ?`,
    [job.id]
  );
};

const processOnce = async (options = {}) => {
  await reclaimStaleWork(options.now instanceof Date ? options.now : new Date());

  try {
    const {
      reconcileOrphanedChildWaits,
    } = require("./workflowSubworkflow.service");
    await reconcileOrphanedChildWaits(20);
  } catch {
    // Non-fatal — next poll retries.
  }

  const job = await claimNextJob();
  if (!job) return false;

  console.info(`[workflow-worker] claimed job ${job.id} run=${job.run_id}`);
  try {
    const result = await executeRun(job.run_id, {
      jobId: job.id,
      claimToken: `${WORKER_ID}-${job.id}-${job.attempts}`,
      now: options.now,
    });
    if (result?.status === "waiting") {
      if (result.deferred) {
        // Unlock without burning attempt budget on not-due wakes.
        await pool.execute(
          `UPDATE workflow_jobs
           SET status = 'queued',
               locked_at = NULL,
               locked_by = NULL,
               attempts = GREATEST(0, attempts - 1),
               available_at = GREATEST(
                 available_at,
                 DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 1 SECOND)
               )
           WHERE id = ?`,
          [job.id]
        );
      }
      console.info(
        `[workflow-worker] run ${job.run_id} waiting until ${result.resumeAt || "?"}`
      );
      return true;
    }
    if (result?.status === "cancelled") {
      await markJobDone(job.id);
      console.info(`[workflow-worker] run ${job.run_id} cancelled`);
      return true;
    }
    await markJobDone(job.id);
    console.info(`[workflow-worker] run ${job.run_id} succeeded`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[workflow-worker] run ${job.run_id} failed:`, message);
    await markJobFailedOrRetry(job, message);
  }
  return true;
};

const startWorkflowWorker = () => {
  if (loopPromise) return loopPromise;

  stopping = false;
  console.info(
    `[workflow-worker] embedded start id=${WORKER_ID} poll=${POLL_MS}ms`
  );

  loopPromise = (async () => {
    while (!stopping) {
      try {
        const didWork = await processOnce();
        if (!didWork) await sleep(POLL_MS);
      } catch (err) {
        console.error("[workflow-worker] loop error:", err);
        await sleep(POLL_MS);
      }
    }
    loopPromise = null;
    console.info("[workflow-worker] stopped");
  })();

  return loopPromise;
};

const stopWorkflowWorker = () => {
  stopping = true;
};

module.exports = {
  startWorkflowWorker,
  stopWorkflowWorker,
  processOnce,
  claimNextJob,
  markJobDone,
  reclaimStaleLockedJobs,
  reclaimStaleWork,
  JOB_LOCK_LEASE_MS,
  WORKER_ID,
};
