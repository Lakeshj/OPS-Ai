/**
 * Runtime regression: googleAnalytics → ga4McpTool WorkflowItem handoff.
 *
 * Reproduces the editor-cache bug where GA4 rows lived only on
 * `output.items` while runtime collected from `context.items` only —
 * preview showed rows, MCP got zero (GA4_UPSTREAM_REQUIRED).
 */
const assert = require("node:assert/strict");
const {
  executePartial,
} = require("../../../../backend/services/workflowEngine.service");

const ga4Items = [
  {
    json: {
      pagePath: "/a",
      sessions: 100,
      engagementRate: 0.2,
      bounceRate: 0.5,
      averageSessionDuration: 30,
    },
  },
  {
    json: {
      pagePath: "/b",
      sessions: 50,
      engagementRate: 0.1,
      bounceRate: 0.8,
      averageSessionDuration: 10,
    },
  },
];

const definition = {
  version: 1,
  nodes: [
    { id: "t", type: "trigger", data: { label: "Manual" } },
    {
      id: "ga4",
      type: "googleAnalytics",
      data: { label: "GA4", credentialId: "c1", propertyId: "1" },
    },
    {
      id: "mcp",
      type: "ga4McpTool",
      data: {
        label: "MCP",
        capabilities: ["engagement_opportunities"],
      },
    },
  ],
  edges: [
    {
      id: "e1",
      source: "t",
      target: "ga4",
      sourceHandle: "main",
      targetHandle: "main",
    },
    {
      id: "e2",
      source: "ga4",
      target: "mcp",
      sourceHandle: "main",
      targetHandle: "main",
    },
  ],
};

const runMcpWithSession = async (ga4Cache) => {
  const partial = await executePartial({
    definition,
    input: {},
    targetNodeId: "mcp",
    mode: "step",
    session: {
      nodeResults: {
        t: {
          status: "succeeded",
          output: { triggered: true },
          items: [{ json: { source: "manual" } }],
          cacheState: "clean",
        },
        ga4: {
          status: "succeeded",
          cacheState: "clean",
          ...ga4Cache,
        },
      },
      dirtyNodes: {},
    },
  });
  return partial;
};

const main = async () => {
  // Nested-only: production / seed shape that previously lost rows at runtime
  const nested = await runMcpWithSession({
    output: {
      propertyId: "properties/1",
      rowCount: 2,
      items: ga4Items,
    },
  });
  assert.equal(nested.results.mcp?.status, "succeeded");
  assert.equal(nested.inputItems?.length, 2);
  assert.equal(nested.results.mcp?.output?.itemsIn, 2);
  assert.ok((nested.results.mcp?.items?.length || 0) > 0);
  assert.equal(
    nested.results.mcp?.output?.runtimeDiagnostics?.handoff?.inputItemCount,
    2
  );

  // Top-level items still work
  const top = await runMcpWithSession({
    output: { propertyId: "properties/1", rowCount: 2 },
    items: ga4Items,
  });
  assert.equal(top.results.mcp?.status, "succeeded");
  assert.equal(top.inputItems?.length, 2);
  assert.equal(top.results.mcp?.output?.itemsIn, 2);

  // Empty upstream still fails with GA4_UPSTREAM_REQUIRED (do not mask)
  const empty = await runMcpWithSession({
    output: { propertyId: "properties/1", rowCount: 0 },
    items: [],
  });
  assert.equal(empty.results.mcp?.status, "failed");
  assert.match(
    String(empty.results.mcp?.error || ""),
    /no usable upstream rows/i
  );
  assert.equal(empty.inputItems?.length ?? 0, 0);

  console.log("ga4-mcp smoke-runtime-handoff OK", {
    nestedIn: nested.inputItems.length,
    nestedOut: nested.results.mcp.items.length,
    topIn: top.inputItems.length,
    emptyStatus: empty.results.mcp.status,
  });
};

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
