/**
 * Runtime regression: GSC MCP Tools via the SAME path as "Run step"
 * (handlers.gscMcpTool → mcpPluginHost → processUpstreamItems).
 *
 * Reproduces the UI bug: CTR + Ranking selected, empty Max position (""),
 * which used to make Number("") === 0 fail CTR validation so only Ranking ran.
 */
const assert = require("node:assert/strict");
const { handlers } = require("../../../../backend/services/workflowNodes.service");

const PROPERTY = "https://example.com/";

const rows = Array.from({ length: 20 }, (_, i) => ({
  json: {
    query: `query-${i}`,
    page: `https://example.com/p${i}`,
    impressions: 100 + i * 10,
    clicks: i % 3 === 0 ? 0 : 2,
    ctr: i % 3 === 0 ? 0 : 0.02,
    position: 5 + (i % 12),
    siteUrl: PROPERTY,
    property: PROPERTY,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
  },
}));

const countByCapability = (items) => {
  const map = {};
  for (const it of items || []) {
    const row = it.json || {};
    if (!row.opportunity_type) continue;
    const cap = String(row.capability || "");
    map[cap] = (map[cap] || 0) + 1;
  }
  return map;
};

const main = async () => {
  // Exact shape from the UI when CTR Max position / Min score were left blank.
  const nodeData = {
    label: "GSC MCP Tools",
    capability: ["ctr_opportunities", "ranking_opportunities"],
    capabilities: ["ctr_opportunities", "ranking_opportunities"],
    minImpressions: 0,
    maxPosition: "", // <-- previously Number("") === 0 → CTR validation failed
    minScore: "",
    limit: 10,
    rankingMinImpressions: "",
    minPosition: "",
    rankingMaxPosition: "",
    rankingLimit: "",
  };

  const result = await handlers.gscMcpTool(
    { id: "gsc-tools-1", type: "gscMcpTool", data: nodeData },
    { inputItems: rows, steps: {}, input: {} }
  );

  assert.equal(result.ok !== false, true);
  assert.ok(Array.isArray(result.items));
  assert.ok(result.output?.runtimeDiagnostics);

  const diag = result.output.runtimeDiagnostics;
  assert.deepEqual(diag.selectedCapabilities, [
    "ctr_opportunities",
    "ranking_opportunities",
  ]);
  assert.deepEqual(diag.executed, [
    "ctr_opportunities",
    "ranking_opportunities",
  ]);

  const counts = countByCapability(result.items);
  assert.ok(
    (counts.ctr_opportunities || 0) > 0,
    `CTR rows missing. counts=${JSON.stringify(counts)} diag=${JSON.stringify(diag.perCapability)}`
  );
  assert.ok(
    (counts.ranking_opportunities || 0) > 0,
    `Ranking rows missing. counts=${JSON.stringify(counts)}`
  );

  for (const it of result.items) {
    const row = it.json || {};
    if (!row.opportunity_type) continue;
    if (row.capability === "ctr_opportunities") {
      assert.equal(row.opportunity_type, "ctr_opportunity");
    } else if (row.capability === "ranking_opportunities") {
      assert.equal(row.opportunity_type, "ranking_opportunity");
    } else {
      assert.fail(`unexpected capability ${row.capability}`);
    }
  }

  // Triple including Content Decay (soft-fail without previousRows must keep CTR+Ranking)
  const triple = await handlers.gscMcpTool(
    {
      id: "gsc-tools-2",
      type: "gscMcpTool",
      data: {
        ...nodeData,
        capability: [
          "ctr_opportunities",
          "ranking_opportunities",
          "content_decay",
        ],
        capabilities: [
          "ctr_opportunities",
          "ranking_opportunities",
          "content_decay",
        ],
      },
    },
    { inputItems: rows, steps: {}, input: {} }
  );
  assert.ok(triple.output?.executed?.includes("ctr_opportunities"));
  assert.ok(triple.output?.executed?.includes("ranking_opportunities"));
  const tripleCounts = countByCapability(triple.items);
  assert.ok((tripleCounts.ctr_opportunities || 0) > 0);
  assert.ok((tripleCounts.ranking_opportunities || 0) > 0);

  console.log("gsc-mcp smoke-runtime-multi-capability OK", {
    ctr: counts.ctr_opportunities,
    ranking: counts.ranking_opportunities,
    total: result.items.length,
  });
};

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
