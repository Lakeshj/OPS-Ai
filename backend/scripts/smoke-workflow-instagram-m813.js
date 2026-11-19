/**
 * Instagram M8.13 backend — metric/breakdown validation + total_value parsing.
 * Run: node scripts/smoke-workflow-instagram-m813.js
 */
const assert = require("assert");
const path = require("path");

const catalog = require("../services/instagramInsightsCatalog");
const ig = require("../services/workflowInstagram.service");

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

console.log("\nInstagram M8.13 backend");

check("IG-M813-B1 engagement preset has no breakdown on groups", () => {
  const built = catalog.buildAccountInsightRequests({
    preset: "engagement",
    period: "day",
    dateRange: "last7days",
  });
  for (const group of built.groups) {
    assert.equal(group.breakdown, undefined);
  }
  assert.ok(built.metrics.includes("likes"));
});

check("IG-M813-B2 likes+age stripped as stale hidden param", () => {
  const built = catalog.buildAccountInsightRequests({
    preset: "custom",
    metrics: ["likes", "comments", "shares", "saves"],
    period: "day",
    breakdown: "age",
    dateRange: "last7days",
  });
  for (const group of built.groups) {
    assert.equal(group.breakdown, undefined);
  }
});

check("IG-M813-B2b metric mix still rejected", () => {
  assert.throws(
    () =>
      catalog.buildAccountInsightRequests({
        preset: "custom",
        metrics: ["likes", "follower_demographics"],
        period: "day",
        dateRange: "last7days",
      }),
    (err) =>
      err.code === "INSTAGRAM_INSIGHTS_METRIC_MIX_INVALID" ||
      err.code === "INSTAGRAM_INSIGHTS_PERIOD_INVALID"
  );
});

check("IG-M813-B3 demographics+age accepted", () => {
  const built = catalog.buildAccountInsightRequests({
    preset: "demographics",
    period: "lifetime",
    breakdown: "age",
  });
  assert.equal(built.groups[0].breakdown, "age");
  assert.equal(built.groups[0].timeframe, "this_month");
  assert.equal(built.groups[0].period, "lifetime");
});

check("IG-M813-B4 total_value parsed as ok value", () => {
  const rows = ig.normalizeInsightRows({
    metricRows: [
      {
        name: "shares",
        title: "Shares",
        period: "day",
        total_value: { value: 2 },
      },
    ],
    operation: "account_insights",
    instagramUserId: "1",
    period: "day",
  });
  assert.equal(rows[0].status, "ok");
  assert.equal(rows[0].value, 2);
});

check("IG-M813-B5 empty values still unavailable without fabricating zero", () => {
  const rows = ig.normalizeInsightRows({
    metricRows: [{ name: "reach", period: "day", values: [] }],
    operation: "account_insights",
    instagramUserId: "1",
    period: "day",
  });
  assert.equal(rows[0].status, "unavailable");
  assert.equal(rows[0].value, undefined);
});

console.log(`\nM8.13 backend checks: ${passed} passed`);
if (process.exitCode) console.error("M8.13 FAIL");
else console.log("M8.13 PASS (backend)");
