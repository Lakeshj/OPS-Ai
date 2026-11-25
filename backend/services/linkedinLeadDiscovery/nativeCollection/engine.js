/**
 * OpsAi Native LinkedIn collection engine (M10.2).
 *
 * Keyword Engine → Source Adapter → Fetch → Normalize → Match → Dedupe → Output
 * Independent of Apify.
 */

const AppError = require("../../../utils/AppError");
const { normalizeLeadItems } = require("../normalize");
const {
  matchKeywordsInText,
  matchCategoriesForKeywords,
} = require("../keywordEngine");
const { getNativeCollectionConfig } = require("./config");
const { chunkQueries, runBatches } = require("./queryBatcher");
const { dedupeRows } = require("./dedupe");
const feedAdapter = require("./feedAdapter");
const userDatasetAdapter = require("./userDatasetAdapter");
const fixtureAdapter = require("./fixtureAdapter");
const { FEASIBILITY_MATRIX, SELECTED_METHODS } = require("./feasibility");

const enrichMatches = (rows, queries) =>
  (rows || []).map((row) => {
    const matchedKeywords =
      Array.isArray(row.matchedKeywords) && row.matchedKeywords.length
        ? row.matchedKeywords
        : matchKeywordsInText(row.content || "", queries);
    const matchedCategoryIds =
      Array.isArray(row.matchedCategoryIds) && row.matchedCategoryIds.length
        ? row.matchedCategoryIds
        : matchCategoriesForKeywords(matchedKeywords);
    return {
      ...row,
      matchedKeywords,
      matchedCategoryIds,
    };
  });

const normalizeNativeSource = (raw) => {
  const value = String(raw || "")
    .trim()
    .toLowerCase();
  if (
    value === "authorized_feed" ||
    value === "feed" ||
    value === "user_dataset" ||
    value === "dataset" ||
    value === "previous_node" ||
    value === "previous" ||
    value === "fixture"
  ) {
    if (value === "feed") return "authorized_feed";
    if (value === "dataset") return "user_dataset";
    if (value === "previous") return "previous_node";
    return value;
  }
  return "";
};

/**
 * Resolve which permitted source to use. Production never falls back to fixtures.
 */
const resolveSourceMode = (spec = {}, config) => {
  const explicitFixtures =
    spec.useFixtures === true ||
    spec.mode === "fixture" ||
    String(spec.collectionMode || "").toLowerCase() === "fixture";
  const nativeSource = normalizeNativeSource(spec.nativeSource);

  const datasetSize = () =>
    userDatasetAdapter.collectDatasetRows(spec.inputItems, spec.datasetPosts)
      .length;

  const requireFeed = () => {
    if (config.feedConfigured) return "feed";
    throw new AppError(
      "Authorized Data Feed is selected but not configured. Set a Feed URL in the node (or OPSAI_LINKEDIN_FEED_URL server default) and optionally attach a feed credential.",
      501,
      "LINKEDIN_LEAD_NATIVE_NOT_CONFIGURED"
    );
  };

  const requireDataset = (label) => {
    if (datasetSize() > 0) return "user_dataset";
    throw new AppError(
      label === "previous_node"
        ? "Previous Node Input is selected but no LinkedIn post items were found on the incoming workflow items. Connect a prior node that outputs LinkedIn posts (sourcePostUrl/content)."
        : "User-provided Dataset is selected but empty. Paste a JSON array of posts or upload a compatible dataset.",
      501,
      "LINKEDIN_LEAD_NATIVE_NOT_CONFIGURED"
    );
  };

  // Explicit native source selection from the UI.
  if (nativeSource === "authorized_feed") return requireFeed();
  if (nativeSource === "user_dataset") return requireDataset("user_dataset");
  if (nativeSource === "previous_node") return requireDataset("previous_node");
  if (nativeSource === "fixture") {
    if (config.isProduction && !config.allowFixtures) {
      throw new AppError(
        "Fixture mode is not allowed in production.",
        400,
        "LINKEDIN_LEAD_FIXTURES_FORBIDDEN"
      );
    }
    if (!config.allowFixtures && config.isProduction) {
      throw new AppError(
        "Fixture mode is not allowed in production.",
        400,
        "LINKEDIN_LEAD_FIXTURES_FORBIDDEN"
      );
    }
    return "fixture";
  }

  // live:true never uses fixtures — require feed or dataset.
  if (spec.live === true) {
    if (config.feedConfigured) return "feed";
    if (datasetSize() > 0) return "user_dataset";
    throw new AppError(
      "OpsAi Native live collection requires an authorized feed or a user-provided / previous-node LinkedIn dataset. Fixtures are not used when live execution is requested.",
      501,
      "LINKEDIN_LEAD_NATIVE_NOT_CONFIGURED"
    );
  }

  if (explicitFixtures) {
    if (config.isProduction && !config.allowFixtures) {
      throw new AppError(
        "Fixture mode is not allowed in production. Configure an authorized feed or supply a user dataset.",
        400,
        "LINKEDIN_LEAD_FIXTURES_FORBIDDEN"
      );
    }
    return "fixture";
  }

  if (config.feedConfigured) return "feed";
  if (datasetSize() > 0) return "user_dataset";

  if (config.allowFixtures && !config.isProduction) {
    return "fixture";
  }

  throw new AppError(
    "OpsAi Native has no live source configured. In the node settings choose Authorized Data Feed, User-provided Dataset, or Previous Node Input — or set OPSAI_LINKEDIN_ALLOW_FIXTURES=1 for local development fixtures only.",
    501,
    "LINKEDIN_LEAD_NATIVE_NOT_CONFIGURED"
  );
};

const collectViaFeed = async (spec, config) => {
  const plan = chunkQueries(spec.queries, config.queryBatchSize);
  const batchRun = await runBatches({
    batches: plan.batches,
    concurrency: config.concurrency,
    signal: spec.signal,
    onBatch: async (batch) => {
      const remainingSlots = Math.max(
        1,
        (spec.maxResults || 25) - 0
      );
      return feedAdapter.searchBatch({
        config,
        queries: batch.queries,
        maxResults: remainingSlots,
        publicationPeriod: spec.publicationPeriod,
        sortBy: spec.sortBy,
        operation: spec.operation,
        signal: spec.signal,
        fetchImpl: spec.fetchImpl,
      });
    },
  });

  const rawRows = batchRun.succeeded.flatMap((s) => s.value?.rows || []);
  return {
    rawRows,
    coverage: {
      ...batchRun.coverage,
      totalQueries: plan.totalQueries,
      batchSize: plan.batchSize,
      batchCount: plan.batchCount,
    },
    partialErrors: batchRun.failed,
    cancelled: batchRun.cancelled,
  };
};

const collectViaDataset = (spec) => {
  const local = userDatasetAdapter.searchLocal({
    inputItems: spec.inputItems,
    datasetPosts: spec.datasetPosts,
    queries: spec.queries,
    maxResults: spec.maxResults,
  });
  return {
    rawRows: local.rows,
    coverage: {
      totalQueries: (spec.queries || []).length,
      completedQueryCount: (spec.queries || []).length,
      remainingQueryCount: 0,
      remainingQueries: [],
      hasMore: false,
      continuation: null,
      mode: "user_dataset",
      datasetSize: local.datasetSize || 0,
    },
    partialErrors: [],
    cancelled: false,
  };
};

const collectViaFixtures = (spec) => {
  const local = fixtureAdapter.searchFixtures({
    queries: spec.queries,
    maxResults: spec.maxResults,
  });
  return {
    rawRows: local.rows,
    coverage: {
      totalQueries: (spec.queries || []).length,
      completedQueryCount: (spec.queries || []).length,
      remainingQueryCount: 0,
      remainingQueries: [],
      hasMore: false,
      continuation: null,
      mode: "fixture",
    },
    partialErrors: [],
    cancelled: false,
  };
};

const search = async (spec = {}, configOverrides = {}) => {
  const config = getNativeCollectionConfig({
    ...configOverrides,
    feedUrl:
      configOverrides.feedUrl != null
        ? configOverrides.feedUrl
        : spec.feedUrl != null
          ? spec.feedUrl
          : undefined,
    feedToken:
      configOverrides.feedToken != null
        ? configOverrides.feedToken
        : spec.feedToken != null
          ? spec.feedToken
          : undefined,
  });
  const mode = resolveSourceMode(spec, config);
  const collectedAt = new Date().toISOString();

  let collected;
  if (mode === "feed") collected = await collectViaFeed(spec, config);
  else if (mode === "user_dataset") collected = collectViaDataset(spec);
  else collected = collectViaFixtures(spec);

  const enriched = enrichMatches(collected.rawRows, spec.queries);
  const deduped = dedupeRows(enriched);
  const limit = Math.min(Math.max(Number(spec.maxResults) || 25, 1), 100);
  const limited = deduped.rows.slice(0, limit);

  // If every batch failed and we have zero rows, surface the error.
  if (
    !limited.length &&
    collected.partialErrors?.length &&
    collected.coverage?.completedBatches === 0
  ) {
    const first = collected.partialErrors[0]?.error;
    throw new AppError(
      first?.message || "All LinkedIn Native query batches failed.",
      first?.status || 502,
      first?.code || "LINKEDIN_LEAD_NATIVE_FEED_ERROR"
    );
  }

  const items = normalizeLeadItems(limited, {
    provider: "opsai_native",
    operation: spec.operation,
    resource: spec.resource || "lead",
    queries: spec.queries,
    collectedAt,
    fixture: mode === "fixture",
  });

  return {
    items,
    paging: {
      hasMore: Boolean(collected.coverage?.hasMore),
      after: null,
      returned: items.length,
      continuation: collected.coverage?.continuation || null,
    },
    providerMeta: {
      provider: "opsai_native",
      mode,
      liveCollection: mode === "feed",
      sourceAdapter:
        mode === "feed"
          ? feedAdapter.id
          : mode === "user_dataset"
            ? userDatasetAdapter.id
            : fixtureAdapter.id,
      coverage: collected.coverage,
      duplicateMerges: deduped.duplicateMerges,
      partialErrors: collected.partialErrors || [],
      cancelled: Boolean(collected.cancelled),
      message:
        mode === "fixture"
          ? "Deterministic fixture results. Not live LinkedIn data."
          : mode === "user_dataset"
            ? "Matched against user-provided LinkedIn dataset (no remote LinkedIn fetch)."
            : "Results from the configured authorized OpsAi LinkedIn opportunity feed.",
      feasibility: SELECTED_METHODS,
    },
  };
};

const getPostDetails = async (spec = {}, configOverrides = {}) => {
  const config = getNativeCollectionConfig({
    ...configOverrides,
    feedUrl:
      configOverrides.feedUrl != null
        ? configOverrides.feedUrl
        : spec.feedUrl != null
          ? spec.feedUrl
          : undefined,
    feedToken:
      configOverrides.feedToken != null
        ? configOverrides.feedToken
        : spec.feedToken != null
          ? spec.feedToken
          : undefined,
  });
  const mode = resolveSourceMode(spec, config);
  const collectedAt = new Date().toISOString();

  let rows = [];
  if (mode === "feed") {
    const out = await feedAdapter.getPost({
      config,
      postUrl: spec.postUrl,
      postId: spec.postId,
      signal: spec.signal,
      fetchImpl: spec.fetchImpl,
    });
    rows = out.rows;
  } else if (mode === "user_dataset") {
    const out = userDatasetAdapter.getPostLocal({
      inputItems: spec.inputItems,
      datasetPosts: spec.datasetPosts,
      postUrl: spec.postUrl,
      postId: spec.postId,
    });
    rows = out.rows;
  } else {
    const out = fixtureAdapter.getFixturePost({
      postUrl: spec.postUrl,
      postId: spec.postId,
    });
    rows = out.rows;
    if (!rows.length && (spec.postUrl || spec.postId)) {
      // Fixtures: fall back to first sample only when no needle matched and needle empty handled above.
    }
  }

  if (!rows.length) {
    throw new AppError(
      "Post details were not found in the selected OpsAi Native source.",
      404,
      "LINKEDIN_LEAD_POST_NOT_FOUND"
    );
  }

  const items = normalizeLeadItems(rows, {
    provider: "opsai_native",
    operation: "get_post_details",
    resource: "post",
    queries: [],
    collectedAt,
    fixture: mode === "fixture",
  });

  return {
    items,
    paging: { hasMore: false, after: null, returned: items.length },
    providerMeta: {
      provider: "opsai_native",
      mode,
      liveCollection: mode === "feed",
      sourceAdapter:
        mode === "feed"
          ? feedAdapter.id
          : mode === "user_dataset"
            ? userDatasetAdapter.id
            : fixtureAdapter.id,
      message:
        mode === "fixture"
          ? "Fixture post details. Not live LinkedIn data."
          : undefined,
    },
  };
};

const getNativeStatus = (configOverrides = {}) => {
  const config = getNativeCollectionConfig(configOverrides);
  return {
    provider: "opsai_native",
    feedConfigured: config.feedConfigured,
    feedUrlConfigured: Boolean(config.feedUrl),
    envFeedConfigured: Boolean(
      String(process.env.OPSAI_LINKEDIN_FEED_URL || "").trim()
    ),
    allowFixtures: config.allowFixtures,
    isProduction: config.isProduction,
    selectedMethods: SELECTED_METHODS,
    feasibility: FEASIBILITY_MATRIX,
    queryBatchSize: config.queryBatchSize,
    concurrency: config.concurrency,
    sources: {
      authorized_feed: config.feedConfigured ? "configured" : "not_configured",
      user_dataset: "requires_node_input",
      previous_node: "requires_incoming_items",
      fixture:
        config.allowFixtures && !config.isProduction
          ? "dev_only"
          : "disabled",
    },
  };
};

module.exports = {
  search,
  getPostDetails,
  resolveSourceMode,
  normalizeNativeSource,
  getNativeStatus,
  FEASIBILITY_MATRIX,
  SELECTED_METHODS,
  FIXTURE_POSTS: fixtureAdapter.FIXTURE_POSTS,
};
