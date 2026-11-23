/**
 * M8.15.1 — AI Agent model-usage logging + live observability fields.
 *
 * Live clue: OpenAI dashboard showed tokens while OpsAi Model Usage did not.
 * Root cause: createOpenAiCompatAdapter → chat.completions.create bypassed
 * ai_usage_events (only chatGenerate logged).
 */
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const usageLog = require("../services/aiUsageLog.service");
const {
  executeGraphInMemory,
} = require("../services/workflowEngine.service");
const {
  resolveAgentResources,
} = require("../services/workflowAiResources.service");

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
            value: opts.question || "What is 12 + 30?",
          },
        ],
      },
    },
    {
      id: "agent",
      type: "aiAgent",
      data: {
        prompt: opts.prompt || "{{item.question}}",
        label: opts.label || "Live Agent",
      },
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
      data: { toolName: "calculator", description: "calc" },
    });
    edges.push({
      id: "eaux-t",
      source: "tool",
      target: "agent",
      sourceHandle: "tool",
      targetHandle: "tools",
    });
  }
  return { version: 1, nodes, edges };
};

async function withCapturedUsage(fn) {
  const calls = [];
  const original = usageLog.recordAiUsageEvent;
  usageLog.recordAiUsageEvent = async (payload) => {
    calls.push(payload);
    return `mock-${calls.length}`;
  };
  try {
    const result = await fn(calls);
    return { result, calls };
  } finally {
    usageLog.recordAiUsageEvent = original;
  }
}

async function main() {
  console.log("\nM8.15.1 AI Agent usage logging + observability");

  await check("M8151-1 Path: Agent → OpenAI adapter (documented)", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowAiResources.service.js"),
      "utf8"
    );
    assert.match(src, /createOpenAiCompatAdapter/);
    assert.match(src, /getClientForProvider/);
    assert.match(src, /chat\.completions\.create/);
    const agentSrc = fs.readFileSync(
      path.join(__dirname, "../services/workflowAiAgent.service.js"),
      "utf8"
    );
    assert.match(agentSrc, /recordAiUsageEvent/);
    assert.match(agentSrc, /source:\s*"ai_agent"/);
  });

  await check("M8151-2 No-tool Agent writes one usage event", async () => {
    const { result, calls } = await withCapturedUsage(async () =>
      executeGraphInMemory(agentFixture({ includeTool: false, modelScript: "echo" }), {
        workspaceId: "ws-m8151",
        userId: "user-m8151",
        runId: "run-m8151-a",
      })
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].source, "ai_agent");
    assert.equal(calls[0].workspaceId, "ws-m8151");
    assert.equal(calls[0].userId, "user-m8151");
    assert.equal(calls[0].workflowRunId, "run-m8151-a");
    assert.equal(calls[0].workflowNodeId, "agent");
    assert.equal(calls[0].workflowNodeName, "Live Agent");
    assert.equal(calls[0].generationIndex, 1);
    assert.equal(calls[0].provider, "test");
    const meta = result.context.steps.agent?.agentMeta?.[0];
    assert.equal(meta?.modelRequests, 1);
    assert.deepEqual(meta?.toolsAvailable, []);
    assert.deepEqual(meta?.toolsRequested || [], []);
    assert.deepEqual(meta?.toolsUsed || [], []);
  });

  await check("M8151-3 Tool-call flow accounts for two model generations", async () => {
    const { result, calls } = await withCapturedUsage(async () =>
      executeGraphInMemory(agentFixture({ modelScript: "calculator-demo" }), {
        workspaceId: "ws-m8151",
        userId: "user-m8151",
        runId: "run-m8151-b",
      })
    );
    assert.equal(calls.length, 2);
    assert.equal(calls[0].generationIndex, 1);
    assert.equal(calls[1].generationIndex, 2);
    assert.ok(calls.every((c) => c.source === "ai_agent"));
    const meta = result.context.steps.agent?.agentMeta?.[0];
    assert.equal(meta?.modelRequests, 2);
    assert.deepEqual(meta?.toolsRequested, ["calculator"]);
    assert.deepEqual(meta?.toolsUsed, ["calculator"]);
    assert.equal((meta?.toolErrors || []).length, 0);
    assert.equal(meta?.modelRequest?.toolCount, 1);
    assert.ok(meta?.modelRequest?.toolNames?.includes("calculator"));
  });

  await check("M8151-4 Soft tool failure: requested but not used", async () => {
    const { result, calls } = await withCapturedUsage(async () =>
      executeGraphInMemory(agentFixture({ modelScript: "tool-exec-fail" }), {
        workspaceId: "ws-m8151",
        userId: "user-m8151",
      })
    );
    assert.ok(calls.length >= 2);
    const meta = result.context.steps.agent?.agentMeta?.[0];
    assert.ok(meta?.modelRequests >= 2);
    assert.deepEqual(meta?.toolsRequested, ["calculator"]);
    assert.deepEqual(meta?.toolsUsed || [], []);
    assert.ok((meta?.toolErrors || []).length >= 1);
    assert.ok(meta?.toolCalls?.some((t) => t.status === "failed"));
  });

  await check("M8151-5 Observability distinguishes toolsAvailable vs requested", async () => {
    const { result } = await withCapturedUsage(async () =>
      executeGraphInMemory(agentFixture({ modelScript: "echo" }), {
        workspaceId: "ws-m8151",
      })
    );
    const meta = result.context.steps.agent?.agentMeta?.[0];
    // Case B: tools available, model skipped them
    assert.ok((meta?.toolsAvailable || []).length >= 1);
    assert.deepEqual(meta?.toolsRequested || [], []);
    assert.equal(meta?.modelRequests, 1);
    assert.equal(meta?.modelRequest?.toolCount, 1);
  });

  await check("M8151-6 Migration 032 present", () => {
    const mig = path.join(
      __dirname,
      "../migrations/032_ai_usage_events_workflow.sql"
    );
    assert.equal(fs.existsSync(mig), true);
    const sql = fs.readFileSync(mig, "utf8");
    assert.match(sql, /workflow_run_id/);
    assert.match(sql, /generation_index/);
    assert.match(sql, /source/);
  });

  await check("M8151-7 recordAiUsageEvent exported + chatGenerate uses it", () => {
    assert.equal(typeof usageLog.recordAiUsageEvent, "function");
    const chat = fs.readFileSync(
      path.join(__dirname, "../modules/chatGenerate/chatGenerate.service.js"),
      "utf8"
    );
    assert.match(chat, /recordAiUsageEvent/);
    assert.equal(/INSERT INTO ai_usage_events/.test(chat), false);
  });

  await check("M8151-8 Instagram list_media still namespaced for OpenAI tools", () => {
    const def = {
      version: 1,
      nodes: [
        {
          id: "agent",
          type: "aiAgent",
          data: { prompt: "x" },
        },
        {
          id: "model",
          type: "aiModelProviderTest",
          data: { script: "echo" },
        },
        {
          id: "ig",
          type: "instagramMcpTool",
          data: { toolId: "list_media" },
        },
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
  });

  console.log(`\n${passed} M8.15.1 checks passed`);
  process.exit(process.exitCode || 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
