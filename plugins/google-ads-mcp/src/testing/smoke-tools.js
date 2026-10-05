/**
 * Plugin-local checks. No live Google calls.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { provider, tools } = require("../contracts/tools");
const { createExecutor } = require("../executor");

const executorSrc = fs.readFileSync(path.join(__dirname, "../executor.js"), "utf8");
assert.equal(executorSrc.includes("googleAds:mutate"), false);
assert.equal(executorSrc.includes(":mutate"), false);
assert.match(executorSrc, /googleAds:search/);
assert.match(executorSrc, /googleAdsFields:search/);
assert.match(executorSrc, /customers:listAccessibleCustomers/);

assert.equal(provider.id, "google_ads");
assert.equal(provider.authType, "google_ads");
assert.deepEqual(
  tools.map((tool) => tool.id),
  [
    "account_summary",
    "campaigns",
    "ad_groups",
    "ads",
    "keywords",
    "assets",
    "conversion_actions",
    "recommendations",
    "campaign_performance",
    "ad_group_performance",
    "ad_performance",
    "keyword_performance",
    "search_terms",
    "device_performance",
    "geographic_performance",
    "placement_performance",
    "conversion_performance",
    "list_accessible_customers",
    "get_resource_metadata",
    "search",
  ]
);
assert.equal(tools.find((tool) => tool.id === "campaign_performance").uiGroup, "performance");
assert.equal(tools.filter((tool) => tool.uiGroup === "performance").length, 9);
assert.equal(tools.find((tool) => tool.id === "get_resource_metadata").uiGroup, "advanced");
assert.equal(tools.find((tool) => tool.id === "search").uiGroup, "advanced");
for (const tool of tools) {
  assert.equal(tool.access, "read");
  assert.equal(tool.risk, "low");
  assert.equal(tool.implemented, true);
  assert.equal(tool.executor, "google_ads_mcp");
}

const AppError = class extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
};
const bound = createExecutor({
  AppError,
  apiVersion: "v25",
  normalizeCustomerId: (value) => String(value || "").replace(/-/g, ""),
  googleApiRequest: async () => {
    throw new Error("smoke must not call Google");
  },
});
assert.throws(() => bound.assertSelectQuery("UPDATE campaign SET campaign.status = 'PAUSED'"), (err) => err.code === "GOOGLE_ADS_QUERY");
assert.match(bound.fieldServiceQuery({ resourceOrField: "metrics.clicks" }), /WHERE name = "metrics\.clicks"/);

console.log("google-ads-mcp smoke-tools: OK");
