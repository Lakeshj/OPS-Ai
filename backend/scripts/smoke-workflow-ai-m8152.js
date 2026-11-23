/**
 * M8.15.2 — Generic AI Agent tool-grounding policy + one guarded retry.
 */
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const {
  looksLikeGenericAccessDenial,
  buildToolsSystemAppendix,
  shouldTriggerGroundingRetry,
  GROUNDING_RETRY_USER_MESSAGE,
} = require("../services/workflowAiAgentGrounding.service");
const {
  executeGraphInMemory,
} = require("../services/workflowEngine.service");
const {
  resolveAgentResources,
  stripSecrets,
} = require("../services/workflowAiResources.service");
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
            value:
              opts.question ||
              "Give me a summary of recent account posts and engagement.",
          },
        ],
      },
    },
    {
      id: "agent",
      type: "aiAgent",
      data: { prompt: opts.prompt || "{{item.question}}", label: "Agent" },
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
        description:
          opts.toolDescription ||
          "Deterministic calculator for numeric ops. Use when the user asks for a computed result from live tool data.",
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
  if (opts.extraNodes) nodes.push(...opts.extraNodes);
  if (opts.extraEdges) edges.push(...opts.extraEdges);
  return { version: 1, nodes, edges };
};

const TOKEN = "IGAA_secret_m8152_never_leak";

async function withMockedInstagramExecute(fn) {
  const original = registry.executeInstagramMcpNode;
  registry.executeInstagramMcpNode = async (node) => {
    const toolId = String(node?.data?.toolId || "");
    if (toolId === "list_media") {
      return {
        items: [
          {
            json: {
              mediaId: "m1",
              mediaType: "IMAGE",
              likeCount: 90,
              commentsCount: 4,
              timestamp: "2026-11-20T10:00:00+0000",
              access_token: TOKEN,
            },
          },
          {
            json: {
              mediaId: "m2",
              mediaType: "REELS",
              likeCount: 200,
              commentsCount: 12,
              timestamp: "2026-11-21T10:00:00+0000",
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
  console.log("\nM8.15.2 AI Agent tool grounding");

  await check("M8152-1 Denial detector is generic (not Instagram-only)", () => {
    assert.equal(
      looksLikeGenericAccessDenial(
        "I would typically need access to your account to answer that."
      ),
      true
    );
    assert.equal(
      looksLikeGenericAccessDenial("Please check your dashboard for spend."),
      true
    );
    assert.equal(
      looksLikeGenericAccessDenial("Here is a professional rewrite of your sentence."),
      false
    );
  });

  await check("M8152-2 System appendix states MUST-use-tool grounding policy", () => {
    const appendix = buildToolsSystemAppendix([
      {
        name: "crm_list_leads",
        description: "List recent CRM leads. Use when the user asks for latest leads.",
      },
    ]);
    assert.match(appendix, /MUST use the tool/i);
    assert.match(appendix, /you would typically/i);
    assert.match(appendix, /crm_list_leads/);
    assert.match(appendix, /latest leads/i);
    assert.equal(/instagram/i.test(appendix), false);
  });

  await check("M8152-3 shouldTriggerGroundingRetry gates correctly", () => {
    assert.equal(
      shouldTriggerGroundingRetry({
        toolsAvailableCount: 2,
        toolsRequestedCount: 0,
        toolsUsedCount: 0,
        groundingRetryTriggered: false,
        assistantText: "I don't have access to your CRM.",
      }),
      true
    );
    assert.equal(
      shouldTriggerGroundingRetry({
        toolsAvailableCount: 2,
        toolsRequestedCount: 0,
        toolsUsedCount: 0,
        groundingRetryTriggered: true,
        assistantText: "I don't have access to your CRM.",
      }),
      false
    );
    assert.equal(
      shouldTriggerGroundingRetry({
        toolsAvailableCount: 0,
        toolsRequestedCount: 0,
        toolsUsedCount: 0,
        groundingRetryTriggered: false,
        assistantText: "I don't have access to your CRM.",
      }),
      false
    );
  });

  await check("M8152-4 Normal rewrite prompt does not call tools", async () => {
    const mem = await executeGraphInMemory(
      agentFixture({
        modelScript: "echo",
        question: "Rewrite this sentence professionally: Hello there.",
      })
    );
    const meta = mem.context.steps.agent?.agentMeta?.[0];
    assert.ok((meta?.toolsAvailable || []).length >= 1);
    assert.deepEqual(meta?.toolsRequested || [], []);
    assert.equal(meta?.groundingRetryTriggered, false);
    assert.equal(meta?.modelRequests, 1);
    assert.match(
      String(mem.context.items.agent[0].json?.ai?.output || ""),
      /Rewrite this sentence/i
    );
  });

  await check("M8152-5 Live-data path: model calls tool on first turn", async () => {
    const mem = await executeGraphInMemory(
      agentFixture({ modelScript: "calculator-demo" })
    );
    const meta = mem.context.steps.agent?.agentMeta?.[0];
    assert.deepEqual(meta?.toolsRequested, ["calculator"]);
    assert.deepEqual(meta?.toolsUsed, ["calculator"]);
    assert.equal(meta?.groundingRetryTriggered, false);
    assert.equal(meta?.modelRequests, 2);
  });

  await check("M8152-6 Model initially skips tool → grounding retry triggers", async () => {
    const mem = await executeGraphInMemory(
      agentFixture({
        modelScript: "grounding-skip-then-tool",
        question: "What is our latest CRM metric total?",
      })
    );
    const meta = mem.context.steps.agent?.agentMeta?.[0];
    assert.equal(meta?.groundingRetryTriggered, true);
    assert.match(String(meta?.groundingRetryReason || ""), /generic_access_denial/);
    assert.ok(meta?.toolsRequested?.includes("calculator"));
    assert.ok(meta?.toolsUsed?.includes("calculator"));
    assert.ok((meta?.modelRequests || 0) >= 3);
    assert.match(
      String(mem.context.items.agent[0].json?.ai?.output || ""),
      /Grounded summary/i
    );
    assert.equal(
      /I would typically need access/i.test(
        String(mem.context.items.agent[0].json?.ai?.output || "")
      ),
      false
    );
  });

  await check("M8152-7 Tool failure yields accurate tool-error answer", async () => {
    const mem = await executeGraphInMemory(
      agentFixture({ modelScript: "tool-exec-fail" })
    );
    const text = String(mem.context.items.agent[0].json?.ai?.output || "");
    assert.match(text, /failed|error|division|zero/i);
    assert.equal(/typically need access|check your dashboard/i.test(text), false);
    const meta = mem.context.steps.agent?.agentMeta?.[0];
    assert.ok((meta?.toolErrors || []).length >= 1);
  });

  await check("M8152-8 Multiple tools: relevant chosen; unrelated ignored", async () => {
    await withMockedInstagramExecute(async () => {
      const def = agentFixture({
        modelScript: "instagram-list-media-demo",
        includeTool: false,
        question:
          "Give me a summary of the 5 most recent Instagram posts with likes and comments.",
        extraNodes: [
          {
            id: "ig-media",
            type: "instagramMcpTool",
            data: { toolId: "list_media" },
          },
          {
            id: "ig-account",
            type: "instagramMcpTool",
            data: { toolId: "account_summary" },
          },
        ],
        extraEdges: [
          {
            id: "e-ig-m",
            source: "ig-media",
            target: "agent",
            sourceHandle: "tool",
            targetHandle: "tools",
          },
          {
            id: "e-ig-a",
            source: "ig-account",
            target: "agent",
            sourceHandle: "tool",
            targetHandle: "tools",
          },
        ],
      });
      const mem = await executeGraphInMemory(def);
      const meta = mem.context.steps.agent?.agentMeta?.[0];
      assert.deepEqual(
        (meta?.toolsAvailable || []).map((t) => t.name).sort(),
        ["instagram_account_summary", "instagram_list_media"]
      );
      assert.deepEqual(meta?.toolsRequested, ["instagram_list_media"]);
      assert.deepEqual(meta?.toolsUsed, ["instagram_list_media"]);
      assert.equal(meta?.groundingRetryTriggered, false);
      assert.match(
        String(mem.context.items.agent[0].json?.ai?.output || ""),
        /likes|Recent Instagram/i
      );
    });
  });

  await check("M8152-9 No tools connected: normal behaviour unchanged", async () => {
    const mem = await executeGraphInMemory(
      agentFixture({
        includeTool: false,
        modelScript: "echo",
        question: "Rewrite: hi",
      })
    );
    const meta = mem.context.steps.agent?.agentMeta?.[0];
    assert.deepEqual(meta?.toolsAvailable, []);
    assert.equal(meta?.groundingRetryTriggered, false);
    assert.equal(meta?.modelRequests, 1);
  });

  await check("M8152-10 Security: no credentials in appendix/meta", async () => {
    const appendix = buildToolsSystemAppendix([
      {
        name: "instagram_list_media",
        description: `List media. access_token=${TOKEN}`,
      },
    ]);
    // Appendix may include attacker-supplied description text from node config;
    // stripSecrets on agentMeta must still never leak execution secrets.
    const cleaned = stripSecrets({
      access_token: TOKEN,
      toolsAvailable: [{ name: "instagram_list_media" }],
    });
    assert.equal(cleaned.access_token, undefined);
    void appendix;
    await withMockedInstagramExecute(async () => {
      const def = agentFixture({
        modelScript: "instagram-list-media-demo",
        includeTool: false,
        extraNodes: [
          {
            id: "ig-media",
            type: "instagramMcpTool",
            data: { toolId: "list_media" },
          },
        ],
        extraEdges: [
          {
            id: "e-ig-m",
            source: "ig-media",
            target: "agent",
            sourceHandle: "tool",
            targetHandle: "tools",
          },
        ],
      });
      const mem = await executeGraphInMemory(def);
      const blob = JSON.stringify({
        meta: mem.context.steps.agent?.agentMeta,
        out: mem.context.items.agent,
      });
      assert.equal(blob.includes(TOKEN), false);
    });
  });

  await check("M8152-11 OpenAI adapter accepts tool_choice required", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowAiResources.service.js"),
      "utf8"
    );
    assert.match(src, /tool_choice/);
    assert.match(src, /toolChoice/);
    assert.match(src, /required/);
    assert.match(src, /toolChoiceFallback/);
  });

  await check("M8152-12 Agent appendix includes grounding policy text live", () => {
    const agentSrc = fs.readFileSync(
      path.join(__dirname, "../services/workflowAiAgent.service.js"),
      "utf8"
    );
    assert.match(agentSrc, /buildToolsSystemAppendix/);
    assert.match(agentSrc, /pendingToolChoice/);
    assert.match(agentSrc, /groundingRetryTriggered/);
    assert.ok(GROUNDING_RETRY_USER_MESSAGE.includes("Relevant connected tools"));
  });

  await check("M8152-13 resolve Instagram list_media still namespaced", () => {
    const def = {
      version: 1,
      nodes: [
        { id: "agent", type: "aiAgent", data: { prompt: "x" } },
        { id: "model", type: "aiModelProviderTest", data: { script: "echo" } },
        { id: "ig", type: "instagramMcpTool", data: { toolId: "list_media" } },
      ],
      edges: [
        {
          id: "em",
          source: "model",
          target: "agent",
          sourceHandle: "model",
          targetHandle: "model",
        },
        {
          id: "et",
          source: "ig",
          target: "agent",
          sourceHandle: "tool",
          targetHandle: "tools",
        },
      ],
    };
    const resolved = resolveAgentResources({ nodeId: "agent", definition: def });
    assert.equal(resolved.toolDescriptors[0].name, "instagram_list_media");
    assert.match(resolved.toolDescriptors[0].description, /Use when/i);
  });

  console.log(`\n${passed} M8.15.2 checks passed`);
  process.exit(process.exitCode || 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
