/**
 * Content Decay regression — prior vs current only (no snapshot).
 * Does not touch OAuth / native GSC / CTR scoring.
 */
const assert = require("assert");
const { runIntelligence } = require("../intelligence");
const {
  validateIntelligenceOutput,
  scoreContentDecay,
  scoreCtrOpportunity,
  scoreRankingOpportunity,
  OPPORTUNITY_TYPES,
} = require("../contracts/intelligenceOutput");
const { FILTER_DEFAULTS } = require("../contracts/intelligenceFilters");
const { processUpstreamItems } = require("../index");

const PROPERTY = "https://example.com/";

const strongCurrent = [
  {
    query: "decay candidate",
    page: "https://example.com/decay",
    clicks: 8,
    impressions: 480,
    ctr: 8 / 480,
    position: 14,
  },
];
const strongPrevious = [
  {
    query: "decay candidate",
    page: "https://example.com/decay",
    clicks: 20,
    impressions: 500,
    ctr: 20 / 500,
    position: 8,
  },
];

const main = () => {
  assert.equal(FILTER_DEFAULTS.content_decay.comparisonPeriod, "prior_period");
  assert.ok(!("snapshot" in { [FILTER_DEFAULTS.content_decay.comparisonPeriod]: 1 } && FILTER_DEFAULTS.content_decay.comparisonPeriod === "snapshot"));

  // A. strong click decline + ranking decline => content_decay
  const strong = runIntelligence("content_decay", {
    rows: strongCurrent,
    previousRows: strongPrevious,
    minPreviousImpressions: 50,
    minCurrentImpressions: 20,
    minClickDropPercent: 20,
    minPositionWorsening: 1,
  });
  assert.equal(strong.ok, true, strong.error?.message);
  assert.ok(validateIntelligenceOutput(strong.data, "content_decay").ok);
  assert.equal(strong.data.count, 1);
  const hit = strong.data.opportunities[0];
  assert.equal(hit.opportunity_type, OPPORTUNITY_TYPES.CONTENT_DECAY);
  assert.equal(hit.metrics.previous_clicks, 20);
  assert.equal(hit.metrics.current_clicks, 8);
  assert.equal(hit.metrics.click_change, -12);
  assert.ok(hit.metrics.click_change_percent <= -20);
  assert.equal(hit.metrics.previous_position, 8);
  assert.equal(hit.metrics.current_position, 14);
  assert.equal(hit.metrics.position_change, 6);
  assert.ok(hit.score_breakdown.formula.includes("click_drop_score"));
  assert.ok(/decreased from 20 to 8|worsened from 8/i.test(hit.reason));
  assert.ok(!/stale|outdated|intent mismatch/i.test(hit.reason));

  // B. click decline but insufficient impressions => no opportunity
  const lowImp = runIntelligence("content_decay", {
    rows: [
      {
        query: "tiny",
        clicks: 1,
        impressions: 5,
        ctr: 0.2,
        position: 20,
      },
    ],
    previousRows: [
      {
        query: "tiny",
        clicks: 5,
        impressions: 10,
        ctr: 0.5,
        position: 10,
      },
    ],
    minPreviousImpressions: 50,
    minCurrentImpressions: 20,
  });
  assert.equal(lowImp.ok, true);
  assert.equal(lowImp.data.count, 0);

  // C. zero clicks in both periods => not automatically decay
  const zeroBoth = runIntelligence("content_decay", {
    rows: [
      {
        query: "zero",
        clicks: 0,
        impressions: 12,
        ctr: 0,
        position: 65,
      },
    ],
    previousRows: [
      {
        query: "zero",
        clicks: 0,
        impressions: 10,
        ctr: 0,
        position: 70,
      },
    ],
    minPreviousImpressions: 5,
    minCurrentImpressions: 5,
    minClickDropPercent: 20,
    minPositionWorsening: 1,
  });
  // Position improved 70→65 — not decay
  assert.equal(zeroBoth.data.count, 0);

  // D. single-period input => MCP_VALIDATION
  const single = runIntelligence("content_decay", {
    rows: strongCurrent,
  });
  assert.equal(single.ok, false);
  assert.equal(single.error.code, "MCP_VALIDATION");
  assert.match(single.error.message, /previous-period|snapshot cannot establish/i);

  // E. missing previousRows => MCP_VALIDATION
  const noPrev = runIntelligence("content_decay", {
    rows: strongCurrent,
    previousRows: [],
  });
  assert.equal(noPrev.ok, false);
  assert.equal(noPrev.error.code, "MCP_VALIDATION");

  // F. missing currentRows => MCP_VALIDATION
  const noCur = runIntelligence("content_decay", {
    rows: [],
    previousRows: strongPrevious,
  });
  assert.equal(noCur.ok, false);
  assert.equal(noCur.error.code, "MCP_VALIDATION");

  // Explicit snapshot rejected
  const snap = runIntelligence("content_decay", {
    rows: strongCurrent,
    previousRows: strongPrevious,
    comparisonPeriod: "snapshot",
  });
  assert.equal(snap.ok, false);
  assert.equal(snap.error.code, "MCP_VALIDATION");

  // G. unchanged performance => no decay
  const flat = runIntelligence("content_decay", {
    rows: [
      {
        query: "stable",
        clicks: 20,
        impressions: 500,
        ctr: 0.04,
        position: 8,
      },
    ],
    previousRows: [
      {
        query: "stable",
        clicks: 20,
        impressions: 500,
        ctr: 0.04,
        position: 8,
      },
    ],
  });
  assert.equal(flat.data.count, 0);

  // H. ranking improvement => no decay (even if clicks flat)
  const improved = runIntelligence("content_decay", {
    rows: [
      {
        query: "climb",
        clicks: 20,
        impressions: 500,
        ctr: 0.04,
        position: 5,
      },
    ],
    previousRows: [
      {
        query: "climb",
        clicks: 20,
        impressions: 500,
        ctr: 0.04,
        position: 12,
      },
    ],
    minClickDropPercent: 20,
    minPositionWorsening: 1,
  });
  assert.equal(improved.data.count, 0);

  // I/J schema + score_breakdown already checked on strong

  // K. filter thresholds — need 50% click drop
  const mild = runIntelligence("content_decay", {
    rows: [
      {
        query: "mild",
        clicks: 45,
        impressions: 200,
        ctr: 0.225,
        position: 5,
      },
    ],
    previousRows: [
      {
        query: "mild",
        clicks: 50,
        impressions: 200,
        ctr: 0.25,
        position: 5,
      },
    ],
    minPreviousImpressions: 50,
    minCurrentImpressions: 20,
    minClickDropPercent: 50,
    minPositionWorsening: 5,
  });
  assert.equal(mild.data.count, 0);

  // L. limit
  const multiPrev = [
    {
      query: "a",
      clicks: 100,
      impressions: 1000,
      ctr: 0.1,
      position: 5,
    },
    {
      query: "b",
      clicks: 80,
      impressions: 800,
      ctr: 0.1,
      position: 6,
    },
    {
      query: "c",
      clicks: 60,
      impressions: 600,
      ctr: 0.1,
      position: 4,
    },
  ];
  const multiCur = [
    {
      query: "a",
      clicks: 40,
      impressions: 900,
      ctr: 0.044,
      position: 12,
    },
    {
      query: "b",
      clicks: 30,
      impressions: 700,
      ctr: 0.043,
      position: 14,
    },
    {
      query: "c",
      clicks: 20,
      impressions: 500,
      ctr: 0.04,
      position: 11,
    },
  ];
  const limited = runIntelligence("content_decay", {
    rows: multiCur,
    previousRows: multiPrev,
    minClickDropPercent: 10,
    minPositionWorsening: 1,
    limit: 2,
  });
  assert.equal(limited.ok, true);
  assert.equal(limited.data.count, 2);

  // currentRows alias
  const alias = runIntelligence("content_decay", {
    currentRows: strongCurrent,
    previousRows: strongPrevious,
  });
  assert.equal(alias.ok, true);
  assert.equal(alias.data.count, 1);

  // M. CTR / Ranking regression
  const ctr = runIntelligence("ctr_opportunities", {
    rows: [
      {
        query: "ctr q",
        clicks: 0,
        impressions: 200,
        ctr: 0,
        position: 8,
      },
    ],
  });
  assert.equal(ctr.ok, true);
  assert.ok(ctr.data.count >= 1);
  assert.equal(
    scoreCtrOpportunity({
      impressions: 132,
      clicks: 0,
      ctr: 0,
      position: 7.9,
    }).score_breakdown.formula,
    "missedClicks * positionWeight"
  );
  assert.equal(
    scoreRankingOpportunity({ impressions: 300, position: 7 }).score,
    Math.round(300 / 7)
  );
  const decayScore = scoreContentDecay({
    clickDrop: 12,
    positionDelta: 6,
    clickDropPercent: 60,
  });
  assert.equal(decayScore.score, Math.round(12 + 6 * 10));
  assert.equal(
    decayScore.score_breakdown.formula,
    "click_drop_score + position_drop_score"
  );

  // Processor path: missing previousRows fails
  const proc = processUpstreamItems({
    capability: "content_decay",
    inputItems: strongCurrent.map((json) => ({ json })),
    sourceMeta: { property: PROPERTY, period: { start: "2026-01-01", end: "2026-01-31" } },
  });
  assert.equal(proc.ok, false);
  assert.equal(proc.error.code, "MCP_VALIDATION");

  const procOk = processUpstreamItems({
    capability: "content_decay",
    inputItems: strongCurrent.map((json) => ({ json })),
    previousRows: strongPrevious,
    sourceMeta: { property: PROPERTY, period: { start: "2026-01-01", end: "2026-01-31" } },
  });
  assert.equal(procOk.ok, true);
  assert.ok(procOk.intelligenceContext.capabilities[0].results.length >= 1);

  console.log("gsc-mcp smoke-content-decay OK");
};

main();
