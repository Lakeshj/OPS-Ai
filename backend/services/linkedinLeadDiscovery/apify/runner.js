/**
 * Apify Actor run lifecycle: start → poll → dataset pagination → abort.
 * Short-lived idempotency cache avoids duplicate runs on immediate retries.
 */

const crypto = require("node:crypto");
const AppError = require("../../../utils/AppError");
const { DEFAULT_RUN } = require("./constants");

const recentRuns = new Map();
const IDEMPOTENCY_TTL_MS = 2 * 60 * 1000;

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        new AppError(
          "Apify run cancelled.",
          499,
          "LINKEDIN_LEAD_APIFY_CANCELLED"
        )
      );
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(
        new AppError(
          "Apify run cancelled.",
          499,
          "LINKEDIN_LEAD_APIFY_CANCELLED"
        )
      );
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });

const hashInput = (actorId, input, maxItems) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify({ actorId, input, maxItems }))
    .digest("hex")
    .slice(0, 32);

const TERMINAL = new Set([
  "SUCCEEDED",
  "FAILED",
  "ABORTED",
  "TIMED-OUT",
  "TIMED_OUT",
]);

const runActorAndCollect = async (
  client,
  {
    input,
    maxItems,
    maxTotalChargeUsd,
    signal,
    timeoutSecs = DEFAULT_RUN.timeoutSecs,
    memoryMbytes = DEFAULT_RUN.memoryMbytes,
    pollIntervalMs = DEFAULT_RUN.pollIntervalMs,
    maxPollMs = DEFAULT_RUN.maxPollMs,
    pageSize = DEFAULT_RUN.datasetPageSize,
    idempotencyKey,
  } = {}
) => {
  if (!input?.urls?.length) {
    throw new AppError(
      "No LinkedIn source URLs were mapped for the Apify Actor.",
      400,
      "LINKEDIN_LEAD_APIFY_INPUT_INVALID"
    );
  }

  const key =
    idempotencyKey ||
    hashInput(client.actorId, input, maxItems);
  const cached = recentRuns.get(key);
  let runData;
  if (cached && Date.now() - cached.at < IDEMPOTENCY_TTL_MS && cached.runId) {
    const existing = await client.getRun(cached.runId, { signal });
    runData = existing.body?.data || existing.body;
  } else {
    const started = await client.startRun(input, {
      timeoutSecs,
      memoryMbytes,
      maxItems,
      maxTotalChargeUsd,
      signal,
    });
    runData = started.body?.data || started.body;
    if (!runData?.id) {
      throw new AppError(
        "Apify Actor run did not return a run id.",
        502,
        "LINKEDIN_LEAD_APIFY_RUN_FAILED"
      );
    }
    recentRuns.set(key, { at: Date.now(), runId: runData.id });
  }

  const runId = runData.id;
  const startedAt = Date.now();
  let status = String(runData.status || "RUNNING").toUpperCase();

  while (!TERMINAL.has(status)) {
    if (signal?.aborted) {
      try {
        await client.abortRun(runId, { signal: undefined });
      } catch (_) {
        // best-effort abort
      }
      throw new AppError(
        "Apify run cancelled.",
        499,
        "LINKEDIN_LEAD_APIFY_CANCELLED"
      );
    }
    if (Date.now() - startedAt > maxPollMs) {
      try {
        await client.abortRun(runId);
      } catch (_) {
        // ignore
      }
      throw new AppError(
        "Apify Actor run timed out while waiting for completion.",
        408,
        "LINKEDIN_LEAD_APIFY_TIMEOUT"
      );
    }
    await sleep(pollIntervalMs, signal);
    const polled = await client.getRun(runId, { signal });
    runData = polled.body?.data || polled.body;
    status = String(runData.status || "").toUpperCase();
  }

  if (status === "FAILED") {
    throw new AppError(
      runData.statusMessage ||
        "Apify Actor execution failed. Check Actor logs in Apify Console.",
      502,
      "LINKEDIN_LEAD_APIFY_RUN_FAILED"
    );
  }
  if (status === "ABORTED") {
    throw new AppError(
      "Apify Actor run was aborted.",
      499,
      "LINKEDIN_LEAD_APIFY_CANCELLED"
    );
  }
  if (status === "TIMED-OUT" || status === "TIMED_OUT") {
    // Timed-out runs may still have partial dataset items.
  }

  const datasetId = runData.defaultDatasetId;
  if (!datasetId) {
    if (status === "SUCCEEDED") {
      return {
        runId,
        status,
        items: [],
        partial: false,
        empty: true,
      };
    }
    throw new AppError(
      "Apify dataset unavailable for this Actor run.",
      502,
      "LINKEDIN_LEAD_APIFY_DATASET_UNAVAILABLE"
    );
  }

  const items = [];
  let offset = 0;
  let total = null;
  while (true) {
    const page = await client.listDatasetItems(datasetId, {
      offset,
      limit: pageSize,
      signal,
    });
    const rows = Array.isArray(page.body)
      ? page.body
      : Array.isArray(page.body?.data)
        ? page.body.data
        : Array.isArray(page.body?.items)
          ? page.body.items
          : [];
    items.push(...rows);
    const count = rows.length;
    if (typeof page.body?.total === "number") total = page.body.total;
    if (count < pageSize) break;
    offset += count;
    if (maxItems != null && items.length >= maxItems) break;
    if (total != null && offset >= total) break;
  }

  const trimmed =
    maxItems != null ? items.slice(0, Math.max(1, Number(maxItems))) : items;

  return {
    runId,
    status,
    datasetId,
    items: trimmed,
    partial: status !== "SUCCEEDED",
    empty: trimmed.length === 0,
    totalReturned: trimmed.length,
  };
};

const clearIdempotencyCache = () => recentRuns.clear();

module.exports = {
  runActorAndCollect,
  clearIdempotencyCache,
  hashInput,
};
