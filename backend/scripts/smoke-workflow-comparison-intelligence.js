/**
 * Phase 2 — GSC + GA4 comparison intelligence.
 * Fetch dual-request coverage also lives in smoke-workflow-14d5 (GSC-7b/7c, GA4-6b/6c).
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const registerComparisonIntelligenceTests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("GSC + GA4 comparison intelligence");

  const periods = () => require("../services/workflowComparisonPeriods");
  const ga4Process = () => require("../../plugins/ga4-mcp/src/adapters/processUpstream");
  const gscProcess = () => require("../../plugins/gsc-mcp/src/adapters/processUpstream");
  const ga4Ground = () => require("../../plugins/ga4-mcp/src/contracts/intelligenceContext");
  const gscGround = () => require("../../plugins/gsc-mcp/src/contracts/intelligenceContext");
  const nativeGa4 = () => require("../services/workflowGa4AiGrounding");

  const ga4Primary = {
    period: "primary",
    rangeStartDate: "2026-06-21",
    rangeEndDate: "2026-09-20",
    landingPage: "/pricing",
    sessions: 200,
    engagementRate: 0.2,
    bounceRate: 0.8,
  };
  const ga4Comparison = {
    period: "comparison",
    rangeStartDate: "2026-03-21",
    rangeEndDate: "2026-06-20",
    landingPage: "/pricing",
    sessions: 100,
    engagementRate: 0.5,
    bounceRate: 0.4,
  };
  const ga4PrimaryOnly = {
    period: "primary",
    rangeStartDate: "2026-06-21",
    rangeEndDate: "2026-09-20",
    landingPage: "/only-primary",
    sessions: 180,
    engagementRate: 0.1,
    bounceRate: 0.9,
  };

  check("CMP-A/B metric change and zero comparison", () => {
    const { metricChange } = periods();
    const up = metricChange(125, 100);
    assertX.equal(up.absolute, 25);
    assertX.equal(up.percentage, 25);
    assertX.equal(up.percentageAvailable, true);
    const zero = metricChange(40, 0);
    assertX.equal(zero.absolute, 40);
    assertX.equal(zero.percentage, null);
    assertX.equal(zero.percentageAvailable, false);
    assertX.equal(zero.reason, "comparison_zero");
    assertX.match(periods().COMPARISON_RULES, /cannot be calculated from zero/);
    assertX.match(periods().COMPARISON_RULES, /Do not invent a zero/);
    assertX.match(periods().COMPARISON_RULES, /MCP score is authoritative/);
    assertX.match(periods().COMPARISON_RULES, /Do not invent causes/);
  });

  check("CMP-Q missing comparison entity is not a zero", () => {
    const { unmatchedPrimaryEntities } = periods();
    const missing = unmatchedPrimaryEntities(
      [ga4Primary, ga4PrimaryOnly],
      [ga4Comparison],
      "google_analytics"
    );
    assertX.equal(missing.length, 1);
    assertX.equal(missing[0].landingPage, "/only-primary");
    assertX.notEqual(missing[0].sessions, 0);
  });

  check("CMP-R GA4 MCP scores primary only and keeps comparison for AI", () => {
    const primaryRun = ga4Process().processUpstreamItems({
      capability: "engagement_opportunities",
      inputItems: [
        { json: { ...ga4Primary, period: undefined } },
        { json: { ...ga4PrimaryOnly, period: undefined } },
      ],
      nodeData: { propertyId: "properties/1", minSessions: 100 },
    });
    const mixed = ga4Process().processUpstreamItems({
      capability: "engagement_opportunities",
      inputItems: [
        { json: ga4Primary },
        { json: ga4Comparison },
        { json: ga4PrimaryOnly },
      ],
      nodeData: { propertyId: "properties/1", minSessions: 100 },
    });
    assertX.equal(primaryRun.ok, true);
    assertX.equal(mixed.ok, true);
    const primaryScores = primaryRun.items
      .map((item) => item.json)
      .filter((row) => row.opportunity_type || row.capability === "engagement_opportunities")
      .map((row) => row.score);
    const mixedOpps = mixed.items
      .map((item) => item.json)
      .filter((row) => row.opportunity_type || row.capability === "engagement_opportunities");
    assertX.deepEqual(
      mixedOpps.map((row) => row.score),
      primaryScores
    );
    assertX.ok(
      mixedOpps.every((row) => row.landingPage !== "/pricing" || row.sessions !== 100),
      "comparison sessions must not replace the primary opportunity"
    );
    const carrier = mixed.items.map((item) => item.json).find((row) => row.comparisonDataset);
    assertX.ok(carrier, "comparison dataset carried for AI");
    assertX.equal(carrier.comparisonDataset.comparisonRows.length, 1);
    assertX.equal(carrier.comparisonDataset.comparisonRows[0].period, "comparison");
    assertX.equal(carrier.comparisonDataset.comparisonRange.startDate, "2026-03-21");
    const grounded = ga4Ground().applyAiGrounding({
      systemPrompt: "Compare the two periods.",
      userPrompt: "Which pages improved?",
      input: mixed.items,
    });
    assertX.equal(grounded.grounded, true);
    assertX.match(grounded.systemPrompt, /PRIMARY PERIOD and COMPARISON PERIOD/);
    assertX.match(grounded.userPrompt, /2026-03-21/);
    assertX.match(grounded.userPrompt, /2026-06-21/);
    assertX.match(grounded.systemPrompt, /MCP score is authoritative/);
    assertX.ok(!mixedOpps.some((row) => row.period === "comparison"));
  });

  check("CMP-R2 GSC MCP scores primary only", () => {
    const row = (period, query, clicks) => ({
      json: {
        period,
        rangeStartDate: period === "primary" ? "2026-06-21" : "2026-03-21",
        rangeEndDate: period === "primary" ? "2026-09-20" : "2026-06-20",
        query,
        clicks,
        impressions: 200,
        ctr: clicks / 200,
        position: 8,
        property: "https://example.com/",
      },
    });
    const primaryOnly = gscProcess().processUpstreamItems({
      capability: "ctr_opportunities",
      inputItems: [row(undefined, "alpha", 10)],
      nodeData: { siteUrl: "https://example.com/", minImpressions: 50 },
      sourceMeta: { property: "https://example.com/" },
    });
    const mixed = gscProcess().processUpstreamItems({
      capability: "ctr_opportunities",
      inputItems: [row("primary", "alpha", 10), row("comparison", "alpha", 80)],
      nodeData: { siteUrl: "https://example.com/", minImpressions: 50 },
      sourceMeta: { property: "https://example.com/" },
    });
    assertX.equal(primaryOnly.ok, true, primaryOnly.error && primaryOnly.error.message);
    assertX.equal(mixed.ok, true, mixed.error && mixed.error.message);
    const scoreOf = (result) =>
      result.items
        .map((item) => item.json)
        .filter((json) => json.opportunity_type === "ctr_opportunity")
        .map((json) => json.score);
    assertX.deepEqual(scoreOf(mixed), scoreOf(primaryOnly));
    const carrier = mixed.items.map((item) => item.json).find((json) => json.comparisonDataset);
    assertX.ok(carrier);
    assertX.equal(carrier.comparisonDataset.comparisonRows[0].clicks, 80);
    const grounded = gscGround().applyAiGrounding({
      systemPrompt: "Compare GSC performance.",
      userPrompt: "What changed?",
      input: mixed.items,
    });
    assertX.equal(grounded.grounded, true);
    assertX.match(grounded.systemPrompt, /cannot be calculated from zero/);
    assertX.match(grounded.userPrompt, /comparisonDataset/);
  });

  check("CMP-N native GA4 grounding names both ranges", () => {
    const grounded = nativeGa4().applyGa4NativeAiGrounding({
      systemPrompt: "Compare the two periods.",
      userPrompt: "Show the biggest increases.",
      input: [{ json: ga4Primary }, { json: ga4Comparison }],
    });
    assertX.equal(grounded.grounded, true);
    assertX.match(grounded.systemPrompt, /2026-06-21/);
    assertX.match(grounded.systemPrompt, /2026-03-21/);
    assertX.match(grounded.systemPrompt, /Do not invent a zero/);
  });

  check("CMP-OFF no comparison section without comparison rows", () => {
    const single = ga4Process().processUpstreamItems({
      capability: "engagement_opportunities",
      inputItems: [{ json: { landingPage: "/pricing", sessions: 200, engagementRate: 0.2, bounceRate: 0.8 } }],
      nodeData: { propertyId: "properties/1" },
    });
    assertX.equal(single.ok, true);
    assertX.equal(
      single.items.some((item) => item.json && item.json.comparisonDataset),
      false
    );
  });

  check("CMP-L schema keeps both date ranges for auto-save", () => {
    const schema = fs.readFileSync(
      path.join(__dirname, "../../frontend/src/modules/workflows/nodeParameterSchemas.ts"),
      "utf8"
    );
    for (const field of [
      "comparisonEnabled",
      "comparisonStartDate",
      "comparisonEndDate",
      "startDate",
      "endDate",
    ]) {
      assertX.ok(schema.includes(`name: "${field}"`), field);
    }
  });

  check("CMP-I/J custom ranges stay independent", () => {
    const { resolvePrimaryAndComparison } = require("../services/workflowGoogleDateRange");
    const resolved = resolvePrimaryAndComparison({
      dateRange: "custom",
      startDate: "2026-06-21",
      endDate: "2026-09-20",
      comparisonEnabled: true,
      comparisonStartDate: "2026-03-21",
      comparisonEndDate: "2026-06-20",
    });
    assertX.equal(resolved.dateRange.startDate, "2026-06-21");
    assertX.equal(resolved.dateRange.endDate, "2026-09-20");
    assertX.equal(resolved.comparison.startDate, "2026-03-21");
    assertX.equal(resolved.comparison.endDate, "2026-06-20");
  });
};

module.exports = { registerComparisonIntelligenceTests };
