/**
 * Instagram M8.13.3 — demographic timeframe (this_week / this_month).
 * Run: npx --yes tsx scripts/smoke-instagram-m8133.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  applyInstagramInsightsPresetChange,
  normalizeInstagramInsightsParams,
} from "../src/modules/workflows/instagramDependentCascade";
import {
  buildInstagramInsightsCollection,
  formatInsightTimeframeLabel,
  parseInsightBreakdownTable,
} from "../src/modules/workflows/instagramOutputPresentation";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.join(__dirname, "..");
const backendRoot = path.join(frontendRoot, "..", "backend");
const requireFromBackend = createRequire(
  path.join(backendRoot, "services/instagramInsightsCatalog.js")
);
const read = (rel: string) =>
  fs.readFileSync(path.join(frontendRoot, rel), "utf8");

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

const catalog = () => requireFromBackend("./instagramInsightsCatalog.js");

console.log("\nInstagram M8.13.3 demographic timeframe");

check("IG-M8133-1 demographics defaults timeframe to this_month", () => {
  const next = normalizeInstagramInsightsParams({
    resource: "insights",
    operation: "account_insights",
    insightsPreset: "demographics",
    period: "lifetime",
    breakdown: "age",
  });
  assert.equal(next.timeframe, "this_month");
  assert.equal(next.period, "lifetime");

  const built = catalog().buildAccountInsightRequests({
    insightsPreset: "demographics",
    metrics: ["follower_demographics"],
    period: "lifetime",
    breakdown: "age",
  });
  assert.equal(built.timeframe, "this_month");
  assert.equal(built.groups[0].timeframe, "this_month");
});

check("IG-M8133-2 engaged demographics sends timeframe", () => {
  const built = catalog().buildAccountInsightRequests({
    insightsPreset: "demographics",
    metrics: ["engaged_audience_demographics"],
    period: "lifetime",
    breakdown: "age",
    timeframe: "this_month",
  });
  assert.equal(built.groups.length, 1);
  assert.equal(built.groups[0].timeframe, "this_month");
  assert.equal(built.groups[0].period, "lifetime");
  assert.equal(built.groups[0].metricType, "total_value");
  assert.deepEqual(built.groups[0].metrics, [
    "engaged_audience_demographics",
  ]);
  assert.equal(
    catalog().getAccountMetric("engaged_audience_demographics").requiresTimeframe,
    true
  );
});

check("IG-M8133-3 reached demographics sends timeframe", () => {
  const built = catalog().buildAccountInsightRequests({
    insightsPreset: "demographics",
    metrics: ["reached_audience_demographics"],
    period: "lifetime",
    breakdown: "age",
    timeframe: "this_week",
  });
  assert.equal(built.groups[0].timeframe, "this_week");
  assert.equal(
    catalog().getAccountMetric("reached_audience_demographics").requiresTimeframe,
    true
  );
});

check("IG-M8133-4 follower demographics remains valid", () => {
  const built = catalog().buildAccountInsightRequests({
    insightsPreset: "demographics",
    metrics: ["follower_demographics"],
    period: "lifetime",
    breakdown: "age",
    timeframe: "this_month",
  });
  assert.equal(built.groups[0].breakdown, "age");
  assert.equal(built.groups[0].period, "lifetime");
  assert.equal(built.groups[0].timeframe, "this_month");
  assert.equal(
    catalog().getAccountMetric("follower_demographics").requiresTimeframe,
    false
  );
});

check("IG-M8133-5 multi-metric demographics includes timeframe", () => {
  const built = catalog().buildAccountInsightRequests({
    insightsPreset: "demographics",
    metrics: [
      "follower_demographics",
      "engaged_audience_demographics",
      "reached_audience_demographics",
    ],
    period: "lifetime",
    breakdown: "age",
    timeframe: "this_month",
  });
  assert.ok(built.groups.length >= 1);
  for (const group of built.groups) {
    assert.equal(group.period, "lifetime");
    assert.equal(group.breakdown, "age");
    assert.equal(group.metricType, "total_value");
    assert.equal(group.timeframe, "this_month");
  }
  const allMetrics = built.groups.flatMap((g: { metrics: string[] }) => g.metrics);
  assert.ok(allMetrics.includes("follower_demographics"));
  assert.ok(allMetrics.includes("engaged_audience_demographics"));
  assert.ok(allMetrics.includes("reached_audience_demographics"));
});

check("IG-M8133-6 demographics forces lifetime", () => {
  const next = normalizeInstagramInsightsParams({
    resource: "insights",
    operation: "account_insights",
    insightsPreset: "demographics",
    period: "days_28",
    dateRange: "last28days",
    breakdown: "age",
  });
  assert.equal(next.period, "lifetime");
  assert.equal(Object.prototype.hasOwnProperty.call(next, "dateRange"), false);
  assert.equal(next.timeframe, "this_month");

  const built = catalog().buildAccountInsightRequests({
    insightsPreset: "demographics",
    metrics: ["engaged_audience_demographics"],
    period: "day",
    breakdown: "age",
  });
  assert.equal(built.groups[0].period, "lifetime");
});

check("IG-M8133-7 performance removes timeframe", () => {
  const next = applyInstagramInsightsPresetChange(
    {
      resource: "insights",
      operation: "account_insights",
      insightsPreset: "demographics",
      period: "lifetime",
      breakdown: "age",
      timeframe: "this_month",
    },
    "engagement"
  );
  assert.equal(Object.prototype.hasOwnProperty.call(next, "timeframe"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(next, "breakdown"), false);

  const normalized = catalog().normalizeAccountInsightsData({
    insightsPreset: "engagement",
    period: "day",
    breakdown: "age",
    timeframe: "this_month",
  });
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, "timeframe"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, "breakdown"), false);
});

check("IG-M8133-8 saved demographic node without timeframe is repaired", () => {
  const saved = {
    resource: "insights",
    operation: "account_insights",
    insightsPreset: "demographics",
    period: "lifetime",
    breakdown: "age",
  };
  const repaired = normalizeInstagramInsightsParams(saved);
  assert.equal(repaired.timeframe, "this_month");

  const backend = catalog().normalizeAccountInsightsData({
    insightsPreset: "demographics",
    period: "lifetime",
    breakdown: "age",
    metrics: ["follower_demographics"],
  });
  assert.equal(backend.timeframe, "this_month");
});

check("IG-M8133-9 backend blocks missing required timeframe before Graph", () => {
  assert.throws(
    () =>
      catalog().assertDemographicTimeframeForMetrics(
        ["engaged_audience_demographics"],
        ""
      ),
    (err: { code?: string; message?: string }) =>
      err.code === "INSTAGRAM_INSIGHTS_TIMEFRAME_REQUIRED" &&
      /Select a timeframe for audience demographic insights/i.test(
        String(err.message || "")
      )
  );
  assert.throws(
    () =>
      catalog().assertDemographicTimeframeForMetrics(
        ["reached_audience_demographics"],
        null
      ),
    (err: { code?: string }) =>
      err.code === "INSTAGRAM_INSIGHTS_TIMEFRAME_REQUIRED"
  );
});

check("IG-M8133-10 human presentation includes timeframe", () => {
  assert.equal(formatInsightTimeframeLabel("this_month"), "This month");
  assert.equal(formatInsightTimeframeLabel("this_week"), "This week");

  const row = {
    metric: "follower_demographics",
    period: "lifetime",
    title: "Follower Demographics",
    status: "ok",
    breakdown: "age",
    timeframe: "this_month",
    breakdownValues: [
      {
        dimension_keys: ["age"],
        results: [
          { value: 2, dimension_values: ["13-17"] },
          { value: 40, dimension_values: ["18-24"] },
        ],
      },
    ],
    _meta: {
      provider: "instagram",
      resource: "insights",
      operation: "account_insights",
    },
  };
  const table = parseInsightBreakdownTable(row)!;
  assert.equal(table.timeframeLabel, "This month");
  const block = buildInstagramInsightsCollection([row])!;
  assert.match(block.text, /Follower Demographics/);
  assert.match(block.text, /Breakdown: Age/);
  assert.match(block.text, /Timeframe: This month/);
  assert.doesNotMatch(block.text, /Timeframe: this_month/);
  assert.ok(block.lines.some((l) => l.label === "Timeframe" && l.value === "This month"));

  const engaged = {
    ...row,
    metric: "engaged_audience_demographics",
    title: "Engaged Audience Demographics",
  };
  const engagedBlock = buildInstagramInsightsCollection([engaged])!;
  assert.match(engagedBlock.text, /Engaged Audience Demographics/);
  assert.match(engagedBlock.text, /Timeframe: This month/);

  const preview = read("src/components/workflows/InstagramOutputPreview.tsx");
  assert.match(preview, /Timeframe: \{table\.timeframeLabel\}/);
});

check("IG-M8133-11 schema exposes Timeframe under demographics", () => {
  const schema = read("src/modules/workflows/nodeParameterSchemas.ts");
  assert.match(schema, /name: "timeframe"/);
  assert.match(schema, /displayName: "Timeframe"/);
  assert.match(schema, /name: "This week"/);
  assert.match(schema, /name: "This month"/);
  assert.match(schema, /value: "this_week"/);
  assert.match(schema, /value: "this_month"/);
  assert.match(schema, /insightsPreset: \["demographics"\]/);
});

check("IG-M8133-12 Graph query path includes timeframe", () => {
  const service = read(
    path.join("..", "backend", "services", "workflowInstagram.service.js")
  );
  assert.match(service, /if \(group\.timeframe\) query\.timeframe = group\.timeframe/);
});

console.log(`\nM8.13.3 checks: ${passed} passed`);
if (process.exitCode) console.error("M8.13.3 FAIL");
else console.log("M8.13.3 PASS");
