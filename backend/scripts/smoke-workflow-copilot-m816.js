/**
 * M8.16 — Workflow Context Bridge (editor ↔ Workflow Copilot).
 *
 * Generic infrastructure: identity, full graph, relationships, selected node,
 * sanitized editor draft, compact latest run, internal inspection tools,
 * secret stripping, cross-workspace guard, no-context fallback.
 */
const assert = require("node:assert/strict");

const bridge = require("../services/workflowCopilotContextBridge.service");
const {
  planCopilotTurn,
} = require("../services/workflowCopilotPlan.service");
const {
  buildContextAwareFixtureReply,
} = require("../services/workflowCopilotConversational.service");

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

const igAgentFixture = (extras = {}) => ({
  version: 1,
  nodes: [
    { id: "manual", type: "trigger", data: { label: "Manual" } },
    {
      id: "ig-src",
      type: "instagram",
      data: {
        resource: "media",
        operation: "list_media",
        credentialId: "cred-ig-secret",
        accessToken: "IGQV_SHOULD_NEVER_LEAK",
        refreshToken: "refresh_SHOULD_NEVER_LEAK",
        appSecret: "app_secret_SHOULD_NEVER_LEAK",
        username: "opsai_demo",
        instagramUserId: "17841400000000000",
        label: "Instagram Native",
      },
    },
    {
      id: "ig-mcp",
      type: "instagramMcpTool",
      data: {
        toolId: "list_media",
        instagramSourceNodeId: "ig-src",
        label: "Instagram MCP",
      },
    },
    {
      id: "model",
      type: "aiModelProviderTest",
      data: { script: "echo", temperature: 0, label: "Model" },
    },
    {
      id: "agent1",
      type: "aiAgent",
      data: {
        prompt: "Summarize recent Instagram posts",
        label: "AI Agent",
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
      source: "ig-mcp",
      target: "agent1",
      sourceHandle: "tool",
      targetHandle: "tools",
    },
  ],
  settings: {},
  ...extras,
});

const latestRunFixture = () => ({
  id: "run-m816",
  runId: "run-m816",
  status: "succeeded",
  steps: {
    agent1: {
      status: "succeeded",
      output: {
        agentMeta: [
          {
            toolsAvailable: ["instagram_list_media"],
            toolsRequested: [],
            toolsUsed: [],
            toolErrors: [],
            modelRequests: 1,
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
  console.log("M8.16 Workflow Context Bridge");

  await check("M816-1 Current workflowId in copilotMeta", async () => {
    const def = igAgentFixture();
    const res = await planCopilotTurn({
      forceMode: "deterministic",
      allowClientExecution: true,
      message: "hello",
      workflowId: "wf-m816",
      workflow: { id: "wf-m816", name: "IG Agent", workspaceId: "ws-1" },
      definition: def,
      selectedNodeId: "agent1",
    });
    assert.equal(res.copilotMeta?.workflowId, "wf-m816");
    assert.equal(res.copilotMeta?.selectedNodeId, "agent1");
    assert.ok((res.copilotMeta?.nodeCount || 0) >= 5);
    assert.ok((res.copilotMeta?.edgeCount || 0) >= 3);
    assert.ok((res.copilotMeta?.relationshipCount || 0) >= 2);
    assert.ok(
      Array.isArray(res.copilotMeta?.internalToolsAvailable) &&
        res.copilotMeta.internalToolsAvailable.includes("workflow_get_context")
    );
  });

  await check("M816-2 Graph awareness: nodes + edges", () => {
    const ctx = bridge.buildWorkflowContext({
      workflow: { id: "wf-m816", name: "IG Agent", workspaceId: "ws-1" },
      editorDefinition: igAgentFixture(),
      selectedNodeId: "agent1",
    });
    const types = ctx.nodes.map((n) => n.type).sort();
    assert.ok(types.includes("instagram"));
    assert.ok(types.includes("instagramMcpTool"));
    assert.ok(types.includes("aiAgent"));
    assert.equal(ctx.selectedNode?.id, "agent1");
    assert.ok(ctx.edges.some((e) => e.source === "ig-mcp" && e.target === "agent1"));
  });

  await check("M816-3 Tool/source relationships preserved", () => {
    const ctx = bridge.buildWorkflowContext({
      workflow: { id: "wf-m816" },
      editorDefinition: igAgentFixture(),
    });
    const tool = ctx.relationships.find(
      (r) => r.type === "tool_binding" && r.from === "ig-mcp" && r.to === "agent1"
    );
    const model = ctx.relationships.find(
      (r) => r.type === "model_binding" && r.from === "model" && r.to === "agent1"
    );
    const source = ctx.relationships.find(
      (r) =>
        r.type === "source_binding" &&
        r.from === "ig-mcp" &&
        r.to === "ig-src"
    );
    assert.ok(tool, "tool_binding missing");
    assert.ok(model, "model_binding missing");
    assert.ok(source, "source_binding missing");
  });

  await check("M816-4 Selected node resolves for 'this'", async () => {
    const def = igAgentFixture();
    const res = await planCopilotTurn({
      forceMode: "deterministic",
      allowClientExecution: true,
      message: "What is connected to this agent?",
      workflowId: "wf-m816",
      workflow: { id: "wf-m816", name: "IG Agent", workspaceId: "ws-1" },
      definition: def,
      selectedNodeId: "agent1",
    });
    assert.equal(res.copilotMeta?.selectedNodeId, "agent1");
    assert.match(res.assistantMessage, /AI Agent|agent1/i);
    assert.match(res.assistantMessage, /Instagram MCP|ig-mcp/i);
    assert.match(res.assistantMessage, /tool/i);
  });

  await check("M816-5 Unsaved editor draft overrides persisted", () => {
    const persisted = igAgentFixture();
    const draft = igAgentFixture();
    draft.nodes.push({
      id: "extra",
      type: "httpRequest",
      data: { label: "Unsaved HTTP", url: "https://example.com" },
    });
    const ctx = bridge.buildWorkflowContext({
      workflow: { id: "wf-m816", definition: persisted },
      editorDefinition: draft,
      persistedDefinition: persisted,
    });
    assert.equal(ctx.contextSource, "editor_draft");
    assert.ok(ctx.nodes.some((n) => n.id === "extra"));

    const same = bridge.buildWorkflowContext({
      workflow: { id: "wf-m816", definition: persisted },
      editorDefinition: persisted,
      persistedDefinition: persisted,
    });
    assert.equal(same.contextSource, "persisted");
  });

  await check("M816-6 Latest run compact meta", () => {
    const ctx = bridge.buildWorkflowContext({
      workflow: { id: "wf-m816" },
      editorDefinition: igAgentFixture(),
      selectedNodeId: "agent1",
      latestExecution: latestRunFixture(),
    });
    assert.equal(ctx.latestExecution?.runId, "run-m816");
    assert.equal(ctx.counts.latestRunAttached, true);
    const agent = ctx.latestExecution.agents?.[0];
    assert.ok(agent);
    assert.deepEqual(agent.toolsAvailable, ["instagram_list_media"]);
    assert.equal(agent.toolEdgesFound, 1);
    assert.equal(agent.toolsUsed.length, 0);
  });

  await check("M816-7 Security: no credentials/tokens in context/prompt", () => {
    const dirty = igAgentFixture();
    dirty.nodes[1].data.authorization = "Bearer SECRET_TOKEN_XYZ";
    dirty.settings = {
      workspaceId: "ws-should-drop",
      accessToken: "settings_token",
    };
    const ctx = bridge.buildWorkflowContext({
      workflow: { id: "wf-m816" },
      editorDefinition: dirty,
    });
    const prompt = bridge.formatWorkflowContextForPrompt(ctx);
    const blob = JSON.stringify({ ctx, prompt });
    assert.ok(!blob.includes("IGQV_SHOULD_NEVER_LEAK"));
    assert.ok(!blob.includes("refresh_SHOULD_NEVER_LEAK"));
    assert.ok(!blob.includes("app_secret_SHOULD_NEVER_LEAK"));
    assert.ok(!blob.includes("SECRET_TOKEN_XYZ"));
    assert.ok(!blob.includes("settings_token"));
    assert.ok(!blob.includes("ws-should-drop"));
    const ig = ctx.nodes.find((n) => n.id === "ig-src");
    assert.equal(ig.username, "opsai_demo");
    assert.equal(ig.credentialConfigured, true);
    assert.equal(ig.accessToken, undefined);
  });

  await check("M816-8 No workflow graph: Copilot still functions", async () => {
    const res = await planCopilotTurn({
      forceMode: "deterministic",
      allowClientExecution: true,
      message: "how are you",
      workflowId: "wf-empty",
      workflow: { id: "wf-empty", name: "Empty", workspaceId: "ws-1" },
      definition: { version: 1, nodes: [], edges: [], settings: {} },
    });
    assert.equal(res.intent, "GENERAL");
    assert.ok(res.assistantMessage);
    assert.equal(res.copilotMeta?.nodeCount, 0);
    assert.equal((res.plan?.operations || []).length, 0);
  });

  await check("M816-9 Cross-workspace workflow guard", () => {
    const ok = bridge.assertWorkflowWorkspaceAccess(
      { id: "wf-a", workspaceId: "ws-1" },
      "ws-1"
    );
    const denied = bridge.assertWorkflowWorkspaceAccess(
      { id: "wf-b", workspaceId: "ws-2" },
      "ws-1"
    );
    assert.equal(ok, true);
    assert.equal(denied, false);
  });

  await check("M816-10 Internal tools + why/account fixture answers", () => {
    const ctx = bridge.buildWorkflowContext({
      workflow: { id: "wf-m816", name: "IG Agent" },
      editorDefinition: igAgentFixture(),
      selectedNodeId: "agent1",
      latestExecution: latestRunFixture(),
    });
    const brief = bridge.buildInspectionBrief(
      ctx,
      "Why isn't the AI Agent getting Instagram data?"
    );
    assert.ok(brief?.toolsUsed?.includes("workflow_get_connections"));
    assert.ok(brief?.toolsUsed?.includes("workflow_get_latest_run"));

    const conn = bridge.executeInternalWorkflowTool(
      ctx,
      "workflow_get_connections",
      { nodeId: "agent1" }
    );
    assert.equal(conn.ok, true);
    assert.ok(
      conn.data.relationships.some((r) => r.type === "tool_binding")
    );

    const prompt = bridge.formatWorkflowContextForPrompt(ctx);
    const why = buildContextAwareFixtureReply({
      message: "Why isn't the AI Agent getting Instagram data?",
      workflowContextPrompt: prompt,
      inspectionBrief: brief,
      selectedNodeId: "agent1",
    });
    assert.ok(why);
    assert.match(why, /tool binding/i);
    assert.match(why, /toolsAvailable|Instagram MCP|MCP/i);

    const account = buildContextAwareFixtureReply({
      message: "Which Instagram account is this workflow using?",
      workflowContextPrompt: prompt,
      selectedNodeId: "ig-src",
    });
    assert.ok(account);
    assert.match(account, /opsai_demo/);
    assert.ok(!/IGQV|accessToken|refresh/i.test(account));
  });

  await check("M816-11 Connected-to-agent end-to-end plan turn", async () => {
    const res = await planCopilotTurn({
      forceMode: "deterministic",
      allowClientExecution: true,
      message: "What is connected to my AI Agent in this workflow?",
      workflowId: "wf-m816",
      workflow: { id: "wf-m816", name: "IG Agent", workspaceId: "ws-1" },
      definition: igAgentFixture(),
      selectedNodeId: "agent1",
      execution: latestRunFixture(),
    });
    assert.match(res.assistantMessage, /Instagram MCP|ig-mcp/i);
    assert.match(res.assistantMessage, /tool/i);
    assert.equal(res.copilotMeta?.latestRunAttached, true);
    assert.ok(
      (res.copilotMeta?.internalToolsUsed || []).length >= 1 ||
        res.contextBrief
    );
  });

  await check("M816-12 Why + account grounded answers", async () => {
    const why = await planCopilotTurn({
      forceMode: "deterministic",
      allowClientExecution: true,
      message: "Why isn't the AI Agent getting Instagram data?",
      workflowId: "wf-m816",
      workflow: { id: "wf-m816", name: "IG Agent", workspaceId: "ws-1" },
      definition: igAgentFixture(),
      selectedNodeId: "agent1",
      execution: latestRunFixture(),
    });
    assert.match(why.assistantMessage, /tool binding|MCP|toolsAvailable/i);
    assert.ok(!/IGQV|accessToken/i.test(why.assistantMessage));

    const account = await planCopilotTurn({
      forceMode: "deterministic",
      allowClientExecution: true,
      message: "Which Instagram account is this workflow using?",
      workflowId: "wf-m816",
      workflow: { id: "wf-m816", name: "IG Agent", workspaceId: "ws-1" },
      definition: igAgentFixture(),
      selectedNodeId: "ig-src",
    });
    assert.match(account.assistantMessage, /opsai_demo/);
    assert.ok(!/IGQV|accessToken|refresh_SHOULD/i.test(account.assistantMessage));
  });

  console.log(`\nM8.16 done: ${passed} checks`);
})();
