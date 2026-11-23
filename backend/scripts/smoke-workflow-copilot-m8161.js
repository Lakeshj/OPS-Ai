/**
 * M8.16.1 — Workflow Copilot against local mock MCP fixture (no Instagram).
 *
 * Asserts graph awareness, published tool capabilities, native-vs-MCP
 * distinction, selected-node, latest-run explanation, and secret stripping.
 */
const assert = require("node:assert/strict");

const bridge = require("../services/workflowCopilotContextBridge.service");
const {
  planCopilotTurn,
} = require("../services/workflowCopilotPlan.service");
const {
  buildContextAwareFixtureReply,
} = require("../services/workflowCopilotConversational.service");
const fixture = require("../services/workflowMockSocialMcp.fixture");

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

const mockWorkflow = ({
  nativeResource = "comments",
  nativeOperation = "list_comments",
} = {}) => ({
  version: 1,
  nodes: [
    { id: "manual", type: "trigger", data: { label: "Manual" } },
    {
      id: "mock-src",
      type: "mockSocialSource",
      data: {
        label: "Mock Social Source",
        resource: nativeResource,
        operation: nativeOperation,
        accountName: "mock_local_account",
        accessToken: "SECRET_MOCK_TOKEN_XYZ",
        appSecret: "SECRET_APP",
      },
    },
    {
      id: "mock-mcp",
      type: "mockSocialMcpTool",
      data: {
        label: "Mock MCP Tool",
        toolId: fixture.TOOL_ID_LIST_POSTS,
        mockSocialSourceNodeId: "mock-src",
      },
    },
    {
      id: "model",
      type: "aiModelProviderTest",
      data: { script: "mock-list-posts-demo", label: "Model" },
    },
    {
      id: "agent1",
      type: "aiAgent",
      data: {
        label: "AI Agent",
        prompt: "Summarize recent social posts",
      },
    },
  ],
  edges: [
    { id: "e-main", source: "manual", target: "agent1" },
    {
      id: "e-model",
      source: "model",
      target: "agent1",
      sourceHandle: "model",
      targetHandle: "model",
    },
    {
      id: "e-tool",
      source: "mock-mcp",
      target: "agent1",
      sourceHandle: "tool",
      targetHandle: "tools",
    },
  ],
  settings: {},
});

const latestRun = () => ({
  id: "run-m8161",
  runId: "run-m8161",
  status: "succeeded",
  steps: {
    agent1: {
      status: "succeeded",
      output: {
        agentMeta: [
          {
            toolsAvailable: [fixture.PUBLIC_TOOL_NAME],
            toolsRequested: [fixture.PUBLIC_TOOL_NAME],
            toolsUsed: [fixture.PUBLIC_TOOL_NAME],
            toolErrors: [],
            modelRequests: 2,
            groundingRetryTriggered: false,
            toolEdgesFound: 1,
            toolNodesResolved: 1,
          },
        ],
      },
    },
  },
});

(async () => {
  console.log("\nM8.16.1 Workflow Copilot + mock MCP context");

  await check("M8161-C-1 Graph + relationships + toolCapabilities", () => {
    const ctx = bridge.buildWorkflowContext({
      workflow: { id: "wf-m8161", name: "Mock Agent" },
      editorDefinition: mockWorkflow(),
      selectedNodeId: "agent1",
    });
    assert.ok(ctx.nodes.some((n) => n.type === "mockSocialSource"));
    assert.ok(ctx.nodes.some((n) => n.type === "mockSocialMcpTool"));
    assert.ok(ctx.nodes.some((n) => n.type === "aiAgent"));
    assert.ok(
      ctx.relationships.some(
        (r) =>
          r.type === "tool_binding" &&
          r.from === "mock-mcp" &&
          r.to === "agent1"
      )
    );
    assert.ok(
      ctx.relationships.some(
        (r) =>
          r.type === "source_binding" &&
          r.from === "mock-mcp" &&
          r.to === "mock-src"
      )
    );
    const mcp = ctx.nodes.find((n) => n.id === "mock-mcp");
    assert.ok(mcp.toolCapabilities?.length >= 1);
    assert.equal(mcp.toolCapabilities[0].name, fixture.PUBLIC_TOOL_NAME);
    assert.match(
      mcp.toolCapabilities[0].description || "",
      /mock social posts/i
    );
  });

  await check("M8161-C-2 Connected to AI Agent", async () => {
    const res = await planCopilotTurn({
      forceMode: "deterministic",
      allowClientExecution: true,
      message: "What is connected to my AI Agent?",
      workflowId: "wf-m8161",
      workflow: { id: "wf-m8161", name: "Mock Agent", workspaceId: "ws-1" },
      definition: mockWorkflow(),
      selectedNodeId: "agent1",
    });
    console.log("\nQ1:", res.assistantMessage.slice(0, 400));
    assert.match(res.assistantMessage, /Mock MCP Tool|mock-mcp/i);
    assert.match(res.assistantMessage, /tool/i);
  });

  await check("M8161-C-3 Tools AI Agent can use = mock_list_posts", async () => {
    const res = await planCopilotTurn({
      forceMode: "deterministic",
      allowClientExecution: true,
      message: "What tools can my AI Agent use?",
      workflowId: "wf-m8161",
      workflow: { id: "wf-m8161", name: "Mock Agent", workspaceId: "ws-1" },
      definition: mockWorkflow(),
      selectedNodeId: "agent1",
    });
    console.log("\nQ2:", res.assistantMessage.slice(0, 400));
    assert.match(res.assistantMessage, /mock_list_posts/);
    assert.ok(
      !/only list comments|can only list comments/i.test(res.assistantMessage)
    );
  });

  await check("M8161-C-4 What does this tool allow", async () => {
    const res = await planCopilotTurn({
      forceMode: "deterministic",
      allowClientExecution: true,
      message: "What does this tool allow the AI Agent to do?",
      workflowId: "wf-m8161",
      workflow: { id: "wf-m8161", name: "Mock Agent", workspaceId: "ws-1" },
      definition: mockWorkflow(),
      selectedNodeId: "mock-mcp",
    });
    console.log("\nQ3:", res.assistantMessage.slice(0, 400));
    assert.match(res.assistantMessage, /mock_list_posts|recent mock social posts/i);
    assert.match(res.assistantMessage, /likes|comments|date|type/i);
  });

  await check("M8161-C-5 Latest run tool usage explanation", async () => {
    const res = await planCopilotTurn({
      forceMode: "deterministic",
      allowClientExecution: true,
      message:
        "Why did my AI Agent use or not use the connected tool in its last run?",
      workflowId: "wf-m8161",
      workflow: { id: "wf-m8161", name: "Mock Agent", workspaceId: "ws-1" },
      definition: mockWorkflow(),
      selectedNodeId: "agent1",
      execution: latestRun(),
    });
    console.log("\nQ4:", res.assistantMessage.slice(0, 500));
    assert.match(res.assistantMessage, /toolsAvailable/);
    assert.match(res.assistantMessage, /mock_list_posts/);
    assert.match(res.assistantMessage, /toolsUsed/);
    assert.match(res.assistantMessage, /modelRequests/);
  });

  await check("M8161-C-6 Native operation ≠ MCP capability", () => {
    const ctx = bridge.buildWorkflowContext({
      workflow: { id: "wf-m8161" },
      editorDefinition: mockWorkflow({
        nativeResource: "comments",
        nativeOperation: "list_comments",
      }),
      selectedNodeId: "agent1",
    });
    const src = ctx.nodes.find((n) => n.id === "mock-src");
    const mcp = ctx.nodes.find((n) => n.id === "mock-mcp");
    assert.equal(src.resource, "comments");
    assert.equal(src.operation, "list_comments");
    assert.equal(mcp.toolCapabilities[0].name, fixture.PUBLIC_TOOL_NAME);
    assert.ok(!/list_comments/i.test(mcp.toolCapabilities[0].name));

    const prompt = bridge.formatWorkflowContextForPrompt(ctx);
    const reply = buildContextAwareFixtureReply({
      message: "What tools can my AI Agent use?",
      workflowContextPrompt: prompt,
      selectedNodeId: "agent1",
    });
    assert.ok(reply);
    assert.match(reply, /mock_list_posts/);
    assert.match(reply, /native/i);
    assert.ok(!/AI Agent can only list comments/i.test(reply));
    assert.ok(!/only list comments because/i.test(reply));
  });

  await check("M8161-C-7 Selected node + secrets absent", async () => {
    const res = await planCopilotTurn({
      forceMode: "deterministic",
      allowClientExecution: true,
      message: "What is connected to this agent?",
      workflowId: "wf-m8161",
      workflow: { id: "wf-m8161", name: "Mock Agent", workspaceId: "ws-1" },
      definition: mockWorkflow(),
      selectedNodeId: "agent1",
    });
    assert.equal(res.copilotMeta?.selectedNodeId, "agent1");
    const blob = JSON.stringify(res);
    assert.ok(!blob.includes("SECRET_MOCK_TOKEN_XYZ"));
    assert.ok(!blob.includes("SECRET_APP"));
    assert.ok(!blob.includes("accessToken"));
  });

  console.log(`\n${passed} M8.16.1 Copilot checks passed`);
  process.exit(process.exitCode || 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
