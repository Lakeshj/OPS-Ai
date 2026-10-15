/**
 * Meta Ads M5 — Common read-only MCP entity tools.
 * Mocked Graph transport only. No live Meta calls.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const LONG = "EAATestLongLivedTokenValue";
const APP_SECRET = "meta-app-secret-test";
const CRED_ID = "cred-meta-m5";
const ACCOUNT = "123456789";
const OTHER_ACCOUNT = "999999999";
const NOW = Date.parse("2026-10-06T12:00:00Z");

const COMMON_IDS = ["account_summary", "campaigns", "ad_sets", "ads", "creatives"];
const INSIGHTS_METRICS = [
  "impressions",
  "reach",
  "clicks",
  "ctr",
  "cpc",
  "cpm",
  "spend",
  "actions",
  "action_values",
  "cost_per_action_type",
];

const registerMetaAdsM5Tests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Meta Ads M5 Common read-only MCP entity tools");

  const registry = () => require("../services/mcpDynamicRegistry.service");
  const metaMcp = () => require("../services/workflowMetaAdsMcp.service");
  const ads = () => require("../services/workflowMetaAds.service");
  const catalog = () => require("../../plugins/meta-ads-mcp/src/contracts/catalog");
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

  const cred = (id = CRED_ID, extra = {}) => ({
    id,
    type: "meta_ads",
    workspaceId: "ws-1",
    name: "Meta Ads",
    secret: { accessToken: LONG, expiresAt: "2030-01-01T00:00:00.000Z" },
    config: { selectedAdAccountId: OTHER_ACCOUNT, ...extra.config },
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
      ...(extra.metaAdsSourceNodeId
        ? { metaAdsSourceNodeId: extra.metaAdsSourceNodeId }
        : {}),
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

  const accountObject = {
    id: "act_123456789",
    account_id: "123456789",
    name: "Acme",
    account_status: 1,
    currency: "EUR",
    timezone_name: "Europe/Paris",
  };

  const campaignRow = {
    id: "111",
    name: "Brand",
    status: "ACTIVE",
    effective_status: "ACTIVE",
    objective: "OUTCOME_TRAFFIC",
    buying_type: "AUCTION",
    start_time: "2026-01-01T00:00:00+0000",
    stop_time: "2026-12-31T00:00:00+0000",
    created_time: "2026-01-01T00:00:00+0000",
    updated_time: "2026-01-02T00:00:00+0000",
  };

  const adSetRow = {
    id: "222",
    name: "Prospecting",
    campaign_id: "111",
    status: "ACTIVE",
    effective_status: "ACTIVE",
    start_time: "2026-01-01T00:00:00+0000",
    end_time: "2026-12-31T00:00:00+0000",
    created_time: "2026-01-01T00:00:00+0000",
    updated_time: "2026-01-02T00:00:00+0000",
    optimization_goal: "LINK_CLICKS",
    billing_event: "IMPRESSIONS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    daily_budget: "2000",
    lifetime_budget: "0",
  };

  const adRow = {
    id: "333",
    name: "Carousel A",
    campaign_id: "111",
    adset_id: "222",
    status: "ACTIVE",
    effective_status: "ACTIVE",
    creative: { id: "444" },
    created_time: "2026-01-01T00:00:00+0000",
    updated_time: "2026-01-02T00:00:00+0000",
  };

  const creativeRow = {
    id: "444",
    name: "Hero",
    title: "Shop now",
    body: "Spring sale",
    thumbnail_url: "https://example.com/thumb.jpg",
    object_story_spec: {
      page_id: "555",
      link_data: { message: "Hello", link: "https://example.com" },
    },
    status: "ACTIVE",
  };

  const page = (rows, extra = {}) => ({
    data: rows,
    paging: extra.paging || {},
  });

  const classifyPath = (pathname) => {
    const text = String(pathname || "");
    if (text.endsWith("/me/adaccounts")) return "accounts";
    if (text.endsWith("/campaigns")) return "campaigns";
    if (text.endsWith("/adsets")) return "ad_sets";
    if (text.endsWith("/ads")) return "ads";
    if (text.endsWith("/adcreatives")) return "creatives";
    if (/\/act_\d+$/.test(text)) return "account_summary";
    return "other";
  };

  const defaultBody = (kind) => {
    if (kind === "accounts") return page([accountObject]);
    if (kind === "account_summary") return accountObject;
    if (kind === "campaigns") return page([campaignRow]);
    if (kind === "ad_sets") return page([adSetRow]);
    if (kind === "ads") return page([adRow]);
    if (kind === "creatives") return page([creativeRow]);
    return { error: { message: "unexpected" } };
  };

  const runTool = async (node, context, { credential = cred(), transport } = {}) => {
    const calls = [];
    const loaded = [];
    const result = await withApp(() =>
      ads().withMetaTestHooks(
        {
          now: () => NOW,
          loadCredential: async (id) => {
            loaded.push(id);
            return credential.id === id ? credential : cred(id);
          },
          transport: async (url, options) => {
            const u = new URL(url);
            const kind = classifyPath(u.pathname);
            calls.push({
              url,
              path: u.pathname,
              query: Object.fromEntries(u.searchParams.entries()),
              method: options?.method || "GET",
              kind,
            });
            if (transport) return transport(u, options, { kind, calls });
            if (kind === "other") {
              return { ok: false, status: 400, body: { error: { message: "unexpected" } } };
            }
            return { ok: true, status: 200, body: defaultBody(kind) };
          },
        },
        () => registry().executeMetaAdsMcpNode(node, context)
      )
    );
    return { result, calls, loaded };
  };

  const dropdownTools = () => registry().listTools({ provider: "meta_ads" });

  check("META-M5-1 account_summary registered and visible", () => {
    const tool = registry().getToolDefinition("meta_ads", "account_summary");
    assertX.equal(tool.uiGroup, "common");
    assertX.equal(tool.implemented, true);
    assertX.equal(tool.access, "read");
    assertX.equal(tool.risk, "low");
    assertX.equal(tool.displayName, "Account Summary");
    assertX.ok(dropdownTools().some((row) => row.id === "account_summary"));
  });

  check("META-M5-2 campaigns registered and visible", () => {
    const tool = registry().getToolDefinition("meta_ads", "campaigns");
    assertX.equal(tool.uiGroup, "common");
    assertX.equal(tool.displayName, "Campaigns");
    assertX.ok(dropdownTools().some((row) => row.id === "campaigns"));
  });

  check("META-M5-3 ad_sets registered and visible", () => {
    const tool = registry().getToolDefinition("meta_ads", "ad_sets");
    assertX.equal(tool.displayName, "Ad Sets");
    assertX.equal(tool.displayName.includes("Ad Group"), false);
    assertX.equal(tool.uiGroup, "common");
    assertX.ok(dropdownTools().some((row) => row.id === "ad_sets"));
  });

  check("META-M5-4 ads registered and visible", () => {
    const tool = registry().getToolDefinition("meta_ads", "ads");
    assertX.equal(tool.displayName, "Ads");
    assertX.equal(tool.uiGroup, "common");
    assertX.ok(dropdownTools().some((row) => row.id === "ads"));
  });

  check("META-M5-5 creatives registered and visible", () => {
    const tool = registry().getToolDefinition("meta_ads", "creatives");
    assertX.equal(tool.displayName, "Creatives");
    assertX.equal(tool.uiGroup, "common");
    assertX.ok(dropdownTools().some((row) => row.id === "creatives"));
  });

  check("META-M5-6 list_accessible_ad_accounts remains hidden", () => {
    const ids = dropdownTools().map((tool) => tool.id);
    assertX.equal(ids.includes("list_accessible_ad_accounts"), false);
    const hidden = registry().getToolDefinition("meta_ads", "list_accessible_ad_accounts");
    assertX.equal(hidden.uiGroup, "internal");
  });

  check("META-M5-7 tool dropdown has Common group", () => {
    const common = dropdownTools().filter((tool) => tool.uiGroup === "common");
    assertX.deepEqual(common.map((tool) => tool.id), COMMON_IDS);
    assertX.deepEqual(
      common.map((tool) => tool.displayName),
      ["Account Summary", "Campaigns", "Ad Sets", "Ads", "Creatives"]
    );
    const ui = read("frontend/src/components/workflows/params/DynamicMcpToolField.tsx");
    assertX.match(ui, /SelectLabel>Common/);
    assertX.match(ui, /showEmptyToolList/);
  });

  check("META-M5-8 account_summary inherits correct native source", async () => {
    const { result, calls, loaded } = await runTool(
      mcpNode("account_summary"),
      sourceContext([sourceNode("only-meta")])
    );
    assertX.equal(loaded[0], CRED_ID);
    assertX.ok(calls[0].path.endsWith(`/act_${ACCOUNT}`));
    assertX.equal(calls[0].path.includes(OTHER_ACCOUNT), false);
    assertX.equal(result.items[0].json.account_id, ACCOUNT);
    assertX.equal(result.items[0].json._meta.adAccountId, ACCOUNT);
  });

  const inheritCases = [
    ["META-M5-9", "campaigns", "/campaigns"],
    ["META-M5-10", "ad_sets", "/adsets"],
    ["META-M5-11", "ads", "/ads"],
    ["META-M5-12", "creatives", "/adcreatives"],
  ];
  for (const [id, toolId, edge] of inheritCases) {
    check(`${id} ${toolId} inherit correct ad account`, async () => {
      const { calls, result } = await runTool(
        mcpNode(toolId, { metaAdsSourceNodeId: "meta-b" }),
        sourceContext([
          sourceNode("meta-a", { credentialId: "cred-a", adAccountId: "111111111" }),
          sourceNode("meta-b", { credentialId: CRED_ID, adAccountId: ACCOUNT }),
        ])
      );
      assertX.ok(calls[0].path.endsWith(`/act_${ACCOUNT}${edge}`));
      assertX.equal(calls[0].path.includes("111111111"), false);
      assertX.equal(calls[0].path.includes(OTHER_ACCOUNT), false);
      assertX.equal(result.items[0].json._meta.adAccountId, ACCOUNT);
    });
  }

  check("META-M5-13 credentialId not persisted", () => {
    const definition = {
      version: 1,
      nodes: [
        {
          id: "meta-mcp-node",
          type: "metaAdsMcpTool",
          position: { x: 0, y: 0 },
          data: {
            nodeType: "metaAdsMcpTool",
            toolId: "campaigns",
            credentialId: "should-not-persist",
            params: { campaignId: "111" },
          },
        },
      ],
      edges: [],
    };
    workflows().validateDefinition(definition);
    assertX.equal(definition.nodes[0].data.credentialId, undefined);
    assertX.equal(definition.nodes[0].data.params.credentialId, undefined);
  });

  check("META-M5-14 adAccountId not persisted", () => {
    const definition = {
      version: 1,
      nodes: [
        {
          id: "meta-mcp-node",
          type: "metaAdsMcpTool",
          position: { x: 0, y: 0 },
          data: {
            nodeType: "metaAdsMcpTool",
            toolId: "ads",
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

  check("META-M5-15 account_summary safe fields", async () => {
    const { result, calls } = await runTool(
      mcpNode("account_summary"),
      sourceContext([sourceNode("only-meta")])
    );
    const json = result.items[0].json;
    assertX.deepEqual(
      Object.keys(json).filter((key) => key !== "_meta").sort(),
      ["account_id", "account_status", "currency", "id", "name", "timezone_name"].sort()
    );
    assertX.equal(json.credentialId, undefined);
    assertX.equal(json.accessToken, undefined);
    assertX.equal(json.appSecret, undefined);
    assertX.equal(json.appsecretProof, undefined);
    const fields = String(calls[0].query.fields || "");
    for (const metric of INSIGHTS_METRICS) {
      assertX.equal(fields.includes(metric), false, metric);
    }
    assertX.equal(registry().getToolDefinition("meta_ads", "account_summary").inputSchema.properties.adAccountId, undefined);
  });

  check("META-M5-16 campaigns one entity per WorkflowItem", async () => {
    const { result } = await runTool(
      mcpNode("campaigns"),
      sourceContext([sourceNode("only-meta")]),
      {
        transport: async () => ({
          ok: true,
          status: 200,
          body: page([
            { ...campaignRow, id: "111", name: "A" },
            { ...campaignRow, id: "112", name: "B" },
          ]),
        }),
      }
    );
    assertX.equal(result.items.length, 2);
    assertX.equal(result.items[0].json.id, "111");
    assertX.equal(result.items[1].json.id, "112");
    assertX.equal(typeof result.items[0].json, "object");
    assertX.equal(Array.isArray(result.items[0].json), false);
  });

  check("META-M5-17 ad_sets one entity per WorkflowItem", async () => {
    const { result } = await runTool(
      mcpNode("ad_sets"),
      sourceContext([sourceNode("only-meta")]),
      {
        transport: async () => ({
          ok: true,
          status: 200,
          body: page([
            { ...adSetRow, id: "222" },
            { ...adSetRow, id: "223" },
          ]),
        }),
      }
    );
    assertX.equal(result.items.length, 2);
    assertX.equal(result.items[0].json.id, "222");
    assertX.equal(result.items[1].json.id, "223");
  });

  check("META-M5-18 ads one entity per WorkflowItem", async () => {
    const { result } = await runTool(
      mcpNode("ads"),
      sourceContext([sourceNode("only-meta")]),
      {
        transport: async () => ({
          ok: true,
          status: 200,
          body: page([
            { ...adRow, id: "333" },
            { ...adRow, id: "334" },
          ]),
        }),
      }
    );
    assertX.equal(result.items.length, 2);
    assertX.equal(typeof result.items[0].json.creative, "object");
    assertX.equal(typeof result.items[0].json.creative, "object");
    assertX.equal(result.items[0].json.creative.id, "444");
  });

  check("META-M5-19 creative nested object remains structured", async () => {
    const { result } = await runTool(
      mcpNode("creatives"),
      sourceContext([sourceNode("only-meta")])
    );
    const spec = result.items[0].json.object_story_spec;
    assertX.equal(typeof spec, "object");
    assertX.equal(Array.isArray(spec), false);
    assertX.equal(typeof spec, "object");
    assertX.equal(spec.page_id, "555");
    assertX.equal(spec.link_data.message, "Hello");
    assertX.equal(typeof spec.link_data, "object");
    const blob = JSON.stringify(result.items[0].json);
    assertX.equal(blob.includes('"object_story_spec":"{'), false);
    assertX.equal(blob.includes('"object_story_spec":"['), false);
  });

  check("META-M5-20 no Insights metrics requested by Common tools", async () => {
    for (const toolId of COMMON_IDS) {
      for (const field of catalog().COMMON_FIELDS[toolId]) {
        assertX.equal(INSIGHTS_METRICS.includes(field), false, `${toolId}:${field}`);
      }
    }
    const { calls } = await runTool(
      mcpNode("campaigns"),
      sourceContext([sourceNode("only-meta")])
    );
    const fields = String(calls[0].query.fields || "");
    for (const metric of INSIGHTS_METRICS) {
      assertX.equal(fields.includes(metric), false, metric);
    }
    assertX.equal(fields.includes("insights"), false);
  });

  const invalidIdCases = [
    ["META-M5-21", "campaigns", "campaignId"],
    ["META-M5-22", "ad_sets", "adSetId"],
    ["META-M5-23", "ads", "adId"],
    ["META-M5-24", "creatives", "creativeId"],
  ];
  for (const [id, toolId, param] of invalidIdCases) {
    check(`${id} ${param} validation`, async () => {
      await assertX.rejects(
        () =>
          runTool(
            mcpNode(toolId, { params: { [param]: "not-a-meta-id" } }),
            sourceContext([sourceNode("only-meta")])
          ),
        (error) => error.code === "META_FILTER_INVALID" && error.message === "Invalid entity ID"
      );
      await assertX.rejects(
        () =>
          runTool(
            mcpNode(toolId, { params: { [param]: "act_111" } }),
            sourceContext([sourceNode("only-meta")])
          ),
        (error) => error.code === "META_FILTER_INVALID"
      );
    });
  }

  check("META-M5-25 status validation", async () => {
    let enabledError = null;
    try {
      await runTool(
        mcpNode("campaigns", { params: { effectiveStatus: "ENABLED" } }),
        sourceContext([sourceNode("only-meta")])
      );
    } catch (error) {
      enabledError = error;
    }
    assertX.ok(enabledError, "ENABLED must be rejected");
    assertX.ok(
      enabledError.code === "MCP_INVALID_PARAMS" || enabledError.code === "META_FILTER_INVALID",
      `${enabledError.code} ${enabledError.message}`
    );
    const adSetOk = catalog().buildEntityQuery("ad_sets", { effectiveStatus: "CAMPAIGN_PAUSED" });
    assertX.equal(adSetOk.effective_status, JSON.stringify(["CAMPAIGN_PAUSED"]));
    let campaignStatusError = null;
    try {
      catalog().buildEntityQuery("campaigns", { effectiveStatus: "CAMPAIGN_PAUSED" });
    } catch (error) {
      campaignStatusError = error;
    }
    assertX.ok(campaignStatusError);
    assertX.equal(campaignStatusError.code, "META_FILTER_INVALID");
    assertX.equal(campaignStatusError.message, "Invalid status/filter");
    const adOk = catalog().buildEntityQuery("ads", { effectiveStatus: "ADSET_PAUSED" });
    assertX.equal(adOk.effective_status, JSON.stringify(["ADSET_PAUSED"]));
    const query = catalog().buildEntityQuery("campaigns", { effectiveStatus: "PAUSED" });
    assertX.equal(query.effective_status, JSON.stringify(["PAUSED"]));
    assertX.ok(catalog().EFFECTIVE_STATUS.ad.includes("PENDING_REVIEW"));
    assertX.equal(catalog().EFFECTIVE_STATUS.campaign.includes("PENDING_REVIEW"), false);
    assertX.equal(catalog().EFFECTIVE_STATUS.campaign.includes("CAMPAIGN_PAUSED"), false);
  });

  check("META-M5-26 cursor pagination uses after", async () => {
    let page = 0;
    const { calls } = await runTool(
      mcpNode("campaigns", { params: { returnAll: true } }),
      sourceContext([sourceNode("only-meta")]),
      {
        transport: async (_u, _o, { calls: seen }) => {
          page += 1;
          const after = page < 3 ? `cursor-${page}` : "";
          return {
            ok: true,
            status: 200,
            body: page === 3
              ? { data: [{ ...campaignRow, id: String(page) }], paging: {} }
              : {
                  data: [{ ...campaignRow, id: String(page) }],
                  paging: { cursors: { after }, next: `https://graph.facebook.com/v26.0/act_${ACCOUNT}/campaigns?access_token=${LONG}&after=${after}` },
                },
          };
        },
      }
    );
    assertX.equal(calls.length, 3);
    assertX.equal(calls[0].query.after, undefined);
    assertX.equal(calls[1].query.after, "cursor-1");
    assertX.equal(calls[2].query.after, "cursor-2");
  });

  check("META-M5-27 paging.next not fetched directly", async () => {
    const leaked = `https://graph.facebook.com/v26.0/act_${ACCOUNT}/campaigns?access_token=${LONG}&appsecret_proof=abc&after=nxt`;
    const { calls } = await runTool(
      mcpNode("campaigns", { params: { returnAll: true } }),
      sourceContext([sourceNode("only-meta")]),
      {
        transport: async (u) => {
          if (String(u.href) === leaked || String(u.toString()) === leaked) {
            throw new Error("fetched paging.next");
          }
          const after = u.searchParams.get("after");
          if (!after) {
            return {
              ok: true,
              status: 200,
              body: {
                data: [{ ...campaignRow, id: "1" }],
                paging: { cursors: { after: "safe-cursor" }, next: leaked },
              },
            };
          }
          return {
            ok: true,
            status: 200,
            body: { data: [{ ...campaignRow, id: "2" }], paging: {} },
          };
        },
      }
    );
    assertX.equal(calls.some((row) => row.url === leaked), false);
    assertX.equal(calls[1].query.after, "safe-cursor");
    assertX.equal(JSON.stringify(calls).includes(LONG), true);
    assertX.equal(calls.every((row) => row.method === "GET"), true);
  });

  check("META-M5-28 hard page cap", async () => {
    const { calls, result } = await runTool(
      mcpNode("campaigns", { params: { returnAll: true } }),
      sourceContext([sourceNode("only-meta")]),
      {
        transport: async (u) => {
          const after = u.searchParams.get("after") || "0";
          const n = Number(after) || 0;
          return {
            ok: true,
            status: 200,
            body: {
              data: [{ ...campaignRow, id: String(n + 1) }],
              paging: {
                cursors: { after: String(n + 1) },
                next: "https://graph.facebook.com/v26.0/next",
              },
            },
          };
        },
      }
    );
    assertX.equal(calls.length, 20);
    assertX.equal(result.items.length, 20);
    assertX.equal(result.items[0].json._meta.truncated, true);
  });

  check("META-M5-29 hard row cap", async () => {
    const { result, calls } = await runTool(
      mcpNode("campaigns", { params: { returnAll: true } }),
      sourceContext([sourceNode("only-meta")]),
      {
        transport: async () => ({
          ok: true,
          status: 200,
          body: {
            data: Array.from({ length: 100 }, (_, i) => ({ ...campaignRow, id: String(i) })),
            paging: { cursors: { after: "more" }, next: "https://graph.facebook.com/v26.0/next" },
          },
        }),
      }
    );
    assertX.equal(result.items.length, 2000);
    assertX.ok(calls.length <= 20);
    assertX.equal(result.items[0].json._meta.truncated, true);
  });

  check("META-M5-30 truncated state correct", async () => {
    const complete = await runTool(
      mcpNode("campaigns"),
      sourceContext([sourceNode("only-meta")])
    );
    assertX.equal(complete.result.items[0].json._meta.truncated, undefined);
    const capped = await runTool(
      mcpNode("campaigns", { params: { limit: 1 } }),
      sourceContext([sourceNode("only-meta")]),
      {
        transport: async () => ({
          ok: true,
          status: 200,
          body: {
            data: [{ ...campaignRow, id: "1" }],
            paging: { cursors: { after: "more" }, next: "https://example.invalid/next" },
          },
        }),
      }
    );
    assertX.equal(capped.result.items.length, 1);
    assertX.equal(capped.result.items[0].json._meta.truncated, true);
  });

  check("META-M5-31 Meta provenance correct", async () => {
    const expected = {
      account_summary: "ad_account",
      campaigns: "campaign",
      ad_sets: "adset",
      ads: "ad",
      creatives: "ad_creative",
    };
    for (const toolId of COMMON_IDS) {
      const { result } = await runTool(mcpNode(toolId), sourceContext([sourceNode("only-meta")]));
      const meta = result.items[0].json._meta;
      assertX.equal(meta.provider, "meta_ads");
      assertX.equal(meta.tool, toolId);
      assertX.equal(meta.resource, expected[toolId]);
      assertX.equal(meta.adAccountId, ACCOUNT);
      assertX.equal(meta.apiVersion, "v26.0");
      assertX.equal(meta.credentialId, undefined);
      assertX.equal(meta.accessToken, undefined);
    }
  });

  const entityRow = (tool, extra = {}) => [
    {
      json: {
        id: "111",
        name: "Brand",
        ...extra,
        _meta: {
          provider: "meta_ads",
          tool,
          resource: catalog().COMMON_RESOURCE[tool],
          adAccountId: ACCOUNT,
          apiVersion: "v26.0",
        },
      },
    },
  ];

  check("META-M5-32 tool-specific grounding correct", () => {
    const cases = [
      ["account_summary", "Meta Ads Account"],
      ["campaigns", "Meta Ads Campaigns"],
      ["ad_sets", "Meta Ads Ad Sets"],
      ["ads", "Meta Ads Ads"],
      ["creatives", "Meta Ads Creatives"],
    ];
    for (const [tool, label] of cases) {
      const g = grounding().applyMetaAdsAiGrounding({
        systemPrompt: "Summarize",
        input: entityRow(tool),
      });
      assertX.equal(g.grounded, true);
      assertX.equal(g.source, "meta_ads");
      assertX.ok(g.systemPrompt.includes(`report: ${label}`), label);
      assertX.ok(g.systemPrompt.includes("entity records"));
      assertX.ok(g.systemPrompt.includes("not Insights performance reports"));
      assertX.equal(g.systemPrompt.includes("These rows are Meta Ads Insights rows"), false);
      assertX.equal(/Ad Group/.test(g.systemPrompt), false);
    }
  });

  check("META-M5-33 Google Ads grounding skipped for Meta output", () => {
    const rows = entityRow("campaigns");
    const google = require("../services/workflowGoogleAdsAiGrounding");
    assertX.equal(google.applyGoogleAdsAiGrounding({ systemPrompt: "s", input: rows }).grounded, false);
  });

  check("META-M5-34 GA4 grounding skipped", () => {
    const rows = entityRow("ad_sets");
    const ga4 = require("../services/workflowGa4AiGrounding");
    assertX.equal(
      ga4.applyGa4NativeAiGrounding({ systemPrompt: "s", userPrompt: "u", input: rows, context: {} }).grounded,
      false
    );
    const { applyMcpAiGrounding } = require("../services/workflowMcpAiGrounding");
    assertX.equal(applyMcpAiGrounding({ systemPrompt: "s", userPrompt: "u", input: rows }).grounded, false);
  });

  check("META-M5-35 GSC grounding skipped", () => {
    const rows = entityRow("ads", { creative: { id: "444" } });
    const { applyMcpAiGrounding } = require("../services/workflowMcpAiGrounding");
    assertX.equal(applyMcpAiGrounding({ systemPrompt: "s", userPrompt: "u", input: rows }).grounded, false);
    const g = grounding().applyMetaAdsAiGrounding({ systemPrompt: "", input: rows });
    assertX.equal(g.systemPrompt.includes("source: google_ads"), false);
    assertX.equal(g.systemPrompt.includes("GA4 Intelligence Report") && !g.systemPrompt.includes("Do not call this a GA4 Intelligence Report"), false);
    assertX.ok(g.systemPrompt.includes("report: Meta Ads Ads"));
  });

  check("META-M5-36 no token leakage", async () => {
    const { result } = await runTool(
      mcpNode("campaigns"),
      sourceContext([sourceNode("only-meta")])
    );
    const blob = JSON.stringify(result);
    assertX.equal(blob.includes(LONG), false);
    assertX.equal(blob.includes("access_token"), false);
    assertX.equal(blob.includes("accessToken"), false);
  });

  check("META-M5-37 no app secret leakage", async () => {
    const { result } = await runTool(
      mcpNode("account_summary"),
      sourceContext([sourceNode("only-meta")])
    );
    const blob = JSON.stringify(result);
    assertX.equal(blob.includes(APP_SECRET), false);
    assertX.equal(blob.includes("appSecret"), false);
  });

  check("META-M5-38 no appsecret_proof leakage", async () => {
    const { result, calls } = await runTool(
      mcpNode("ads"),
      sourceContext([sourceNode("only-meta")])
    );
    const blob = JSON.stringify(result);
    assertX.equal(blob.includes("appsecret_proof"), false);
    assertX.equal(blob.includes("appsecretProof"), false);
    assertX.ok(calls[0].query.appsecret_proof);
  });

  check("META-M5-39 ads_read remains only Meta permission", () => {
    const { OAUTH_SCOPES } = require("../config/metaGraph");
    assertX.deepEqual([...OAUTH_SCOPES], ["ads_read"]);
    assertX.equal(OAUTH_SCOPES.includes("ads_management"), false);
    for (const rel of [
      "plugins/meta-ads-mcp/src/executor.js",
      "plugins/meta-ads-mcp/src/contracts/tools.js",
      "plugins/meta-ads-mcp/src/contracts/catalog.js",
    ]) {
      assertX.equal(read(rel).includes("ads_management"), false, rel);
    }
  });

  check("META-M5-40 Graph writes remain unreachable", async () => {
    const src = read("plugins/meta-ads-mcp/src/executor.js");
    assertX.equal(/method:\s*["']POST["']/.test(src), false);
    let write = false;
    await runTool(mcpNode("campaigns"), sourceContext([sourceNode("only-meta")]), {
      transport: async (_u, options) => {
        if (String(options?.method || "GET").toUpperCase() !== "GET") write = true;
        return { ok: true, status: 200, body: page([campaignRow]) };
      },
    });
    assertX.equal(write, false);
    await assertX.rejects(
      () => ads().metaGraphRequest({ path: `act_${ACCOUNT}/campaigns`, method: "POST", accessToken: LONG }),
      (error) => error.code === "META_PERMISSION_DENIED"
    );
    await assertX.rejects(
      () =>
        metaMcp().executeMetaAdsMcpTool({
          toolId: "custom_insights",
          credentialId: CRED_ID,
          account: { adAccountId: ACCOUNT },
        }),
      (error) => error.code === "MCP_UNKNOWN_TOOL"
    );
  });

  check("META-M5-41 native M3 reports unchanged", () => {
    const nativeCatalog = require("../services/metaAdsReportCatalog");
    assertX.deepEqual(Object.keys(nativeCatalog.REPORTS).sort(), [
      "account_performance",
      "ad_performance",
      "ad_set_performance",
      "campaign_performance",
    ].sort());
    const native = read("backend/services/workflowMetaAds.service.js");
    assertX.match(native, /executeMetaAdsNode/);
    assertX.equal(native.includes("account_summary"), false);
    assertX.deepEqual(
      dropdownTools().filter((tool) => tool.uiGroup === "common").map((tool) => tool.id),
      ["account_summary", "campaigns", "ad_sets", "ads", "creatives"]
    );
  });

  check("META-M5-42 M4 source auto-binding unchanged", () => {
    const account = metaMcp().resolveMetaAdsAccountContext(
      mcpNode("campaigns"),
      sourceContext([sourceNode("only-meta")])
    );
    assertX.equal(account.adAccountId, ACCOUNT);
    assertX.equal(account.credentialId, CRED_ID);
    const state = metaMcp().metaAdsSourceFieldState([sourceNode("only-meta")], "");
    assertX.equal(state.showSelector, false);
  });

  check("META-M5-43 M4 multi-source selector unchanged", () => {
    const state = metaMcp().metaAdsSourceFieldState(
      [sourceNode("meta-a", { label: "Brand" }), sourceNode("meta-b", { label: "Retail" })],
      ""
    );
    assertX.equal(state.showSelector, true);
    assertX.equal(state.message, null);
  });

  check("META-M5-44 generic Dynamic MCP Tool remains hidden", () => {
    const lib = JSON.parse(read("frontend/src/modules/workflows/nodeLibrary.json"));
    const nodes = lib.nodes || lib;
    const generic = nodes.find((n) => n.engineType === "mcpDynamicTool");
    assertX.equal(generic?.hidden, true);
  });

  check("META-M5-45 structured outputs render through the new inspector without stringifying", async () => {
    const { result } = await runTool(
      mcpNode("creatives"),
      sourceContext([sourceNode("only-meta")])
    );
    const json = result.items[0].json;
    assertX.equal(typeof json.object_story_spec, "object");
    assertX.equal(typeof json.object_story_spec.link_data, "object");
    const viewer = read("frontend/src/modules/workflows/inspectorViewModel.ts");
    assertX.match(viewer, /compactObjectPreview/);
    assertX.match(viewer, /kind: "object"/);
    assertX.match(viewer, /toCanonicalItems/);
    const adsResult = await runTool(mcpNode("ads"), sourceContext([sourceNode("only-meta")]));
    assertX.equal(typeof adsResult.result.items[0].json.creative, "object");
    assertX.equal(typeof adsResult.result.items[0].json.creative.id, "string");
  });
};

module.exports = { registerMetaAdsM5Tests };

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
  registerMetaAdsM5Tests({
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
