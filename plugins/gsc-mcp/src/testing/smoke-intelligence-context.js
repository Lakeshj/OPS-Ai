/**
 * IntelligenceContext → AI grounding regression tests.
 *
 * Does not modify OAuth, native googleSearchConsole, or scoring formulas.
 */
const assert = require("assert");
const {
  processUpstreamItems,
  intelligenceContext: ctx,
} = require("../index");
const {
  scoreCtrOpportunity,
  scoreRankingOpportunity,
  scoreContentDecay,
} = require("../contracts/intelligenceOutput");

const PROPERTY = "https://example.com/";
const PERIOD = { start: "2026-01-01", end: "2026-01-31" };
const SOURCE_META = { property: PROPERTY, period: PERIOD };

const CTR_ROWS = [
  {
    query: "gemini visibility tracker",
    page: "https://example.com/gemini",
    clicks: 0,
    impressions: 132,
    ctr: 0,
    position: 7.9,
  },
  {
    query: "seo workflow",
    page: "https://example.com/seo",
    clicks: 12,
    impressions: 400,
    ctr: 0.03,
    position: 9,
  },
];

const RANK_ROWS = [
  {
    query: "ranking climb",
    page: "https://example.com/rank",
    clicks: 20,
    impressions: 300,
    ctr: 0.067,
    position: 7,
  },
];

const DECAY_ROWS = [
  {
    query: "fading page",
    page: "https://example.com/fade",
    clicks: 5,
    impressions: 200,
    ctr: 0.025,
    position: 12,
  },
];

const PREVIOUS_DECAY = [
  {
    query: "fading page",
    page: "https://example.com/fade",
    clicks: 50,
    impressions: 220,
    ctr: 0.227,
    position: 6,
  },
];

const runCap = (capability, rows, extra = {}) =>
  processUpstreamItems({
    capability,
    inputItems: rows.map((json) => ({ json })),
    sourceMeta: SOURCE_META,
    ...extra,
  });

const main = () => {
  // 1. Single CTR capability → correct AI context
  const ctr = runCap("ctr_opportunities", CTR_ROWS);
  assert.equal(ctr.ok, true, "ctr ok");
  assert.ok(ctr.intelligenceContext, "intelligenceContext present");
  assert.equal(ctr.intelligenceContext.source, "google_search_console");
  assert.equal(ctr.intelligenceContext.property, PROPERTY);
  assert.equal(ctr.intelligenceContext.period.start, PERIOD.start);
  assert.equal(ctr.intelligenceContext.period.end, PERIOD.end);
  assert.equal(ctr.intelligenceContext.capabilities.length, 1);
  assert.equal(
    ctr.intelligenceContext.capabilities[0].capability,
    "ctr_opportunities"
  );
  assert.ok(ctr.intelligenceContext.capabilities[0].results.length >= 1);
  const groundedCtr = ctx.applyAiGrounding({
    systemPrompt: "",
    userPrompt: "Recommend next SEO actions",
    input: ctr.intelligenceContext,
  });
  assert.equal(groundedCtr.grounded, true);
  assert.ok(
    groundedCtr.userPrompt.includes('"capability": "ctr_opportunities"') ||
      groundedCtr.userPrompt.includes('"capability":"ctr_opportunities"')
  );
  assert.ok(groundedCtr.systemPrompt.includes("## GSC MCP evidence rules"));
  assert.ok(groundedCtr.systemPrompt.includes("opportunity_type"));
  assert.ok(groundedCtr.userPrompt.includes("gemini visibility tracker"));

  // 2. Multiple capabilities → correctly separated
  const ranking = runCap("ranking_opportunities", RANK_ROWS);
  assert.equal(ranking.ok, true);
  const combined = ctx.combineIntelligenceInputs([
    ctr.intelligenceContext,
    ranking.intelligenceContext,
  ]);
  assert.equal(combined.capabilities.length, 2);
  const caps = combined.capabilities.map((s) => s.capability).sort();
  assert.deepEqual(caps, ["ctr_opportunities", "ranking_opportunities"]);

  // 3. CTR + Ranking + Content Decay → no data loss
  const decay = runCap("content_decay", DECAY_ROWS, {
    previousRows: PREVIOUS_DECAY,
    filters: {
      minPreviousImpressions: 40,
      minCurrentImpressions: 20,
      minClickDropPercent: 10,
      minPositionWorsening: 1,
    },
  });
  assert.equal(decay.ok, true);
  const triple = ctx.combineIntelligenceInputs([
    ctr.intelligenceContext,
    ranking.intelligenceContext,
    decay.intelligenceContext,
  ]);
  assert.equal(triple.capabilities.length, 3);
  const ctrSection = triple.capabilities.find(
    (s) => s.capability === "ctr_opportunities"
  );
  const rankSection = triple.capabilities.find(
    (s) => s.capability === "ranking_opportunities"
  );
  const decaySection = triple.capabilities.find(
    (s) => s.capability === "content_decay"
  );
  assert.ok(ctrSection.results.length >= 1);
  assert.ok(rankSection.results.length >= 1);
  assert.ok(decaySection.count === decaySection.results.length);
  assert.equal(
    ctrSection.results.length,
    ctr.intelligenceContext.capabilities[0].results.length
  );

  // Merge-style rebuild from tagged workflow items
  const mergedFromItems = ctx.tryBuildFromWorkflowItems([
    ...ctr.items,
    ...ranking.items,
    ...decay.items,
  ]);
  assert.equal(mergedFromItems.ok, true);
  assert.equal(mergedFromItems.context.capabilities.length, 3);

  // 4. Empty capability → no hallucinated opportunities
  const empty = runCap("ctr_opportunities", [
    {
      query: "tiny",
      page: "https://example.com/tiny",
      clicks: 0,
      impressions: 1,
      ctr: 0,
      position: 50,
    },
  ]);
  assert.equal(empty.ok, true);
  assert.equal(empty.intelligenceContext.capabilities[0].count, 0);
  assert.deepEqual(empty.intelligenceContext.capabilities[0].results, []);
  const groundedEmpty = ctx.applyAiGrounding({
    systemPrompt: "",
    userPrompt: "Find business opportunities",
    input: empty.intelligenceContext,
  });
  assert.equal(groundedEmpty.empty, true);
  assert.ok(/zero results|Empty GSC/i.test(groundedEmpty.systemPrompt));
  const safeEmptyReply =
    "No opportunities were found for ctr_opportunities. The supplied GSC data is insufficient.";
  assert.ok(
    ctx.rejectsUnrelatedGenericOpportunities(
      safeEmptyReply,
      empty.intelligenceContext
    )
  );
  assert.ok(
    !ctx.rejectsUnrelatedGenericOpportunities(
      "- Sustainable Energy Solutions\n- Telehealth Services\n- E-commerce Expansion",
      empty.intelligenceContext
    )
  );

  // 5. Missing property → validation/error
  const missingProp = processUpstreamItems({
    capability: "ctr_opportunities",
    inputItems: CTR_ROWS.map((json) => ({ json })),
  });
  assert.equal(missingProp.ok, false);
  assert.equal(missingProp.error.code, "MCP_PROPERTY_REQUIRED");

  const badCtx = ctx.buildIntelligenceContext({
    property: null,
    period: PERIOD,
    capabilities: [
      { capability: "ctr_opportunities", results: [], count: 0 },
    ],
  });
  const validated = ctx.validateIntelligenceContext(badCtx, {
    requireProperty: true,
  });
  assert.equal(validated.ok, false);
  assert.equal(validated.error.code, "MCP_PROPERTY_REQUIRED");

  // 6. Metrics preserved
  const gemini = ctrSection.results.find(
    (r) => r.entity?.query === "gemini visibility tracker"
  );
  assert.ok(gemini);
  assert.equal(gemini.metrics.impressions, 132);
  assert.equal(gemini.metrics.clicks, 0);
  assert.equal(gemini.metrics.ctr, 0);
  assert.ok(Math.abs(gemini.metrics.position - 7.9) < 0.05);

  // 7. Filters preserved
  const filtered = processUpstreamItems({
    capability: "ctr_opportunities",
    inputItems: CTR_ROWS.map((json) => ({ json })),
    sourceMeta: SOURCE_META,
    filters: {
      minImpressions: 50,
      maxPosition: 20,
      minScore: 0,
      limit: 1,
    },
  });
  assert.equal(filtered.ok, true);
  assert.equal(filtered.intelligenceContext.capabilities[0].filters.limit, 1);
  assert.equal(
    filtered.intelligenceContext.capabilities[0].filters.minImpressions,
    50
  );
  assert.ok(filtered.items[0].json.filters.limit === 1);

  // 8. Date range preserved
  assert.equal(triple.period.start, PERIOD.start);
  assert.equal(triple.period.end, PERIOD.end);
  assert.equal(ctr.items[0].json.period.start, PERIOD.start);

  // 9. AI context contains capability identity
  const groundedMulti = ctx.applyAiGrounding({
    systemPrompt: "",
    userPrompt: "Summarize",
    input: triple,
  });
  assert.ok(groundedMulti.userPrompt.includes("ctr_opportunities"));
  assert.ok(groundedMulti.userPrompt.includes("ranking_opportunities"));
  assert.ok(groundedMulti.userPrompt.includes("content_decay"));
  assert.ok(groundedMulti.userPrompt.includes(PROPERTY));

  // 10. AI cannot produce unrelated generic opportunities from empty GSC result
  assert.ok(
    groundedEmpty.systemPrompt.includes("Do not invent") ||
      groundedEmpty.systemPrompt.includes("Do not create opportunities from untagged")
  );
  assert.ok(
    groundedEmpty.systemPrompt.includes("No actionable GSC evidence was returned")
  );
  assert.ok(
    !ctx.rejectsUnrelatedGenericOpportunities(
      "Sustainable Energy Solutions and Telehealth Services are strong bets",
      empty.intelligenceContext
    )
  );

  // 11. AI recommendation references supplied GSC evidence
  const goodRec =
    'Improve CTR for "gemini visibility tracker" — 132 impressions, 0 clicks, position 7.9';
  assert.ok(
    ctx.recommendationCitesEvidence(goodRec, ctr.intelligenceContext)
  );
  assert.ok(
    !ctx.recommendationCitesEvidence(
      "Expand into telehealth services globally",
      ctr.intelligenceContext
    )
  );

  // 12. Existing native GSC node remains unchanged — smoke marker only
  // (googleSearchConsole handler not imported/modified by this suite)
  assert.ok(typeof processUpstreamItems === "function");

  // 13. Existing MCP intelligence scoring remains unchanged
  const ctrScore = scoreCtrOpportunity({
    impressions: 132,
    clicks: 0,
    ctr: 0,
    position: 7.9,
  });
  assert.equal(ctrScore.score_breakdown.formula, "missedClicks * positionWeight");
  assert.ok(ctrScore.score_breakdown.missed_clicks >= 6);
  const rankScore = scoreRankingOpportunity({
    impressions: 300,
    position: 7,
  });
  assert.equal(rankScore.score, Math.round(300 / 7));
  const decayScore = scoreContentDecay({ clickDrop: 20, positionDelta: 2.5 });
  assert.equal(decayScore.score, Math.round(20 + 2.5 * 10));
  assert.equal(
    decayScore.score_breakdown.formula,
    "click_drop_score + position_drop_score"
  );

  // Single capability still produces full IntelligenceContext contract
  const singleBuilt = ctx.tryBuildFromWorkflowItems(ctr.items);
  assert.equal(singleBuilt.ok, true);
  assert.equal(singleBuilt.context.capabilities[0].capability, "ctr_opportunities");

  console.log("gsc-mcp smoke-intelligence-context OK");
};

main();
