/**
 * AI dataset scope + Google Ads October campaign_performance aggregation.
 * AI-DATASET-1..13
 */
const assert = require("node:assert/strict");

const {
  resolveAgentContextScope,
  executeAiAgent,
  RUNTIME_DATA_MARKER,
} = require("../services/workflowAiAgent.service");
const {
  aggregateGoogleAdsPerformanceForAi,
  applyGoogleAdsAiGrounding,
  formatGoogleAdsReport,
} = require("../services/workflowGoogleAdsAiGrounding");
const { executeGraphInMemory } = require("../services/workflowEngine.service");
const {
  resolveAuxiliaryBindings,
  getExecutionEdges,
} = require("../services/workflowConnection.service");
const { resolveAgentResources } = require("../services/workflowAiResources.service");
const { interpolate, resolveExpression } = require("../services/workflowNodes.service");

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

/** October 2026 fixture: daily rows that period-sum to console-verified totals. */
const OCTOBER_CAMPAIGNS = [
  {
    campaignId: "24221515828",
    campaignName: "SC_PWC_BrandedCore_Search_01/09/26",
    days: [
      { date: "2026-10-01", cost: 30000, impressions: 10000, clicks: 400, conversions: 10 },
      { date: "2026-10-15", cost: 15000, impressions: 8000, clicks: 300, conversions: 10 },
      { date: "2026-10-31", cost: 8179.02, impressions: 3897, clicks: 121, conversions: 11 },
    ],
    expect: {
      spend: 53179.02,
      impressions: 21897,
      clicks: 821,
      conversions: 31,
      ctr: 821 / 21897,
      cpc: 53179.02 / 821,
    },
  },
  {
    campaignId: "24216276470",
    campaignName: "Campaign_24216276470",
    days: [
      { date: "2026-10-02", cost: 20000, impressions: 2000, clicks: 100, conversions: 2 },
      { date: "2026-10-20", cost: 14187.43, impressions: 2353, clicks: 149, conversions: 4 },
    ],
    expect: {
      spend: 34187.43,
      impressions: 4353,
      clicks: 249,
      conversions: 6,
      ctr: 249 / 4353,
      cpc: 34187.43 / 249,
    },
  },
  {
    campaignId: "24388582529",
    campaignName: "Campaign_24388582529",
    days: [
      { date: "2026-10-03", cost: 8000, impressions: 1200, clicks: 80, conversions: 5 },
      { date: "2026-10-21", cost: 5686.29, impressions: 1040, clicks: 86, conversions: 4 },
    ],
    expect: {
      spend: 13686.29,
      impressions: 2240,
      clicks: 166,
      conversions: 9,
      ctr: 166 / 2240,
      cpc: 13686.29 / 166,
    },
  },
  {
    campaignId: "24383305563",
    campaignName: "Campaign_24383305563",
    days: [
      { date: "2026-10-04", cost: 7000, impressions: 2000, clicks: 90, conversions: 1 },
      { date: "2026-10-22", cost: 6499.67, impressions: 1975, clicks: 98, conversions: 1 },
    ],
    expect: {
      spend: 13499.67,
      impressions: 3975,
      clicks: 188,
      conversions: 2,
      ctr: 188 / 3975,
      cpc: 13499.67 / 188,
    },
  },
  {
    campaignId: "24416727746",
    campaignName: "Campaign_24416727746",
    days: [
      { date: "2026-10-05", cost: 400, impressions: 40, clicks: 4, conversions: 0 },
      { date: "2026-10-23", cost: 458.96, impressions: 43, clicks: 5, conversions: 0 },
    ],
    expect: {
      spend: 858.96,
      impressions: 83,
      clicks: 9,
      conversions: 0,
      ctr: 9 / 83,
      cpc: 858.96 / 9,
    },
  },
];

const GRAND = {
  spend: 115411.38,
  impressions: 32548,
  clicks: 1433,
  conversions: 48,
  ctr: 1433 / 32548,
  cpc: 115411.38 / 1433,
};

const buildDailyRows = () => {
  const rows = [];
  for (const campaign of OCTOBER_CAMPAIGNS) {
    for (const day of campaign.days) {
      const ctr = day.impressions > 0 ? day.clicks / day.impressions : 0;
      const averageCpc = day.clicks > 0 ? day.cost / day.clicks : 0;
      rows.push({
        source: "google_ads",
        provider: "google_ads",
        reportType: "campaign_performance",
        campaignId: campaign.campaignId,
        campaignName: campaign.campaignName,
        date: day.date,
        impressions: day.impressions,
        clicks: day.clicks,
        ctr,
        cost: day.cost,
        costMicros: Math.round(day.cost * 1_000_000),
        averageCpc,
        conversions: day.conversions,
        conversionsValue: day.conversions * 100,
        currencyCode: "INR",
        _meta: {
          provider: "google_ads",
          report: "campaign_performance",
          resource: "campaign",
        },
      });
    }
  }
  return rows;
};

/** Pad to 80 daily rows while preserving October campaign totals. */
const buildEightyDailyRows = () => {
  const base = buildDailyRows();
  const fillerCampaign = OCTOBER_CAMPAIGNS[0];
  let day = 6;
  while (base.length < 80) {
    // Zero-metric padding days so period SUM for real campaigns stays exact.
    const date = `2026-10-${String(day).padStart(2, "0")}`;
    base.push({
      source: "google_ads",
      provider: "google_ads",
      reportType: "campaign_performance",
      campaignId: "99999999999",
      campaignName: "Pad_Zero",
      date,
      impressions: 0,
      clicks: 0,
      ctr: 0,
      cost: 0,
      costMicros: 0,
      averageCpc: 0,
      conversions: 0,
      conversionsValue: 0,
      currencyCode: "INR",
      _meta: {
        provider: "google_ads",
        report: "campaign_performance",
        resource: "campaign",
      },
    });
    day += 1;
    if (day > 28) day = 6;
  }
  void fillerCampaign;
  return base.slice(0, 80);
};

const approx = (actual, expected, eps = 0.02) =>
  Math.abs(Number(actual) - Number(expected)) <= eps;

async function main() {
  console.log("\nAI dataset scope + Google Ads October aggregation");

  await check("AI-DATASET-1 80 input rows + dataset scope = one Agent turn", async () => {
    assert.equal(resolveAgentContextScope({}), "item");
    assert.equal(resolveAgentContextScope({ contextScope: "dataset" }), "dataset");
    // Must NOT infer from prompt wording
    assert.equal(
      resolveAgentContextScope({ prompt: "Analyze {{items}} last month" }),
      "item"
    );

    const rows = buildEightyDailyRows();
    assert.equal(rows.length, 80);
    const def = {
      version: 1,
      nodes: [
        { id: "manual", type: "trigger", data: {} },
        {
          id: "set",
          type: "code",
          data: {
            mode: "all",
            code: `return ${JSON.stringify(rows)};`,
          },
        },
        {
          id: "agent",
          type: "aiAgent",
          data: {
            contextScope: "dataset",
            prompt: "Analyze last month's campaign performance",
          },
        },
        { id: "result", type: "result", data: {} },
        {
          id: "model",
          type: "aiModelProviderTest",
          data: { script: "echo" },
        },
      ],
      edges: [
        { id: "e1", source: "manual", target: "set" },
        { id: "e2", source: "set", target: "agent" },
        { id: "e3", source: "agent", target: "result" },
        {
          id: "eaux-m",
          source: "model",
          target: "agent",
          sourceHandle: "model",
          targetHandle: "model",
        },
      ],
    };
    const mem = await executeGraphInMemory(def);
    assert.equal(mem.context.items.agent.length, 1);
    const meta = mem.context.steps.agent?.agentMeta || [];
    assert.equal(meta.length, 1);
  });

  const daily = buildDailyRows();
  const aggregated = aggregateGoogleAdsPerformanceForAi(daily);
  const byId = Object.fromEntries(
    aggregated.map((row) => [String(row.campaignId), row])
  );

  await check("AI-DATASET-2 same campaign across dates groups into one campaign", () => {
    const real = aggregated.filter((row) => row.campaignId !== "99999999999");
    assert.equal(real.length, 5);
    assert.equal(byId["24221515828"].dayCount, 3);
    assert.equal(byId["24221515828"].campaignName, "SC_PWC_BrandedCore_Search_01/09/26");
  });

  await check("AI-DATASET-3 spend SUM correct", () => {
    for (const campaign of OCTOBER_CAMPAIGNS) {
      assert.ok(
        approx(byId[campaign.campaignId].cost, campaign.expect.spend),
        `${campaign.campaignId} spend`
      );
    }
    const totalSpend = aggregated
      .filter((row) => row.campaignId !== "99999999999")
      .reduce((sum, row) => sum + row.cost, 0);
    assert.ok(approx(totalSpend, GRAND.spend));
  });

  await check("AI-DATASET-4 impressions SUM correct", () => {
    for (const campaign of OCTOBER_CAMPAIGNS) {
      assert.equal(byId[campaign.campaignId].impressions, campaign.expect.impressions);
    }
    assert.equal(
      aggregated
        .filter((row) => row.campaignId !== "99999999999")
        .reduce((sum, row) => sum + row.impressions, 0),
      GRAND.impressions
    );
  });

  await check("AI-DATASET-5 clicks SUM correct", () => {
    for (const campaign of OCTOBER_CAMPAIGNS) {
      assert.equal(byId[campaign.campaignId].clicks, campaign.expect.clicks);
    }
    assert.equal(
      aggregated
        .filter((row) => row.campaignId !== "99999999999")
        .reduce((sum, row) => sum + row.clicks, 0),
      GRAND.clicks
    );
  });

  await check("AI-DATASET-6 CTR derived from total clicks/impressions", () => {
    const row = byId["24221515828"];
    assert.equal(row.ctr, row.clicks / row.impressions);
    assert.ok(approx(row.ctr * 100, 3.75, 0.01));
    assert.ok(approx(GRAND.ctr * 100, 4.4, 0.01));
  });

  await check("AI-DATASET-7 CPC derived from total spend/clicks", () => {
    const row = byId["24221515828"];
    assert.ok(approx(row.averageCpc, row.cost / row.clicks, 1e-9));
    assert.ok(approx(row.averageCpc, 64.77, 0.01));
    assert.ok(approx(GRAND.cpc, 80.54, 0.01));
  });

  await check("AI-DATASET-8 daily CTR not averaged", () => {
    const days = OCTOBER_CAMPAIGNS[0].days;
    const avgDailyCtr =
      days.reduce((sum, d) => sum + d.clicks / d.impressions, 0) / days.length;
    assert.equal(byId["24221515828"].ctr === avgDailyCtr, false);
  });

  await check("AI-DATASET-9 daily CPC not averaged", () => {
    const days = OCTOBER_CAMPAIGNS[0].days;
    const avgDailyCpc =
      days.reduce((sum, d) => sum + d.cost / d.clicks, 0) / days.length;
    assert.equal(byId["24221515828"].averageCpc === avgDailyCpc, false);
  });

  await check("AI-DATASET-10 campaign_performance conversions are NOT labeled Leads", () => {
    const report = formatGoogleAdsReport(daily);
    assert.match(report, /Conversions: 31/);
    assert.match(report, /Leads: N\/A/);
    assert.doesNotMatch(report, /Leads: 31/);
    const grounded = applyGoogleAdsAiGrounding({
      systemPrompt: "Analyze last month",
      userPrompt: "Analyze last month's campaign performance",
      input: daily,
    });
    assert.equal(grounded.grounded, true);
    assert.match(grounded.systemPrompt, /conversions means Conversions, not Leads/);
    assert.match(grounded.systemPrompt, /Never map conversions/);
    assert.match(grounded.systemPrompt, /Leads: N\/A/);
  });

  await check("AI-DATASET-11 Leads/CPL unavailable without lead-specific conversion action", () => {
    const grounded = applyGoogleAdsAiGrounding({
      userPrompt: "Show leads and CPL",
      input: daily,
    });
    assert.match(grounded.systemPrompt, /Leads and CPL are N\/A/);
    assert.match(grounded.systemPrompt, /does not identify all conversions as Leads/);
    assert.equal(aggregated.every((row) => row.leads == null), true);
  });

  await check("AI-DATASET-12 item scope remains unchanged", async () => {
    assert.equal(resolveAgentContextScope({ contextScope: "item" }), "item");
    const def = {
      version: 1,
      nodes: [
        { id: "manual", type: "trigger", data: {} },
        {
          id: "set",
          type: "code",
          data: {
            mode: "all",
            code: `return [{ question: "a" }, { question: "b" }];`,
          },
        },
        {
          id: "agent",
          type: "aiAgent",
          data: { contextScope: "item", prompt: "{{item.question}}" },
        },
        { id: "result", type: "result", data: {} },
        {
          id: "model",
          type: "aiModelProviderTest",
          data: { script: "echo" },
        },
      ],
      edges: [
        { id: "e1", source: "manual", target: "set" },
        { id: "e2", source: "set", target: "agent" },
        { id: "e3", source: "agent", target: "result" },
        {
          id: "eaux-m",
          source: "model",
          target: "agent",
          sourceHandle: "model",
          targetHandle: "model",
        },
      ],
    };
    const mem = await executeGraphInMemory(def);
    assert.equal(mem.context.items.agent.length, 2);
    assert.deepEqual(
      mem.context.items.agent.map((i) => i.json?.ai?.output || i.json?.text),
      ["a", "b"]
    );
    assert.equal(
      String(mem.context.items.agent[0].json?.ai?.output || "").includes(
        RUNTIME_DATA_MARKER
      ),
      false
    );
  });

  await check("AI-DATASET-13 MCP auxiliary tool behavior unchanged", () => {
    const def = {
      version: 1,
      nodes: [
        {
          id: "ads",
          type: "googleAds",
          data: { credentialId: "cred-1", customerId: "1234567890" },
        },
        {
          id: "mcp",
          type: "googleAdsMcpTool",
          data: { toolId: "account_summary", googleAdsSourceNodeId: "ads" },
        },
        {
          id: "agent",
          type: "aiAgent",
          data: { contextScope: "dataset", prompt: "Analyze" },
        },
        {
          id: "model",
          type: "aiModelProviderTest",
          data: { script: "echo" },
        },
        {
          id: "campaigns",
          type: "code",
          data: { mode: "all", code: `return [{ campaignName: "A" }];` },
        },
      ],
      edges: [
        { id: "e-main", source: "campaigns", target: "agent" },
        {
          id: "eaux-m",
          source: "model",
          target: "agent",
          sourceHandle: "model",
          targetHandle: "model",
        },
        {
          id: "eaux-t",
          source: "mcp",
          target: "agent",
          sourceHandle: "tool",
          targetHandle: "tools",
        },
      ],
    };
    assert.equal(
      getExecutionEdges(def).some((e) => e.source === "mcp" && e.target === "agent"),
      false
    );
    const bindings = resolveAuxiliaryBindings({ nodeId: "agent", definition: def });
    assert.equal(bindings.tools.length, 1);
    assert.equal(bindings.tools[0].sourceNodeId, "mcp");
    const resources = resolveAgentResources({ nodeId: "agent", definition: def });
    assert.equal(resources.toolDescriptors[0].toolKind, "google_ads_mcp");
  });

  await check("AI-DATASET-extra dataset grounding exposes October totals once", () => {
    const grounded = applyGoogleAdsAiGrounding({
      systemPrompt: "",
      userPrompt: "Analyze last month's campaign performance",
      input: daily,
    });
    assert.equal(grounded.grounded, true);
    assert.match(grounded.systemPrompt, /period totals/);
    assert.match(grounded.systemPrompt, /SC_PWC_BrandedCore_Search_01\/09\/26/);
    assert.match(grounded.systemPrompt, /Cost \(currency \/ Spend\): 53179\.02/);
    assert.match(grounded.systemPrompt, /Impressions: 21897/);
    assert.match(grounded.systemPrompt, /Clicks: 821/);
    assert.match(grounded.systemPrompt, /Conversions: 31/);
    assert.match(grounded.systemPrompt, /group by campaignId/);
    // Raw daily spend fragments should not appear as separate campaign answers
    assert.equal(
      (grounded.systemPrompt.match(/SC_PWC_BrandedCore_Search_01\/09\/26/g) || []).length,
      1
    );
  });

  // silence unused
  void executeAiAgent;
  void interpolate;
  void resolveExpression;

  console.log(`\n${passed} AI-DATASET checks passed`);
  process.exit(process.exitCode || 0);
}

void main();
