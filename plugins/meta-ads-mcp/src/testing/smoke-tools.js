/**
 * Plugin-local checks. No live Meta calls.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { provider, tools } = require("../contracts/tools");
const {
  COMMON_TOOL_IDS,
  COMMON_FIELDS,
  COMMON_RESOURCE,
  COMMON_EDGE,
  INSIGHTS_METRIC_FIELDS,
  EFFECTIVE_STATUS,
  buildEntityQuery,
  optionalId,
} = require("../contracts/catalog");
const { createExecutor } = require("../executor");

const executorSrc = fs.readFileSync(path.join(__dirname, "../executor.js"), "utf8");
assert.equal(executorSrc.includes("ads_management"), false);
assert.equal(/method:\s*["']POST["']/.test(executorSrc), false);
assert.equal(/method:\s*["']PUT["']/.test(executorSrc), false);
assert.equal(/method:\s*["']DELETE["']/.test(executorSrc), false);
assert.match(executorSrc, /me\/adaccounts/);
assert.match(executorSrc, /method: "GET"/);
assert.match(executorSrc, /paging\?\.cursors\?\.after/);
assert.match(executorSrc, /paging\?\.next/);
assert.equal(/fetch\(/.test(executorSrc), false);

assert.equal(provider.id, "meta_ads");
assert.equal(provider.authType, "meta_ads");
assert.deepEqual(
  tools.map((tool) => tool.id),
  [
    "account_summary",
    "campaigns",
    "ad_sets",
    "ads",
    "creatives",
    "account_performance",
    "campaign_performance",
    "ad_set_performance",
    "ad_performance",
    "demographic_performance",
    "geographic_performance",
    "device_performance",
    "placement_performance",
    "list_accessible_ad_accounts",
  ]
);
assert.deepEqual([...COMMON_TOOL_IDS], [
  "account_summary",
  "campaigns",
  "ad_sets",
  "ads",
  "creatives",
]);

const accountTool = tools.find((tool) => tool.id === "list_accessible_ad_accounts");
assert.equal(accountTool.uiGroup, "internal");
assert.equal(accountTool.access, "read");
assert.equal(accountTool.risk, "low");
assert.equal(accountTool.implemented, true);
assert.equal(accountTool.executor, "meta_ads_mcp");

for (const id of COMMON_TOOL_IDS) {
  const tool = tools.find((row) => row.id === id);
  assert.ok(tool, id);
  assert.equal(tool.uiGroup, "common");
  assert.equal(tool.access, "read");
  assert.equal(tool.risk, "low");
  assert.equal(tool.implemented, true);
  assert.equal(tool.executor, "meta_ads_mcp");
  assert.equal(tool.inputSchema.properties.credentialId, undefined);
  assert.equal(tool.inputSchema.properties.adAccountId, undefined);
  assert.equal(tool.inputSchema.properties.accessToken, undefined);
  assert.equal(tool.inputSchema.properties.appSecret, undefined);
  for (const field of COMMON_FIELDS[id]) {
    assert.equal(INSIGHTS_METRIC_FIELDS.includes(field), false, field);
  }
}

assert.equal(COMMON_RESOURCE.account_summary, "ad_account");
assert.equal(COMMON_EDGE.campaigns, "campaigns");
assert.equal(COMMON_EDGE.ad_sets, "adsets");
assert.equal(COMMON_EDGE.ads, "ads");
assert.equal(COMMON_EDGE.creatives, "adcreatives");
assert.equal(tools.find((tool) => tool.id === "ad_sets").displayName, "Ad Sets");
assert.equal(tools.find((tool) => tool.id === "ad_sets").displayName.includes("Ad Group"), false);

const campaignQuery = buildEntityQuery("campaigns", {
  campaignId: "111",
  effectiveStatus: "ACTIVE",
});
assert.equal(campaignQuery.fields.includes("impressions"), false);
assert.equal(campaignQuery.filtering.includes('"id"'), true);
assert.equal(campaignQuery.effective_status, JSON.stringify(["ACTIVE"]));
assert.equal(campaignQuery.after, undefined);

assert.throws(() => optionalId({ campaignId: "act_1" }, "campaignId"), (err) => err.code === "META_FILTER_INVALID");
assert.throws(
  () => buildEntityQuery("campaigns", { effectiveStatus: "ENABLED" }),
  (err) => err.code === "META_FILTER_INVALID"
);
assert.ok(EFFECTIVE_STATUS.ad.includes("ADSET_PAUSED"));
assert.equal(EFFECTIVE_STATUS.campaign.includes("ADSET_PAUSED"), false);

const AppError = class extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
};
const bound = createExecutor({
  AppError,
  apiVersion: "v26.0",
  collectPages: async () => {
    throw new Error("smoke must not call Meta");
  },
  presentAdAccount: () => ({}),
  normalizeAdAccountId: (value) => String(value).replace(/^act_/i, ""),
  metaGraphRequest: async () => {
    throw new Error("smoke must not call Meta");
  },
  runInsightsReport: async () => {
    throw new Error("smoke must not call Insights");
  },
});
assert.equal(typeof bound.executeMetaAdsMcpTool, "function");
assert.equal(bound.API_VERSION, "v26.0");

const { PERFORMANCE_TOOL_IDS, buildPerformanceRequest } = require("../contracts/performance");
assert.equal(PERFORMANCE_TOOL_IDS.length, 8);
for (const id of PERFORMANCE_TOOL_IDS) {
  const tool = tools.find((row) => row.id === id);
  assert.equal(tool.uiGroup, "performance");
  assert.equal(tool.access, "read");
  assert.equal(tool.implemented, true);
  assert.equal(tool.inputSchema.properties.credentialId, undefined);
  assert.equal(tool.inputSchema.properties.adAccountId, undefined);
}
assert.deepEqual(buildPerformanceRequest("device_performance", {}).breakdowns, ["impression_device"]);
assert.deepEqual(buildPerformanceRequest("geographic_performance", {}).breakdowns, ["country"]);
assert.throws(
  () => buildPerformanceRequest("demographic_performance", { demographicMode: "age_country" }),
  (err) => err.code === "META_BREAKDOWN_INVALID"
);

(async () => {
  await assert.rejects(
    () => bound.executeMetaAdsMcpTool({ toolId: "custom_insights", credentialId: "c" }),
    (err) => err.code === "MCP_UNKNOWN_TOOL"
  );
  await assert.rejects(
    () => bound.executeMetaAdsMcpTool({ toolId: "campaign_performance", credentialId: "c" }),
    (err) => err.code === "META_ADS_SOURCE_ACCOUNT"
  );
  await assert.rejects(
    () => bound.executeMetaAdsMcpTool({ toolId: "campaigns", credentialId: "c" }),
    (err) => err.code === "META_ADS_SOURCE_ACCOUNT"
  );
  console.log("meta-ads-mcp smoke-tools: OK");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
