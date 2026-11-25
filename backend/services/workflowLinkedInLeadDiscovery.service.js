/**
 * LinkedIn Lead Discovery Native — domain service + Native adapter (M10.1).
 * Independent of Instagram / Meta Ads / Facebook Page / GSC / GA4.
 */

const AppError = require("../utils/AppError");
const { getPublicLibrary } = require("./linkedinLeadDiscovery/keywordLibrary");
const { buildSearchQueries } = require("./linkedinLeadDiscovery/keywordEngine");
const {
  PROVIDERS,
  normalizeProviderId,
  getProviderDescriptor,
  providerSupports,
} = require("./linkedinLeadDiscovery/providerInterface");
const opsaiNative = require("./linkedinLeadDiscovery/opsaiNativeProvider");
const apify = require("./linkedinLeadDiscovery/apifyProvider");

const OPERATIONS = Object.freeze({
  discover_by_category: Object.freeze({
    id: "discover_by_category",
    label: "Discover Leads by Service Category",
    mode: "category",
  }),
  discover_by_custom_keywords: Object.freeze({
    id: "discover_by_custom_keywords",
    label: "Discover Leads by Custom Keywords",
    mode: "custom",
  }),
  search_posts: Object.freeze({
    id: "search_posts",
    label: "Search LinkedIn Posts",
    mode: "search_posts",
  }),
  get_post_details: Object.freeze({
    id: "get_post_details",
    label: "Get Post Details",
    mode: "get_post_details",
  }),
});

const SECRET_KEY_RE =
  /(access[_-]?token|api[_-]?token|refresh[_-]?token|client[_-]?secret|cookie|authorization|^password$|^secret$|^token$)/i;

const stripSecretKeys = (value) => {
  if (Array.isArray(value)) return value.map(stripSecretKeys);
  if (!value || typeof value !== "object") return value;
  const next = {};
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEY_RE.test(key)) continue;
    next[key] = stripSecretKeys(nested);
  }
  return next;
};

const sanitizeLinkedInLeadDiscoveryNodeData = (data) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const next = stripSecretKeys(data);
  if (next.operation != null) next.operation = String(next.operation).trim();
  if (next.dataProvider != null) {
    next.dataProvider = normalizeProviderId(next.dataProvider);
  }
  if (next.maxResults != null) {
    const n = Number(next.maxResults);
    next.maxResults = Number.isFinite(n)
      ? Math.min(Math.max(Math.floor(n), 1), 100)
      : 25;
  }
  if (Array.isArray(next.categoryIds)) {
    next.categoryIds = next.categoryIds.map(String);
  }
  if (Array.isArray(next.intentIds)) {
    next.intentIds = next.intentIds.map(String);
  }
  if (Array.isArray(next.customKeywords)) {
    next.customKeywords = next.customKeywords.map((k) => String(k).trim()).filter(Boolean);
  }
  if (next.postUrl != null) next.postUrl = String(next.postUrl).trim();
  if (next.postId != null) next.postId = String(next.postId).trim();
  // Clear incompatible stale params by operation.
  const op = next.operation || "discover_by_category";
  if (op === "get_post_details") {
    delete next.categoryIds;
    delete next.intentExpansion;
    delete next.intentIds;
    delete next.customKeywords;
  }
  if (op === "discover_by_custom_keywords" || op === "search_posts") {
    delete next.categoryIds;
  }
  if (op === "discover_by_category") {
    // keep categoryIds
  }
  if (normalizeProviderId(next.dataProvider) !== "apify") {
    delete next.apifyBillingMode;
    delete next.apifyCredentialId;
  }
  return next;
};

const resolveProvider = (providerId) => {
  const id = normalizeProviderId(providerId);
  if (id === "apify") return apify;
  return opsaiNative;
};

const leadError = (message, code, status = 400) =>
  new AppError(message, status, code);

const resolveApifyCredential = async (data, context) => {
  if (normalizeProviderId(data.dataProvider) !== "apify") return null;
  if (context?.apifyCredential) return context.apifyCredential;
  const credentialId = String(data.apifyCredentialId || "").trim();
  if (!credentialId) {
    throw leadError(
      "Select an Apify API token credential before running with the Apify provider.",
      "LINKEDIN_LEAD_APIFY_NOT_CONNECTED"
    );
  }
  const workspaceId = String(
    context?.workspaceId || context?.workspace?.id || ""
  ).trim();
  if (!workspaceId) {
    throw leadError(
      "Workspace context is required to resolve the Apify credential.",
      "LINKEDIN_LEAD_APIFY_NOT_CONNECTED"
    );
  }
  const credentials = require("../modules/workflows/credentials.service");
  const credential = await credentials.getForWorkspace(credentialId, workspaceId);
  if (!credential || credential.type !== "apify") {
    throw leadError(
      "Apify credential not found for this workspace.",
      "LINKEDIN_LEAD_APIFY_NOT_CONNECTED",
      404
    );
  }
  return credential;
};

const executeLinkedInLeadDiscoveryNode = async (node, context) => {
  const data = sanitizeLinkedInLeadDiscoveryNodeData(node?.data || {});
  const operation = String(data.operation || "discover_by_category").trim();
  const providerId = normalizeProviderId(data.dataProvider);
  const provider = resolveProvider(providerId);
  const descriptor = getProviderDescriptor(providerId);

  if (!OPERATIONS[operation]) {
    throw leadError(
      "Unsupported LinkedIn Lead Discovery operation.",
      "LINKEDIN_LEAD_OPERATION_UNSUPPORTED"
    );
  }
  if (!providerSupports(providerId, operation)) {
    throw leadError(
      `${descriptor.label} does not support ${OPERATIONS[operation].label}.`,
      "LINKEDIN_LEAD_CAPABILITY_UNSUPPORTED"
    );
  }

  const inputItems = Array.isArray(context?.inputItems)
    ? context.inputItems
    : Array.isArray(context?.items)
      ? context.items
      : [];
  const datasetPosts = Array.isArray(data.datasetPosts) ? data.datasetPosts : [];
  const useFixtures = data.useFixtures === true;
  const signal = context?.signal || context?.abortSignal || undefined;
  const apifyCredential =
    providerId === "apify"
      ? await resolveApifyCredential(data, context)
      : null;

  if (operation === "get_post_details") {
    const result = await provider.getPostDetails({
      postUrl: data.postUrl,
      postId: data.postId,
      live: data.live === true,
      useFixtures,
      inputItems,
      datasetPosts,
      signal,
      credentialId: data.apifyCredentialId,
      credential: apifyCredential,
      billingMode: data.apifyBillingMode || "free",
      apifyClient: context?.apifyClient,
      fetchImpl: context?.apifyFetchImpl,
    });
    return wrapResult(result, {
      operation,
      providerId,
      queries: [],
    });
  }

  const queryPlan = buildSearchQueries({
    mode: OPERATIONS[operation].mode,
    categoryIds: data.categoryIds,
    customKeywords: data.customKeywords || data.searchKeywords,
    additionalKeywords: data.additionalKeywords,
    keywordOverrides: data.keywordOverrides,
    intentExpansion: data.intentExpansion === true,
    intentIds: data.intentIds,
    maxQueries: data.maxQueries || 500,
  });

  if (!queryPlan.queries.length) {
    throw leadError(
      operation === "discover_by_category"
        ? "Select at least one service category (or provide keyword overrides)."
        : "Provide at least one search keyword.",
      "LINKEDIN_LEAD_KEYWORDS_REQUIRED"
    );
  }

  const result = await provider.search({
    operation,
    resource: operation === "search_posts" ? "post" : "lead",
    queries: queryPlan.queries,
    maxResults: data.maxResults || 25,
    publicationPeriod: data.publicationPeriod || "past-week",
    sortBy: data.sortBy || "recent",
    live: data.live === true,
    useFixtures,
    inputItems,
    datasetPosts,
    signal,
    credentialId: data.apifyCredentialId,
    credential: apifyCredential,
    billingMode: data.apifyBillingMode || "free",
    apifyClient: context?.apifyClient,
    fetchImpl: context?.apifyFetchImpl,
  });

  return wrapResult(result, {
    operation,
    providerId,
    queryPlan,
  });
};

const wrapResult = (result, { operation, providerId, queryPlan, queries }) => {
  const rawItems = Array.isArray(result?.items) ? result.items : [];
  const items = rawItems.map((row) =>
    row && typeof row === "object" && row.json && typeof row.json === "object"
      ? row
      : { json: row }
  );
  const plan = queryPlan || null;
  return {
    items,
    output: {
      resource: operation === "search_posts" || operation === "get_post_details" ? "post" : "lead",
      operation,
      dataProvider: providerId,
      rowCount: items.length,
      queryCount: plan?.queryCount ?? (queries || []).length,
      originalKeywordCount: plan?.originalKeywords?.length ?? null,
      expandedKeywordCount: plan?.expandedKeywords?.length ?? null,
      truncatedQueries: Boolean(plan?.truncated),
      paging: result?.paging || null,
      providerMeta: result?.providerMeta || null,
      coverage: result?.providerMeta?.coverage || null,
      candidateNote:
        "Results are candidate opportunities from public posts — not automatically qualified leads.",
    },
  };
};

const getLinkedInLeadDiscoveryCatalog = () => {
  let nativeStatus = null;
  try {
    nativeStatus = opsaiNative.getStatus();
  } catch (_) {
    nativeStatus = null;
  }
  return {
    operations: Object.values(OPERATIONS),
    providers: Object.values(PROVIDERS),
    library: getPublicLibrary(),
    nativeStatus,
  };
};

const getProviderUsageStatus = async (
  providerId,
  credential,
  { forceRefresh = false, apifyClient, fetchImpl } = {}
) => {
  const id = normalizeProviderId(providerId);
  const provider = resolveProvider(id);
  if (typeof provider.getUsageStatus !== "function") {
    return {
      available: false,
      reason: "Usage status is not supported for this provider.",
      free: null,
      paid: null,
    };
  }
  return provider.getUsageStatus({
    credential,
    forceRefresh,
    apifyClient,
    fetchImpl,
  });
};

module.exports = {
  OPERATIONS,
  sanitizeLinkedInLeadDiscoveryNodeData,
  executeLinkedInLeadDiscoveryNode,
  getLinkedInLeadDiscoveryCatalog,
  getProviderUsageStatus,
  getPublicLibrary,
  buildSearchQueries,
  PROVIDERS,
  normalizeProviderId,
  providerSupports,
};
