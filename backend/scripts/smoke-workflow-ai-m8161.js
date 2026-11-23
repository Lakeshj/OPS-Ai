/**
 * M8.16.1 — Local-only AI Agent + mock MCP end-to-end (no Instagram/Meta).
 *
 * Proves generic architecture:
 *   Mock Social Source ← source binding — Mock MCP Tool --tool--> AI Agent
 * via REAL Run Step (executePartial) and full in-memory execution.
 */
const assert = require("node:assert/strict");

const {
  executePartial,
  executeGraphInMemory,
  expandIdsWithAuxiliaryResources,
} = require("../services/workflowEngine.service");
const {
  resolveAgentResources,
} = require("../services/workflowAiResources.service");
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

const printTrace = (label, meta, answer) => {
  console.log(`\n--- ${label} ---`);
  console.log("Workflow graph:");
  console.log("3+ nodes (source, mcp, model, agent, trigger)");
  console.log("2 auxiliary relationships (model + tool)");
  console.log("\nAI Agent:");
  console.log(`toolEdgesFound: ${meta?.toolEdgesFound}`);
  console.log(`toolNodesResolved: ${meta?.toolNodesResolved}`);
  console.log("toolsAvailable:");
  for (const t of meta?.toolsAvailable || []) {
    console.log(`- ${typeof t === "string" ? t : t.name}`);
  }
  console.log("\nTurn 1:");
  console.log(
    `tool requested: ${(meta?.toolsRequested || []).join(", ") || "(none)"}`
  );
  console.log("\nTool:");
  console.log(
    `status: ${(meta?.toolErrors || []).length ? "error" : "success"}`
  );
  console.log("\nTurn 2:");
  console.log(
    meta?.modelRequests >= 2
      ? "final grounded response produced"
      : `modelRequests=${meta?.modelRequests}`
  );
  if (answer) {
    console.log(`answer: ${String(answer).slice(0, 240)}`);
  }
};

const mockAgentFixture = ({
  nativeResource = "posts",
  nativeOperation = "list_posts",
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
        accessToken: "SHOULD_NEVER_LEAK_MOCK_TOKEN",
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
      data: { script: "mock-list-posts-demo", temperature: 0, label: "Model" },
    },
    {
      id: "agent",
      type: "aiAgent",
      data: {
        label: "AI Agent",
        prompt:
          "Give me a summary of the 5 most recent social posts. Include date, post type, likes and comments. Then tell me which post had the strongest engagement.",
      },
    },
  ],
  edges: [
    { id: "e-main", source: "manual", target: "agent" },
    {
      id: "e-model",
      source: "model",
      target: "agent",
      sourceHandle: "model",
      targetHandle: "model",
    },
    {
      id: "e-tool",
      source: "mock-mcp",
      target: "agent",
      sourceHandle: "tool",
      targetHandle: "tools",
    },
  ],
  settings: {},
});

const assertAgentMeta = (meta, { requireGroundedAnswer = null } = {}) => {
  assert.ok(meta, "agentMeta missing");
  assert.ok(meta.toolEdgesFound >= 1);
  assert.ok(meta.toolNodesResolved >= 1);
  const available = (meta.toolsAvailable || []).map((t) =>
    typeof t === "string" ? t : t.name
  );
  assert.ok(
    available.includes(fixture.PUBLIC_TOOL_NAME),
    `toolsAvailable missing ${fixture.PUBLIC_TOOL_NAME}: ${available.join(",")}`
  );
  assert.ok(
    (meta.toolsRequested || []).includes(fixture.PUBLIC_TOOL_NAME),
    `toolsRequested missing ${fixture.PUBLIC_TOOL_NAME}`
  );
  assert.ok(
    (meta.toolsUsed || []).includes(fixture.PUBLIC_TOOL_NAME),
    `toolsUsed missing ${fixture.PUBLIC_TOOL_NAME}`
  );
  assert.ok(meta.modelRequests >= 2, `modelRequests=${meta.modelRequests}`);
  if (requireGroundedAnswer != null) {
    const text = String(requireGroundedAnswer);
    assert.match(text, /p3/i);
    assert.match(text, /70/);
    assert.match(text, /8/);
    assert.match(text, /78/);
    assert.ok(!/I would need access/i.test(text));
    assert.ok(!/you would typically/i.test(text));
    assert.ok(!/check your social account/i.test(text));
  }
};

(async () => {
  console.log("\nM8.16.1 Local mock MCP + AI Agent architecture");

  await check("M8161-AI-1 expandIds keeps mock MCP + source for Agent", () => {
    const def = mockAgentFixture();
    const kept = expandIdsWithAuxiliaryResources(def, new Set(["agent"]));
    assert.equal(kept.has("agent"), true);
    assert.equal(kept.has("mock-mcp"), true);
    assert.equal(kept.has("model"), true);
    assert.equal(kept.has("mock-src"), true);
  });

  await check("M8161-AI-2 resolveAgentResources discovers mock_list_posts", () => {
    const def = mockAgentFixture();
    const resolved = resolveAgentResources({
      nodeId: "agent",
      definition: def,
    });
    assert.equal(resolved.diagnostics.toolEdgesFound, 1);
    assert.equal(resolved.diagnostics.toolNodesResolved, 1);
    assert.equal(resolved.toolDescriptors[0].name, fixture.PUBLIC_TOOL_NAME);
    assert.match(
      resolved.toolDescriptors[0].description || "",
      /five most recent mock social posts/i
    );
  });

  await check("M8161-AI-3 Editor Run Step discovers + calls mock tool", async () => {
    const def = mockAgentFixture();
    const partial = await executePartial({
      definition: def,
      input: {},
      targetNodeId: "agent",
      mode: "step",
      workspaceId: "ws-m8161",
      workflowId: "wf-m8161",
      userId: "user-m8161",
    });
    assert.equal(partial.targetNodeId, "agent");
    const result = partial.results.agent;
    assert.equal(result.status, "succeeded");
    const meta = result.output?.agentMeta?.[0];
    const answer =
      result.output?.text ||
      result.output?.message ||
      result.items?.[0]?.json?.text ||
      result.items?.[0]?.json?.message ||
      JSON.stringify(result.output || {});
    printTrace("Run Step", meta, answer);
    assertAgentMeta(meta, { requireGroundedAnswer: answer });
  });

  await check("M8161-AI-4 Full execution shares same tool path", async () => {
    const def = mockAgentFixture();
    const mem = await executeGraphInMemory(def, {
      workspaceId: "ws-m8161",
      workflowId: "wf-m8161",
      userId: "user-m8161",
    });
    const step = mem.context.steps.agent;
    const meta = step?.agentMeta?.[0];
    const answer =
      step?.text ||
      step?.message ||
      step?.items?.[0]?.json?.text ||
      JSON.stringify(step || {});
    printTrace("Full run", meta, answer);
    assertAgentMeta(meta, { requireGroundedAnswer: answer });
  });

  await check("M8161-AI-5 Native comments op does not change MCP capability", () => {
    const def = mockAgentFixture({
      nativeResource: "comments",
      nativeOperation: "list_comments",
    });
    const resolved = resolveAgentResources({
      nodeId: "agent",
      definition: def,
    });
    assert.equal(resolved.toolDescriptors[0].name, fixture.PUBLIC_TOOL_NAME);
    assert.ok(
      !/list_comments/i.test(resolved.toolDescriptors[0].name),
      "MCP capability must not become list_comments"
    );
    assert.match(
      resolved.toolDescriptors[0].description || "",
      /mock social posts/i
    );
  });

  await check("M8161-AI-6 Fixture executor returns deterministic posts", () => {
    const out = fixture.executeListPosts({ limit: 5 });
    assert.equal(out.posts.length, 5);
    assert.equal(out.posts[2].id, "p3");
    assert.equal(out.posts[2].likes, 70);
    assert.equal(out.posts[2].comments, 8);
  });

  console.log(`\n${passed} M8.16.1 AI checks passed`);
  process.exit(process.exitCode || 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
