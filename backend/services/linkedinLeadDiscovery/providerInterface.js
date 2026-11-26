/**
 * LinkedIn Lead Discovery — provider capability contracts (M10.1).
 * Providers are independent adapters behind a shared input/output contract.
 */

const PROVIDERS = Object.freeze({
  opsai_native: Object.freeze({
    id: "opsai_native",
    label: "OpsAi Native",
    primary: true,
    capabilities: Object.freeze({
      discover_by_category: true,
      discover_by_custom_keywords: true,
      search_posts: true,
      get_post_details: true,
      usage_status: false,
      free_paid_modes: false,
    }),
    collectionStatus: "native_engine_ready",
    notes:
      "Primary provider. Live sources: Perigon LinkedIn Social API, authorized OpsAi opportunity feed, user-provided dataset, or previous-node input. Fixtures are opt-in for development only. Get Post Details is not available for Perigon.",
  }),
  apify: Object.freeze({
    id: "apify",
    label: "Apify",
    primary: false,
    capabilities: Object.freeze({
      discover_by_category: true,
      discover_by_custom_keywords: true,
      search_posts: true,
      get_post_details: true,
      usage_status: true,
      free_paid_modes: true,
    }),
    collectionStatus: "live_ready",
    actorId: "kTfhD8wSCMRXlhNmE",
    actorUsernameName: "scrapeforge~linkedin-all-in-one",
    actorUrl: "https://apify.com/scrapeforge/linkedin-all-in-one",
    notes:
      "Optional. Requires Apify API token only (no LinkedIn session cookies). PAY_PER_EVENT. Free/Paid share one Apify monthly allowance.",
    knownInputFields: Object.freeze([
      "mode",
      "search",
      "postUrls",
      "postedLimit",
      "sortBy",
      "maxPosts",
      "contentType",
    ]),
  }),
});

const normalizeProviderId = (raw) => {
  const value = String(raw || "opsai_native")
    .trim()
    .toLowerCase();
  if (value === "apify") return "apify";
  return "opsai_native";
};

const getProviderDescriptor = (providerId) =>
  PROVIDERS[normalizeProviderId(providerId)] || PROVIDERS.opsai_native;

const providerSupports = (providerId, capability) => {
  const desc = getProviderDescriptor(providerId);
  return Boolean(desc.capabilities?.[capability]);
};

module.exports = {
  PROVIDERS,
  normalizeProviderId,
  getProviderDescriptor,
  providerSupports,
};
