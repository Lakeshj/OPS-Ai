/**
 * Intelligence quality tests:
 * - scoring (transparent formulas + ordering)
 * - empty data
 * - output schema (opportunity_type, entity, metrics, reason, recommendation, score)
 * - regression (no generic recommendations; types separated)
 *
 * Does not touch OAuth, credentials, or native googleSearchConsole.
 */
const assert = require("assert");
const {
  processUpstreamItems,
  getStaticCatalog,
} = require("../index");
const {
  ESSENTIAL_INTELLIGENCE_IDS,
  TOOL_LABELS,
} = require("../contracts/capabilities");
const {
  OPPORTUNITY_TYPES,
  validateIntelligenceOutput,
  scoreCtrOpportunity,
  scoreRankingOpportunity,
  scoreContentDecay,
  scoreKeywordConflict,
} = require("../contracts/intelligenceOutput");
const { runIntelligence } = require("../intelligence");

const SAMPLE_ROWS = [
  {
    query: "seo workflow",
    page: "https://example.com/seo",
    clicks: 12,
    impressions: 400,
    ctr: 0.03,
    position: 9,
  },
  {
    query: "seo workflow",
    page: "https://example.com/blog/seo",
    clicks: 4,
    impressions: 180,
    ctr: 0.022,
    position: 14,
  },
  {
    query: "low ctr keyword",
    page: "https://example.com/guide",
    clicks: 0,
    impressions: 132,
    ctr: 0,
    position: 7.9,
  },
  {
    query: "ranking climb",
    page: "https://example.com/rank",
    clicks: 20,
    impressions: 300,
    ctr: 0.067,
    position: 7,
  },
];

const PREVIOUS_ROWS = [
  {
    query: "low ctr keyword",
    page: "https://example.com/guide",
    clicks: 40,
    impressions: 200,
    ctr: 0.2,
    position: 5,
  },
];

const assertOpportunityShape = (row, allowedTypes) => {
  assert.ok(allowedTypes.includes(row.opportunity_type), row.opportunity_type);
  assert.ok(row.entity && row.entity.label);
  assert.ok(row.metrics && typeof row.metrics === "object");
  assert.equal(typeof row.reason, "string");
  assert.ok(row.reason.length > 40, "reason should be detailed");
  assert.equal(typeof row.recommendation, "string");
  assert.ok(row.recommendation.length > 40, "recommendation should be detailed");
  assert.equal(typeof row.score, "number");
  assert.ok(row.score_breakdown && row.score_breakdown.formula);
  // Must cite numbers somewhere in reason (impressions/clicks/position)
  assert.ok(
    /\d/.test(row.reason),
    `reason must include metrics: ${row.reason}`
  );
  assert.ok(
    !/page-level signals suggest|soft engagement signal|within striking distance|on-page optimization upside/i.test(
      `${row.reason} ${row.recommendation}`
    ),
    `generic copy leaked: ${row.reason}`
  );
};

const main = async () => {
  // --- Scoring unit checks ---
  const ctrScore = scoreCtrOpportunity({
    impressions: 132,
    clicks: 0,
    ctr: 0,
    position: 7.9,
  });
  assert.ok(ctrScore.score > 0);
  assert.equal(ctrScore.score_breakdown.formula, "missedClicks * positionWeight");
  assert.ok(ctrScore.score_breakdown.missed_clicks >= 6);

  const rankScore = scoreRankingOpportunity({
    impressions: 300,
    position: 7,
  });
  assert.equal(rankScore.score, Math.round(300 / 7));

  const decayScore = scoreContentDecay({ clickDrop: 20, positionDelta: 2.5 });
  assert.equal(decayScore.score, Math.round(20 + 2.5 * 10));

  const conflictScore = scoreKeywordConflict({
    pageCount: 2,
    impressions: 580,
  });
  assert.equal(conflictScore.score, 1160);

  // Higher impressions / better band should outrank weaker CTR miss
  const high = scoreCtrOpportunity({
    impressions: 1000,
    clicks: 5,
    ctr: 0.005,
    position: 6,
  });
  const low = scoreCtrOpportunity({
    impressions: 60,
    clicks: 1,
    ctr: 0.016,
    position: 15,
  });
  assert.ok(high.score > low.score);

  // --- Empty data ---
  for (const id of ESSENTIAL_INTELLIGENCE_IDS) {
    const empty = runIntelligence(id, { rows: [] });
    assert.equal(empty.ok, true, `${id} empty should ok`);
    const schema = validateIntelligenceOutput(empty.data, id);
    assert.ok(schema.ok, `${id} empty schema: ${schema.errors.join("; ")}`);
    assert.equal(empty.data.count, 0);
    assert.deepEqual(empty.data.opportunities, []);
  }

  const missingUpstream = processUpstreamItems({
    capability: "ranking_opportunities",
    inputItems: [],
  });
  assert.equal(missingUpstream.ok, false);
  assert.equal(missingUpstream.error.code, "MCP_UPSTREAM_REQUIRED");

  // --- Output schema + regression for each tool ---
  const ctr = runIntelligence("ctr_opportunities", { rows: SAMPLE_ROWS });
  assert.equal(ctr.ok, true);
  assert.ok(validateIntelligenceOutput(ctr.data, "ctr_opportunities").ok);
  assert.ok(ctr.data.count >= 1);
  for (const row of ctr.data.opportunities) {
    assertOpportunityShape(row, [OPPORTUNITY_TYPES.CTR]);
  }
  // Example regression: 132 impr / 0 clicks / pos 7.9 must be called out
  const example = ctr.data.opportunities.find(
    (o) => o.entity.label === "low ctr keyword"
  );
  assert.ok(example, "expected low ctr keyword opportunity");
  assert.ok(/132/.test(example.reason));
  assert.ok(/0 clicks|0% CTR/i.test(example.reason));
  assert.ok(/7\.9/.test(example.reason));
  assert.ok(/title|meta/i.test(example.recommendation));

  const ranking = runIntelligence("ranking_opportunities", {
    rows: SAMPLE_ROWS,
  });
  assert.ok(validateIntelligenceOutput(ranking.data, "ranking_opportunities").ok);
  for (const row of ranking.data.opportunities) {
    assertOpportunityShape(row, [OPPORTUNITY_TYPES.RANKING]);
  }
  assert.ok(
    ranking.data.opportunities.every(
      (a, i, arr) => i === 0 || arr[i - 1].score >= a.score
    ),
    "ranking scores must be descending"
  );

  const decaySnap = runIntelligence("content_decay", { rows: SAMPLE_ROWS });
  assert.ok(validateIntelligenceOutput(decaySnap.data, "content_decay").ok);
  for (const row of decaySnap.data.opportunities) {
    assertOpportunityShape(row, [OPPORTUNITY_TYPES.CONTENT_DECAY]);
  }

  const decayPrev = runIntelligence("content_decay", {
    rows: SAMPLE_ROWS,
    previousRows: PREVIOUS_ROWS,
    comparisonPeriod: "prior_period",
    dropPercentage: 10,
  });
  assert.ok(validateIntelligenceOutput(decayPrev.data, "content_decay").ok);
  assert.ok(decayPrev.data.count >= 1);
  const decayHit = decayPrev.data.opportunities.find(
    (o) => o.entity.label === "low ctr keyword"
  );
  assert.ok(decayHit);
  assert.ok(/fell from|worsened/i.test(decayHit.reason));
  assert.equal(decayHit.opportunity_type, OPPORTUNITY_TYPES.CONTENT_DECAY);

  const conflict = runIntelligence("keyword_cannibalization", {
    rows: SAMPLE_ROWS,
  });
  assert.ok(
    validateIntelligenceOutput(conflict.data, "keyword_cannibalization").ok
  );
  assert.ok(conflict.data.count >= 1);
  for (const row of conflict.data.opportunities) {
    assertOpportunityShape(row, [OPPORTUNITY_TYPES.KEYWORD_CONFLICT]);
    assert.ok(row.metrics.page_count >= 2);
    assert.ok(/canonical|301|consolidat/i.test(row.recommendation));
  }

  const gap = runIntelligence("query_gap_analysis", { rows: SAMPLE_ROWS });
  assert.ok(validateIntelligenceOutput(gap.data, "query_gap_analysis").ok);
  for (const row of gap.data.opportunities) {
    assertOpportunityShape(row, [
      OPPORTUNITY_TYPES.CTR,
      OPPORTUNITY_TYPES.RANKING,
    ]);
  }

  const pageOpt = runIntelligence("page_optimization_suggestions", {
    rows: SAMPLE_ROWS,
  });
  assert.ok(
    validateIntelligenceOutput(pageOpt.data, "page_optimization_suggestions")
      .ok
  );
  for (const row of pageOpt.data.opportunities) {
    assertOpportunityShape(row, [
      OPPORTUNITY_TYPES.CTR,
      OPPORTUNITY_TYPES.RANKING,
    ]);
  }

  // Processor still works with WorkflowItems
  const processed = processUpstreamItems({
    capability: "ctr_opportunities",
    inputItems: SAMPLE_ROWS.map((json) => ({ json })),
    sourceMeta: {
      property: "https://example.com/",
      period: { start: "2026-01-01", end: "2026-01-31" },
    },
  });
  assert.equal(processed.ok, true);
  assert.ok(processed.items.length >= 1);
  assert.equal(
    processed.items[0].json.opportunity_type,
    OPPORTUNITY_TYPES.CTR
  );
  assert.ok(processed.intelligenceContext);
  assert.equal(processed.intelligenceContext.property, "https://example.com/");
  assert.equal(
    processed.intelligenceContext.capabilities[0].capability,
    "ctr_opportunities"
  );

  // Registry still exposes tools with separate labels
  const catalog = getStaticCatalog({}, { audience: "agent" });
  for (const id of ESSENTIAL_INTELLIGENCE_IDS) {
    const entry = catalog.find((t) => t.id === id);
    assert.ok(entry);
    assert.equal(entry.label, TOOL_LABELS[id]);
    assert.notEqual(entry.id, entry.label);
  }

  console.log("gsc-mcp smoke-intelligence OK");
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
