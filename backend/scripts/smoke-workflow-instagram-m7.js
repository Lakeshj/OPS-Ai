/**
 * Instagram M7 — dedicated MCP READ tools (IG-MCP-1..23).
 * L1/L2 focused — does not run the full workflow suite.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const IG_USER = "17841400000000001";
const MEDIA_ID = "17890000000000001";
const TOKEN = "IG_LONG_LIVED_TOKEN_SECRET_VALUE";
const CRED_ID = "cred-ig-m7";

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

const read = (rel) =>
  fs.readFileSync(path.join(__dirname, "../..", rel), "utf8");

const baseCred = (overrides = {}) => ({
  id: CRED_ID,
  type: "instagram",
  name: "IG",
  workspaceId: "ws-1",
  secret: {
    accessToken: TOKEN,
    expiresAt: "2099-01-01T00:00:00.000Z",
    grantedPermissions: [
      "instagram_business_basic",
      "instagram_business_manage_comments",
      "instagram_business_manage_insights",
      "instagram_business_content_publishing",
    ],
    instagramUserId: IG_USER,
    ...(overrides.secret || {}),
  },
  config: {
    connected: true,
    instagramUserId: IG_USER,
    username: "brand_ig",
    grantedPermissions: [
      "instagram_business_basic",
      "instagram_business_manage_comments",
      "instagram_business_manage_insights",
      "instagram_business_content_publishing",
    ],
    ...(overrides.config || {}),
  },
});

const igSource = (id = "ig-1", extra = {}) => ({
  id,
  type: "instagram",
  data: {
    label: "Instagram",
    credentialId: CRED_ID,
    resource: "account",
    operation: "get_profile",
    ...extra,
  },
});

const mcpNode = (overrides = {}) => ({
  id: "ig-mcp-1",
  type: "instagramMcpTool",
  data: {
    nodeType: "instagramMcpTool",
    toolId: "account_summary",
    instagramSourceNodeId: "ig-1",
    params: {},
    ...overrides,
  },
});

async function main() {
  console.log("\nInstagram M7 MCP READ tools");

  const registry = () => require("../services/mcpDynamicRegistry.service");
  const host = () => require("../services/workflowInstagramMcp.service");
  const ig = () => require("../services/workflowInstagram.service");
  const auth = () => require("../services/workflowInstagramAuth.service");
  const comments = () => require("../services/workflowInstagramComments.service");
  const catalog = () => require("../services/instagramInsightsCatalog");
  const workflows = () => require("../modules/workflows/workflows.service");
  const {
    listOutputPorts,
    validateTypedConnection,
    resolveAuxiliaryBindings,
    getExecutionEdges,
    CONNECTION_KIND,
    DATA_TYPE,
  } = require("../services/workflowConnection.service");
  const {
    resolveAgentResources,
    buildToolDescriptor,
    materializeAgentRuntime,
    AI_ERROR,
  } = require("../services/workflowAiResources.service");
  const handlers = () => require("../services/workflowNodes.service").handlers;

  await check("IG-MCP-1 instagramMcpTool registered", () => {
    assert.equal(typeof handlers().instagramMcpTool, "function");
    assert.equal(workflows().ALLOWED_NODE_TYPES.has("instagramMcpTool"), true);
    assert.ok(read("frontend/src/modules/workflows/types.ts").includes('| "instagramMcpTool"'));
    assert.ok(
      read("frontend/src/modules/workflows/nodeContract.ts").includes(
        'type: "instagramMcpTool"'
      )
    );
    assert.ok(
      read("frontend/src/modules/workflows/nodeLibrary.json").includes(
        '"engineType": "instagramMcpTool"'
      )
    );
    const providers = registry().listProviders();
    assert.ok(providers.some((p) => p.id === "instagram"));
    const tools = registry().listTools({ provider: "instagram" });
    assert.deepEqual(
      tools.map((t) => t.id).sort(),
      [
        "account_insights",
        "account_summary",
        "comments",
        "list_media",
        "media_details",
        "media_insights",
      ]
    );
  });

  await check("IG-MCP-2 tool port is auxiliary, not main-data", () => {
    const ports = listOutputPorts("instagramMcpTool");
    assert.ok(
      ports.some((p) => p.id === "main" && p.connectionKind === CONNECTION_KIND.EXECUTION)
    );
    assert.ok(
      ports.some(
        (p) =>
          p.id === "tool" &&
          p.connectionKind === CONNECTION_KIND.AUXILIARY &&
          p.dataType === DATA_TYPE.AI_TOOL
      )
    );
    const ok = validateTypedConnection({
      sourceType: "instagramMcpTool",
      targetType: "aiAgent",
      sourceHandle: "tool",
      targetHandle: "tools",
    });
    assert.equal(ok.ok, true);
    const bad = validateTypedConnection({
      sourceType: "instagramMcpTool",
      targetType: "aiAgent",
      sourceHandle: "main",
      targetHandle: "tools",
    });
    assert.equal(bad.ok, false);
  });

  await check("IG-MCP-3 source binding inherits credentialId", async () => {
    const account = await host().resolveInstagramAccountContext(
      mcpNode(),
      { workspaceId: "ws-1", graph: { nodes: [igSource()], edges: [] } },
      {
        resolveCredentialContext: async ({ credentialId }) => {
          assert.equal(credentialId, CRED_ID);
          return { credentialId, instagramUserId: IG_USER, cred: baseCred() };
        },
      }
    );
    assert.equal(account.credentialId, CRED_ID);
    assert.equal(account.sourceNodeId, "ig-1");
  });

  await check("IG-MCP-4 source binding inherits instagramUserId", async () => {
    const account = await host().resolveInstagramAccountContext(
      mcpNode(),
      { workspaceId: "ws-1", graph: { nodes: [igSource()], edges: [] } },
      {
        resolveCredentialContext: async () => ({
          credentialId: CRED_ID,
          instagramUserId: IG_USER,
          cred: baseCred(),
        }),
      }
    );
    assert.equal(account.instagramUserId, IG_USER);
  });

  await check("IG-MCP-5 no access token stored on MCP node", () => {
    const sanitized = registry().sanitizeInstagramMcpNodeData({
      toolId: "account_summary",
      credentialId: CRED_ID,
      instagramUserId: IG_USER,
      accessToken: TOKEN,
      params: { accessToken: TOKEN, mediaId: MEDIA_ID },
      instagramSourceNodeId: "ig-1",
    });
    assert.equal(sanitized.credentialId, undefined);
    assert.equal(sanitized.instagramUserId, undefined);
    assert.equal(sanitized.accessToken, undefined);
    assert.equal(sanitized.params.accessToken, undefined);
    assert.equal(sanitized.instagramSourceNodeId, "ig-1");
    assert.equal(JSON.stringify(sanitized).includes(TOKEN), false);
  });

  await check("IG-MCP-6 missing source returns safe config error", async () => {
    await assert.rejects(
      () =>
        host().resolveInstagramAccountContext(mcpNode(), {
          graph: { nodes: [], edges: [] },
        }),
      (err) =>
        err.code === "INSTAGRAM_SOURCE_REQUIRED" ||
        err.code === "INSTAGRAM_SOURCE_MISSING"
    );
    await assert.rejects(
      () =>
        host().resolveInstagramAccountContext(
          mcpNode({ instagramSourceNodeId: "gone" }),
          { graph: { nodes: [igSource()], edges: [] } }
        ),
      (err) => err.code === "INSTAGRAM_SOURCE_MISSING"
    );
  });

  await check("IG-MCP-7 account_summary delegates to native profile logic", async () => {
    let saw = null;
    const result = await registry().executeInstagramMcpNode(
      mcpNode({ toolId: "account_summary" }),
      { workspaceId: "ws-1", graph: { nodes: [igSource()], edges: [] } },
      {
        resolveCredentialContext: async () => ({
          credentialId: CRED_ID,
          instagramUserId: IG_USER,
          cred: baseCred(),
        }),
        executeInstagramMcp: async (args) => {
          saw = args;
          return host().executeInstagramMcpTool(args, {
            getProfile: async (spec) => {
              assert.equal(spec.instagramUserId, IG_USER);
              assert.equal(spec.credentialId, CRED_ID);
              return {
                id: IG_USER,
                username: "brand_ig",
                _meta: { provider: "instagram", operation: "get_profile" },
              };
            },
          });
        },
      }
    );
    assert.equal(saw.toolId, "account_summary");
    assert.equal(result.items[0].json.tool, "account_summary");
    assert.equal(result.items[0].json.provider, "instagram");
    assert.equal(result.items[0].json.username, "brand_ig");
  });

  await check("IG-MCP-8 list_media uses native pagination/caps", async () => {
    let listArgs = null;
    const result = await registry().executeInstagramMcpNode(
      mcpNode({ toolId: "list_media", params: { limit: 3 } }),
      { workspaceId: "ws-1", graph: { nodes: [igSource()], edges: [] } },
      {
        resolveCredentialContext: async () => ({
          credentialId: CRED_ID,
          instagramUserId: IG_USER,
          cred: baseCred(),
        }),
        executeInstagramMcp: async (args) =>
          host().executeInstagramMcpTool(args, {
            listMedia: async (spec) => {
              listArgs = spec;
              return {
                rows: [
                  {
                    id: MEDIA_ID,
                    mediaId: MEDIA_ID,
                    _meta: { provider: "instagram", truncated: false },
                  },
                ],
                truncated: false,
              };
            },
          }),
      }
    );
    assert.equal(listArgs.limit, 3);
    assert.equal(listArgs.returnAll, false);
    assert.equal(result.items[0].json.tool, "list_media");
  });

  await check("IG-MCP-9 media_details requires mediaId", async () => {
    await assert.rejects(
      () =>
        registry().executeInstagramMcpNode(
          mcpNode({ toolId: "media_details", params: {} }),
          { workspaceId: "ws-1", graph: { nodes: [igSource()], edges: [] } },
          {
            resolveCredentialContext: async () => ({
              credentialId: CRED_ID,
              instagramUserId: IG_USER,
              cred: baseCred(),
            }),
          }
        ),
      (err) =>
        err.code === "MCP_INVALID_PARAMS" || err.code === "INSTAGRAM_MEDIA_INVALID"
    );
  });

  await check("IG-MCP-10 comments is read-only and uses native comments logic", async () => {
    let commentArgs = null;
    const result = await registry().executeInstagramMcpNode(
      mcpNode({ toolId: "comments", params: { mediaId: MEDIA_ID, maxItems: 10 } }),
      { workspaceId: "ws-1", graph: { nodes: [igSource()], edges: [] } },
      {
        resolveCredentialContext: async () => ({
          credentialId: CRED_ID,
          instagramUserId: IG_USER,
          cred: baseCred(),
        }),
        executeInstagramMcp: async (args) =>
          host().executeInstagramMcpTool(args, {
            listComments: async (spec) => {
              commentArgs = spec;
              return {
                rows: [
                  {
                    id: "c1",
                    text: "hi",
                    _meta: { provider: "instagram", operation: "list_comments" },
                  },
                ],
              };
            },
          }),
      }
    );
    assert.equal(commentArgs.mediaId, MEDIA_ID);
    assert.equal(commentArgs.limit, 10);
    assert.equal(commentArgs.returnAll, false);
    assert.equal(result.items[0].json.tool, "comments");
    const tools = registry().listTools({ provider: "instagram" });
    assert.equal(tools.some((t) => t.id === "reply_comment"), false);
  });

  await check("IG-MCP-11 account_insights uses M4 metric catalog", async () => {
    let insightData = null;
    await registry().executeInstagramMcpNode(
      mcpNode({
        toolId: "account_insights",
        params: { preset: "overview", period: "day" },
      }),
      { workspaceId: "ws-1", graph: { nodes: [igSource()], edges: [] } },
      {
        resolveCredentialContext: async () => ({
          credentialId: CRED_ID,
          instagramUserId: IG_USER,
          cred: baseCred(),
        }),
        executeInstagramMcp: async (args) =>
          host().executeInstagramMcpTool(args, {
            runAccountInsights: async (spec) => {
              insightData = spec.data;
              const built = catalog().buildAccountInsightRequests({
                preset: spec.data.preset,
                period: spec.data.period,
              });
              assert.ok(built.metrics.includes("views"));
              return {
                rows: [
                  {
                    metric: "views",
                    value: 12,
                    _meta: { provider: "instagram", operation: "account_insights" },
                  },
                ],
              };
            },
          }),
      }
    );
    assert.equal(insightData.preset, "overview");
  });

  await check("IG-MCP-12 media_insights uses M4 media-type validation", async () => {
    await assert.rejects(
      async () =>
        catalog().buildMediaInsightRequest({
          preset: "custom",
          metrics: ["ig_reels_avg_watch_time"],
          mediaType: "IMAGE",
        }),
      (err) =>
        err.code === "INSTAGRAM_INSIGHTS_MEDIA_UNSUPPORTED" ||
        /media|metric|supported/i.test(String(err.message || err))
    );
    let mediaType = null;
    await registry().executeInstagramMcpNode(
      mcpNode({
        toolId: "media_insights",
        params: { mediaId: MEDIA_ID, mediaType: "REELS", preset: "overview" },
      }),
      { workspaceId: "ws-1", graph: { nodes: [igSource()], edges: [] } },
      {
        resolveCredentialContext: async () => ({
          credentialId: CRED_ID,
          instagramUserId: IG_USER,
          cred: baseCred(),
        }),
        executeInstagramMcp: async (args) =>
          host().executeInstagramMcpTool(args, {
            runMediaInsights: async (spec) => {
              mediaType = spec.data.mediaType;
              return {
                rows: [
                  {
                    metric: "views",
                    value: 9,
                    _meta: { provider: "instagram", operation: "media_insights" },
                  },
                ],
              };
            },
          }),
      }
    );
    assert.equal(mediaType, "REELS");
  });

  await check("IG-MCP-13 unsupported arbitrary metric rejected", async () => {
    await assert.rejects(
      () =>
        registry().executeTool({
          provider: "instagram",
          toolId: "account_insights",
          credentialId: CRED_ID,
          params: { preset: "custom", metrics: ["made_up_metric_xyz"] },
          account: { instagramUserId: IG_USER },
          cred: baseCred(),
        }),
      (err) =>
        err.code === "MCP_INVALID_PARAMS" ||
        /unsupported|unknown|metric/i.test(String(err.message || ""))
    );
  });

  await check("IG-MCP-14 no publish tools exposed", () => {
    const tools = registry().listTools({ provider: "instagram", exposure: "all" });
    for (const id of [
      "publish_image",
      "publish_carousel",
      "publish_reel",
      "publish_story",
    ]) {
      assert.equal(tools.some((t) => t.id === id), false, id);
    }
    const plugin = require("../../plugins/instagram-mcp/src/index.js");
    for (const id of plugin.WRITE_TOOL_IDS.filter((x) => x.startsWith("publish"))) {
      assert.equal(plugin.tools.some((t) => t.id === id), false);
    }
  });

  await check("IG-MCP-15 no reply_comment tool exposed", () => {
    const tools = registry().listTools({ provider: "instagram", exposure: "all" });
    assert.equal(tools.some((t) => t.id === "reply_comment"), false);
  });

  await check("IG-MCP-16 tool result never replaces main WorkflowItems", () => {
    const def = {
      version: 1,
      nodes: [
        { id: "manual", type: "trigger", data: {} },
        igSource("ig-src"),
        mcpNode({ instagramSourceNodeId: "ig-src" }),
        { id: "agent", type: "aiAgent", data: { prompt: "x" } },
        { id: "model", type: "aiChatModel", data: {} },
      ],
      edges: [
        { id: "e1", source: "manual", target: "ig-src" },
        { id: "e2", source: "ig-src", target: "agent" },
        {
          id: "eaux",
          source: "ig-mcp-1",
          target: "agent",
          sourceHandle: "tool",
          targetHandle: "tools",
        },
        {
          id: "emodel",
          source: "model",
          target: "agent",
          sourceHandle: "model",
          targetHandle: "model",
        },
      ],
    };
    const exec = getExecutionEdges(def);
    assert.equal(
      exec.some((e) => e.source === "ig-mcp-1" && e.target === "agent"),
      false
    );
    const bindings = resolveAuxiliaryBindings({ nodeId: "agent", definition: def });
    assert.equal(bindings.tools.length, 1);
    assert.equal(bindings.tools[0].sourceType, "instagramMcpTool");
  });

  await check("IG-MCP-17 main Instagram input + MCP tools coexist correctly", () => {
    const def = {
      version: 1,
      nodes: [
        igSource("ig-src"),
        mcpNode({
          toolId: "list_media",
          instagramSourceNodeId: "ig-src",
        }),
        { id: "agent", type: "aiAgent", data: { prompt: "{{item.username}}" } },
        { id: "model", type: "aiChatModel", data: {} },
      ],
      edges: [
        { id: "main", source: "ig-src", target: "agent" },
        {
          id: "tool",
          source: "ig-mcp-1",
          target: "agent",
          sourceHandle: "tool",
          targetHandle: "tools",
        },
        {
          id: "emodel",
          source: "model",
          target: "agent",
          sourceHandle: "model",
          targetHandle: "model",
        },
      ],
    };
    const bindings = resolveAuxiliaryBindings({ nodeId: "agent", definition: def });
    assert.equal(bindings.tools[0].sourceNodeId, "ig-mcp-1");
    const resolved = resolveAgentResources({ nodeId: "agent", definition: def });
    assert.equal(resolved.toolDescriptors[0].toolKind, "instagram_mcp");
    assert.equal(resolved.toolDescriptors[0].igToolId, "list_media");
    const exec = getExecutionEdges(def);
    assert.ok(exec.some((e) => e.source === "ig-src" && e.target === "agent"));
    assert.equal(
      exec.some((e) => e.source === "ig-mcp-1" && e.target === "agent"),
      false
    );
  });

  await check("IG-MCP-18 missing permissions return safe tool error", async () => {
    await assert.rejects(
      () =>
        host().executeInstagramMcpTool(
          {
            toolId: "comments",
            credentialId: CRED_ID,
            params: { mediaId: MEDIA_ID },
            account: { instagramUserId: IG_USER },
            cred: baseCred({
              secret: { grantedPermissions: ["instagram_business_basic"] },
              config: { grantedPermissions: ["instagram_business_basic"] },
            }),
          },
          {
            listComments: async (spec) => comments().listComments(spec),
          }
        ),
      (err) =>
        err.code === "INSTAGRAM_PERMISSION_DENIED" ||
        /permission/i.test(String(err.message || ""))
    );
  });

  await check("IG-MCP-19 no secrets/paging URLs leak", async () => {
    const result = await registry().executeInstagramMcpNode(
      mcpNode({ toolId: "list_media" }),
      { workspaceId: "ws-1", graph: { nodes: [igSource()], edges: [] } },
      {
        resolveCredentialContext: async () => ({
          credentialId: CRED_ID,
          instagramUserId: IG_USER,
          cred: baseCred(),
        }),
        executeInstagramMcp: async (args) =>
          host().executeInstagramMcpTool(args, {
            listMedia: async () => ({
              rows: [
                {
                  id: MEDIA_ID,
                  mediaId: MEDIA_ID,
                  paging: {
                    next: `https://graph.facebook.com/media?access_token=${TOKEN}`,
                    cursors: { after: "CUR" },
                  },
                  _meta: { provider: "instagram" },
                },
              ],
            }),
          }),
      }
    );
    const blob = JSON.stringify(result.items);
    assert.equal(blob.includes(TOKEN), false);
    assert.equal(blob.includes("access_token="), false);
    assert.equal(blob.includes(CRED_ID), false);
  });

  await check("IG-MCP-20 Google Ads MCP auxiliary regression green", () => {
    const ports = listOutputPorts("googleAdsMcpTool");
    assert.ok(ports.some((p) => p.id === "tool" && p.connectionKind === CONNECTION_KIND.AUXILIARY));
    assert.ok(registry().listProviders().some((p) => p.id === "google_ads"));
    assert.ok(
      registry().listTools({ provider: "google_ads" }).some((t) => t.id === "account_summary")
    );
  });

  await check("IG-MCP-21 Meta Ads MCP auxiliary regression green", () => {
    assert.ok(registry().listProviders().some((p) => p.id === "meta_ads"));
    assert.ok(
      registry().listTools({ provider: "meta_ads" }).some((t) => t.id === "account_summary")
    );
    const ports = listOutputPorts("metaAdsMcpTool");
    assert.ok(ports.some((p) => p.id === "main"));
  });

  await check("IG-MCP-22 AI Agent tool registration regression green", () => {
    const desc = buildToolDescriptor(
      mcpNode({ toolId: "account_insights", params: { preset: "overview" } })
    );
    assert.equal(desc.toolKind, "instagram_mcp");
    assert.equal(desc.igToolId, "account_insights");
    assert.equal(
      Object.prototype.hasOwnProperty.call(desc.inputSchema.properties || {}, "credentialId"),
      false
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(desc.inputSchema.properties || {}, "instagramUserId"),
      false
    );
    assert.throws(
      () => buildToolDescriptor(mcpNode({ toolId: "not_real" })),
      (err) => err.code === AI_ERROR.TOOL_SCHEMA_INVALID
    );
    const googleDesc = buildToolDescriptor({
      id: "g",
      type: "googleAdsMcpTool",
      data: { toolId: "account_summary" },
    });
    assert.equal(googleDesc.toolKind, "google_ads_mcp");
  });

  await check("IG-MCP-23 AI item/dataset scope regression green", () => {
    const scope = require("../services/workflowAiContextScope");
    assert.equal(typeof scope.resolveAiContextScope, "function");
    const item = scope.resolveAiContextScope({ contextScope: "item" });
    const dataset = scope.resolveAiContextScope({ contextScope: "dataset" });
    assert.ok(item);
    assert.ok(dataset);
    assert.notEqual(item, dataset);
  });

  // Materialize Instagram MCP tool executor shape
  await check("IG-MCP-22b materialize Instagram MCP tool executor", async () => {
    const def = {
      version: 1,
      nodes: [
        igSource("ig-src"),
        mcpNode({
          toolId: "account_summary",
          instagramSourceNodeId: "ig-src",
        }),
        { id: "agent", type: "aiAgent", data: { prompt: "x" } },
        { id: "model", type: "aiChatModel", data: {} },
      ],
      edges: [
        {
          id: "eaux",
          source: "ig-mcp-1",
          target: "agent",
          sourceHandle: "tool",
          targetHandle: "tools",
        },
        {
          id: "emodel",
          source: "model",
          target: "agent",
          sourceHandle: "model",
          targetHandle: "model",
        },
      ],
    };
    const resolved = resolveAgentResources({ nodeId: "agent", definition: def });
    const runtime = materializeAgentRuntime(resolved);
    // M8.15: MCP tools use stable namespaced names (provider_toolId).
    assert.equal(runtime.toolsByName.has("instagram_account_summary"), true);
    const reg = registry();
    const prev = reg.executeInstagramMcpNode;
    reg.executeInstagramMcpNode = async () => ({
      output: { toolId: "account_summary", itemCount: 1 },
      items: [
        {
          json: {
            provider: "instagram",
            tool: "account_summary",
            instagramUserId: IG_USER,
            username: "brand_ig",
          },
        },
      ],
    });
    try {
      const out = await runtime.toolsByName.get("instagram_account_summary").execute(
        {},
        { graph: { nodes: def.nodes, edges: def.edges }, workspaceId: "ws-1" }
      );
      const parsed = JSON.parse(out);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.provider, "instagram");
      assert.equal(parsed.tool, "account_summary");
      assert.equal(parsed.instagramUserId, IG_USER);
      assert.ok(Array.isArray(parsed.data));
    } finally {
      reg.executeInstagramMcpNode = prev;
    }
  });

  // Prove native services still export expected entry points (non-regression hooks)
  await check("IG-MCP native export surface frozen", () => {
    assert.equal(typeof ig().getProfile, "function");
    assert.equal(typeof ig().listMedia, "function");
    assert.equal(typeof ig().getMedia, "function");
    assert.equal(typeof ig().runAccountInsights, "function");
    assert.equal(typeof ig().runMediaInsights, "function");
    assert.equal(typeof comments().listComments, "function");
    assert.equal(typeof auth().loadCredentialRow, "function");
  });

  console.log(`\n${passed} IG-MCP checks passed`);
  process.exit(process.exitCode || 0);
}

void main();
