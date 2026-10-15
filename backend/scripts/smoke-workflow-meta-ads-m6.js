/**
 * Meta Ads M6 — Performance + controlled breakdown MCP tools.
 * Mocked Graph transport only. No live Meta calls.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const LONG = "EAATestLongLivedTokenValue";
const APP_SECRET = "meta-app-secret-test";
const CRED_ID = "cred-meta-m6";
const ACCOUNT = "123456789";
const OTHER_ACCOUNT = "999999999";
const NOW = Date.parse("2026-10-06T12:00:00Z");
const LEAKED_NEXT = `https://graph.facebook.com/v26.0/act_${ACCOUNT}/insights?access_token=${LONG}&after=nxt`;

const PERF_IDS = [
  "account_performance",
  "campaign_performance",
  "ad_set_performance",
  "ad_performance",
];
const BREAKDOWN_IDS = [
  "demographic_performance",
  "geographic_performance",
  "device_performance",
  "placement_performance",
];
const ALL_M6 = [...PERF_IDS, ...BREAKDOWN_IDS];

const registerMetaAdsM6Tests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Meta Ads M6 performance + breakdown MCP tools");

  const registry = () => require("../services/mcpDynamicRegistry.service");
  const metaMcp = () => require("../services/workflowMetaAdsMcp.service");
  const ads = () => require("../services/workflowMetaAds.service");
  const catalog = () => require("../services/metaAdsReportCatalog");
  const perf = () => require("../../plugins/meta-ads-mcp/src/contracts/performance");
  const grounding = () => require("../services/workflowMetaAdsAiGrounding");
  const workflows = () => require("../modules/workflows/workflows.service");

  const root = path.join(__dirname, "..", "..");
  const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

  const withApp = async (fn) => {
    const prevId = process.env.META_APP_ID;
    const prevSecret = process.env.META_APP_SECRET;
    process.env.META_APP_ID = "meta-app-id";
    process.env.META_APP_SECRET = APP_SECRET;
    try {
      return await fn();
    } finally {
      if (prevId == null) delete process.env.META_APP_ID;
      else process.env.META_APP_ID = prevId;
      if (prevSecret == null) delete process.env.META_APP_SECRET;
      else process.env.META_APP_SECRET = prevSecret;
    }
  };

  const cred = (id = CRED_ID) => ({
    id,
    type: "meta_ads",
    workspaceId: "ws-1",
    name: "Meta Ads",
    secret: { accessToken: LONG, expiresAt: "2030-01-01T00:00:00.000Z" },
    config: { selectedAdAccountId: OTHER_ACCOUNT },
  });

  const sourceNode = (id, data = {}) => ({
    id,
    type: "metaAds",
    data: {
      nodeType: "metaAds",
      label: data.label || "Meta Ads",
      credentialId: data.credentialId === undefined ? CRED_ID : data.credentialId,
      adAccountId: data.adAccountId === undefined ? ACCOUNT : data.adAccountId,
      reportType: "account_performance",
      dateRange: "last30days",
      ...data,
    },
  });

  const mcpNode = (toolId, extra = {}) => ({
    id: "meta-mcp-1",
    type: "metaAdsMcpTool",
    data: {
      nodeType: "metaAdsMcpTool",
      toolId,
      params: extra.params || {},
      ...(extra.metaAdsSourceNodeId ? { metaAdsSourceNodeId: extra.metaAdsSourceNodeId } : {}),
    },
  });

  const sourceContext = (nodes, extra = {}) => ({
    workspaceId: "ws-1",
    graph: { nodes, edges: extra.edges || [] },
    definition: { nodes, edges: extra.edges || [] },
    inputItems: extra.inputItems || [{ json: {} }],
    input: extra.input || {},
    steps: extra.steps || {},
  });

  const insightRow = (extra = {}) => ({
    account_id: ACCOUNT,
    account_name: "Acme",
    account_currency: "EUR",
    campaign_id: "111",
    campaign_name: "Brand",
    adset_id: "222",
    adset_name: "Prospecting",
    ad_id: "333",
    ad_name: "Carousel A",
    impressions: "1000",
    reach: "800",
    frequency: "1.25",
    clicks: "40",
    inline_link_clicks: "25",
    ctr: "4",
    cpc: "0.5",
    cpm: "20",
    spend: "20.00",
    actions: [
      { action_type: "link_click", value: "25" },
      { action_type: "purchase", value: "2" },
    ],
    action_values: [{ action_type: "purchase", value: "99.50" }],
    cost_per_action_type: [{ action_type: "link_click", value: "0.8" }],
    date_start: "2026-09-29",
    date_stop: "2026-09-29",
    ...extra,
  });

  const runTool = async (node, context, { timezone = "America/Los_Angeles", pageFor, now = NOW } = {}) => {
    const calls = [];
    let insightsIndex = 0;
    const result = await withApp(() =>
      ads().withMetaTestHooks(
        {
          now: () => now,
          loadCredential: async (id) => cred(id === CRED_ID ? CRED_ID : id),
          transport: async (url, options) => {
            const u = new URL(url);
            const query = Object.fromEntries(u.searchParams.entries());
            calls.push({
              url,
              path: u.pathname,
              query,
              method: options?.method || "GET",
            });
            if (String(u.href) === LEAKED_NEXT) throw new Error("fetched paging.next");
            if (u.pathname.endsWith("/insights")) {
              const page = pageFor
                ? pageFor(insightsIndex, query)
                : { data: [insightRow()] };
              insightsIndex += 1;
              return { ok: true, status: 200, body: page };
            }
            if (/\/act_\d+$/.test(u.pathname)) {
              return {
                ok: true,
                status: 200,
                body: {
                  id: `act_${ACCOUNT}`,
                  account_id: ACCOUNT,
                  name: "Acme",
                  currency: "EUR",
                  timezone_name: timezone,
                  account_status: 1,
                },
              };
            }
            return { ok: false, status: 400, body: { error: { message: "unexpected" } } };
          },
        },
        () => registry().executeMetaAdsMcpNode(node, context)
      )
    );
    return {
      result,
      calls,
      insightCalls: calls.filter((row) => row.path.endsWith("/insights")),
    };
  };

  const dropdown = () => registry().listTools({ provider: "meta_ads" });

  const names = [
    ["META-M6-1", "account_performance", "Account Performance"],
    ["META-M6-2", "campaign_performance", "Campaign Performance"],
    ["META-M6-3", "ad_set_performance", "Ad Set Performance"],
    ["META-M6-4", "ad_performance", "Ad Performance"],
    ["META-M6-5", "demographic_performance", "Demographic Performance"],
    ["META-M6-6", "geographic_performance", "Geographic Performance"],
    ["META-M6-7", "device_performance", "Device Performance"],
    ["META-M6-8", "placement_performance", "Placement Performance"],
  ];
  for (const [id, toolId, label] of names) {
    check(`${id} ${toolId} registered`, () => {
      const tool = registry().getToolDefinition("meta_ads", toolId);
      assertX.equal(tool.displayName, label);
      assertX.equal(tool.implemented, true);
      assertX.equal(tool.access, "read");
      assertX.equal(tool.risk, "low");
      assertX.equal(label.includes("Ad Group"), false);
      assertX.ok(dropdown().some((row) => row.id === toolId));
    });
  }

  check("META-M6-9 all M6 tools uiGroup=performance", () => {
    const performance = dropdown().filter((tool) => tool.uiGroup === "performance");
    assertX.deepEqual(performance.map((tool) => tool.id), ALL_M6);
    const ui = read("frontend/src/components/workflows/params/DynamicMcpToolField.tsx");
    assertX.match(ui, /SelectLabel>Performance/);
  });

  check("META-M6-10 source inheritance unchanged", async () => {
    const { insightCalls } = await runTool(
      mcpNode("campaign_performance", { metaAdsSourceNodeId: "meta-b" }),
      sourceContext([
        sourceNode("meta-a", { adAccountId: "111111111" }),
        sourceNode("meta-b", { adAccountId: ACCOUNT }),
      ])
    );
    assertX.ok(insightCalls[0].path.includes(`/act_${ACCOUNT}/insights`));
    assertX.equal(insightCalls[0].path.includes("111111111"), false);
    const state = metaMcp().metaAdsSourceFieldState(
      [sourceNode("meta-a"), sourceNode("meta-b")],
      ""
    );
    assertX.equal(state.showSelector, true);
  });

  check("META-M6-11 credentialId not persisted", () => {
    const definition = {
      version: 1,
      nodes: [
        {
          id: "n",
          type: "metaAdsMcpTool",
          position: { x: 0, y: 0 },
          data: {
            nodeType: "metaAdsMcpTool",
            toolId: "account_performance",
            credentialId: "nope",
            params: {},
          },
        },
      ],
      edges: [],
    };
    workflows().validateDefinition(definition);
    assertX.equal(definition.nodes[0].data.credentialId, undefined);
  });

  check("META-M6-12 adAccountId not persisted", () => {
    const definition = {
      version: 1,
      nodes: [
        {
          id: "n",
          type: "metaAdsMcpTool",
          position: { x: 0, y: 0 },
          data: {
            nodeType: "metaAdsMcpTool",
            toolId: "ad_performance",
            adAccountId: ACCOUNT,
            params: { adAccountId: ACCOUNT },
          },
        },
      ],
      edges: [],
    };
    workflows().validateDefinition(definition);
    assertX.equal(definition.nodes[0].data.adAccountId, undefined);
    assertX.equal(definition.nodes[0].data.params.adAccountId, undefined);
  });

  check("META-M6-13 account timezone used", async () => {
    const early = Date.parse("2026-10-06T03:00:00Z");
    const la = await runTool(
      mcpNode("account_performance", { params: { dateRange: "yesterday" } }),
      sourceContext([sourceNode("only-meta")]),
      { timezone: "America/Los_Angeles", now: early }
    );
    const tokyo = await runTool(
      mcpNode("account_performance", { params: { dateRange: "yesterday" } }),
      sourceContext([sourceNode("only-meta")]),
      { timezone: "Asia/Tokyo", now: early }
    );
    assertX.equal(JSON.parse(la.insightCalls[0].query.time_range).since, "2026-10-04");
    assertX.equal(JSON.parse(tokyo.insightCalls[0].query.time_range).since, "2026-10-05");
    assertX.equal(la.result.items[0].json._meta.timezone, "America/Los_Angeles");
  });

  check("META-M6-14 last7days semantics match M3", async () => {
    const { insightCalls, result } = await runTool(
      mcpNode("account_performance"),
      sourceContext([sourceNode("only-meta", { dateRange: "last30days" })])
    );
    assertX.deepEqual(JSON.parse(insightCalls[0].query.time_range), {
      since: "2026-09-29",
      until: "2026-10-05",
    });
    assertX.equal(insightCalls[0].query.date_preset, undefined);
    assertX.equal(insightCalls[0].query.time_increment, "1");
    assertX.equal(result.items[0].json._meta.dateRange.since, "2026-09-29");
    const native = catalog().resolveMetaDateRange({
      timezone: "America/Los_Angeles",
      nowMs: NOW,
      dateRange: "last7days",
    });
    assertX.deepEqual(native, {
      preset: "last7days",
      since: "2026-09-29",
      until: "2026-10-05",
      timezone: "America/Los_Angeles",
    });
  });

  check("META-M6-15 custom date validation", async () => {
    const { insightCalls } = await runTool(
      mcpNode("campaign_performance", {
        params: { dateRange: "custom", customSince: "2026-09-01", customUntil: "2026-09-15" },
      }),
      sourceContext([sourceNode("only-meta")])
    );
    assertX.equal(
      insightCalls[0].query.time_range,
      JSON.stringify({ since: "2026-09-01", until: "2026-09-15" })
    );
    let inverted = null;
    try {
      await runTool(
        mcpNode("campaign_performance", {
          params: { dateRange: "custom", customSince: "2026-09-20", customUntil: "2026-09-15" },
        }),
        sourceContext([sourceNode("only-meta")])
      );
    } catch (error) {
      inverted = error;
    }
    assertX.equal(inverted && inverted.code, "META_DATE_WINDOW");
  });

  check("META-M6-16 37-month limit retained", async () => {
    let err = null;
    try {
      await runTool(
        mcpNode("account_performance", {
          params: { dateRange: "custom", customSince: "2023-01-01", customUntil: "2023-01-10" },
        }),
        sourceContext([sourceNode("only-meta")])
      );
    } catch (error) {
      err = error;
    }
    assertX.equal(err && err.code, "META_DATE_WINDOW");
    assertX.equal(catalog().MAX_LOOKBACK_MONTHS, 37);
  });

  const levelCases = [
    ["META-M6-17", "account_performance", "account"],
    ["META-M6-18", "campaign_performance", "campaign"],
    ["META-M6-19", "ad_set_performance", "adset"],
    ["META-M6-20", "ad_performance", "ad"],
  ];
  for (const [id, toolId, level] of levelCases) {
    check(`${id} ${level} level request correct`, async () => {
      const { insightCalls, result } = await runTool(
        mcpNode(toolId),
        sourceContext([sourceNode("only-meta")])
      );
      assertX.equal(insightCalls[0].query.level, level);
      assertX.equal(insightCalls[0].path.endsWith(`/act_${ACCOUNT}/insights`), true);
      assertX.equal(result.items[0].json._meta.level, level);
      assertX.equal(insightCalls[0].method, "GET");
    });
  }

  check("META-M6-21 campaign filters validated", async () => {
    const { insightCalls } = await runTool(
      mcpNode("campaign_performance", {
        params: { campaignId: "111", effectiveStatus: "PAUSED" },
      }),
      sourceContext([sourceNode("only-meta")])
    );
    assertX.deepEqual(JSON.parse(insightCalls[0].query.filtering), [
      { field: "campaign.id", operator: "IN", value: ["111"] },
      { field: "campaign.effective_status", operator: "IN", value: ["PAUSED"] },
    ]);
    let bad = null;
    try {
      await runTool(
        mcpNode("campaign_performance", { params: { campaignId: "abc" } }),
        sourceContext([sourceNode("only-meta")])
      );
    } catch (error) {
      bad = error;
    }
    assertX.equal(bad && bad.code, "META_FILTER_INVALID");
  });

  check("META-M6-22 adSet filters validated", async () => {
    const { insightCalls } = await runTool(
      mcpNode("ad_set_performance", { params: { adSetId: "222" } }),
      sourceContext([sourceNode("only-meta")])
    );
    assertX.deepEqual(JSON.parse(insightCalls[0].query.filtering), [
      { field: "adset.id", operator: "IN", value: ["222"] },
    ]);
    let bad = null;
    try {
      await runTool(
        mcpNode("ad_set_performance", { params: { adSetId: "act_1" } }),
        sourceContext([sourceNode("only-meta")])
      );
    } catch (error) {
      bad = error;
    }
    assertX.equal(bad && bad.code, "META_FILTER_INVALID");
  });

  check("META-M6-23 ad filters validated", async () => {
    const { insightCalls } = await runTool(
      mcpNode("ad_performance", { params: { adId: "333" } }),
      sourceContext([sourceNode("only-meta")])
    );
    assertX.deepEqual(JSON.parse(insightCalls[0].query.filtering), [
      { field: "ad.id", operator: "IN", value: ["333"] },
    ]);
  });

  check("META-M6-24 status validated", async () => {
    let err = null;
    try {
      await runTool(
        mcpNode("campaign_performance", { params: { effectiveStatus: "ENABLED" } }),
        sourceContext([sourceNode("only-meta")])
      );
    } catch (error) {
      err = error;
    }
    assertX.ok(err);
    assertX.ok(err.code === "MCP_INVALID_PARAMS" || err.code === "META_FILTER_INVALID");
  });

  check("META-M6-25 actions preserved as array<object>", async () => {
    const { result } = await runTool(
      mcpNode("campaign_performance"),
      sourceContext([sourceNode("only-meta")])
    );
    const actions = result.items[0].json.actions;
    assertX.equal(Array.isArray(actions), true);
    assertX.equal(typeof actions[0], "object");
    assertX.equal(actions[0].action_type, "link_click");
    assertX.equal(typeof actions[0].value, "number");
  });

  check("META-M6-26 action_values preserved", async () => {
    const { result } = await runTool(
      mcpNode("ad_set_performance"),
      sourceContext([sourceNode("only-meta")])
    );
    const values = result.items[0].json.action_values;
    assertX.equal(Array.isArray(values), true);
    assertX.equal(values[0].action_type, "purchase");
    assertX.equal(values[0].value, 99.5);
  });

  check("META-M6-27 cost_per_action_type preserved", async () => {
    const { result } = await runTool(
      mcpNode("ad_performance"),
      sourceContext([sourceNode("only-meta")])
    );
    const costs = result.items[0].json.cost_per_action_type;
    assertX.equal(Array.isArray(costs), true);
    assertX.equal(costs[0].action_type, "link_click");
  });

  check("META-M6-28 no synthetic conversions", async () => {
    const { result, insightCalls } = await runTool(
      mcpNode("account_performance"),
      sourceContext([sourceNode("only-meta")])
    );
    assertX.equal(result.items[0].json.conversions, undefined);
    assertX.equal(result.items[0].json.revenue, undefined);
    assertX.equal(result.items[0].json.roas, undefined);
    assertX.equal(String(insightCalls[0].query.fields).includes("conversions"), false);
  });

  check("META-M6-29 clicks remains distinct from inline_link_clicks", async () => {
    const { result } = await runTool(
      mcpNode("campaign_performance"),
      sourceContext([sourceNode("only-meta")])
    );
    assertX.equal(result.items[0].json.clicks, 40);
    assertX.equal(result.items[0].json.inline_link_clicks, 25);
  });

  check("META-M6-30 account currency retained", async () => {
    const { result } = await runTool(
      mcpNode("account_performance"),
      sourceContext([sourceNode("only-meta")])
    );
    assertX.equal(result.items[0].json.account_currency, "EUR");
  });

  check("META-M6-31 demographic breakdown valid", async () => {
    const { insightCalls, result } = await runTool(
      mcpNode("demographic_performance", { params: { demographicMode: "age_and_gender" } }),
      sourceContext([sourceNode("only-meta")]),
      { pageFor: () => ({ data: [insightRow({ age: "18-24", gender: "female" })] }) }
    );
    assertX.equal(insightCalls[0].query.breakdowns, "age,gender");
    assertX.equal(insightCalls[0].query.level, "account");
    assertX.equal(result.items[0].json.age, "18-24");
    assertX.equal(result.items[0].json.gender, "female");
    assertX.deepEqual(result.items[0].json._meta.breakdowns, ["age", "gender"]);
  });

  check("META-M6-32 invalid demographic combination rejected", () => {
    let err = null;
    try {
      perf().buildPerformanceRequest("demographic_performance", { demographicMode: "age_country" });
    } catch (error) {
      err = error;
    }
    assertX.equal(err && err.code, "META_BREAKDOWN_INVALID");
  });

  check("META-M6-33 country breakdown valid", async () => {
    const { insightCalls, result } = await runTool(
      mcpNode("geographic_performance"),
      sourceContext([sourceNode("only-meta")]),
      { pageFor: () => ({ data: [insightRow({ country: "US" })] }) }
    );
    assertX.equal(insightCalls[0].query.breakdowns, "country");
    assertX.equal(result.items[0].json.country, "US");
  });

  check("META-M6-34 device breakdown valid", async () => {
    const { insightCalls, result } = await runTool(
      mcpNode("device_performance"),
      sourceContext([sourceNode("only-meta")]),
      { pageFor: () => ({ data: [insightRow({ impression_device: "iphone" })] }) }
    );
    assertX.equal(insightCalls[0].query.breakdowns, "impression_device");
    assertX.equal(result.items[0].json.impression_device, "iphone");
    assertX.equal(String(insightCalls[0].query.breakdowns).includes("segments.device"), false);
  });

  check("META-M6-35 publisher platform breakdown valid", async () => {
    const { insightCalls, result } = await runTool(
      mcpNode("placement_performance", { params: { placementBreakdown: "publisher_platform" } }),
      sourceContext([sourceNode("only-meta")]),
      { pageFor: () => ({ data: [insightRow({ publisher_platform: "facebook" })] }) }
    );
    assertX.equal(insightCalls[0].query.breakdowns, "publisher_platform");
    assertX.equal(result.items[0].json.publisher_platform, "facebook");
  });

  check("META-M6-36 platform position breakdown valid", async () => {
    const { insightCalls, result } = await runTool(
      mcpNode("placement_performance", { params: { placementBreakdown: "platform_position" } }),
      sourceContext([sourceNode("only-meta")]),
      { pageFor: () => ({ data: [insightRow({ platform_position: "feed" })] }) }
    );
    assertX.equal(insightCalls[0].query.breakdowns, "platform_position");
    assertX.equal(result.items[0].json.platform_position, "feed");
  });

  check("META-M6-37 unsupported breakdown combination rejected", () => {
    let err = null;
    try {
      catalog().validateBreakdowns(["age", "country"]);
    } catch (error) {
      err = error;
    }
    assertX.equal(err && err.code, "META_BREAKDOWN_INVALID");
    let placement = null;
    try {
      perf().buildPerformanceRequest("placement_performance", {
        placementBreakdown: "impression_device",
      });
    } catch (error) {
      placement = error;
    }
    assertX.equal(placement && placement.code, "META_BREAKDOWN_INVALID");
  });

  check("META-M6-38 paging uses cursor after", async () => {
    const { insightCalls } = await runTool(
      mcpNode("campaign_performance", { params: { returnAll: true } }),
      sourceContext([sourceNode("only-meta")]),
      {
        pageFor: (index) =>
          index === 0
            ? {
                data: [insightRow({ campaign_id: "1" })],
                paging: { cursors: { after: "cursor-1" }, next: LEAKED_NEXT },
              }
            : { data: [insightRow({ campaign_id: "2" })], paging: {} },
      }
    );
    assertX.equal(insightCalls.length, 2);
    assertX.equal(insightCalls[0].query.after, undefined);
    assertX.equal(insightCalls[1].query.after, "cursor-1");
  });

  check("META-M6-39 paging.next not requested directly", async () => {
    const { calls } = await runTool(
      mcpNode("campaign_performance", { params: { returnAll: true } }),
      sourceContext([sourceNode("only-meta")]),
      {
        pageFor: (index) =>
          index === 0
            ? {
                data: [insightRow({ campaign_id: "1" })],
                paging: { cursors: { after: "safe" }, next: LEAKED_NEXT },
              }
            : { data: [insightRow({ campaign_id: "2" })], paging: {} },
      }
    );
    assertX.equal(calls.some((row) => row.url === LEAKED_NEXT), false);
  });

  check("META-M6-40 row cap enforced", async () => {
    const { result, insightCalls } = await runTool(
      mcpNode("campaign_performance", { params: { returnAll: true } }),
      sourceContext([sourceNode("only-meta")]),
      {
        pageFor: () => ({
          data: Array.from({ length: 100 }, (_, i) => insightRow({ campaign_id: String(i) })),
          paging: { cursors: { after: "more" }, next: LEAKED_NEXT },
        }),
      }
    );
    assertX.equal(result.items.length, 2000);
    assertX.ok(insightCalls.length <= 20);
  });

  check("META-M6-41 page cap enforced", async () => {
    const { insightCalls, result } = await runTool(
      mcpNode("campaign_performance", { params: { returnAll: true } }),
      sourceContext([sourceNode("only-meta")]),
      {
        pageFor: (index) => ({
          data: [insightRow({ campaign_id: String(index) })],
          paging: { cursors: { after: String(index + 1) }, next: LEAKED_NEXT },
        }),
      }
    );
    assertX.equal(insightCalls.length, 20);
    assertX.equal(result.items.length, 20);
  });

  check("META-M6-42 truncated metadata correct", async () => {
    const complete = await runTool(
      mcpNode("account_performance"),
      sourceContext([sourceNode("only-meta")])
    );
    assertX.equal(complete.result.items[0].json._meta.truncated, undefined);
    const capped = await runTool(
      mcpNode("campaign_performance", { params: { limit: 1 } }),
      sourceContext([sourceNode("only-meta")]),
      {
        pageFor: () => ({
          data: [insightRow()],
          paging: { cursors: { after: "more" }, next: LEAKED_NEXT },
        }),
      }
    );
    assertX.equal(capped.result.items.length, 1);
    assertX.equal(capped.result.items[0].json._meta.truncated, true);
  });

  check("META-M6-43 one Insights row = one WorkflowItem", async () => {
    const { result } = await runTool(
      mcpNode("campaign_performance"),
      sourceContext([sourceNode("only-meta")]),
      {
        pageFor: () => ({
          data: [insightRow({ campaign_id: "1" }), insightRow({ campaign_id: "2" })],
        }),
      }
    );
    assertX.equal(result.items.length, 2);
    assertX.equal(result.items[0].json.campaign_id, "1");
    assertX.equal(result.items[1].json.campaign_id, "2");
  });

  check("META-M6-44 nested arrays remain structured", async () => {
    const { result } = await runTool(
      mcpNode("ad_performance"),
      sourceContext([sourceNode("only-meta")])
    );
    const json = result.items[0].json;
    assertX.equal(typeof json.actions, "object");
    assertX.equal(Array.isArray(json.actions), true);
    const blob = JSON.stringify(json);
    assertX.equal(blob.includes('"actions":"['), false);
    assertX.equal(blob.includes('"action_values":"['), false);
  });

  check("META-M6-45 provenance provider correct", async () => {
    const { result } = await runTool(
      mcpNode("campaign_performance"),
      sourceContext([sourceNode("only-meta")])
    );
    const meta = result.items[0].json._meta;
    assertX.equal(meta.provider, "meta_ads");
    assertX.equal(meta.tool, "campaign_performance");
    assertX.equal(meta.resource, "insights");
    assertX.equal(meta.report, "campaign_performance");
    assertX.equal(meta.apiVersion, "v26.0");
    assertX.equal(meta.credentialId, undefined);
  });

  check("META-M6-46 dateRange provenance correct", async () => {
    const { result } = await runTool(
      mcpNode("account_performance"),
      sourceContext([sourceNode("only-meta")])
    );
    assertX.deepEqual(result.items[0].json._meta.dateRange, {
      since: "2026-09-29",
      until: "2026-10-05",
    });
  });

  check("META-M6-47 timezone provenance correct", async () => {
    const { result } = await runTool(
      mcpNode("account_performance"),
      sourceContext([sourceNode("only-meta")]),
      { timezone: "Europe/Paris" }
    );
    assertX.equal(result.items[0].json._meta.timezone, "Europe/Paris");
  });

  check("META-M6-48 breakdown provenance correct", async () => {
    const { result } = await runTool(
      mcpNode("placement_performance", {
        params: { placementBreakdown: "publisher_and_position" },
      }),
      sourceContext([sourceNode("only-meta")]),
      {
        pageFor: () => ({
          data: [insightRow({ publisher_platform: "instagram", platform_position: "feed" })],
        }),
      }
    );
    assertX.deepEqual(result.items[0].json._meta.breakdowns, [
      "publisher_platform",
      "platform_position",
    ]);
    assertX.equal(result.items[0].json._meta.tool, "placement_performance");
    assertX.equal(result.items[0].json._meta.report, "placement_performance");
  });

  check("META-M6-49 Meta grounding labels correct", () => {
    const cases = [
      ["account_performance", "Meta Ads Account Performance"],
      ["campaign_performance", "Meta Ads Campaign Performance"],
      ["ad_set_performance", "Meta Ads Ad Set Performance"],
      ["ad_performance", "Meta Ads Ad Performance"],
      ["demographic_performance", "Meta Ads Demographic Performance"],
      ["geographic_performance", "Meta Ads Geographic Performance"],
      ["device_performance", "Meta Ads Device Performance"],
      ["placement_performance", "Meta Ads Placement Performance"],
    ];
    for (const [tool, label] of cases) {
      const g = grounding().applyMetaAdsAiGrounding({
        systemPrompt: "Summarize",
        input: [
          {
            json: {
              clicks: 1,
              inline_link_clicks: 2,
              _meta: {
                provider: "meta_ads",
                tool,
                resource: "insights",
                report: tool,
                level: "account",
                adAccountId: ACCOUNT,
                apiVersion: "v26.0",
                dateRange: { since: "2026-09-29", until: "2026-10-05" },
                timezone: "UTC",
                ...(tool === "demographic_performance" ? { breakdowns: ["age"] } : {}),
              },
            },
          },
        ],
      });
      assertX.equal(g.grounded, true);
      assertX.ok(g.systemPrompt.includes(`report: ${label}`), label);
      assertX.ok(g.systemPrompt.includes("inline_link_clicks"));
      assertX.equal(/Ad Group/.test(g.systemPrompt), false);
    }
  });

  const perfRows = [
    {
      json: {
        clicks: 1,
        _meta: {
          provider: "meta_ads",
          tool: "campaign_performance",
          resource: "insights",
          report: "campaign_performance",
          level: "campaign",
          adAccountId: ACCOUNT,
          apiVersion: "v26.0",
          dateRange: { since: "2026-09-29", until: "2026-10-05" },
          timezone: "UTC",
        },
      },
    },
  ];

  check("META-M6-50 Google Ads grounding skipped", () => {
    const google = require("../services/workflowGoogleAdsAiGrounding");
    assertX.equal(google.applyGoogleAdsAiGrounding({ systemPrompt: "s", input: perfRows }).grounded, false);
  });

  check("META-M6-51 GA4 grounding skipped", () => {
    const ga4 = require("../services/workflowGa4AiGrounding");
    assertX.equal(
      ga4.applyGa4NativeAiGrounding({ systemPrompt: "s", userPrompt: "u", input: perfRows, context: {} }).grounded,
      false
    );
  });

  check("META-M6-52 GSC grounding skipped", () => {
    const { applyMcpAiGrounding } = require("../services/workflowMcpAiGrounding");
    assertX.equal(applyMcpAiGrounding({ systemPrompt: "s", userPrompt: "u", input: perfRows }).grounded, false);
  });

  check("META-M6-53 token not leaked", async () => {
    const { result } = await runTool(
      mcpNode("campaign_performance"),
      sourceContext([sourceNode("only-meta")])
    );
    assertX.equal(JSON.stringify(result).includes(LONG), false);
  });

  check("META-M6-54 app secret not leaked", async () => {
    const { result } = await runTool(
      mcpNode("account_performance"),
      sourceContext([sourceNode("only-meta")])
    );
    assertX.equal(JSON.stringify(result).includes(APP_SECRET), false);
  });

  check("META-M6-55 appsecret_proof not leaked", async () => {
    const { result, insightCalls } = await runTool(
      mcpNode("ad_performance"),
      sourceContext([sourceNode("only-meta")])
    );
    assertX.equal(JSON.stringify(result).includes("appsecret_proof"), false);
    assertX.ok(insightCalls[0].query.appsecret_proof);
  });

  check("META-M6-56 paging.next URL not leaked", async () => {
    const { result } = await runTool(
      mcpNode("campaign_performance", { params: { returnAll: true } }),
      sourceContext([sourceNode("only-meta")]),
      {
        pageFor: (index) =>
          index === 0
            ? {
                data: [insightRow()],
                paging: { cursors: { after: "safe" }, next: LEAKED_NEXT },
              }
            : { data: [insightRow({ campaign_id: "9" })], paging: {} },
      }
    );
    const blob = JSON.stringify(result);
    assertX.equal(blob.includes(LEAKED_NEXT), false);
    assertX.equal(blob.includes("paging.next"), false);
  });

  check("META-M6-57 ads_read remains only permission", () => {
    const { OAUTH_SCOPES } = require("../config/metaGraph");
    assertX.deepEqual([...OAUTH_SCOPES], ["ads_read"]);
    assertX.equal(read("plugins/meta-ads-mcp/src/contracts/performance.js").includes("ads_management"), false);
  });

  check("META-M6-58 Graph writes remain unreachable", async () => {
    const src = read("plugins/meta-ads-mcp/src/executor.js");
    assertX.equal(/method:\s*["']POST["']/.test(src), false);
    await assertX.rejects(
      () => ads().metaGraphRequest({ path: `act_${ACCOUNT}/insights`, method: "POST", accessToken: LONG }),
      (error) => error.code === "META_PERMISSION_DENIED"
    );
  });

  check("META-M6-59 native M3 reports unchanged", () => {
    assertX.deepEqual(Object.keys(catalog().REPORTS).sort(), [
      "account_performance",
      "ad_performance",
      "ad_set_performance",
      "campaign_performance",
    ].sort());
    const native = read("backend/services/workflowMetaAds.service.js");
    assertX.match(native, /executeMetaAdsNode/);
  });

  check("META-M6-60 M5 Common tools unchanged", () => {
    const common = dropdown().filter((tool) => tool.uiGroup === "common");
    assertX.deepEqual(common.map((tool) => tool.id), [
      "account_summary",
      "campaigns",
      "ad_sets",
      "ads",
      "creatives",
    ]);
    assertX.equal(dropdown().some((tool) => tool.id === "list_accessible_ad_accounts"), false);
  });
};

module.exports = { registerMetaAdsM6Tests };

if (require.main === module) {
  const queue = [];
  let passed = 0;
  const check = (name, fn) => {
    queue.push(async () => {
      try {
        await fn();
        passed += 1;
        console.log(`  ok  ${name}`);
      } catch (err) {
        console.error(`FAIL  ${name}\n      ${err.message}`);
        process.exitCode = 1;
      }
    });
  };
  registerMetaAdsM6Tests({
    check,
    section: (name) => queue.push(async () => console.log(`\n${name}`)),
    assert,
  });
  (async () => {
    for (const task of queue) await task();
    console.log(`\n${passed} checks passed`);
    process.exit(process.exitCode || 0);
  })();
}
