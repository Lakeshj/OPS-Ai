/**
 * Instagram M8.13.3 backend — demographic timeframe capabilities + Graph groups.
 * Run: node scripts/smoke-workflow-instagram-m8133.js
 */
const assert = require("assert");

const catalog = require("../services/instagramInsightsCatalog");

let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
};

console.log("\nInstagram M8.13.3 backend timeframe");

check("IG-M8133-B1 defaults this_month", () => {
  const built = catalog.buildAccountInsightRequests({
    preset: "demographics",
    metrics: ["follower_demographics"],
    period: "lifetime",
    breakdown: "age",
  });
  assert.equal(built.timeframe, "this_month");
  assert.equal(built.groups[0].timeframe, "this_month");
});

check("IG-M8133-B2 engaged sends timeframe", () => {
  const built = catalog.buildAccountInsightRequests({
    preset: "demographics",
    metrics: ["engaged_audience_demographics"],
    period: "lifetime",
    breakdown: "age",
    timeframe: "this_month",
  });
  assert.equal(built.groups[0].timeframe, "this_month");
  assert.equal(built.groups[0].period, "lifetime");
  assert.equal(built.groups[0].metricType, "total_value");
});

check("IG-M8133-B3 reached sends timeframe", () => {
  const built = catalog.buildAccountInsightRequests({
    preset: "demographics",
    metrics: ["reached_audience_demographics"],
    period: "lifetime",
    breakdown: "age",
    timeframe: "this_week",
  });
  assert.equal(built.groups[0].timeframe, "this_week");
});

check("IG-M8133-B4 multi-metric one compatible group", () => {
  const built = catalog.buildAccountInsightRequests({
    preset: "demographics",
    metrics: [
      "follower_demographics",
      "engaged_audience_demographics",
      "reached_audience_demographics",
    ],
    period: "lifetime",
    breakdown: "age",
    timeframe: "this_month",
  });
  assert.equal(built.groups.length, 1);
  assert.deepEqual(built.groups[0].metrics.sort(), [
    "engaged_audience_demographics",
    "follower_demographics",
    "reached_audience_demographics",
  ].sort());
  assert.equal(built.groups[0].timeframe, "this_month");
});

check("IG-M8133-B5 forces lifetime + strips date range", () => {
  const normalized = catalog.normalizeAccountInsightsData({
    insightsPreset: "demographics",
    period: "days_28",
    dateRange: "last7days",
    since: "2026-01-01",
    until: "2026-01-07",
    breakdown: "age",
  });
  assert.equal(normalized.period, "lifetime");
  assert.equal(normalized.timeframe, "this_month");
  assert.equal(normalized.dateRange, undefined);
  assert.equal(normalized.since, undefined);
  assert.equal(normalized.until, undefined);
});

check("IG-M8133-B6 performance removes timeframe", () => {
  const normalized = catalog.normalizeAccountInsightsData({
    insightsPreset: "overview",
    period: "day",
    timeframe: "this_month",
    breakdown: "age",
  });
  assert.equal(normalized.timeframe, undefined);
  assert.equal(normalized.breakdown, undefined);
});

check("IG-M8133-B7 missing required timeframe guard", () => {
  assert.throws(
    () =>
      catalog.assertDemographicTimeframeForMetrics(
        ["engaged_audience_demographics"],
        ""
      ),
    (err) =>
      err.code === "INSTAGRAM_INSIGHTS_TIMEFRAME_REQUIRED" &&
      /Select a timeframe for audience demographic insights/.test(err.message)
  );
});

check("IG-M8133-B8 capability map", () => {
  const follower = catalog.getAccountMetric("follower_demographics");
  const engaged = catalog.getAccountMetric("engaged_audience_demographics");
  const reached = catalog.getAccountMetric("reached_audience_demographics");
  assert.equal(follower.requiresTimeframe, false);
  assert.equal(engaged.requiresTimeframe, true);
  assert.equal(reached.requiresTimeframe, true);
  assert.deepEqual(engaged.allowedTimeframes, ["this_week", "this_month"]);
  assert.deepEqual(
    catalog.resolveCompatibleDemographicTimeframes([
      "follower_demographics",
      "engaged_audience_demographics",
      "reached_audience_demographics",
    ]),
    ["this_week", "this_month"]
  );
});

console.log(`\nM8.13.3 backend checks: ${passed} passed`);
if (process.exitCode) console.error("M8.13.3 FAIL");
else console.log("M8.13.3 PASS (backend)");
