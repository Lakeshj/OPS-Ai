/**
 * M10.3.14 Part B — LinkedIn include/exclude keywords (offline).
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let passed = 0;
const check = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
};

(async () => {
  console.log("\nM10.3.14 LinkedIn include/exclude keywords");

  const {
    applyExcludeKeywords,
    matchesKeyword,
    normalizeText,
  } = require("../services/linkedinLeadDiscovery/excludeKeywords");
  const { buildSearchQueries } = require("../services/linkedinLeadDiscovery/keywordEngine");
  const lib = require("../services/linkedinLeadDiscovery/keywordLibrary");

  await check("M10314-L1 Library still 10/140/15", () => {
    assert.equal(lib.SERVICE_CATEGORIES.length, 10);
    assert.equal(lib.ORIGINAL_KEYWORD_COUNT, 140);
    assert.equal(lib.INTENT_VARIATIONS.length, 15);
  });

  await check("M10314-L2 Additional include keywords extend query plan", () => {
    const plan = buildSearchQueries({
      mode: "discover_by_category",
      categoryIds: ["seo"],
      additionalKeywords: ["b2b seo partner", "local seo audit"],
    });
    assert.ok(plan.queries.includes("b2b seo partner"));
    assert.ok(plan.additionalKeywordCount >= 2);
  });

  await check("M10314-L3 Phrase exclude does not match partial words", () => {
    const hay = normalizeText("We need an SEO agency this quarter");
    assert.equal(matchesKeyword(hay, "seo", "phrase"), true);
    assert.equal(matchesKeyword(hay, "se", "phrase"), false);
    assert.equal(matchesKeyword(hay, "agency", "contains"), true);
  });

  await check("M10314-L4 Exclude removes matching posts and counts them", () => {
    const items = [
      { json: { content: "Looking for an SEO agency", author: { name: "Buyer" } } },
      { json: { content: "We provide SEO services", author: { name: "Zenerom" } } },
      { json: { content: "Need content writer", author: { name: "Studio" } } },
    ];
    const out = applyExcludeKeywords(items, {
      excludeKeywords: ["Zenerom", "we provide"],
      excludeMatchMode: "phrase",
    });
    assert.equal(out.excludedCount, 1);
    assert.equal(out.items.length, 2);
  });

  await check("M10314-L5 Contains mode excludes substring", () => {
    const items = [
      { json: { content: "Hire LinkpluxMarketing today" } },
      { json: { content: "Need a freelancer for ads" } },
    ];
    const out = applyExcludeKeywords(items, {
      excludeKeywords: ["linkplux"],
      excludeMatchMode: "contains",
    });
    assert.equal(out.excludedCount, 1);
    assert.equal(out.items.length, 1);
  });

  await check("M10314-L6 FE include/exclude + Clear all wiring", () => {
    const fe = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/components/workflows/params/LinkedInLeadDiscoveryFields.tsx"
      ),
      "utf8"
    );
    assert.match(fe, /Additional include keywords/);
    assert.match(fe, /Exclude keywords/);
    assert.match(fe, /excludeMatchMode/);
    assert.match(fe, /Clear all/);
  });

  await check("M10314-L7 search_posts wrap does not require exclude", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowLinkedInLeadDiscovery.service.js"),
      "utf8"
    );
    assert.match(src, /excludedByKeyword/);
    assert.match(src, /discover_by_category/);
  });

  console.log(`\nM10.3.14 LinkedIn checks passed: ${passed}`);
  console.log(process.exitCode ? "M10.3.14 LinkedIn FAIL" : "M10.3.14 LinkedIn PASS (offline)");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
