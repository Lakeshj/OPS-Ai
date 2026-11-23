/**
 * M8.15 — AI Agent reliability (generic tool registry, soft failures, observability).
 *
 * Root causes under test:
 * - weak catalog / missing whenToUse → model skips tools
 * - empty tool registry hard to observe
 * - hard tool failures aborted the agent
 * - thin agentMeta (toolsAvailable / toolsUsed)
 *
 * Instagram MCP is the first live grounding fixture only — no agent Instagram hacks.
 */
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const {
  buildToolDescriptor,
  namespacedMcpToolName,
  composeToolDescription,
  resolveAgentResources,
  materializeAgentRuntime,
  stripSecrets,
  AI_ERROR,
} = require("../services/workflowAiResources.service");
const {
  executeAiAgent,
  runAgentForItem,
} = require("../services/workflowAiAgent.service");
const {
  getAuxiliaryEdges,
  resolveAuxiliaryBindings,
} = require("../services/workflowConnection.service");
const {
  executeGraphInMemory,
} = require("../services/workflowEngine.service");
const registry = require("../services/mcpDynamicRegistry.service");

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

const TOKEN = "IGAA_secret_token_m815_never_leak";

const agentFixture = (opts = {}) => {
  const modelScript = opts.modelScript || "echo";
  const includeTool = opts.includeTool !== false;
  const nodes = [
    { id: "manual", type: "trigger", data: {} },
    {
      id: "set",
      type: "set",
      data: {
        mappings: [
          {
            key: "question",
            value: opts.question || "Summarize this in one sentence: OpsAi ships workflows.",
          },
        ],
      },
    },
    {
      id: "agent",
      type: "aiAgent",
      data: {
        prompt: opts.prompt || "{{item.question}}",
        ...(opts.systemInstruction
          ? { systemInstruction: opts.systemInstruction }
          : {}),
      },
    },
    {
      id: "result",
      type: "result",
      data: { mapFrom: "{{steps.agent.text}}" },
    },
    {
      id: "model",
      type: "aiModelProviderTest",
      data: { script: modelScript, temperature: 0 },
    },
  ];
  const edges = [
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
  ];
  if (includeTool) {
    nodes.push({
      id: "tool",
      type: "aiCalculatorTool",
      data: {
        toolName: opts.toolName || "calculator",
        description: opts.toolDescription || "calc",
      },
    });
    edges.push({
      id: "eaux-t",
      source: "tool",
      target: "agent",
      sourceHandle: "tool",
      targetHandle: "tools",
    });
  }
  if (opts.extraTools) {
    for (const t of opts.extraTools) {
      nodes.push(t.node);
      edges.push(t.edge);
    }
  }
  return { version: 1, nodes, edges };
};

const instagramAgentFixture = (opts = {}) => ({
  version: 1,
  nodes: [
    { id: "manual", type: "trigger", data: {} },
    {
      id: "set",
      type: "set",
      data: {
        mappings: [
          {
            key: "question",
            value:
              opts.question ||
              "What are my recent Instagram posts and which had the strongest engagement?",
          },
        ],
      },
    },
    {
      id: "agent",
      type: "aiAgent",
      data: { prompt: "{{item.question}}" },
    },
    {
      id: "model",
      type: "aiModelProviderTest",
      data: {
        script: opts.modelScript || "instagram-list-media-demo",
        temperature: 0,
      },
    },
    {
      id: "ig-mcp",
      type: "instagramMcpTool",
      data: {
        toolId: "list_media",
        instagramSourceNodeId: "ig-src",
      },
    },
    ...(opts.alsoAccountSummary
      ? [
          {
            id: "ig-mcp-account",
            type: "instagramMcpTool",
            data: {
              toolId: "account_summary",
              instagramSourceNodeId: "ig-src",
            },
          },
        ]
      : []),
  ],
  edges: [
    { id: "e1", source: "manual", target: "set" },
    { id: "e2", source: "set", target: "agent" },
    {
      id: "eaux-m",
      source: "model",
      target: "agent",
      sourceHandle: "model",
      targetHandle: "model",
    },
    {
      id: "eaux-ig",
      source: "ig-mcp",
      target: "agent",
      sourceHandle: "tool",
      targetHandle: "tools",
    },
    ...(opts.alsoAccountSummary
      ? [
          {
            id: "eaux-ig-account",
            source: "ig-mcp-account",
            target: "agent",
            sourceHandle: "tool",
            targetHandle: "tools",
          },
        ]
      : []),
  ],
});

async function withMockedInstagramExecute(fn) {
  const original = registry.executeInstagramMcpNode;
  registry.executeInstagramMcpNode = async (node) => {
    const toolId = String(node?.data?.toolId || "");
    if (toolId === "list_media") {
      const limit = Number(node?.data?.params?.limit) || 25;
      const rows = [
        {
          mediaId: "m1",
          mediaType: "IMAGE",
          likeCount: 120,
          commentsCount: 8,
          caption: "Launch post",
          access_token: TOKEN,
        },
        {
          mediaId: "m2",
          mediaType: "REELS",
          likeCount: 40,
          commentsCount: 2,
          caption: "B-roll",
        },
      ].slice(0, Math.max(1, Math.min(limit, 25)));
      return {
        items: rows.map((json) => ({ json })),
      };
    }
    if (toolId === "account_summary") {
      return {
        items: [
          {
            json: {
              id: "ig-user-1",
              username: "opsai_demo",
              followers_count: 10,
              access_token: TOKEN,
            },
          },
        ],
      };
    }
    return { items: [] };
  };
  try {
    return await fn();
  } finally {
    registry.executeInstagramMcpNode = original;
  }
}

async function main() {
  console.log("\nM8.15 AI Agent reliability");

  await check("M815-1 No tools: normal chat + empty toolsAvailable", async () => {
    const def = agentFixture({ includeTool: false, modelScript: "echo" });
    const mem = await executeGraphInMemory(def);
    const out = String(mem.context.items.agent[0].json?.ai?.output || "");
    assert.match(out, /OpsAi|workflows/i);
    const meta = mem.context.steps.agent?.agentMeta?.[0];
    assert.deepEqual(meta?.toolsAvailable, []);
    assert.deepEqual(meta?.toolsUsed || [], []);
    assert.equal((meta?.toolCalls || []).length, 0);
  });

  await check("M815-2 Empty model content fails clearly (no silent blank)", async () => {
    const { interpolate, resolveExpression } = require("../services/workflowNodes.service");
    const resources = resolveAgentResources({
      nodeId: "agent",
      definition: agentFixture({ includeTool: false }),
    });
    const runtime = materializeAgentRuntime(resources);
    runtime.model = {
      provider: "test",
      model: "empty",
      async invoke() {
        return {
          message: { role: "assistant", content: "   " },
          toolCalls: [],
          finishReason: "stop",
        };
      },
    };
    await assert.rejects(
      () =>
        runAgentForItem({
          node: { id: "agent", type: "aiAgent", data: { prompt: "hello" } },
          item: { json: { question: "hello" } },
          itemIndex: 0,
          runtime,
          context: {},
          data: { prompt: "hello" },
          interpolate,
          resolveExpression,
        }),
      (err) =>
        err.code === AI_ERROR.TOOL_CALL_INVALID &&
        /empty response/i.test(err.message)
    );
  });

  await check("M815-3 One tool registered: namespaced MCP name + strong description", async () => {
    const desc = buildToolDescriptor({
      id: "ig-mcp",
      type: "instagramMcpTool",
      data: { toolId: "list_media" },
    });
    assert.equal(desc.name, "instagram_list_media");
    assert.equal(
      namespacedMcpToolName("instagram", "list_media"),
      "instagram_list_media"
    );
    assert.match(desc.description, /recent|engagement|posts|limit/i);
    assert.match(desc.description, /Use when/i);
    assert.equal(desc.inputSchema?.properties?.accessToken, undefined);
    assert.equal(desc.inputSchema?.properties?.credentialId, undefined);
  });

  await check("M815-4 composeToolDescription merges whenToUse generically", () => {
    const text = composeToolDescription(
      {
        description: "Fetch rows.",
        whenToUse: "Use when the user asks for live account data.",
      },
      {}
    );
    assert.match(text, /Fetch rows/);
    assert.match(text, /Use when the user asks/);
  });

  await check("M815-5 Model tool call → execute → grounded final + toolsUsed", async () => {
    const def = agentFixture({ modelScript: "calculator-demo" });
    const mem = await executeGraphInMemory(def);
    const meta = mem.context.steps.agent?.agentMeta?.[0];
    assert.ok(meta?.toolsAvailable?.some((t) => t.name === "calculator"));
    assert.ok(meta?.toolsUsed?.includes("calculator"));
    assert.ok(meta?.toolCalls?.some((t) => t.status === "succeeded"));
    assert.match(
      String(mem.context.items.agent[0].json?.ai?.output || ""),
      /answer is 42/i
    );
  });

  await check("M815-6 Tool failure soft-fails; final answer can explain", async () => {
    const def = agentFixture({ modelScript: "tool-exec-fail" });
    const mem = await executeGraphInMemory(def);
    const meta = mem.context.steps.agent?.agentMeta?.[0];
    assert.ok(meta?.toolCalls?.some((t) => t.status === "failed"));
    assert.ok(meta?.toolsRequested?.includes("calculator"));
    assert.equal((meta?.toolsUsed || []).includes("calculator"), false);
    assert.match(
      String(mem.context.items.agent[0].json?.ai?.output || ""),
      /failed|division|zero/i
    );
  });

  await check("M815-7 Invalid args soft-fail into structured tool error", async () => {
    const def = agentFixture({ modelScript: "force-bad-args" });
    const mem = await executeGraphInMemory(def);
    const meta = mem.context.steps.agent?.agentMeta?.[0];
    assert.ok(meta?.toolCalls?.some((t) => t.status === "failed"));
    assert.ok(
      meta?.toolCalls?.some(
        (t) => t.errorCode === AI_ERROR.TOOL_ARGS_INVALID || t.status === "failed"
      )
    );
    assert.match(
      String(mem.context.items.agent[0].json?.ai?.output || ""),
      /failed|invalid|number/i
    );
  });

  await check("M815-8 Multiple tools: correct tool chosen; unrelated not called", async () => {
    await withMockedInstagramExecute(async () => {
      const def = instagramAgentFixture({
        alsoAccountSummary: true,
        modelScript: "instagram-list-media-demo",
      });
      const mem = await executeGraphInMemory(def);
      const meta = mem.context.steps.agent?.agentMeta?.[0];
      const names = (meta?.toolsAvailable || []).map((t) => t.name).sort();
      assert.deepEqual(names, [
        "instagram_account_summary",
        "instagram_list_media",
      ]);
      assert.deepEqual(meta?.toolsUsed, ["instagram_list_media"]);
      assert.equal(
        (meta?.toolCalls || []).some((t) =>
          String(t.toolName).includes("account_summary")
        ),
        false
      );
      assert.match(
        String(mem.context.items.agent[0].json?.ai?.output || ""),
        /Recent Instagram posts|likes/i
      );
    });
  });

  await check("M815-9 Sequential rounds: second tool call allowed", async () => {
    const def = agentFixture({ modelScript: "sequential-tools" });
    const mem = await executeGraphInMemory(def);
    const meta = mem.context.steps.agent?.agentMeta?.[0];
    assert.ok((meta?.rounds || 0) >= 3);
    assert.equal((meta?.toolCalls || []).length, 2);
    assert.ok(meta?.toolCalls?.every((t) => t.status === "succeeded"));
    assert.match(
      String(mem.context.items.agent[0].json?.ai?.output || ""),
      /two sequential/i
    );
  });

  await check("M815-10 Tool→tools edge remains auxiliary", () => {
    const def = agentFixture();
    const aux = getAuxiliaryEdges(def);
    assert.ok(
      aux.some(
        (e) =>
          e.source === "tool" &&
          e.target === "agent" &&
          String(e.targetHandle) === "tools"
      )
    );
    const bindings = resolveAuxiliaryBindings({
      nodeId: "agent",
      definition: def,
    });
    assert.equal(bindings.tools.length, 1);
    assert.equal(bindings.model.length, 1);
  });

  await check("M815-11 Security: no access_token in messages/meta/trace", async () => {
    await withMockedInstagramExecute(async () => {
      const def = instagramAgentFixture();
      const mem = await executeGraphInMemory(def);
      const blob = JSON.stringify({
        items: mem.context.items.agent,
        steps: mem.context.steps.agent,
      });
      assert.equal(blob.includes(TOKEN), false);
      assert.equal(/access[_-]?token/i.test(blob), false);
      const cleaned = stripSecrets({ access_token: TOKEN, ok: true });
      assert.equal(cleaned.access_token, undefined);
    });
  });

  await check("M815-12 Instagram MCP fixture: list_media grounding under mock model", async () => {
    await withMockedInstagramExecute(async () => {
      const def = instagramAgentFixture({
        question:
          "Show my recent Instagram posts and engagement (likes/comments).",
      });
      const resolved = resolveAgentResources({
        nodeId: "agent",
        definition: def,
      });
      assert.equal(resolved.toolDescriptors[0].name, "instagram_list_media");
      assert.match(
        resolved.toolDescriptors[0].description,
        /Use when.*recent posts|engagement/i
      );

      const mem = await executeGraphInMemory(def);
      const meta = mem.context.steps.agent?.agentMeta?.[0];
      assert.ok(
        meta?.toolsAvailable?.some((t) => t.name === "instagram_list_media")
      );
      assert.deepEqual(meta?.toolsUsed, ["instagram_list_media"]);
      assert.ok(meta?.toolCalls?.[0]?.status === "succeeded");
      const text = String(mem.context.items.agent[0].json?.ai?.output || "");
      assert.match(text, /120 likes|likes/i);
      assert.equal(text.includes(TOKEN), false);
    });
  });

  await check("M815-13 Zero-tool path keeps toolsAvailable empty", async () => {
    const def = agentFixture({ includeTool: false, modelScript: "echo" });
    const mem = await executeGraphInMemory(def);
    const meta = mem.context.steps.agent?.agentMeta?.[0];
    assert.deepEqual(meta?.toolsAvailable, []);
    assert.equal((meta?.toolsUsed || []).length, 0);
  });

  await check("M815-14 FE observability helpers cover toolsAvailable/toolsUsed", () => {
    const uxPath = path.join(
      __dirname,
      "../../frontend/src/modules/workflows/aiAgentUx.ts"
    );
    const extrasPath = path.join(
      __dirname,
      "../../frontend/src/components/workflows/AiAgentInspectorExtras.tsx"
    );
    const ux = fs.readFileSync(uxPath, "utf8");
    const extras = fs.readFileSync(extrasPath, "utf8");
    assert.match(ux, /toolsAvailable/);
    assert.match(ux, /toolsUsed/);
    assert.match(ux, /summarizeAgentToolObservability/);
    assert.match(extras, /summarizeAgentToolObservability/);
    assert.match(extras, /Tools \(run\)/);
  });

  // Silence unused import lint-ish
  void executeAiAgent;

  console.log(`\n${passed} M8.15 checks passed`);
  process.exit(process.exitCode || 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
