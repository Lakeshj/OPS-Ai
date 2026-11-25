/**
 * M10.1 — LinkedIn Lead Discovery Native foundation.
 * Fixtures only. No live LinkedIn / Apify calls.
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
  console.log("\nM10.1 LinkedIn Lead Discovery foundation");
  // M10.2: fixtures are opt-in — enable for this regression harness only.
  process.env.OPSAI_LINKEDIN_ALLOW_FIXTURES = "1";
  delete process.env.OPSAI_LINKEDIN_FEED_URL;

  const root = path.join(__dirname, "..", "..");
  const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
  const lib = () =>
    require("../services/linkedinLeadDiscovery/keywordLibrary");
  const engine = () =>
    require("../services/linkedinLeadDiscovery/keywordEngine");
  const service = () =>
    require("../services/workflowLinkedInLeadDiscovery.service");
  const workflows = () =>
    require("../modules/workflows/workflows.service");

  await check("M101-1 Exactly 10 categories and 140 keywords", () => {
    const { SERVICE_CATEGORIES, ORIGINAL_KEYWORD_COUNT, INTENT_VARIATIONS } =
      lib();
    assert.equal(SERVICE_CATEGORIES.length, 10);
    assert.equal(ORIGINAL_KEYWORD_COUNT, 140);
    assert.equal(INTENT_VARIATIONS.length, 15);
    const expected = {
      digital_marketing: 12,
      seo: 14,
      ai_visibility: 19,
      performance_marketing: 15,
      social_media_marketing: 14,
      influencer_marketing: 15,
      website_design_development: 13,
      branding_digital_pr: 12,
      b2b_lead_generation: 10,
      general_agency_outsourcing: 16,
    };
    for (const cat of SERVICE_CATEGORIES) {
      assert.equal(
        cat.keywords.length,
        expected[cat.id],
        `${cat.id} keyword count`
      );
    }
  });

  await check("M101-2 All original keyword texts preserved", () => {
    const { SERVICE_CATEGORIES } = lib();
    const mustInclude = [
      "Looking for a digital marketing agency",
      "SEO freelancer or agency",
      "Google AI Overview optimization",
      "E-commerce performance marketing",
      "Reels creation agency",
      "Nano influencer campaigns",
      "WordPress development agency",
      "Reputation management services",
      "Sales pipeline generation",
      "RFP digital marketing",
    ];
    const all = SERVICE_CATEGORIES.flatMap((c) => c.keywords);
    for (const kw of mustInclude) {
      assert.ok(all.includes(kw), `missing keyword: ${kw}`);
    }
    assert.equal(new Set(all.map((k) => k.toLowerCase())).size, all.length);
  });

  await check("M101-3 Intent variations exact set", () => {
    const labels = lib().INTENT_VARIATIONS.map((i) => i.label);
    assert.deepEqual(labels, [
      "Looking for",
      "Need",
      "Seeking",
      "Required",
      "Hiring",
      "Recommendations",
      "Suggest",
      "Exploring",
      "Shortlisting",
      "Onboarding",
      "Partner needed",
      "Agency search",
      "Outsourcing",
      "Project requirement",
      "Request for proposal",
    ]);
  });

  await check("M101-4 Select all categories loads 140 originals", () => {
    const plan = engine().buildSearchQueries({
      mode: "category",
      categoryIds: "all",
      intentExpansion: false,
    });
    assert.equal(plan.originalKeywords.length, 140);
    assert.equal(plan.queryCount, 140);
  });

  await check("M101-5 Intent expansion dedupes and keeps originals", () => {
    const plan = engine().buildSearchQueries({
      mode: "category",
      categoryIds: ["seo"],
      intentExpansion: true,
      intentIds: "all",
    });
    assert.equal(plan.originalKeywords.length, 14);
    assert.ok(plan.expandedKeywords.length > 0);
    assert.ok(plan.queries.length >= 14);
    assert.ok(plan.queries.includes("Looking for SEO agency"));
    // No malformed double intent.
    assert.ok(
      !plan.queries.some((q) => /looking for looking for/i.test(q))
    );
  });

  await check("M101-6 Custom keywords + short stem expansion", () => {
    const plan = engine().buildSearchQueries({
      mode: "custom",
      customKeywords: ["SEO agency", "Need SEO expert already full"],
      intentExpansion: true,
      intentIds: ["looking_for", "required"],
    });
    assert.ok(plan.queries.includes("SEO agency"));
    assert.ok(plan.queries.includes("Looking for SEO agency"));
    assert.ok(plan.queries.includes("SEO agency required"));
  });

  await check("M101-7 Node registration ALLOWED + handler", () => {
    assert.equal(
      workflows().ALLOWED_NODE_TYPES.has("linkedinLeadDiscovery"),
      true
    );
    const definition = {
      version: 1,
      nodes: [
        {
          id: "trigger-1",
          type: "trigger",
          position: { x: 0, y: 0 },
          data: { nodeType: "trigger" },
        },
        {
          id: "li-1",
          type: "linkedinLeadDiscovery",
          position: { x: 200, y: 0 },
          data: {
            label: "LinkedIn Lead Discovery",
            nodeType: "linkedinLeadDiscovery",
            operation: "discover_by_category",
            dataProvider: "opsai_native",
            categoryIds: ["seo"],
          },
        },
        {
          id: "result-1",
          type: "result",
          position: { x: 400, y: 0 },
          data: { nodeType: "result" },
        },
      ],
      edges: [
        { id: "e1", source: "trigger-1", target: "li-1" },
        { id: "e2", source: "li-1", target: "result-1" },
      ],
    };
    assert.doesNotThrow(() => workflows().validateDefinition(definition));
    const nodesSrc = read("backend/services/workflowNodes.service.js");
    assert.match(nodesSrc, /linkedinLeadDiscovery:\s*async/);
  });

  await check("M101-8 Fixture Run Step discover_by_category", async () => {
    const out = await service().executeLinkedInLeadDiscoveryNode(
      {
        data: {
          operation: "discover_by_category",
          dataProvider: "opsai_native",
          categoryIds: ["digital_marketing", "seo"],
          intentExpansion: false,
          maxResults: 10,
        },
      },
      { inputItems: [{ json: {} }] }
    );
    assert.ok(out.items.length >= 1);
    assert.equal(out.items[0].json._meta.provider, "linkedin_lead_discovery");
    assert.equal(out.items[0].json.qualifiedLead, false);
    assert.equal(out.items[0].json.candidateOpportunity, true);
    assert.equal(out.output.dataProvider, "opsai_native");
    assert.match(
      String(out.output.providerMeta?.message || ""),
      /fixture|not live/i
    );
  });

  await check("M101-9 Apify without credential does not affect Native", async () => {
    await assert.rejects(
      () =>
        service().executeLinkedInLeadDiscoveryNode(
          {
            data: {
              operation: "discover_by_category",
              dataProvider: "apify",
              categoryIds: ["seo"],
            },
          },
          { inputItems: [{ json: {} }] }
        ),
      (err) => {
        assert.equal(err.code, "LINKEDIN_LEAD_APIFY_NOT_CONNECTED");
        return true;
      }
    );
    // Native fixtures still work independently.
    const native = await service().executeLinkedInLeadDiscoveryNode(
      {
        data: {
          operation: "discover_by_category",
          dataProvider: "opsai_native",
          categoryIds: ["seo"],
          useFixtures: true,
          maxResults: 3,
        },
      },
      { inputItems: [{ json: {} }] }
    );
    assert.ok(native.items.length >= 1);
  });

  await check("M101-10 Provider isolation + FE wiring", () => {
    const svc = read("backend/services/workflowLinkedInLeadDiscovery.service.js");
    assert.ok(!/workflowInstagram|workflowMetaAds|workflowFacebookPage/.test(svc));
    const types = read("frontend/src/modules/workflows/types.ts");
    const library = read("frontend/src/modules/workflows/nodeLibrary.json");
    const schema = read("frontend/src/modules/workflows/nodeParameterSchemas.ts");
    assert.match(types, /linkedinLeadDiscovery/);
    assert.match(types, /"apify"/);
    assert.match(library, /"engineType": "linkedinLeadDiscovery"/);
    assert.match(schema, /linkedinLeadDiscovery:\s*\[/);
  });

  await check("M101-11 Usage status never fabricates percentages", async () => {
    const usage = await service().getProviderUsageStatus("apify", null);
    assert.equal(usage.available, false);
    assert.equal(usage.free, null);
    assert.equal(usage.paid, null);
    assert.ok(usage.reason);
  });

  await check("M101-12 Sanitize clears stale Apify + category params", () => {
    const cleaned = service().sanitizeLinkedInLeadDiscoveryNodeData({
      operation: "discover_by_custom_keywords",
      dataProvider: "opsai_native",
      categoryIds: ["seo"],
      apifyCredentialId: "cred-1",
      apifyBillingMode: "paid",
      customKeywords: ["SEO agency"],
      accessToken: "secret-should-strip",
    });
    assert.equal(cleaned.categoryIds, undefined);
    assert.equal(cleaned.apifyCredentialId, undefined);
    assert.equal(cleaned.apifyBillingMode, undefined);
    assert.equal(cleaned.accessToken, undefined);
    assert.deepEqual(cleaned.customKeywords, ["SEO agency"]);
  });

  await check("M101-13 Get Post Details fixture + common schema", async () => {
    const out = await service().executeLinkedInLeadDiscoveryNode(
      {
        data: {
          operation: "get_post_details",
          dataProvider: "opsai_native",
          postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:fixture1",
        },
      },
      { inputItems: [{ json: {} }] }
    );
    const row = out.items[0].json;
    assert.ok(row.sourcePostId);
    assert.ok(row.sourcePostUrl);
    assert.ok(row.content);
    assert.equal(row.qualifiedLead, false);
    assert.equal(row._meta.fixture, true);
    assert.equal(row.dataProvider, "opsai_native");
  });

  await check("M101-14 Live without feed → config error (no silent fixtures)", async () => {
    await assert.rejects(
      () =>
        service().executeLinkedInLeadDiscoveryNode(
          {
            data: {
              operation: "search_posts",
              dataProvider: "opsai_native",
              customKeywords: ["SEO agency"],
              live: true,
            },
          },
          { inputItems: [{ json: {} }] }
        ),
      (err) => {
        assert.equal(err.code, "LINKEDIN_LEAD_NATIVE_NOT_CONFIGURED");
        return true;
      }
    );
  });

  console.log(`\n${passed} M10.1 LinkedIn Lead Discovery checks passed`);
  try {
    const { pool } = require("../config/database");
    await pool.end();
  } catch (_) {
    // ignore
  }
  process.exit(process.exitCode || 0);
})().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
