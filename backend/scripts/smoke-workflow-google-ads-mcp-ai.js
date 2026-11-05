/**
 * Google Ads MCP → AI auxiliary tool binding (MCP-AI-1..8).
 * L1/L2 focused — does not run the full workflow suite.
 */
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

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

const {
  getExecutionEdges,
  getAuxiliaryEdges,
  resolveAuxiliaryBindings,
  listOutputPorts,
  validateTypedConnection,
  CONNECTION_KIND,
  DATA_TYPE,
} = require("../services/workflowConnection.service");
const {
  resolveAgentResources,
  materializeAgentRuntime,
  buildToolDescriptor,
  AI_ERROR,
} = require("../services/workflowAiResources.service");
const { executeGraphInMemory } = require("../services/workflowEngine.service");
const registry = () => require("../services/mcpDynamicRegistry.service");
const adsHost = () => require("../services/workflowGoogleAdsMcp.service");

const sourceNode = (id = "ads") => ({
  id,
  type: "googleAds",
  data: {
    label: "Google Ads",
    credentialId: "cred-ads-1",
    customerId: "1234567890",
    loginCustomerId: "1112223330",
  },
});

const mcpNode = (overrides = {}) => ({
  id: "mcp",
  type: "googleAdsMcpTool",
  data: {
    toolId: "account_summary",
    googleAdsSourceNodeId: "ads",
    params: {},
    ...overrides,
  },
});

const adsAiDefinition = ({ itemCount = 42 } = {}) => {
  const rows = Array.from({ length: itemCount }, (_, i) => ({
    campaignName: `Campaign ${i + 1}`,
    clicks: i + 1,
  }));
  const code = `return ${JSON.stringify(rows)};`;
  return {
    version: 1,
    nodes: [
      { id: "manual", type: "trigger", data: {} },
      {
        id: "ads",
        type: "code",
        data: { mode: "all", code },
      },
      sourceNode("ads-source"),
      mcpNode({ googleAdsSourceNodeId: "ads-source" }),
      {
        id: "agent",
        type: "aiAgent",
        data: { prompt: "{{item.campaignName}}" },
      },
      { id: "result", type: "result", data: {} },
      {
        id: "model",
        type: "aiModelProviderTest",
        data: { script: "echo" },
      },
    ],
    edges: [
      { id: "e1", source: "manual", target: "ads" },
      { id: "e2", source: "ads", target: "agent" },
      { id: "e3", source: "agent", target: "result" },
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
};

async function main() {
  console.log("\nGoogle Ads MCP → AI tool binding");

  await check("MCP-AI-1 Google Ads 42 items → AI main input remains 42", async () => {
    const def = adsAiDefinition({ itemCount: 42 });
    const mem = await executeGraphInMemory(def);
    const agentItems = mem.context.items.agent;
    assert.equal(agentItems.length, 42);
    assert.equal(agentItems[0].json.campaignName, "Campaign 1");
    assert.equal(agentItems[41].json.campaignName, "Campaign 42");
  });

  await check("MCP-AI-2 attaching MCP as auxiliary tool does not replace main items", async () => {
    const def = adsAiDefinition({ itemCount: 42 });
    const exec = getExecutionEdges(def);
    assert.equal(
      exec.some((e) => e.source === "mcp" && e.target === "agent"),
      false
    );
    assert.equal(
      exec.some((e) => e.source === "ads" && e.target === "agent"),
      true
    );
    const aux = getAuxiliaryEdges(def);
    assert.equal(
      aux.some(
        (e) =>
          e.source === "mcp" &&
          e.target === "agent" &&
          e.sourceHandle === "tool" &&
          e.targetHandle === "tools"
      ),
      true
    );
    const mem = await executeGraphInMemory(def);
    assert.equal(mem.context.items.agent.length, 42);
    assert.equal(
      mem.context.items.agent.every((row) => row.json?.campaignName),
      true
    );
  });

  await check("MCP-AI-3 MCP source binding works without Google Ads → MCP main edge", async () => {
    const def = adsAiDefinition();
    assert.equal(
      def.edges.some((e) => e.source === "ads-source" && e.target === "mcp"),
      false
    );
    assert.equal(
      getExecutionEdges(def).some((e) => e.source === "ads-source" && e.target === "mcp"),
      false
    );
    const account = adsHost().resolveGoogleAdsAccountContext(mcpNode({
      googleAdsSourceNodeId: "ads-source",
    }), {
      graph: { nodes: def.nodes, edges: def.edges },
    });
    assert.equal(account.credentialId, "cred-ads-1");
    assert.equal(account.customerId, "1234567890");
    assert.equal(account.loginCustomerId, "1112223330");
    assert.equal(account.sourceNodeId, "ads-source");
  });

  await check("MCP-AI-4 manual MCP execution still returns its own result", async () => {
    const result = await registry().executeGoogleAdsMcpNode(
      mcpNode({ toolId: "account_summary", googleAdsSourceNodeId: "ads" }),
      { graph: { nodes: [sourceNode("ads")], edges: [] } },
      {
        googleApiRequest: async () => ({
          body: {
            results: [
              {
                customer: { id: "1234567890", descriptiveName: "Acme" },
                metrics: { costMicros: "1000000", clicks: "10" },
              },
            ],
          },
        }),
      }
    );
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].json._meta.tool, "account_summary");
    assert.equal(result.output.itemCount, 1);
  });

  await check("MCP-AI-5 standalone MCP execution unchanged", async () => {
    const result = await registry().executeGoogleAdsMcpNode(
      {
        id: "mcp-standalone",
        type: "googleAdsMcpTool",
        data: { toolId: "list_accessible_customers" },
      },
      {
        graph: {
          nodes: [sourceNode("only-ads")],
          edges: [],
        },
      },
      {
        googleApiRequest: async () => ({
          body: { resourceNames: ["customers/1234567890"] },
        }),
      }
    );
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].json.customerId, "1234567890");
    assert.equal(result.items[0].json._meta.provider, "google_ads");
  });

  await check("MCP-AI-6 credential/customer context inherited server-side", async () => {
    let seenCredential = null;
    let seenCustomer = null;
    const node = mcpNode({
      toolId: "search",
      googleAdsSourceNodeId: "ads",
      params: { query: "SELECT campaign.id FROM campaign", limit: 1 },
    });
    // Must not persist account fields on the MCP node
    assert.equal(node.data.credentialId, undefined);
    assert.equal(node.data.customerId, undefined);
    await registry().executeGoogleAdsMcpNode(
      node,
      { graph: { nodes: [sourceNode("ads")], edges: [] } },
      {
        googleApiRequest: async (spec) => {
          seenCredential = spec.credentialId;
          seenCustomer = String(spec.url || "");
          return { body: { results: [{ campaign: { id: "1" } }] } };
        },
      }
    );
    assert.equal(seenCredential, "cred-ads-1");
    assert.match(seenCustomer, /customers\/1234567890/);
  });

  await check("MCP-AI-7 no credentials copied into WorkflowItems", async () => {
    const result = await registry().executeGoogleAdsMcpNode(
      mcpNode({ toolId: "account_summary", googleAdsSourceNodeId: "ads" }),
      { graph: { nodes: [sourceNode("ads")], edges: [] } },
      {
        googleApiRequest: async () => ({
          body: {
            results: [
              {
                customer: { id: "1234567890" },
                metrics: { clicks: "1" },
              },
            ],
          },
        }),
      }
    );
    const blob = JSON.stringify(result.items);
    assert.equal(blob.includes("cred-ads-1"), false);
    assert.equal(blob.includes("credentialId"), false);
    assert.equal(blob.includes("developerToken"), false);
    assert.equal(blob.includes("accessToken"), false);
    assert.equal(result.items[0].json._meta.provider, "google_ads");
  });

  await check("MCP-AI-8 AI tool binding exposes the selected MCP tool correctly", async () => {
    const ports = listOutputPorts("googleAdsMcpTool");
    assert.ok(ports.some((p) => p.id === "main" && p.connectionKind === CONNECTION_KIND.EXECUTION));
    assert.ok(
      ports.some(
        (p) =>
          p.id === "tool" &&
          p.connectionKind === CONNECTION_KIND.AUXILIARY &&
          p.dataType === DATA_TYPE.AI_TOOL
      )
    );

    const ok = validateTypedConnection({
      sourceType: "googleAdsMcpTool",
      targetType: "aiAgent",
      sourceHandle: "tool",
      targetHandle: "tools",
    });
    assert.equal(ok.ok, true);

    const bad = validateTypedConnection({
      sourceType: "googleAdsMcpTool",
      targetType: "aiAgent",
      sourceHandle: "main",
      targetHandle: "tools",
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.code, "INCOMPATIBLE_PORT_TYPE");

    const def = adsAiDefinition();
    const bindings = resolveAuxiliaryBindings({ nodeId: "agent", definition: def });
    assert.equal(bindings.tools.length, 1);
    assert.equal(bindings.tools[0].sourceNodeId, "mcp");
    assert.equal(bindings.tools[0].sourceType, "googleAdsMcpTool");

    const resolved = resolveAgentResources({ nodeId: "agent", definition: def });
    assert.equal(resolved.toolDescriptors.length, 1);
    assert.equal(resolved.toolDescriptors[0].toolKind, "google_ads_mcp");
    assert.equal(resolved.toolDescriptors[0].adsToolId, "account_summary");
    assert.equal(resolved.toolDescriptors[0].name, "account_summary");
    assert.equal(resolved.toolDescriptors[0].kind, "ai-tool");
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        resolved.toolDescriptors[0].inputSchema.properties || {},
        "customerId"
      ),
      false
    );

    const desc = buildToolDescriptor(mcpNode({ toolId: "campaign_performance" }));
    assert.equal(desc.adsToolId, "campaign_performance");
    assert.equal(desc.toolKind, "google_ads_mcp");

    const runtime = materializeAgentRuntime(resolved);
    assert.equal(runtime.toolsByName.has("account_summary"), true);

    let toolInvokeCount = 0;
    const original = registry().executeGoogleAdsMcpNode;
    registry().executeGoogleAdsMcpNode = async (...args) => {
      toolInvokeCount += 1;
      return original(...args);
    };
    try {
      const text = await runtime.toolsByName.get("account_summary").execute(
        {},
        {
          graph: { nodes: [sourceNode("ads-source"), mcpNode()], edges: [] },
          workspaceId: "ws-1",
        }
      );
      // Without googleApiRequest mock this may fail auth — call descriptor path only.
      void text;
    } catch {
      // Executor wiring is proven by materialize + name; live Ads call not required here.
    } finally {
      registry().executeGoogleAdsMcpNode = original;
    }
    void toolInvokeCount;

    // Prove executor invokes host with inherited context (mocked HTTP).
    const live = materializeAgentRuntime(
      resolveAgentResources({
        nodeId: "agent",
        definition: {
          ...def,
          nodes: def.nodes.map((n) =>
            n.id === "mcp"
              ? mcpNode({ toolId: "account_summary", googleAdsSourceNodeId: "ads-source" })
              : n
          ),
        },
      })
    );
    const prevReq = require("../services/googleOAuth.service").googleApiRequest;
    // Prefer deps injection via executeGoogleAdsMcpNode mock
    const reg = registry();
    const prevExec = reg.executeGoogleAdsMcpNode;
    let sawToolId = null;
    let sawNoCredOnNode = false;
    reg.executeGoogleAdsMcpNode = async (node, context) => {
      sawToolId = node.data.toolId;
      sawNoCredOnNode = node.data.credentialId == null;
      assert.ok(context.graph);
      return {
        output: { toolId: node.data.toolId, itemCount: 1 },
        items: [
          {
            json: {
              customer: { id: "1234567890" },
              _meta: { provider: "google_ads", tool: node.data.toolId },
            },
          },
        ],
      };
    };
    try {
      const out = await live.toolsByName.get("account_summary").execute(
        { limit: 1 },
        { graph: { nodes: def.nodes, edges: def.edges } }
      );
      const parsed = JSON.parse(out);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.toolId, "account_summary");
      assert.equal(parsed.itemCount, 1);
      assert.equal(sawToolId, "account_summary");
      assert.equal(sawNoCredOnNode, true);
      assert.equal(JSON.stringify(parsed).includes("cred-ads-1"), false);
    } finally {
      reg.executeGoogleAdsMcpNode = prevExec;
      void prevReq;
    }

    // Contract files expose tool port
    const feContract = fs.readFileSync(
      path.join(__dirname, "../../frontend/src/modules/workflows/nodeContract.ts"),
      "utf8"
    );
    assert.match(feContract, /googleAdsMcpTool:[\s\S]*id: "tool"[\s\S]*dataType: "ai-tool"/);
  });

  // Unknown toolId still rejected
  await check("MCP-AI-8b unknown toolId rejected at descriptor build", () => {
    assert.throws(
      () => buildToolDescriptor(mcpNode({ toolId: "not_a_real_tool" })),
      (err) => err.code === AI_ERROR.TOOL_SCHEMA_INVALID
    );
  });

  console.log(`\n${passed} MCP-AI checks passed`);
  process.exit(process.exitCode || 0);
}

void main();
