/**
 * Regression: multi-capability GSC MCP Tools must EXECUTE every selected capability.
 * Run via: npm run test:gsc-mcp (backend)
 */
const assert = require("node:assert/strict");
const {
  processUpstreamItems,
  normalizeCapabilities,
} = require("../adapters/processUpstream");
const {
  OPPORTUNITY_TYPES,
  CAPABILITY_OPPORTUNITY_TYPE,
} = require("../contracts/intelligenceOutput");

const PROPERTY = "https://example.com/";
const PERIOD = { start: "2026-08-01", end: "2026-08-31" };

const baseRow = (overrides = {}) => ({
  query: "ai visibility checker",
  page: "https://example.com/a",
  impressions: 197,
  clicks: 0,
  ctr: 0,
  position: 8.2,
  siteUrl: PROPERTY,
  property: PROPERTY,
  startDate: PERIOD.start,
  endDate: PERIOD.end,
  ...overrides,
});

const SAMPLE_ROWS = [
  baseRow(),
  baseRow({
    query: "deep rank query",
    page: "https://example.com/b",
    impressions: 400,
    clicks: 5,
    ctr: 0.0125,
    position: 12.4,
  }),
];

const PREVIOUS_DECAY = [
  baseRow({
    query: "decay query",
    page: "https://example.com/decay",
    impressions: 200,
    clicks: 40,
    ctr: 0.2,
    position: 5,
  }),
];

const CURRENT_DECAY = [
  baseRow({
    query: "decay query",
    page: "https://example.com/decay",
    impressions: 180,
    clicks: 10,
    ctr: 0.055,
    position: 9,
  }),
];

const asItems = (rows) => rows.map((json) => ({ json }));

const countByCapability = (result) => {
  const map = {};
  for (const it of result.items || []) {
    const row = it.json || {};
    if (!row.opportunity_type) continue;
    const cap = String(row.capability || "");
    map[cap] = (map[cap] || 0) + 1;
  }
  return map;
};

const run = (capability, opts = {}) => {
  const caps = Array.isArray(capability) ? capability : [capability];
  return processUpstreamItems({
    capability: opts.useCapabilitiesField ? undefined : capability,
    capabilities: opts.useCapabilitiesField ? caps : opts.capabilities,
    inputItems: asItems(opts.rows || SAMPLE_ROWS),
    previousRows: opts.previousRows,
    nodeData: {
      capability: opts.useCapabilitiesField ? caps[0] : capability,
      capabilities: caps,
      minImpressions: 10,
      rankingMinImpressions: 10,
      minPosition: 5,
      rankingMaxPosition: 20,
      maxPosition: 20,
      minScore: 0,
      limit: 50,
      rankingLimit: 50,
      minPreviousImpressions: 40,
      minCurrentImpressions: 10,
      minClickDropPercent: 10,
      minPositionWorsening: 1,
      decayLimit: 50,
      ...(opts.nodeData || {}),
    },
    sourceMeta: { property: PROPERTY, period: PERIOD },
  });
};

const assertIdentity = (item, capability) => {
  const expectedType = CAPABILITY_OPPORTUNITY_TYPE[capability];
  assert.equal(item.json.capability, capability);
  assert.equal(item.json.opportunity_type, expectedType);
};

const main = () => {
  // Parsing must never collapse to first-only
  assert.deepEqual(
    normalizeCapabilities(["ctr_opportunities", "ranking_opportunities"]),
    ["ctr_opportunities", "ranking_opportunities"]
  );
  assert.deepEqual(
    normalizeCapabilities('["ctr_opportunities","ranking_opportunities"]'),
    ["ctr_opportunities", "ranking_opportunities"]
  );
  assert.deepEqual(
    normalizeCapabilities("ctr_opportunities", [
      "ctr_opportunities",
      "ranking_opportunities",
      "content_decay",
    ]),
    ["ctr_opportunities", "ranking_opportunities", "content_decay"]
  );

  // 1. Single CTR
  const ctrOnly = run("ctr_opportunities");
  assert.equal(ctrOnly.ok, true, ctrOnly.error?.message);
  const ctrCounts = countByCapability(ctrOnly);
  assert.ok((ctrCounts.ctr_opportunities || 0) > 0);
  assert.equal(ctrCounts.ranking_opportunities, undefined);

  // 2. Single Ranking
  const rankOnly = run("ranking_opportunities");
  assert.equal(rankOnly.ok, true, rankOnly.error?.message);
  assert.ok((countByCapability(rankOnly).ranking_opportunities || 0) > 0);

  // 3. Single Content Decay
  const decayOnly = run("content_decay", {
    rows: CURRENT_DECAY,
    previousRows: PREVIOUS_DECAY,
  });
  assert.equal(decayOnly.ok, true, decayOnly.error?.message);
  assert.ok((countByCapability(decayOnly).content_decay || 0) > 0);

  // 4. CTR + Ranking — BOTH must execute and return rows
  const ctrRank = run(["ctr_opportunities", "ranking_opportunities"]);
  assert.equal(ctrRank.ok, true, ctrRank.error?.message);
  assert.deepEqual(ctrRank.output.executed, [
    "ctr_opportunities",
    "ranking_opportunities",
  ]);
  const cr = countByCapability(ctrRank);
  assert.ok((cr.ctr_opportunities || 0) > 0, "CTR+Ranking must include CTR rows");
  assert.ok(
    (cr.ranking_opportunities || 0) > 0,
    "CTR+Ranking must include Ranking rows"
  );

  // 5. CTR + Content Decay
  const ctrDecay = run(["ctr_opportunities", "content_decay"], {
    rows: [...SAMPLE_ROWS, ...CURRENT_DECAY],
    previousRows: PREVIOUS_DECAY,
  });
  assert.equal(ctrDecay.ok, true, ctrDecay.error?.message);
  const cd = countByCapability(ctrDecay);
  assert.ok((cd.ctr_opportunities || 0) > 0);
  assert.ok((cd.content_decay || 0) > 0);

  // 6. Ranking + Content Decay
  const rankDecay = run(["ranking_opportunities", "content_decay"], {
    rows: [...SAMPLE_ROWS, ...CURRENT_DECAY],
    previousRows: PREVIOUS_DECAY,
  });
  assert.equal(rankDecay.ok, true, rankDecay.error?.message);
  const rd = countByCapability(rankDecay);
  assert.ok((rd.ranking_opportunities || 0) > 0);
  assert.ok((rd.content_decay || 0) > 0);

  // 7. CTR + Ranking + Content Decay — all three execute
  const tripleCaps = [
    "ctr_opportunities",
    "ranking_opportunities",
    "content_decay",
  ];
  const triple = run(tripleCaps, {
    rows: [...SAMPLE_ROWS, ...CURRENT_DECAY],
    previousRows: PREVIOUS_DECAY,
  });
  assert.equal(triple.ok, true, triple.error?.message);
  assert.equal(triple.output.capabilities.length, 3);
  assert.deepEqual(triple.output.executed, tripleCaps);
  const tr = countByCapability(triple);
  assert.ok((tr.ctr_opportunities || 0) > 0, "triple: CTR missing");
  assert.ok((tr.ranking_opportunities || 0) > 0, "triple: Ranking missing");
  assert.ok((tr.content_decay || 0) > 0, "triple: Decay missing");
  for (const it of triple.items) {
    if (!it.json?.opportunity_type) continue;
    assertIdentity(it, it.json.capability);
  }

  // Canonical capabilities[] field (frontend multi-select)
  const viaCapabilitiesField = run(tripleCaps, {
    useCapabilitiesField: true,
    rows: [...SAMPLE_ROWS, ...CURRENT_DECAY],
    previousRows: PREVIOUS_DECAY,
  });
  assert.equal(viaCapabilitiesField.ok, true);
  assert.deepEqual(viaCapabilitiesField.output.executed, tripleCaps);
  const viaCounts = countByCapability(viaCapabilitiesField);
  assert.ok((viaCounts.ctr_opportunities || 0) > 0);
  assert.ok((viaCounts.ranking_opportunities || 0) > 0);
  assert.ok((viaCounts.content_decay || 0) > 0);

  // 8. First capability returns zero — others still execute
  const firstZero = run(["ctr_opportunities", "ranking_opportunities"], {
    rows: [
      baseRow({
        query: "rankable",
        impressions: 300,
        clicks: 20,
        ctr: 0.066,
        position: 8,
      }),
    ],
    nodeData: {
      // Absurd CTR floor → zero CTR; Ranking still qualifies
      minImpressions: 100000,
      rankingMinImpressions: 10,
      minPosition: 5,
      rankingMaxPosition: 20,
      maxPosition: 20,
      limit: 50,
      rankingLimit: 50,
    },
  });
  assert.equal(firstZero.ok, true, firstZero.error?.message);
  assert.deepEqual(firstZero.output.executed, [
    "ctr_opportunities",
    "ranking_opportunities",
  ]);
  const fz = countByCapability(firstZero);
  assert.equal(fz.ctr_opportunities, undefined);
  assert.ok((fz.ranking_opportunities || 0) > 0);

  // 9. Middle capability returns zero
  const middleZero = run(
    ["ctr_opportunities", "ranking_opportunities", "content_decay"],
    {
      rows: [...SAMPLE_ROWS, ...CURRENT_DECAY],
      previousRows: PREVIOUS_DECAY,
      nodeData: {
        minImpressions: 10,
        rankingMinImpressions: 100000, // Ranking → 0
        minPosition: 5,
        rankingMaxPosition: 20,
        maxPosition: 20,
        limit: 50,
        rankingLimit: 50,
        minPreviousImpressions: 40,
        minCurrentImpressions: 10,
        minClickDropPercent: 10,
        minPositionWorsening: 1,
      },
    }
  );
  assert.equal(middleZero.ok, true);
  assert.equal(middleZero.output.executed.length, 3);
  const mz = countByCapability(middleZero);
  assert.ok((mz.ctr_opportunities || 0) > 0);
  assert.equal(mz.ranking_opportunities, undefined);
  assert.ok((mz.content_decay || 0) > 0);

  // 10. Last capability returns zero / soft-fails — earlier results kept
  const lastFails = run(
    ["ctr_opportunities", "ranking_opportunities", "content_decay"],
    {
      rows: SAMPLE_ROWS,
      // No previousRows → content_decay fails, but CTR+Ranking must remain
      previousRows: undefined,
    }
  );
  assert.equal(lastFails.ok, true, lastFails.error?.message);
  assert.deepEqual(lastFails.output.executed, [
    "ctr_opportunities",
    "ranking_opportunities",
  ]);
  assert.ok(
    (lastFails.output.failures || []).some(
      (f) => f.capability === "content_decay"
    )
  );
  const lf = countByCapability(lastFails);
  assert.ok((lf.ctr_opportunities || 0) > 0);
  assert.ok((lf.ranking_opportunities || 0) > 0);
  assert.equal(lf.content_decay, undefined);

  // 11. Identity on every opportunity row
  for (const it of [...ctrRank.items, ...triple.items]) {
    if (!it.json?.opportunity_type) continue;
    assertIdentity(it, it.json.capability);
  }

  // 12. Filter isolation — Ranking must not inherit CTR-only absurd floor
  //     when dedicated rankingMinImpressions is set.
  const isolated = run(["ctr_opportunities", "ranking_opportunities"], {
    nodeData: {
      minImpressions: 100000, // would zero CTR
      rankingMinImpressions: 10, // Ranking must still run
      minPosition: 5,
      rankingMaxPosition: 20,
      maxPosition: 20,
      limit: 50,
      rankingLimit: 50,
    },
  });
  assert.equal(isolated.ok, true);
  const iso = countByCapability(isolated);
  assert.equal(iso.ctr_opportunities, undefined);
  assert.ok((iso.ranking_opportunities || 0) > 0);

  // 13. Legacy single-string capability still works
  const legacy = processUpstreamItems({
    capability: "ctr_opportunities",
    inputItems: asItems(SAMPLE_ROWS),
    nodeData: { capability: "ctr_opportunities", minImpressions: 10 },
    sourceMeta: { property: PROPERTY, period: PERIOD },
  });
  assert.equal(legacy.ok, true);
  assert.ok((countByCapability(legacy).ctr_opportunities || 0) > 0);

  // Empty upstream
  const empty = processUpstreamItems({
    capability: ["ctr_opportunities", "ranking_opportunities"],
    inputItems: [],
    sourceMeta: { property: PROPERTY, period: PERIOD },
  });
  assert.equal(empty.ok, false);
  assert.equal(empty.error.code, "MCP_UPSTREAM_REQUIRED");

  // Empty-string filter values must not collapse multi-cap to Ranking-only
  // (UI clears number fields to "" → Number("") === 0 previously failed CTR).
  const emptyStringFilters = processUpstreamItems({
    capability: ["ctr_opportunities", "ranking_opportunities"],
    capabilities: ["ctr_opportunities", "ranking_opportunities"],
    inputItems: asItems(SAMPLE_ROWS),
    nodeData: {
      capability: ["ctr_opportunities", "ranking_opportunities"],
      capabilities: ["ctr_opportunities", "ranking_opportunities"],
      minImpressions: 0,
      maxPosition: "",
      minScore: "",
      limit: 10,
      rankingMinImpressions: "",
      minPosition: "",
      rankingMaxPosition: "",
      rankingLimit: "",
    },
    sourceMeta: { property: PROPERTY, period: PERIOD },
  });
  assert.equal(emptyStringFilters.ok, true, emptyStringFilters.error?.message);
  assert.deepEqual(emptyStringFilters.output.executed, [
    "ctr_opportunities",
    "ranking_opportunities",
  ]);
  const esf = countByCapability(emptyStringFilters);
  assert.ok(
    (esf.ctr_opportunities || 0) > 0,
    "empty maxPosition must not drop CTR"
  );
  assert.ok((esf.ranking_opportunities || 0) > 0);

  console.log("gsc-mcp smoke-multi-capability OK");
};

main();
