/**
 * M10.3.11 — Adaptive buyer relevance filtering + JSON copy wiring.
 * Offline fixture only — no live Apify charges.
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

const fixturePath = path.join(
  __dirname,
  "fixtures/linkedin-lead-m10311-25posts.json"
);

(async () => {
  console.log("\nM10.3.11 Adaptive buyer relevance + JSON copy");

  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const { mapApifyItems } = require("../services/linkedinLeadDiscovery/apify/mapResults");
  const {
    filterBuyerRelevance,
    scoreBuyerRelevance,
  } = require("../services/linkedinLeadDiscovery/buyerRelevance");
  const { dedupeRows } = require("../services/linkedinLeadDiscovery/nativeCollection/dedupe");
  const { normalizeLeadItems } = require("../services/linkedinLeadDiscovery/normalize");

  const rawMapped = mapApifyItems(fixture.posts);
  assert.equal(rawMapped.length, 25);

  const deduped = dedupeRows(rawMapped);
  assert.ok(deduped.duplicateMerges >= 1, "duplicate ShopNova requirement merges");

  const authorIn = (rows, name) =>
    rows.some((r) => String(r.author?.name || "").includes(name));

  let recentResult;
  let relevantResult;

  await check("M10311-1 Most Recent filtering on fixture", () => {
    recentResult = filterBuyerRelevance(deduped.rows, {
      sortBy: "recent",
      operation: "discover_by_category",
      categoryIds: ["digital_marketing", "seo"],
      maxResults: 25,
    });
    const rows = recentResult.rows;
    console.log(
      `       recent accepted=${rows.length}/${deduped.rows.length} promoExcluded=${recentResult.diagnostics.competitorPromotionsExcluded}`
    );
    assert.ok(authorIn(rows, "Oryntic Labs"));
    assert.ok(authorIn(rows, "Bhairava Group"));
    assert.ok(authorIn(rows, "CareerByteCode"));
    assert.ok(!authorIn(rows, "Zenerom"));
    assert.ok(!authorIn(rows, "SNV Everstrive"));
    assert.ok(!authorIn(rows, "Parthnix"));
    assert.ok(!authorIn(rows, "Tecklixtech"));
    assert.ok(!authorIn(rows, "Linkplux"));
    assert.ok(
      recentResult.diagnostics.competitorPromotionsExcluded +
        recentResult.diagnostics.irrelevantExcluded >=
        5
    );
    // Sorted newest first
    for (let i = 1; i < rows.length; i += 1) {
      const prev = Date.parse(rows[i - 1].publishedAt || 0) || 0;
      const cur = Date.parse(rows[i].publishedAt || 0) || 0;
      assert.ok(prev >= cur);
    }
  });

  await check("M10311-2 Most Relevant stricter than Recent", () => {
    relevantResult = filterBuyerRelevance(deduped.rows, {
      sortBy: "relevant",
      operation: "discover_by_category",
      categoryIds: ["digital_marketing", "seo"],
      maxResults: 25,
    });
    const rows = relevantResult.rows;
    console.log(
      `       relevant accepted=${rows.length}/${deduped.rows.length}`
    );
    assert.ok(authorIn(rows, "Oryntic Labs"));
    assert.ok(authorIn(rows, "Bhairava Group"));
    assert.ok(!authorIn(rows, "Zenerom"));
    assert.ok(rows.length <= recentResult.rows.length);
    // Borderline "stretched team" may drop in relevant mode
    const borderline = rows.find((r) =>
      /stretched/i.test(String(r.content || ""))
    );
    // Not required to exclude, but relevant should not expand beyond recent
    assert.ok(borderline == null || recentResult.rows.some((r) => /stretched/i.test(r.content || "")));
  });

  await check("M10311-3 Measured precision vs labels (fixture)", () => {
    const labeledInclude = new Set(
      fixture.posts
        .filter((p) => p.label === "include" || p.label === "include_borderline")
        .map((p) => p.author.name)
    );
    const labeledExclude = new Set(
      fixture.posts
        .filter((p) => p.label === "exclude")
        .map((p) => p.author.name)
    );

    const measure = (rows, mode) => {
      const acceptedNames = rows.map((r) => r.author?.name).filter(Boolean);
      const truePos = acceptedNames.filter((n) => labeledInclude.has(n)).length;
      const falsePos = acceptedNames.filter((n) => labeledExclude.has(n)).length;
      const falseNeg = [...labeledInclude].filter(
        (n) => !acceptedNames.includes(n)
      ).length;
      const precision =
        acceptedNames.length === 0
          ? 0
          : truePos / Math.max(1, truePos + falsePos);
      console.log(
        `       ${mode}: n=${acceptedNames.length} precision=${(precision * 100).toFixed(1)}% TP=${truePos} FP=${falsePos} FN=${falseNeg}`
      );
      return { precision, truePos, falsePos, falseNeg, n: acceptedNames.length };
    };

    const recent = measure(recentResult.rows, "recent");
    const relevant = measure(relevantResult.rows, "relevant");
    // Targets are aspiration; require solid fixture behavior without claiming live %.
    assert.ok(recent.precision >= 0.8, `recent precision ${recent.precision}`);
    assert.ok(
      relevant.precision >= 0.9,
      `relevant precision ${relevant.precision}`
    );
    assert.equal(recent.falsePos, 0);
    assert.equal(relevant.falsePos, 0);
    assert.ok(recent.falseNeg <= 2, "avoid excessive exclusion on recent");
  });

  await check("M10311-4 Agency author with outsourcing kept", () => {
    assert.ok(authorIn(recentResult.rows, "North Peak Agency"));
    const scored = scoreBuyerRelevance(
      rawMapped.find((r) => /North Peak/i.test(r.author?.name || ""))
    );
    assert.equal(scored.classification, "direct_buyer");
  });

  await check("M10311-5 search_posts / get_post_details skip buyer filter", () => {
    const passthrough = filterBuyerRelevance(deduped.rows, {
      sortBy: "relevant",
      operation: "search_posts",
      maxResults: 10,
    });
    assert.equal(passthrough.diagnostics.applied, false);
    assert.equal(passthrough.rows.length, 10);
  });

  await check("M10311-6 Normalize preserves candidateOpportunity + qualifiedLead false", () => {
    const items = normalizeLeadItems(recentResult.rows, {
      provider: "apify",
      operation: "discover_by_category",
      queries: ["Looking for SEO agency"],
    });
    assert.ok(items.length > 0);
    assert.equal(items[0].qualifiedLead, false);
    assert.equal(items[0].candidateOpportunity, true);
    assert.ok(items[0].content && !/Show more/i.test(items[0].content));
  });

  await check("M10311-7 Zero relevant results path", () => {
    const onlyPromo = mapApifyItems(
      fixture.posts.filter((p) => /Zenerom|Linkplux/.test(p.author.name))
    );
    const out = filterBuyerRelevance(onlyPromo, {
      sortBy: "relevant",
      operation: "discover_by_category",
      maxResults: 25,
    });
    assert.equal(out.rows.length, 0);
    assert.ok(
      out.diagnostics.competitorPromotionsExcluded +
        out.diagnostics.irrelevantExcluded >=
        1
    );
  });

  await check("M10311-8 FE copy wiring (not Markdown preview)", () => {
    // M10.3.12: clipboard is human-readable "Copy Results"; not Markdown cards.
    const preview = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/components/workflows/LinkedInLeadOutputPreview.tsx"
      ),
      "utf8"
    );
    assert.match(preview, /Copy Results/);
    assert.match(preview, /formatLinkedInLeadHumanReadableCopy/);
    assert.doesNotMatch(preview, /Copy JSON/);
    const sidebar = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/components/workflows/WorkflowResultsSidebar.tsx"
      ),
      "utf8"
    );
    assert.match(sidebar, /formatLinkedInLeadHumanReadableCopy/);
    assert.match(sidebar, /Never copy Markdown/);
    assert.doesNotMatch(sidebar, /formatStepOutput\(latestRun\.output\)[\s\S]{0,200}clipboard/);
  });

  await check("M10311-9 Actor still scrapeforge; no cookie path", () => {
    const { ACTOR_ID } = require("../services/linkedinLeadDiscovery/apify/constants");
    assert.equal(ACTOR_ID, "kTfhD8wSCMRXlhNmE");
    const provider = fs.readFileSync(
      path.join(
        __dirname,
        "../services/linkedinLeadDiscovery/apifyProvider.js"
      ),
      "utf8"
    );
    assert.match(provider, /filterBuyerRelevance/);
    assert.match(provider, /perBatchItemBudget|basePerBatch/);
  });

  await check("M10311-10 Keyword library unchanged 10/140/15", () => {
    const lib = require("../services/linkedinLeadDiscovery/keywordLibrary");
    assert.equal(lib.SERVICE_CATEGORIES.length, 10);
    assert.equal(lib.ORIGINAL_KEYWORD_COUNT, 140);
    assert.equal(lib.INTENT_VARIATIONS.length, 15);
  });

  console.log(`\nM10.3.11 checks passed: ${passed}`);
  console.log(process.exitCode ? "M10.3.11 FAIL" : "M10.3.11 PASS (offline)");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
