/**
 * Deterministic query batching with continuation metadata.
 * Never silently drops queries — remaining batches are reported.
 */

const chunkQueries = (queries, batchSize) => {
  const list = Array.isArray(queries) ? queries.map(String) : [];
  const size = Math.max(1, Number(batchSize) || 10);
  const batches = [];
  for (let i = 0; i < list.length; i += size) {
    batches.push({
      batchIndex: batches.length,
      offset: i,
      queries: list.slice(i, i + size),
    });
  }
  return {
    totalQueries: list.length,
    batchSize: size,
    batchCount: batches.length,
    batches,
  };
};

/**
 * Run async work over batches with bounded concurrency.
 * Collects partial successes; records per-batch errors.
 */
const runBatches = async ({
  batches,
  concurrency = 3,
  signal,
  onBatch,
}) => {
  const limit = Math.max(1, Number(concurrency) || 3);
  const results = new Array(batches.length);
  let next = 0;
  let cancelled = false;

  const worker = async () => {
    while (true) {
      if (signal?.aborted) {
        cancelled = true;
        break;
      }
      const idx = next;
      next += 1;
      if (idx >= batches.length) break;
      const batch = batches[idx];
      try {
        const value = await onBatch(batch, idx);
        results[idx] = { ok: true, batchIndex: idx, value };
      } catch (err) {
        results[idx] = {
          ok: false,
          batchIndex: idx,
          error: {
            message: err?.message || String(err),
            code: err?.code || null,
            status: err?.status || err?.statusCode || null,
          },
          queries: batch.queries,
        };
      }
    }
  };

  const workers = Array.from({ length: Math.min(limit, batches.length || 1) }, () =>
    worker()
  );
  await Promise.all(workers);

  const succeeded = results.filter((r) => r && r.ok);
  const failed = results.filter((r) => r && !r.ok);
  const pending =
    cancelled
      ? batches
          .slice(results.findIndex((r) => !r) === -1 ? batches.length : 0)
          .filter((_, i) => !results[i])
      : [];

  // Remaining query coverage when some batches failed or were cancelled.
  const completedQueryCount = succeeded.reduce(
    (sum, r) => sum + (r.value?.queryCount ?? batches[r.batchIndex]?.queries?.length ?? 0),
    0
  );
  const failedQueries = failed.flatMap((r) => r.queries || []);
  const remainingQueries = [
    ...failedQueries,
    ...pending.flatMap((b) => b.queries || []),
  ];

  return {
    results,
    succeeded,
    failed,
    cancelled,
    coverage: {
      totalBatches: batches.length,
      completedBatches: succeeded.length,
      failedBatches: failed.length,
      completedQueryCount,
      remainingQueryCount: remainingQueries.length,
      remainingQueries,
      hasMore: remainingQueries.length > 0,
      continuation: remainingQueries.length
        ? {
            reason: cancelled
              ? "cancelled"
              : failed.length
                ? "partial_batch_failures"
                : "incomplete",
            nextQueries: remainingQueries,
          }
        : null,
    },
  };
};

module.exports = {
  chunkQueries,
  runBatches,
};
