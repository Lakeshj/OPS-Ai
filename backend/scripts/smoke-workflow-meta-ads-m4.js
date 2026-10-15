/**
 * Meta Ads M4 — dedicated MCP tools node + source inheritance.
 * Mocked Graph transport only. No live Meta calls.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const LONG = "EAATestLongLivedTokenValue";
const APP_SECRET = "meta-app-secret-test";
const CRED_ID = "cred-meta-m4";
const ACCOUNT = "123456789";
const NOW = Date.parse("2026-10-06T12:00:00Z");

const registerMetaAdsM4Tests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Meta Ads M4 dedicated MCP tools node + source inheritance");

  const registry = () => require("../services/mcpDynamicRegistry.service");
  const metaMcp = () => require("../services/workflowMetaAdsMcp.service");
  const ads = () => require("../services/workflowMetaAds.service");
  const { handlers } = require("../services/workflowNodes.service");
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
    config: { selectedAdAccountId: "999999999", ...extra.config },
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

  const accountPage = {
    data: [
      {
        id: "act_123456789",
        account_id: "123456789",
        name: "Acme",
        account_status: 1,
        currency: "EUR",
        timezone_name: "Europe/Paris",
      },
    ],
  };

  const runInternal = async (node, context, { credential = cred(), loaded = [] } = {}) => {
    const calls = [];
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
            calls.push({
              url,
              path: u.pathname,
              query: Object.fromEntries(u.searchParams.entries()),
              method: options?.method || "GET",
            });
            if (u.pathname.endsWith("/me/adaccounts")) {
              return { ok: true, status: 200, body: accountPage };
            }
            return { ok: false, status: 400, body: { error: { message: "unexpected" } } };
          },
        },
        () => registry().executeMetaAdsMcpNode(node, context)
      )
    );
    return { result, calls, loaded };
  };

  check("META-M4-1 Meta Ads MCP Tools appears in library", () => {
    const lib = JSON.parse(read("frontend/src/modules/workflows/nodeLibrary.json"));
    const nodes = lib.nodes || lib;
    const entry = nodes.find((n) => n.engineType === "metaAdsMcpTool");
    assertX.ok(entry);
    assertX.equal(entry.name, "Meta Ads MCP Tools");
    assertX.equal(entry.provider, "Meta");
    assertX.equal(entry.category, "Marketing");
    assertX.equal(entry.available, true);
    const aliases = entry.aliases || [];
    for (const alias of [
      "meta ads mcp",
      "facebook ads mcp",
      "meta tools",
      "facebook ads tools",
      "ads mcp meta",
      "meta marketing api",
    ]) {
      assertX.ok(aliases.includes(alias), alias);
    }
    const generic = nodes.find((n) => n.engineType === "mcpDynamicTool");
    assertX.equal(generic?.hidden, true);
  });

  check("META-M4-2 node type = metaAdsMcpTool", () => {
    assertX.equal(typeof handlers.metaAdsMcpTool, "function");
    const backendContract = require("../config/nodeContract");
    assertX.ok(JSON.stringify(backendContract).includes("metaAdsMcpTool"));
    assertX.ok(
      read("frontend/src/modules/workflows/nodeContract.ts").includes('type: "metaAdsMcpTool"')
    );
    assertX.ok(read("frontend/src/modules/workflows/types.ts").includes('| "metaAdsMcpTool"'));
    assertX.ok(
      read("frontend/src/components/workflows/WorkflowCanvas.tsx").includes(
        "metaAdsMcpTool: WorkflowNode"
      )
    );
    assertX.equal(workflows().ALLOWED_NODE_TYPES.has("metaAdsMcpTool"), true);
  });

  check("META-M4-3 provider implicitly = meta_ads", () => {
    assertX.equal(require("../../plugins/meta-ads-mcp/src").provider.id, "meta_ads");
    const providers = registry().listProviders();
    const meta = providers.find((row) => row.id === "meta_ads");
    assertX.ok(meta);
    assertX.equal(meta.authType, "meta_ads");
    const canvas = read("frontend/src/components/workflows/WorkflowCanvas.tsx");
    assertX.match(canvas, /case "metaAdsMcpTool"/);
    assertX.doesNotMatch(
      canvas.slice(canvas.indexOf('case "metaAdsMcpTool"'), canvas.indexOf('case "metaAdsMcpTool"') + 280),
      /provider:/
    );
  });

  check("META-M4-4 generic provider picker is not shown", () => {
    const renderer = read("frontend/src/components/workflows/params/NodeParameterRenderer.tsx");
    assertX.match(renderer, /lockedProvider="meta_ads"/);
    const field = read("frontend/src/components/workflows/params/DynamicMcpToolField.tsx");
    assertX.match(field, /lockedProvider \? null/);
  });

  check("META-M4-5 exactly one metaAds node auto-binds", async () => {
    const { calls, loaded, result } = await runInternal(
      mcpNode("list_accessible_ad_accounts"),
      sourceContext([sourceNode("only-meta")])
    );
    assertX.equal(loaded[0], CRED_ID);
    assertX.ok(calls[0].path.endsWith("/me/adaccounts"));
    assertX.equal(result.items[0].json.adAccountId, "123456789");
    assertX.equal(mcpNode("list_accessible_ad_accounts").data.metaAdsSourceNodeId, undefined);
  });

  check("META-M4-6 single source → no Meta Ads Source selector", () => {
    const state = metaMcp().metaAdsSourceFieldState(
      [sourceNode("only-meta", { label: "Main account" })],
      ""
    );
    assertX.equal(state.showSelector, false);
    assertX.equal(state.message, null);
    assertX.equal(state.sources.length, 1);
    const ui = read("frontend/src/components/workflows/params/DynamicMcpToolField.tsx");
    assertX.match(ui, /sourceState\?\.showSelector/);
    assertX.match(ui, /Meta Ads Source/);
  });

  check("META-M4-7 multiple metaAds nodes → selector appears", () => {
    const state = metaMcp().metaAdsSourceFieldState(
      [
        sourceNode("meta-a", { label: "Brand" }),
        sourceNode("meta-b", { label: "Retail" }),
      ],
      ""
    );
    assertX.equal(state.showSelector, true);
    assertX.deepEqual(
      state.sources.map((row) => `${row.label} (${row.id})`),
      ["Brand (meta-a)", "Retail (meta-b)"]
    );
    assertX.equal(state.message, null);
  });

  check("META-M4-8 selected source id persists", () => {
    const definition = {
      version: 1,
      nodes: [
        {
          id: "meta-mcp-node",
          type: "metaAdsMcpTool",
          position: { x: 0, y: 0 },
          data: {
            nodeType: "metaAdsMcpTool",
            toolId: "list_accessible_ad_accounts",
            metaAdsSourceNodeId: "meta-b",
            credentialId: "should-not-persist",
            adAccountId: "should-not-persist",
            params: {},
          },
        },
      ],
      edges: [],
    };
    workflows().validateDefinition(definition);
    assertX.equal(definition.nodes[0].data.metaAdsSourceNodeId, "meta-b");
    assertX.equal(definition.nodes[0].data.credentialId, undefined);
    assertX.equal(definition.nodes[0].data.adAccountId, undefined);
  });

  check("META-M4-9 no source → actionable validation", async () => {
    await assertX.rejects(
      () =>
        registry().executeMetaAdsMcpNode(
          mcpNode("list_accessible_ad_accounts"),
          sourceContext([])
        ),
      (error) => error.message === "Add and configure a Meta Ads node first."
    );
    const state = metaMcp().metaAdsSourceFieldState([], "");
    assertX.equal(state.showSelector, false);
    assertX.equal(state.message, "Add and configure a Meta Ads node first.");
  });

  check("META-M4-10 deleted source → actionable validation", async () => {
    await assertX.rejects(
      () =>
        registry().executeMetaAdsMcpNode(
          mcpNode("list_accessible_ad_accounts", { metaAdsSourceNodeId: "gone" }),
          sourceContext([sourceNode("still-here")])
        ),
      (error) =>
        error.message === "The selected Meta Ads source is no longer in this workflow."
    );
  });

  check("META-M4-11 missing source credential → validation", async () => {
    await assertX.rejects(
      () =>
        registry().executeMetaAdsMcpNode(
          mcpNode("list_accessible_ad_accounts"),
          sourceContext([sourceNode("meta-source", { credentialId: "" })])
        ),
      (error) =>
        error.message === "Configure a Meta Ads credential on the selected Meta Ads node."
    );
  });

  check("META-M4-12 missing source adAccountId → validation", async () => {
    await assertX.rejects(
      () =>
        registry().executeMetaAdsMcpNode(
          mcpNode("list_accessible_ad_accounts"),
          sourceContext([sourceNode("meta-source", { adAccountId: "  " })])
        ),
      (error) => error.message === "Select an Ad Account on the selected Meta Ads node."
    );
  });

  check("META-M4-13 credential inherited server-side", async () => {
    const { loaded } = await runInternal(
      mcpNode("list_accessible_ad_accounts"),
      sourceContext(
        [sourceNode("meta-source", { credentialId: "{{input.credentialId}}" })],
        { input: { credentialId: "cred-from-source" } }
      ),
      { credential: cred("cred-from-source") }
    );
    assertX.equal(loaded[0], "cred-from-source");
  });

  check("META-M4-14 adAccountId inherited server-side", () => {
    const account = metaMcp().resolveMetaAdsAccountContext(
      mcpNode("list_accessible_ad_accounts"),
      sourceContext([
        sourceNode("meta-source", {
          credentialId: CRED_ID,
          adAccountId: "111222333",
        }),
      ])
    );
    assertX.equal(account.adAccountId, "111222333");
    assertX.equal(account.credentialId, CRED_ID);
    const fromItems = metaMcp().resolveMetaAdsAccountContext(
      mcpNode("list_accessible_ad_accounts"),
      sourceContext(
        [sourceNode("meta-source", { adAccountId: "111222333" })],
        { inputItems: [{ json: { adAccountId: "888888888", credentialId: "from-item" } }] }
      )
    );
    assertX.equal(fromItems.adAccountId, "111222333");
    assertX.equal(fromItems.credentialId, CRED_ID);
  });

  check("META-M4-15 credentialId not persisted on MCP node", () => {
    const definition = {
      version: 1,
      nodes: [
        {
          id: "meta-mcp-node",
          type: "metaAdsMcpTool",
          position: { x: 0, y: 0 },
          data: {
            nodeType: "metaAdsMcpTool",
            toolId: "list_accessible_ad_accounts",
            credentialId: "cred-meta",
            params: { credentialId: "cred-meta" },
          },
        },
      ],
      edges: [],
    };
    workflows().validateDefinition(definition);
    assertX.equal(definition.nodes[0].data.credentialId, undefined);
    assertX.equal(definition.nodes[0].data.params.credentialId, undefined);
  });

  check("META-M4-16 adAccountId not persisted on MCP node", () => {
    const definition = {
      version: 1,
      nodes: [
        {
          id: "meta-mcp-node",
          type: "metaAdsMcpTool",
          position: { x: 0, y: 0 },
          data: {
            nodeType: "metaAdsMcpTool",
            toolId: "list_accessible_ad_accounts",
            adAccountId: ACCOUNT,
            provider: "meta_ads",
            params: { adAccountId: ACCOUNT },
          },
        },
      ],
      edges: [],
    };
    workflows().validateDefinition(definition);
    const saved = definition.nodes[0].data;
    assertX.equal(saved.adAccountId, undefined);
    assertX.equal(saved.provider, undefined);
    assertX.equal(saved.params.adAccountId, undefined);
  });

  check("META-M4-17 list_accessible_ad_accounts registered", () => {
    const tool = registry().getToolDefinition("meta_ads", "list_accessible_ad_accounts");
    assertX.equal(tool.uiGroup, "internal");
    assertX.equal(tool.implemented, true);
    assertX.equal(tool.access, "read");
    assertX.equal(tool.risk, "low");
    assertX.equal(tool.authType, "meta_ads");
  });

  check("META-M4-18 list_accessible_ad_accounts hidden from normal dropdown", () => {
    const ids = registry().listTools({ provider: "meta_ads" }).map((tool) => tool.id);
    assertX.equal(ids.includes("list_accessible_ad_accounts"), false);
    const ui = read("frontend/src/components/workflows/params/DynamicMcpToolField.tsx");
    assertX.match(ui, /SelectLabel>Common/);
  });

  check("META-M4-19 internal tool executes using inherited credential", async () => {
    const { result, calls, loaded } = await runInternal(
      mcpNode("list_accessible_ad_accounts", { metaAdsSourceNodeId: "meta-b" }),
      sourceContext([
        sourceNode("meta-a", { credentialId: "cred-a", adAccountId: "111111111" }),
        sourceNode("meta-b", { credentialId: "cred-b", adAccountId: "222222222" }),
      ]),
      { credential: cred("cred-b") }
    );
    assertX.equal(loaded[0], "cred-b");
    assertX.ok(calls[0].path.endsWith("/me/adaccounts"));
    assertX.equal(calls[0].method, "GET");
    assertX.equal(result.items[0].json.name, "Acme");
  });

  check("META-M4-20 Meta provenance correct", async () => {
    const { result } = await runInternal(
      mcpNode("list_accessible_ad_accounts"),
      sourceContext([sourceNode("only-meta")])
    );
    const meta = result.items[0].json._meta;
    assertX.equal(meta.provider, "meta_ads");
    assertX.equal(meta.tool, "list_accessible_ad_accounts");
    assertX.equal(meta.resource, "ad_account");
    assertX.equal(meta.apiVersion, "v26.0");
    assertX.equal(meta.credentialId, undefined);
  });

  check("META-M4-21 no Meta token/proof leakage", async () => {
    const { result, calls } = await runInternal(
      mcpNode("list_accessible_ad_accounts"),
      sourceContext([sourceNode("only-meta")])
    );
    const blob = JSON.stringify(result);
    assertX.equal(blob.includes(LONG), false);
    assertX.equal(blob.includes(APP_SECRET), false);
    assertX.equal(blob.includes("appsecret_proof"), false);
    assertX.equal(blob.includes("accessToken"), false);
    assertX.ok(calls[0].query.access_token);
    assertX.ok(calls[0].query.appsecret_proof);
  });

  check("META-M4-22 native metaAds node unchanged", () => {
    const native = read("backend/services/workflowMetaAds.service.js");
    assertX.equal(native.includes("metaAdsMcpTool"), false);
    assertX.equal(native.includes("list_accessible_ad_accounts"), false);
    assertX.match(native, /executeMetaAdsNode/);
    const catalog = require("../services/metaAdsReportCatalog");
    assertX.deepEqual(Object.keys(catalog.REPORTS).sort(), [
      "account_performance",
      "ad_performance",
      "ad_set_performance",
      "campaign_performance",
    ].sort());
  });

  check("META-M4-23 Meta M2 auth unchanged", () => {
    const { OAUTH_SCOPES, API_VERSION } = require("../config/metaGraph");
    assertX.deepEqual([...OAUTH_SCOPES], ["ads_read"]);
    assertX.equal(API_VERSION, "v26.0");
    assertX.equal(OAUTH_SCOPES.includes("ads_management"), false);
  });

  check("META-M4-24 Meta M3 reports unchanged", () => {
    const m3 = read("backend/scripts/smoke-workflow-meta-ads-m3.js");
    assertX.match(m3, /META-M3-1/);
    assertX.match(m3, /account_performance/);
    assertX.match(m3, /campaign_performance/);
    const native = read("backend/services/workflowMetaAds.service.js");
    assertX.match(native, /insights/);
  });

  check("META-M4-25 Google Ads MCP unchanged", () => {
    const adsIds = registry()
      .listTools({ provider: "google_ads" })
      .map((tool) => tool.id);
    assertX.ok(adsIds.includes("search"));
    assertX.equal(adsIds.includes("list_accessible_ad_accounts"), false);
    const plugin = read("plugins/google-ads-mcp/src/contracts/tools.js");
    assertX.equal(plugin.includes("meta_ads"), false);
    assertX.equal(plugin.includes("metaAdsMcpTool"), false);
  });

  check("META-M4-26 GA4/GSC MCP unchanged", () => {
    const gsc = registry().listTools({ provider: "google_search_console" });
    assertX.deepEqual(gsc.map((tool) => tool.id), ["inspect_url_enhanced"]);
    const ga4 = registry().listTools({ provider: "google_analytics" });
    assertX.ok(ga4.some((tool) => tool.id === "run_realtime_report"));
  });

  check("META-M4-27 no ads_management permission introduced", () => {
    const files = [
      "plugins/meta-ads-mcp/src/executor.js",
      "plugins/meta-ads-mcp/src/contracts/tools.js",
      "backend/services/workflowMetaAdsMcp.service.js",
      "backend/config/metaGraph.js",
    ];
    for (const rel of files) {
      assertX.equal(read(rel).includes("ads_management"), false, rel);
    }
  });

  check("META-M4-28 no Graph write endpoint reachable", async () => {
    const src = read("plugins/meta-ads-mcp/src/executor.js");
    assertX.equal(/method:\s*["']POST["']/.test(src), false);
    assertX.equal(/method:\s*["']PUT["']/.test(src), false);
    assertX.equal(/method:\s*["']DELETE["']/.test(src), false);
    assertX.equal(/paging\.next/.test(src) && /fetch\(/.test(src), false);
    let write = false;
    await withApp(() =>
      ads().withMetaTestHooks(
        {
          now: () => NOW,
          loadCredential: async () => cred(),
          transport: async (url, options) => {
            if (String(options?.method || "GET").toUpperCase() !== "GET") write = true;
            return { ok: true, status: 200, body: accountPage };
          },
        },
        () =>
          registry().executeMetaAdsMcpNode(
            mcpNode("list_accessible_ad_accounts"),
            sourceContext([sourceNode("only-meta")])
          )
      )
    );
    assertX.equal(write, false);
    await assertX.rejects(
      () => ads().metaGraphRequest({ path: "act_1", method: "POST", accessToken: LONG }),
      (error) => error.code === "META_PERMISSION_DENIED"
    );
  });
};

module.exports = { registerMetaAdsM4Tests };

if (require.main === module) {
  let passed = 0;
  const queue = [];
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
  registerMetaAdsM4Tests({ check, section: (name) => queue.push(async () => console.log(`\n${name}`)), assert });
  (async () => {
    for (const task of queue) await task();
    console.log(`\n${passed} checks passed`);
    process.exit(process.exitCode || 0);
  })();
}
