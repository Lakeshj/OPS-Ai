/**
 * Instagram M8.13.1 — Insights stale hidden param normalization.
 * Run: npx --yes tsx scripts/smoke-instagram-m8131.ts
 */
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  applyInstagramInsightsPresetChange,
  instagramInsightsParamsNeedNormalize,
  normalizeInstagramInsightsParams,
} from "../src/modules/workflows/instagramDependentCascade";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(__dirname, "..", "..", "backend");
const requireBackend = createRequire(
  path.join(backendRoot, "services/instagramInsightsCatalog.js")
);
const catalog = () => requireBackend("./instagramInsightsCatalog.js");

let passed = 0;
const check = (name: string, fn: () => void) => {
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

console.log("\nInstagram M8.13.1 Insights stale-param normalization");

check("IG-M8131-1 performance + stale city → city removed", () => {
  const next = normalizeInstagramInsightsParams({
    resource: "insights",
    operation: "account_insights",
    insightsPreset: "engagement",
    period: "days_28",
    breakdown: "city",
  });
  assert.equal(Object.prototype.hasOwnProperty.call(next, "breakdown"), false);
  assert.equal(next.period, "days_28");
});

check("IG-M8131-2 performance + stale age → age removed", () => {
  const next = normalizeInstagramInsightsParams({
    resource: "insights",
    operation: "account_insights",
    insightsPreset: "overview",
    breakdown: "age",
  });
  assert.equal(Object.prototype.hasOwnProperty.call(next, "breakdown"), false);
});

check("IG-M8131-3 demographics + days_28 → period becomes lifetime", () => {
  const next = normalizeInstagramInsightsParams({
    resource: "insights",
    operation: "account_insights",
    insightsPreset: "demographics",
    period: "days_28",
    breakdown: "city",
  });
  assert.equal(next.period, "lifetime");
  assert.equal(next.breakdown, "city");
});

check("IG-M8131-4 demographics + day → period becomes lifetime", () => {
  const next = normalizeInstagramInsightsParams({
    resource: "insights",
    operation: "account_insights",
    insightsPreset: "demographics",
    period: "day",
    breakdown: "age",
  });
  assert.equal(next.period, "lifetime");
});

check("IG-M8131-5 demographics preserves compatible breakdown", () => {
  const next = normalizeInstagramInsightsParams({
    resource: "insights",
    operation: "account_insights",
    insightsPreset: "demographics",
    period: "lifetime",
    breakdown: "gender",
  });
  assert.equal(next.breakdown, "gender");
});

check("IG-M8131-6 demographics clears incompatible performance date params", () => {
  const next = normalizeInstagramInsightsParams({
    resource: "insights",
    operation: "account_insights",
    insightsPreset: "demographics",
    period: "days_28",
    dateRange: "last7days",
    since: "2026-01-01",
    until: "2026-01-07",
    dateStart: "2026-01-01",
    dateEnd: "2026-01-07",
    breakdown: "age",
  });
  assert.equal(next.period, "lifetime");
  assert.equal(Object.prototype.hasOwnProperty.call(next, "dateRange"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(next, "since"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(next, "until"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(next, "dateStart"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(next, "dateEnd"), false);
});

check("IG-M8131-7 demographics → performance removes breakdown", () => {
  const next = applyInstagramInsightsPresetChange(
    {
      resource: "insights",
      operation: "account_insights",
      insightsPreset: "demographics",
      period: "lifetime",
      breakdown: "city",
    },
    "engagement"
  );
  assert.equal(next.insightsPreset, "engagement");
  assert.equal(Object.prototype.hasOwnProperty.call(next, "breakdown"), false);
});

check("IG-M8131-8 performance → demographics forces lifetime", () => {
  const next = applyInstagramInsightsPresetChange(
    {
      resource: "insights",
      operation: "account_insights",
      insightsPreset: "engagement",
      period: "days_28",
      dateRange: "last28days",
      breakdown: "city",
    },
    "demographics"
  );
  assert.equal(next.period, "lifetime");
  // Compatible demographic breakdown carried from prior state is preserved.
  assert.equal(next.breakdown, "city");
  assert.equal(Object.prototype.hasOwnProperty.call(next, "dateRange"), false);

  const withoutBreakdown = applyInstagramInsightsPresetChange(
    {
      resource: "insights",
      operation: "account_insights",
      insightsPreset: "engagement",
      period: "days_28",
    },
    "demographics"
  );
  assert.equal(withoutBreakdown.breakdown, "age");
});

check("IG-M8131-9 saved invalid workflow repaired on editor load", () => {
  const saved = {
    resource: "insights",
    operation: "account_insights",
    insightsPreset: "engagement",
    period: "day",
    breakdown: "city",
  };
  const repaired = normalizeInstagramInsightsParams(saved);
  assert.equal(instagramInsightsParamsNeedNormalize(saved, repaired), true);
  assert.equal(Object.prototype.hasOwnProperty.call(repaired, "breakdown"), false);
});

check("IG-M8131-10 execution payload contains no hidden stale parameters", () => {
  const normalized = catalog().normalizeAccountInsightsData({
    insightsPreset: "engagement",
    period: "days_28",
    breakdown: "city",
    metrics: ["likes", "comments", "shares", "saves"],
  });
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, "breakdown"), false);
  const built = catalog().buildAccountInsightRequests(normalized);
  for (const group of built.groups) {
    assert.equal(group.breakdown, undefined);
  }

  const demo = catalog().normalizeAccountInsightsData({
    insightsPreset: "demographics",
    period: "days_28",
    breakdown: "age",
    metrics: ["follower_demographics"],
  });
  assert.equal(demo.period, "lifetime");
  const demoBuilt = catalog().buildAccountInsightRequests(demo);
  assert.equal(demoBuilt.groups[0].period, "lifetime");
  assert.equal(demoBuilt.groups[0].breakdown, "age");
});

check("IG-M8131-11 backend compatibility guard remains", () => {
  assert.throws(
    () =>
      catalog().buildAccountInsightRequests({
        preset: "demographics",
        metrics: ["follower_demographics"],
        period: "lifetime",
        breakdown: "not_a_real_breakdown",
      }),
    (err: { code?: string }) =>
      err.code === "INSTAGRAM_INSIGHTS_BREAKDOWN_INVALID"
  );
});

check("IG-M8131-12 need-normalize detects key deletion", () => {
  const before = { breakdown: "city", period: "day" };
  const after = { period: "day" };
  assert.equal(instagramInsightsParamsNeedNormalize(before, after), true);
});

console.log(`\nM8.13.1 checks: ${passed} passed`);
if (process.exitCode) console.error("M8.13.1 FAIL");
else console.log("M8.13.1 PASS");
