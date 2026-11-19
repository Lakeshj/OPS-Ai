/**
 * Instagram M8.13 — Insights mode split, breakdown rules, presentation.
 * Run: npx --yes tsx scripts/smoke-instagram-m813.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { applyInstagramInsightsPresetChange } from "../src/modules/workflows/instagramDependentCascade";
import {
  buildInstagramInsightsCollection,
} from "../src/modules/workflows/instagramOutputPresentation";
import { resolveOutputPresentation } from "../src/modules/workflows/outputPresentation";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.join(__dirname, "..");
const backendRoot = path.join(frontendRoot, "..", "backend");
const requireFromBackend = createRequire(
  path.join(backendRoot, "services/instagramInsightsCatalog.js")
);
const read = (rel: string) =>
  fs.readFileSync(path.join(frontendRoot, rel), "utf8");
const readBackend = (rel: string) =>
  fs.readFileSync(path.join(backendRoot, rel), "utf8");

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

const catalog = () =>
  requireFromBackend("./instagramInsightsCatalog.js");
const ig = () => requireFromBackend("./workflowInstagram.service.js");

console.log("\nInstagram M8.13 Insights compatibility");

check("IG-M813-1 likes + no breakdown valid", () => {
  const built = catalog().buildAccountInsightRequests({
    preset: "custom",
    metrics: ["likes"],
    period: "day",
    dateRange: "last7days",
  });
  assert.equal(built.groups.length, 1);
  assert.equal(built.groups[0].breakdown, undefined);
  assert.deepEqual(built.groups[0].metrics, ["likes"]);
});

check("IG-M813-2 comments + no breakdown valid", () => {
  const built = catalog().buildAccountInsightRequests({
    preset: "custom",
    metrics: ["comments"],
    period: "day",
    dateRange: "last7days",
  });
  assert.equal(built.groups[0].breakdown, undefined);
});

check("IG-M813-3 shares + no breakdown valid", () => {
  const built = catalog().buildAccountInsightRequests({
    preset: "custom",
    metrics: ["shares"],
    period: "day",
    dateRange: "last7days",
  });
  assert.equal(built.groups[0].breakdown, undefined);
});

check("IG-M813-4 saves + no breakdown valid", () => {
  const built = catalog().buildAccountInsightRequests({
    preset: "custom",
    metrics: ["saves"],
    period: "day",
    dateRange: "last7days",
  });
  assert.equal(built.groups[0].breakdown, undefined);
});

check("IG-M813-5 likes + age rejected before Graph call", () => {
  assert.throws(
    () =>
      catalog().buildAccountInsightRequests({
        preset: "custom",
        metrics: ["likes"],
        period: "day",
        breakdown: "age",
        dateRange: "last7days",
      }),
    (err: { code?: string; message?: string }) =>
      err.code === "INSTAGRAM_INSIGHTS_BREAKDOWN_INVALID" &&
      /Age breakdown is only available for audience demographic insights/i.test(
        String(err.message || "")
      )
  );
});

check("IG-M813-6 demographic metric + age valid", () => {
  const built = catalog().buildAccountInsightRequests({
    preset: "demographics",
    metrics: ["follower_demographics"],
    period: "lifetime",
    breakdown: "age",
  });
  assert.equal(built.groups.length, 1);
  assert.equal(built.groups[0].breakdown, "age");
  assert.deepEqual(built.groups[0].metrics, ["follower_demographics"]);
});

check("IG-M813-7 audience → performance clears breakdown", () => {
  const next = applyInstagramInsightsPresetChange(
    {
      insightsPreset: "demographics",
      breakdown: "age",
      period: "lifetime",
      metrics: ["follower_demographics"],
    },
    "engagement"
  );
  assert.equal(next.insightsPreset, "engagement");
  assert.equal(next.breakdown, "");
});

check("IG-M813-8 performance → audience clears incompatible inputs", () => {
  const next = applyInstagramInsightsPresetChange(
    {
      insightsPreset: "engagement",
      period: "day",
      dateRange: "last7days",
      since: "2026-01-01",
      until: "2026-01-07",
      breakdown: "",
    },
    "demographics"
  );
  assert.equal(next.period, "lifetime");
  assert.equal(next.dateRange, "");
  assert.equal(next.since, "");
  assert.equal(next.until, "");
  assert.equal(next.breakdown, "age");
});

check("IG-M813-9 Graph errors not converted into unavailable", () => {
  const auth = readBackend("services/workflowInstagramAuth.service.js");
  const svc = readBackend("services/workflowInstagram.service.js");
  assert.match(svc, /mapInsightsProviderError/);
  assert.match(auth, /PERMISSION_NOT_GRANTED/);
  assert.doesNotMatch(
    svc,
    /status:\s*"unavailable".*PERMISSION_NOT_GRANTED/
  );
});

check("IG-M813-10 genuine empty demographic → readable unavailable", () => {
  const rows = ig().normalizeInsightRows({
    metricRows: [{ name: "follower_demographics", period: "lifetime", values: [] }],
    operation: "account_insights",
    instagramUserId: "178",
    period: "lifetime",
    breakdown: "age",
  });
  assert.equal(rows[0].status, "unavailable");
  assert.match(
    String(rows[0].unavailableReason || ""),
    /Audience demographic data is not available/
  );
  const block = buildInstagramInsightsCollection(rows);
  assert.match(String(block?.text || ""), /Audience demographic data is not available/);
});

check("IG-M813-11 Insights renderer displays one human-readable result set", () => {
  const items = [
    {
      metric: "likes",
      title: "Likes",
      value: 14,
      status: "ok",
      dateStart: "2026-11-12",
      dateEnd: "2026-11-18",
      _meta: { provider: "instagram", resource: "insights", operation: "account_insights" },
    },
    {
      metric: "comments",
      title: "Comments",
      value: 3,
      status: "ok",
      dateStart: "2026-11-12",
      dateEnd: "2026-11-18",
      _meta: { provider: "instagram", resource: "insights", operation: "account_insights" },
    },
  ];
  const resolved = resolveOutputPresentation(items);
  assert.equal(resolved?.blocks.length, 1);
  assert.equal(resolved?.blocks[0].layout, "insights");
  assert.ok((resolved?.blocks[0].stats || []).length >= 2);
  assert.match(String(resolved?.summaryText || ""), /Likes/);
  assert.doesNotMatch(String(resolved?.summaryText || ""), /__callableReturnItems/);
});

check("IG-M813-12 raw runtime contracts unchanged (presentation unwrap-only)", () => {
  const original = {
    result: [
      {
        metric: "likes",
        value: 14,
        status: "ok",
        _meta: {
          provider: "instagram",
          resource: "insights",
          operation: "account_insights",
        },
      },
    ],
  };
  const resolved = resolveOutputPresentation(original);
  assert.equal(resolved?.original, original);
  assert.equal((original.result[0] as { value: number }).value, 14);
});

check("IG-M813-13 total_value likes is not false unavailable", () => {
  const rows = ig().normalizeInsightRows({
    metricRows: [
      { name: "likes", title: "Likes", period: "day", total_value: { value: 14 } },
    ],
    operation: "account_insights",
    instagramUserId: "178",
    period: "day",
    breakdown: "age",
  });
  assert.equal(rows[0].status, "ok");
  assert.equal(rows[0].value, 14);
  assert.equal(rows[0].breakdown, undefined);
});

check("IG-M813-14 schema hides breakdown outside demographics", () => {
  const schema = read("src/modules/workflows/nodeParameterSchemas.ts");
  const start = schema.indexOf('name: "breakdown"');
  const slice = schema.slice(start, start + 900);
  assert.match(slice, /insightsPreset:\s*\[\s*"demographics"\s*\]/);
  assert.doesNotMatch(
    slice,
    /insightsPreset:\s*\[\s*"demographics"\s*,\s*"custom"\s*\]/
  );
});

console.log(`\nM8.13 frontend/backend checks: ${passed} passed`);
if (process.exitCode) {
  console.error("M8.13 FAIL");
} else {
  console.log("M8.13 PASS");
}
