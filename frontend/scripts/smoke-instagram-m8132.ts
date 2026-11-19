/**
 * Instagram M8.13.2 — demographic breakdownValues in primary human Insights card.
 * Run: npx --yes tsx scripts/smoke-instagram-m8132.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildInstagramInsightsCollection,
  parseInsightBreakdownTable,
} from "../src/modules/workflows/instagramOutputPresentation";
import { resolveOutputPresentation } from "../src/modules/workflows/outputPresentation";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.join(__dirname, "..");
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

const liveShape = {
  metric: "follower_demographics",
  period: "lifetime",
  title: "Follower Demographics",
  status: "ok",
  breakdown: "age",
  breakdownValues: [
    {
      dimension_keys: ["age"],
      results: [
        { value: 2, dimension_values: ["13-17"] },
        { value: 40, dimension_values: ["18-24"] },
        { value: 244, dimension_values: ["25-34"] },
        { value: 97, dimension_values: ["35-44"] },
        { value: 29, dimension_values: ["45-54"] },
        { value: 3, dimension_values: ["55-64"] },
        { value: 1, dimension_values: ["65+"] },
      ],
    },
  ],
  _meta: {
    provider: "instagram",
    resource: "insights",
    operation: "account_insights",
  },
};

console.log("\nInstagram M8.13.2 demographic breakdown human view");

check("IG-M8132-1 parses 13–17 visible label", () => {
  const table = parseInsightBreakdownTable(liveShape);
  assert.ok(table);
  assert.ok(table!.rows.some((r) => r.label.includes("13") && r.label.includes("17")));
});

check("IG-M8132-2 parses 18–24", () => {
  const table = parseInsightBreakdownTable(liveShape)!;
  assert.ok(table.rows.some((r) => /18/.test(r.label) && /24/.test(r.label)));
});

check("IG-M8132-3 parses 25–34", () => {
  const table = parseInsightBreakdownTable(liveShape)!;
  assert.ok(table.rows.some((r) => /25/.test(r.label) && /34/.test(r.label)));
});

check("IG-M8132-4 parses value 244", () => {
  const table = parseInsightBreakdownTable(liveShape)!;
  assert.ok(table.rows.some((r) => r.value === "244"));
});

check("IG-M8132-5 See breakdown is NOT the only content", () => {
  const block = buildInstagramInsightsCollection([liveShape]);
  assert.ok(block);
  assert.ok(block!.breakdownTables?.length);
  assert.doesNotMatch(block!.text, /^Instagram Insights\nFollower Demographics\nSee breakdown$/);
  assert.equal(block!.stats?.some((s) => s.value === "See breakdown"), undefined);
  const preview = read("src/components/workflows/InstagramOutputPreview.tsx");
  assert.match(preview, /InsightBreakdownTableView/);
  assert.match(preview, /data-instagram-insights-breakdown/);
});

check("IG-M8132-6 Raw JSON still available via presentation original", () => {
  const resolved = resolveOutputPresentation(liveShape);
  assert.equal(resolved?.original, liveShape);
  assert.equal(
    (resolved?.items[0] as { breakdownValues: unknown }).breakdownValues,
    liveShape.breakdownValues
  );
});

check("IG-M8132-7 Human Copy contains breakdown rows", () => {
  const block = buildInstagramInsightsCollection([liveShape])!;
  assert.match(block.text, /Follower Demographics/);
  assert.match(block.text, /Breakdown: Age/);
  assert.match(block.text, /Period: Lifetime/);
  assert.match(block.text, /18/);
  assert.match(block.text, /244/);
  assert.doesNotMatch(block.text, /See breakdown/);
});

check("IG-M8132-8 empty breakdownValues shows demographic empty message", () => {
  const empty = {
    ...liveShape,
    breakdownValues: [{ dimension_keys: ["age"], results: [] }],
    status: "ok",
  };
  const block = buildInstagramInsightsCollection([empty])!;
  assert.match(
    block.text,
    /Demographic data is not available for this account or timeframe/
  );
  assert.doesNotMatch(block.text, /See breakdown/);
});

check("IG-M8132-9 city breakdown is collapsible", () => {
  const city = {
    ...liveShape,
    breakdown: "city",
    breakdownValues: [
      {
        dimension_keys: ["city"],
        results: Array.from({ length: 25 }, (_, i) => ({
          value: i + 1,
          dimension_values: [`City ${i + 1}`],
        })),
      },
    ],
  };
  const table = parseInsightBreakdownTable(city)!;
  assert.equal(table.collapsible, true);
  assert.equal(table.rows.length, 25);
});

console.log(`\nM8.13.2 checks: ${passed} passed`);
if (process.exitCode) console.error("M8.13.2 FAIL");
else console.log("M8.13.2 PASS");
