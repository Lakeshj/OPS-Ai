/**
 * Intelligence filter tests:
 * - default values
 * - custom filters
 * - empty results
 * - output schema regression
 *
 * Does not touch OAuth, credentials, googleSearchConsole, or the workflow engine.
 */
const assert = require("assert");
const {
  processUpstreamItems,
  intelligenceFilters,
} = require("../index");
const {
  FILTER_DEFAULTS,
  validateIntelligenceFilters,
  extractFiltersFromNodeData,
} = require("../contracts/intelligenceFilters");
const {
  OPPORTUNITY_TYPES,
  validateIntelligenceOutput,
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
  {
    query: "tiny",
    page: "https://example.com/tiny",
    clicks: 0,
    impressions: 10,
    ctr: 0,
    position: 8,
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

const main = () => {
  assert.ok(intelligenceFilters);
  assert.equal(FILTER_DEFAULTS.ctr_opportunities.minImpressions, 50);
  assert.equal(FILTER_DEFAULTS.ranking_opportunities.minPosition, 5);
  assert.equal(FILTER_DEFAULTS.content_decay.comparisonPeriod, "prior_period");
  assert.equal(FILTER_DEFAULTS.content_decay.minPreviousImpressions, 50);
  assert.equal(FILTER_DEFAULTS.keyword_cannibalization.minPages, 2);

  // --- Default values ---
  for (const id of Object.keys(FILTER_DEFAULTS)) {
    const validated = validateIntelligenceFilters(id, {});
    assert.equal(validated.ok, true, `${id} defaults failed`);
    for (const [key, value] of Object.entries(FILTER_DEFAULTS[id])) {
      assert.equal(
        validated.filters[key],
        value,
        `${id}.${key} default mismatch`
      );
    }
  }

  // --- Invalid filters ---
  const badCtr = validateIntelligenceFilters("ctr_opportunities", {
    maxPosition: 0,
  });
  assert.equal(badCtr.ok, false);
  assert.equal(badCtr.error.code, "MCP_VALIDATION");

  const badPages = validateIntelligenceFilters("keyword_cannibalization", {
    minPages: 1,
  });
  assert.equal(badPages.ok, false);

  // --- Custom CTR filters ---
  const ctrDefault = runIntelligence("ctr_opportunities", {
    rows: SAMPLE_ROWS,
  });
  assert.equal(ctrDefault.ok, true);
  assert.ok(validateIntelligenceOutput(ctrDefault.data, "ctr_opportunities").ok);
  assert.ok(ctrDefault.data.count >= 1);

  const ctrTight = runIntelligence("ctr_opportunities", {
    rows: SAMPLE_ROWS,
    minImpressions: 200,
    maxPosition: 10,
    minScore: 1,
    limit: 1,
  });
  assert.equal(ctrTight.ok, true);
  assert.ok(ctrTight.data.count <= 1);
  for (const row of ctrTight.data.opportunities) {
    assert.ok(row.metrics.impressions >= 200);
    assert.ok(row.metrics.position <= 10);
    assert.ok(row.score >= 1);
    assert.equal(row.opportunity_type, OPPORTUNITY_TYPES.CTR);
  }

  // Empty via filters
  const ctrEmpty = runIntelligence("ctr_opportunities", {
    rows: SAMPLE_ROWS,
    minImpressions: 999999,
  });
  assert.equal(ctrEmpty.ok, true);
  assert.equal(ctrEmpty.data.count, 0);
  assert.ok(validateIntelligenceOutput(ctrEmpty.data, "ctr_opportunities").ok);

  // --- Custom ranking filters (position range) ---
  const rankCustom = runIntelligence("ranking_opportunities", {
    rows: SAMPLE_ROWS,
    minImpressions: 100,
    minPosition: 6,
    maxPosition: 10,
    limit: 10,
  });
  assert.equal(rankCustom.ok, true);
  for (const row of rankCustom.data.opportunities) {
    assert.ok(row.metrics.position >= 6 && row.metrics.position <= 10);
    assert.equal(row.opportunity_type, OPPORTUNITY_TYPES.RANKING);
  }

  const rankEmpty = runIntelligence("ranking_opportunities", {
    rows: SAMPLE_ROWS,
    minPosition: 50,
    maxPosition: 60,
  });
  assert.equal(rankEmpty.data.count, 0);

  // --- Content decay: prior period only + thresholds ---
  const decaySnapRejected = runIntelligence("content_decay", {
    rows: SAMPLE_ROWS,
    previousRows: PREVIOUS_ROWS,
    comparisonPeriod: "snapshot",
  });
  assert.equal(decaySnapRejected.ok, false);
  assert.equal(decaySnapRejected.error.code, "MCP_VALIDATION");

  const decayNoPrior = runIntelligence("content_decay", {
    rows: SAMPLE_ROWS,
    minClickDropPercent: 20,
  });
  assert.equal(decayNoPrior.ok, false);
  assert.equal(decayNoPrior.error.code, "MCP_VALIDATION");

  const decayPrior = runIntelligence("content_decay", {
    rows: SAMPLE_ROWS,
    previousRows: PREVIOUS_ROWS,
    minClickDropPercent: 20,
    minPreviousImpressions: 40,
    minCurrentImpressions: 20,
  });
  assert.equal(decayPrior.ok, true);
  assert.ok(decayPrior.data.count >= 1);
  const decayHit = decayPrior.data.opportunities.find(
    (o) => o.entity.label === "low ctr keyword"
  );
  assert.ok(decayHit);
  assert.ok(Math.abs(decayHit.metrics.click_change_percent) >= 20);

  const decayStrictDrop = runIntelligence("content_decay", {
    rows: SAMPLE_ROWS,
    previousRows: [
      {
        query: "low ctr keyword",
        page: "https://example.com/guide",
        clicks: 50,
        impressions: 200,
        ctr: 0.25,
        position: 5,
      },
    ],
    minClickDropPercent: 50,
    minPreviousImpressions: 40,
    minCurrentImpressions: 20,
  });
  // Create a mild decline that fails the 50% bar
  const mildDecline = runIntelligence("content_decay", {
    rows: [
      {
        query: "mild",
        page: "https://example.com/mild",
        clicks: 45,
        impressions: 200,
        ctr: 0.225,
        position: 5,
      },
    ],
    previousRows: [
      {
        query: "mild",
        page: "https://example.com/mild",
        clicks: 50,
        impressions: 200,
        ctr: 0.25,
        position: 5,
      },
    ],
    minClickDropPercent: 50,
    minPositionWorsening: 5,
    minPreviousImpressions: 40,
    minCurrentImpressions: 20,
  });
  assert.equal(mildDecline.data.count, 0);
  assert.ok(decayStrictDrop.data.count >= 0); // 100% drop still qualifies at 50%

  // --- Cannibalization filters ---
  const cannibal = runIntelligence("keyword_cannibalization", {
    rows: SAMPLE_ROWS,
    minPages: 2,
    minImpressions: 100,
  });
  assert.equal(cannibal.ok, true);
  assert.ok(cannibal.data.count >= 1);
  for (const row of cannibal.data.opportunities) {
    assert.ok(row.metrics.page_count >= 2);
    assert.ok(row.metrics.impressions >= 100);
    assert.equal(row.opportunity_type, OPPORTUNITY_TYPES.KEYWORD_CONFLICT);
  }

  const cannibalEmpty = runIntelligence("keyword_cannibalization", {
    rows: SAMPLE_ROWS,
    minPages: 5,
  });
  assert.equal(cannibalEmpty.data.count, 0);

  // --- Node-data extraction + processUpstream ---
  const extracted = extractFiltersFromNodeData("ranking_opportunities", {
    rankingMinImpressions: 40,
    minPosition: 5,
    rankingMaxPosition: 15,
    rankingLimit: 3,
  });
  assert.equal(extracted.minImpressions, 40);
  assert.equal(extracted.maxPosition, 15);
  assert.equal(extracted.limit, 3);

  const processed = processUpstreamItems({
    capability: "ctr_opportunities",
    inputItems: SAMPLE_ROWS.map((json) => ({ json })),
    nodeData: {
      capability: "ctr_opportunities",
      minImpressions: 50,
      maxPosition: 20,
      minScore: 0,
      limit: 2,
    },
    sourceMeta: {
      property: "https://example.com/",
      period: { start: "2026-01-01", end: "2026-01-31" },
    },
  });
  assert.equal(processed.ok, true);
  assert.ok(processed.items.length <= 2);
  assert.equal(processed.output.filters.limit, 2);
  assert.equal(
    processed.items[0].json.opportunity_type,
    OPPORTUNITY_TYPES.CTR
  );

  // Invalid via processor
  const bad = processUpstreamItems({
    capability: "ctr_opportunities",
    inputItems: SAMPLE_ROWS.map((json) => ({ json })),
    filters: { maxPosition: -1 },
    sourceMeta: { property: "https://example.com/" },
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "MCP_VALIDATION");

  console.log("gsc-mcp smoke-intelligence-filters OK");
};

main();
