/**
 * Smoke: tool execution + intelligence + upstream processor (mock).
 */
const assert = require("assert");
const { createPlugin, processUpstreamItems } = require("../index");

const main = async () => {
  const plugin = createPlugin({ transport: "mock" });

  const caps = await plugin.executeCapability(
    "get_capabilities",
    {},
    { accessToken: "mock-token" }
  );
  assert.equal(caps.ok, true);
  assert.ok(Array.isArray(caps.data?.labels));

  const analytics = await plugin.callTool(
    "get_search_analytics",
    { siteUrl: "https://example.com/", rowLimit: 10 },
    { accessToken: "mock-token" }
  );
  assert.equal(analytics.ok, true);
  assert.ok(Array.isArray(analytics.data?.rows));

  const rows = analytics.data.rows.map((r) => ({
    query: r.keys?.[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  }));

  const ctr = plugin.runIntelligence("ctr_opportunities", { rows });
  assert.equal(ctr.ok, true);

  const ranking = plugin.runIntelligence("ranking_opportunities", { rows });
  assert.equal(ranking.ok, true);

  const decay = plugin.runIntelligence("content_decay", {
    rows,
    previousRows: rows.map((r) => ({
      ...r,
      clicks: (r.clicks || 0) + 10,
      position: Math.max(1, (r.position || 10) - 3),
    })),
  });
  assert.equal(decay.ok, true);

  const sheet = plugin.runAction("prepare_sheet_rows", {
    rows: ctr.data.opportunities,
    title: "CTR opportunities",
    siteUrl: "https://example.com/",
  });
  assert.equal(sheet.ok, true);
  assert.equal(sheet.data.handoff, "googleSheets");

  const email = plugin.runAction("prepare_email_digest", {
    rows: ctr.data.opportunities,
    title: "Weekly SEO",
  });
  assert.equal(email.data.handoff, "gmail");

  // Main-flow processor: WorkflowItems shaped like googleSearchConsole output
  const inputItems = [
    {
      json: {
        query: "low ctr keyword",
        clicks: 10,
        impressions: 500,
        ctr: 0.02,
        position: 8,
      },
    },
    {
      json: {
        query: "another opportunity",
        clicks: 5,
        impressions: 200,
        ctr: 0.025,
        position: 12,
      },
    },
  ];
  const processed = processUpstreamItems({
    capability: "ctr_opportunities",
    inputItems,
    sourceMeta: {
      property: "https://example.com/",
      period: { start: "2026-01-01", end: "2026-01-31" },
    },
  });
  assert.equal(processed.ok, true);
  assert.ok(processed.items.length >= 1);

  const missing = processUpstreamItems({
    capability: "ctr_opportunities",
    inputItems: [],
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "MCP_UPSTREAM_REQUIRED");

  console.log("gsc-mcp smoke-tools OK");
  await plugin.close();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
