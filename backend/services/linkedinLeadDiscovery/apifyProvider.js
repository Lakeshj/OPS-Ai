/**
 * Optional Apify provider for LinkedIn Lead Discovery (M10.3 / M10.3.9).
 * Independent of OpsAi Native feed. Reuses shared keyword batching + normalize + dedupe.
 *
 * Actor: scrapeforge/linkedin-all-in-one (id kTfhD8wSCMRXlhNmE) — no LinkedIn cookies.
 */

const AppError = require("../../utils/AppError");
const { getProviderDescriptor } = require("./providerInterface");
const { normalizeLeadItems } = require("./normalize");
const {
  matchKeywordsInText,
  matchCategoriesForKeywords,
} = require("./keywordEngine");
const { chunkQueries, runBatches } = require("./nativeCollection/queryBatcher");
const { dedupeRows } = require("./nativeCollection/dedupe");
const { extractToken, createApifyClient } = require("./apify/client");
const {
  fetchUsageStatus,
  assertBillingModeAllowed,
  clearUsageCache,
} = require("./apify/usage");
const { buildActorInput } = require("./apify/inputMapper");
const { runActorAndCollect } = require("./apify/runner");
const { mapApifyItems } = require("./apify/mapResults");
const {
  filterBuyerRelevance,
  shouldApplyBuyerFilter,
} = require("./buyerRelevance");
const {
  ACTOR_ID,
  ACTOR_URL,
  ACTOR_PRICING,
  DEFAULT_RUN,
} = require("./apify/constants");

const ACTOR = getProviderDescriptor("apify");

const resolveClient = (spec = {}) => {
  if (spec.apifyClient) return spec.apifyClient;
  const token = extractToken(spec.credential);
  return createApifyClient({
    token,
    fetchImpl: spec.fetchImpl,
    actorId: spec.actorId || ACTOR_ID,
  });
};

const enrichMatches = (rows, queries) =>
  (rows || []).map((row) => {
    const matchedKeywords =
      Array.isArray(row.matchedKeywords) && row.matchedKeywords.length
        ? row.matchedKeywords
        : matchKeywordsInText(row.content || "", queries || []);
    const matchedCategoryIds =
      Array.isArray(row.matchedCategoryIds) && row.matchedCategoryIds.length
        ? row.matchedCategoryIds
        : matchCategoriesForKeywords(matchedKeywords);
    return { ...row, matchedKeywords, matchedCategoryIds };
  });

const buildActorInputPreview = (spec = {}) => {
  const mapped = buildActorInput(spec);
  return {
    actorId: ACTOR_ID,
    actorUrl: ACTOR_URL,
    inputPreview: {
      mode: mapped.input.mode,
      search: mapped.input.search || null,
      postUrls: mapped.input.postUrls || null,
      postedLimit: mapped.input.postedLimit || null,
      sortBy: mapped.input.sortBy || null,
      maxPosts: mapped.input.maxPosts || null,
    },
    note: "Preview of Actor input mapping (no LinkedIn cookies).",
  };
};

const getUsageStatus = async ({
  credential,
  forceRefresh = false,
  apifyClient,
  fetchImpl,
} = {}) => {
  const hasToken = Boolean(extractToken(credential));
  if (!hasToken && !apifyClient) {
    return {
      available: false,
      connected: false,
      reason: "Connect an Apify API token to load usage status.",
      free: null,
      paid: null,
      actorId: ACTOR_ID,
      actorUrl: ACTOR_URL,
      pricingModel: ACTOR_PRICING.model,
      allowanceNote: ACTOR_PRICING.note,
    };
  }
  try {
    const client =
      apifyClient ||
      createApifyClient({ token: extractToken(credential), fetchImpl });
    const cacheKey = credential?.id || "anon";
    // Must await — a bare `return fetchUsageStatus(...)` lets async 401
    // rejections escape the try/catch and surface as OpsAi HTTP 401 → logout.
    return await fetchUsageStatus(client, { forceRefresh, cacheKey });
  } catch (err) {
    if (err instanceof AppError) {
      return {
        available: false,
        connected: false,
        reason: err.message,
        code: err.code,
        free: null,
        paid: null,
        actorId: ACTOR_ID,
        actorUrl: ACTOR_URL,
        provider: "apify",
      };
    }
    return {
      available: false,
      connected: hasToken,
      reason: "Apify usage status unavailable.",
      free: null,
      paid: null,
      actorId: ACTOR_ID,
      actorUrl: ACTOR_URL,
      provider: "apify",
    };
  }
};

const prepareEntitlement = async (client, spec) => {
  const usage = await fetchUsageStatus(client, {
    forceRefresh: true,
    cacheKey: spec.credential?.id || "anon",
  });
  const gate = assertBillingModeAllowed(usage, spec.billingMode);
  return { usage, gate };
};

const search = async (spec = {}) => {
  const client = resolveClient(spec);
  const { usage, gate } = await prepareEntitlement(client, spec);

  // Validate actor exists (capability check) — injectable mock may skip hard fail.
  try {
    await client.getActor();
  } catch (err) {
    if (err?.code === "LINKEDIN_LEAD_APIFY_CREDENTIAL_INVALID") throw err;
    throw new AppError(
      "Apify LinkedIn post scraper Actor is unavailable.",
      502,
      "LINKEDIN_LEAD_APIFY_ACTOR_UNAVAILABLE"
    );
  }

  const queries = Array.isArray(spec.queries) ? spec.queries : [];
  const batchSize = Math.min(
    Math.max(Number(spec.queryBatchSize) || 5, 1),
    10
  );
  const plan = chunkQueries(queries, batchSize);
  const maxResults = Math.min(Math.max(Number(spec.maxResults) || 25, 1), 100);
  const applyBuyerFilter = shouldApplyBuyerFilter(spec.operation);

  // Free mode: serialize batches and decrement shared maxTotalChargeUsd so
  // concurrent runs cannot collectively exceed the included allowance.
  const freeMode = gate.mode === "free";
  let remainingChargeUsd =
    gate.maxTotalChargeUsd != null && Number.isFinite(gate.maxTotalChargeUsd)
      ? Number(gate.maxTotalChargeUsd)
      : null;
  const minCharge =
    ACTOR_PRICING.events.actorStartUsd + ACTOR_PRICING.events.datasetItemUsd;

  // Distribute per-batch maxItems so early queries cannot alone consume the
  // global result budget (later keyword batches still execute).
  const batchCount = Math.max(1, plan.batchCount || plan.batches.length || 1);
  const basePerBatch = Math.max(3, Math.ceil(maxResults / batchCount));
  let remainingItemBudget = maxResults;

  const batchRun = await runBatches({
    batches: plan.batches,
    concurrency: freeMode ? 1 : Math.min(Number(spec.concurrency) || 1, 2),
    signal: spec.signal,
    onBatch: async (batch) => {
      if (remainingChargeUsd != null && remainingChargeUsd < minCharge) {
        throw new AppError(
          "Free Apify allowance would be exceeded by additional query batches. Remaining queries were not executed.",
          402,
          "LINKEDIN_LEAD_APIFY_FREE_EXHAUSTED"
        );
      }
      if (remainingItemBudget <= 0) {
        return {
          queryCount: batch.queries.length,
          rows: [],
          runId: null,
          status: "SKIPPED_BUDGET",
          partial: false,
          skipped: true,
        };
      }
      const batchMaxItems = Math.min(
        maxResults,
        Math.max(basePerBatch, remainingItemBudget)
      );
      const mapped = buildActorInput({
        ...spec,
        queries: batch.queries,
        operation: spec.operation,
        maxResults: batchMaxItems,
      });
      const batchCap =
        remainingChargeUsd != null ? remainingChargeUsd : gate.maxTotalChargeUsd;
      const collected = await runActorAndCollect(client, {
        input: mapped.input,
        maxItems: batchMaxItems,
        maxTotalChargeUsd: batchCap,
        signal: spec.signal,
        timeoutSecs: DEFAULT_RUN.timeoutSecs,
        idempotencyKey: spec.idempotencyKey
          ? `${spec.idempotencyKey}:${batch.batchIndex}`
          : undefined,
      });
      const mappedRows = mapApifyItems(collected.items);
      remainingItemBudget = Math.max(
        0,
        remainingItemBudget - mappedRows.length
      );
      if (remainingChargeUsd != null) {
        const estimated =
          ACTOR_PRICING.events.actorStartUsd +
          Math.max(1, collected.items?.length || 0) *
            ACTOR_PRICING.events.datasetItemUsd;
        remainingChargeUsd = Math.max(0, remainingChargeUsd - estimated);
      }
      return {
        queryCount: batch.queries.length,
        rows: mappedRows,
        runId: collected.runId,
        status: collected.status,
        partial: collected.partial,
      };
    },
  });

  const rawRows = batchRun.succeeded.flatMap((s) => s.value?.rows || []);
  if (
    !rawRows.length &&
    batchRun.failed.length &&
    batchRun.coverage.completedBatches === 0
  ) {
    const first = batchRun.failed[0]?.error;
    throw new AppError(
      first?.message || "All Apify query batches failed.",
      first?.status || 502,
      first?.code || "LINKEDIN_LEAD_APIFY_RUN_FAILED"
    );
  }

  const enriched = enrichMatches(rawRows, queries);
  const deduped = dedupeRows(enriched);
  const filtered = filterBuyerRelevance(deduped.rows, {
    sortBy: spec.sortBy,
    operation: spec.operation,
    categoryIds: spec.categoryIds,
    maxResults,
  });
  const limited = applyBuyerFilter
    ? filtered.rows
    : deduped.rows.slice(0, maxResults);
  const collectedAt = new Date().toISOString();
  const items = normalizeLeadItems(limited, {
    provider: "apify",
    operation: spec.operation,
    resource: spec.resource || "lead",
    queries,
    collectedAt,
    fixture: false,
  });

  clearUsageCache(spec.credential?.id);

  return {
    items,
    paging: {
      hasMore: Boolean(batchRun.coverage?.hasMore),
      after: null,
      returned: items.length,
      continuation: batchRun.coverage?.continuation || null,
    },
    providerMeta: {
      provider: "apify",
      mode: "apify_live",
      liveCollection: true,
      billingMode: gate.mode,
      actorId: ACTOR_ID,
      actorUrl: ACTOR_URL,
      pricingModel: ACTOR_PRICING.model,
      sortBy: spec.sortBy || "recent",
      selectedKeywords: queries,
      queriesExecuted: plan.totalQueries,
      coverage: {
        ...batchRun.coverage,
        totalQueries: plan.totalQueries,
        batchSize: plan.batchSize,
        batchCount: plan.batchCount,
        perBatchItemBudget: basePerBatch,
      },
      rawPostsRetrieved: rawRows.length,
      duplicateMerges: deduped.duplicateMerges,
      relevance: applyBuyerFilter
        ? {
            ...filtered.diagnostics,
            finalResultCount: items.length,
          }
        : { applied: false, finalResultCount: items.length },
      partialErrors: batchRun.failed,
      usageSnapshot: {
        refreshedAt: usage.refreshedAt,
        freePlan: usage.freePlan,
        freeRemainingUsd: usage.free?.remainingUsd ?? null,
        paidRemainingUsd: usage.paid?.remainingUsd ?? null,
      },
      message:
        items.length === 0
          ? applyBuyerFilter
            ? "No buyer-intent opportunities matched after relevance filtering."
            : "Apify returned no matching posts for the selected queries."
          : "Results from Apify LinkedIn post search scraper.",
    },
  };
};

const getPostDetails = async (spec = {}) => {
  if (!spec.postUrl && !spec.postId) {
    throw new AppError(
      "Provide a LinkedIn post URL for Get Post Details.",
      400,
      "LINKEDIN_LEAD_POST_REQUIRED"
    );
  }
  const client = resolveClient(spec);
  const { usage, gate } = await prepareEntitlement(client, spec);
  const mapped = buildActorInput({
    operation: "get_post_details",
    postUrl: spec.postUrl,
    postId: spec.postId,
    maxResults: 1,
  });
  const collected = await runActorAndCollect(client, {
    input: mapped.input,
    maxItems: 5,
    maxTotalChargeUsd: gate.maxTotalChargeUsd,
    signal: spec.signal,
  });
  const rows = mapApifyItems(collected.items);
  if (!rows.length) {
    throw new AppError(
      collected.partial
        ? "Apify run ended without post details (partial/timeout)."
        : "Apify did not return details for this LinkedIn post.",
      collected.partial ? 502 : 404,
      collected.partial
        ? "LINKEDIN_LEAD_APIFY_RUN_FAILED"
        : "LINKEDIN_LEAD_POST_NOT_FOUND"
    );
  }
  const items = normalizeLeadItems(rows.slice(0, 1), {
    provider: "apify",
    operation: "get_post_details",
    resource: "post",
    queries: [],
    collectedAt: new Date().toISOString(),
    fixture: false,
  });
  clearUsageCache(spec.credential?.id);
  return {
    items,
    paging: { hasMore: false, after: null, returned: items.length },
    providerMeta: {
      provider: "apify",
      mode: "apify_live",
      liveCollection: true,
      billingMode: gate.mode,
      actorId: ACTOR_ID,
      runId: collected.runId,
      usageSnapshot: {
        refreshedAt: usage.refreshedAt,
        freePlan: usage.freePlan,
      },
    },
  };
};

module.exports = {
  id: "apify",
  ACTOR,
  ACTOR_ID,
  ACTOR_URL,
  ACTOR_PRICING,
  buildActorInputPreview,
  search,
  getPostDetails,
  getUsageStatus,
  extractToken,
  createApifyClient,
  clearUsageCache,
};
