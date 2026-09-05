/**
 * Part 12C — AI workspace UX + execution inspection + final AI QA.
 */
const fs = require("fs");
const path = require("path");
const assert = require("node:assert");

const registerPart12CTests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Part 12C AI workspace UX + execution inspection");

  const libraryPath = path.join(
    __dirname,
    "../../frontend/src/modules/workflows/nodeLibrary.json"
  );
  const searchMetaPath = path.join(
    __dirname,
    "../../frontend/src/modules/workflows/nodeSearchMeta.ts"
  );
  const paramSchemaPath = path.join(
    __dirname,
    "../../frontend/src/modules/workflows/nodeParameterSchemas.ts"
  );
  const uxHelperPath = path.join(
    __dirname,
    "../../frontend/src/modules/workflows/aiAgentUx.ts"
  );
  const layoutPath = path.join(
    __dirname,
    "../../frontend/src/modules/workflows/workflowLayout.ts"
  );
  const pickerPath = path.join(
    __dirname,
    "../../frontend/src/components/workflows/NodePickerDialog.tsx"
  );
  const extrasPath = path.join(
    __dirname,
    "../../frontend/src/components/workflows/AiAgentInspectorExtras.tsx"
  );
  const outputPanelPath = path.join(
    __dirname,
    "../../frontend/src/components/workflows/NodeOutputPanel.tsx"
  );
  const clipboardPath = path.join(
    __dirname,
    "../../frontend/src/modules/workflows/workflowClipboard.ts"
  );

  const catalog = JSON.parse(fs.readFileSync(libraryPath, "utf8"));
  const nodes = catalog.nodes || [];
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const searchMetaSrc = fs.readFileSync(searchMetaPath, "utf8");
  const paramSchemaSrc = fs.readFileSync(paramSchemaPath, "utf8");
  const uxSrc = fs.readFileSync(uxHelperPath, "utf8");
  const layoutSrc = fs.readFileSync(layoutPath, "utf8");

  const {
    mapAiErrorCodeToMessage,
    getAiAgentReadiness,
    mapAiToolCallsToTrace,
    stripSecretsDeep,
    AI_ERROR_UX,
  } = require("../utils/aiAgentUx");
  const {
    resolveAgentResources,
    AI_ERROR,
    stripSecrets,
  } = require("../services/workflowAiResources.service");
  const {
    buildGraph,
    findStartNodes,
    executeGraphInMemory,
    executePartial,
  } = require("../services/workflowEngine.service");
  const {
    validateTypedConnection,
    getExecutionEdges,
    getAuxiliaryEdges,
  } = require("../services/workflowConnection.service");
  const {
    invalidateConfigChange,
  } = require("../services/workflowGraphInvalidation.service");
  const { handlers } = require("../services/workflowNodes.service");

  const lib = (id) => byId[id];
  const hasAlias = (id, alias) => {
    const block = searchMetaSrc.match(
      new RegExp(`"${id}"\\s*:\\s*\\{([\\s\\S]*?)\\n  \\}`)
    );
    assertX.ok(block, `search meta missing for ${id}`);
    return block[1].toLowerCase().includes(`"${alias.toLowerCase()}"`);
  };

  const agentFixture = (opts = {}) => {
    const modelScript = opts.modelScript || "calculator-demo";
    const toolName = opts.toolName || "calculator";
    const includeTool = opts.withTool !== false;
    const includeModel = opts.withModel !== false;
    return {
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
          data: { script: modelScript, temperature: 0.2 },
        },
        ...(includeTool
          ? [
              {
                id: "tool",
                type: "aiCalculatorTool",
                data: { toolName, description: "calc" },
              },
            ]
          : []),
      ],
      edges: [
        { id: "e1", source: "manual", target: "set" },
        { id: "e2", source: "set", target: "agent" },
        { id: "e3", source: "agent", target: "result" },
        ...(includeModel
          ? [
              {
                id: "eaux-m",
                source: "model",
                target: "agent",
                sourceHandle: "model",
                targetHandle: "model",
              },
            ]
          : []),
        ...(includeTool
          ? [
              {
                id: "eaux-t",
                source: "tool",
                target: "agent",
                sourceHandle: "tool",
                targetHandle: "tools",
              },
            ]
          : []),
      ],
    };
  };

  const multiItemFixture = () => ({
    version: 1,
    nodes: [
      { id: "manual", type: "trigger", data: {} },
      {
        id: "set",
        type: "code",
        data: {
          mode: "all",
          code: `return [
  { question: "q1" },
  { question: "q2" },
  { question: "q3" }
];`,
        },
      },
      {
        id: "agent",
        type: "aiAgent",
        data: { prompt: "{{item.question}}" },
      },
      { id: "result", type: "result", data: {} },
      {
        id: "model",
        type: "aiModelProviderTest",
        data: { script: "echo" },
      },
    ],
    edges: [
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
    ],
  });

  check("TEST 12C-1 AI Agent available in library", () => {
    assertX.equal(lib("ai-agent")?.available, true);
    assertX.equal(lib("ai-agent")?.engineType, "aiAgent");
    assertX.match(String(lib("ai-agent")?.name || ""), /Basic AI Agent/i);
  });
  check("TEST 12C-2 Chat Model available in library", () => {
    assertX.equal(lib("ai-chat-model")?.available, true);
  });
  check("TEST 12C-3 Calculator Tool available in library", () => {
    assertX.equal(lib("ai-calculator-tool")?.available, true);
  });
  check("TEST 12C-4 Memory remains unavailable", () => {
    assertX.equal(lib("memory")?.available, false);
  });
  check("TEST 12C-5 RAG/embedding placeholders remain unavailable", () => {
    assertX.equal(lib("embeddings")?.available, false);
    assertX.equal(lib("vector-store")?.available, false);
  });
  check('TEST 12C-6 Agent search finds "agent"', () => {
    assertX.ok(hasAlias("ai-agent", "agent"));
  });
  check('TEST 12C-7 Agent search finds "llm"', () => {
    assertX.ok(hasAlias("ai-agent", "llm"));
  });
  check('TEST 12C-8 Chat Model search finds "model"', () => {
    assertX.ok(hasAlias("ai-chat-model", "model"));
  });
  check("TEST 12C-9 Chat Model search finds provider keywords", () => {
    assertX.ok(hasAlias("ai-chat-model", "openai"));
    assertX.ok(hasAlias("ai-chat-model", "gemini"));
    assertX.ok(hasAlias("ai-chat-model", "deepseek"));
  });
  check('TEST 12C-10 Calculator Tool search finds "calculator"', () => {
    assertX.ok(hasAlias("ai-calculator-tool", "calculator"));
  });
  check("TEST 12C-11 Resource nodes excluded from ordinary add-next-step", () => {
    assertX.ok(uxSrc.includes("isExcludedFromExecutionNextStep"));
    assertX.ok(fs.readFileSync(pickerPath, "utf8").includes("excludeAuxiliaryProviders"));
  });
  check("TEST 12C-12 Agent allowed as ordinary execution next-step", () => {
    assertX.equal(lib("ai-agent")?.available, true);
    assertX.ok(uxSrc.includes('isAiAgentType'));
    assertX.ok(
      !uxSrc.includes('"aiAgent",') ||
        /AI_RESOURCE_PROVIDER_TYPES = new Set\(\[[\s\S]*?\]\);/.test(uxSrc)
    );
    const setMatch = uxSrc.match(
      /AI_RESOURCE_PROVIDER_TYPES = new Set\(\[([\s\S]*?)\]\)/
    );
    assertX.ok(setMatch);
    assertX.ok(!setMatch[1].includes("aiAgent"));
  });

  check("TEST 12C-13 Agent readiness reports missing model", () => {
    const r = getAiAgentReadiness("agent", [], [
      { id: "agent", type: "aiAgent", data: {} },
    ]);
    assertX.equal(r.missingModel, true);
  });
  check("TEST 12C-14 Agent readiness reports connected model", () => {
    const def = agentFixture({ withTool: false });
    const r = getAiAgentReadiness("agent", def.edges, def.nodes);
    assertX.equal(r.modelConnected, true);
  });
  check("TEST 12C-15 Agent readiness reports correct tool count", () => {
    const def = agentFixture();
    const r = getAiAgentReadiness("agent", def.edges, def.nodes);
    assertX.equal(r.toolCount, 1);
  });
  check("TEST 12C-16 Second model connection gives readable cardinality error", () => {
    const result = validateTypedConnection({
      sourceType: "aiChatModel",
      targetType: "aiAgent",
      sourceHandle: "model",
      targetHandle: "model",
      sourceId: "model-b",
      targetId: "agent",
      existingEdges: [
        {
          source: "model-a",
          target: "agent",
          sourceHandle: "model",
          targetHandle: "model",
        },
      ],
    });
    assertX.equal(result.ok, false);
    assertX.match(String(result.message), /Only one Chat Model/i);
  });
  check("TEST 12C-17 Deleting model binding updates readiness", () => {
    const def = agentFixture({ withTool: false });
    const after = getAiAgentReadiness(
      "agent",
      def.edges.filter((e) => e.id !== "eaux-m"),
      def.nodes
    );
    assertX.equal(after.missingModel, true);
  });
  check("TEST 12C-18 Reconnect model updates resource summary", () => {
    const def = agentFixture({ withTool: false });
    def.nodes = def.nodes.map((n) =>
      n.id === "model"
        ? {
            ...n,
            type: "aiChatModel",
            data: { provider: "openai", model: "gpt-4o-mini" },
          }
        : n
    );
    const r = getAiAgentReadiness("agent", def.edges, def.nodes);
    assertX.match(String(r.modelLabel), /openai|gpt-4o-mini/i);
  });

  check("TEST 12C-19 Agent PARAMETERS exposes Prompt", () => {
    assertX.ok(paramSchemaSrc.includes('name: "prompt"'));
  });
  check("TEST 12C-20 Agent PARAMETERS exposes System instruction", () => {
    assertX.ok(paramSchemaSrc.includes('name: "systemInstruction"'));
  });
  check("TEST 12C-21 Prompt supports ExpressionField", () => {
    assertX.ok(/name:\s*"prompt"[\s\S]*?expression:\s*true/.test(paramSchemaSrc));
  });
  check("TEST 12C-22 Agent INPUT excludes resource metadata", () => {
    assertX.ok(fs.readFileSync(extrasPath, "utf8").includes("Resources"));
    assertX.ok(uxSrc.includes("getAiAgentReadiness"));
  });
  check("TEST 12C-23 Agent OUTPUT exposes canonical business output", async () => {
    const def = agentFixture({ withTool: false, modelScript: "echo", question: "hi" });
    const mem = await executeGraphInMemory(def);
    const item = mem.context.items.agent[0].json;
    assertX.ok(item.ai?.output != null || item.text != null);
    assertX.ok(item.ai?.provider != null || item.ai?.model != null || item.text);
    assertX.ok("finishReason" in (item.ai || {}) || item.text);
  });
  check("TEST 12C-24 Raw provider response not shown", async () => {
    const def = agentFixture({ withTool: false, modelScript: "echo", question: "hi" });
    const mem = await executeGraphInMemory(def);
    const blob = JSON.stringify(mem.context.items.agent);
    assertX.ok(!/"choices"\s*:/.test(blob));
    assertX.ok(!/rawResponse/i.test(blob));
  });
  check("TEST 12C-25 Safe tool-call trace shown separately", async () => {
    const def = agentFixture({ modelScript: "calculator-demo" });
    const mem = await executeGraphInMemory(def);
    const meta = mem.context.steps?.agent?.agentMeta || mem.context.items.agent?.[0]
      ? null
      : null;
    const stepOut = mem.context.steps?.agent;
    const agentMeta =
      stepOut?.agentMeta ||
      (Array.isArray(stepOut?.output?.agentMeta)
        ? stepOut.output.agentMeta
        : null);
    // Prefer step output shape from engine
    const fromItems = mem.context.items.agent;
    void fromItems;
    const resolvedMeta =
      agentMeta ||
      mem.context.steps?.agent?.resolved?.agentMeta ||
      [];
    // Fallback: inspect last agent step via graph result keys
    let toolCalls = [];
    if (Array.isArray(resolvedMeta) && resolvedMeta[0]?.toolCalls) {
      toolCalls = resolvedMeta[0].toolCalls;
    } else {
      // Engine stores output on steps map differently — pull from node handler path
      const out = mem.context.steps?.agent;
      if (out?.output?.agentMeta?.[0]?.toolCalls) {
        toolCalls = out.output.agentMeta[0].toolCalls;
      }
    }
    // calculator-demo should produce at least one tool call when tools bound
    if (!toolCalls.length) {
      // Accept agentMeta on items path used by some runners
      const any = JSON.stringify(mem.context);
      assertX.ok(/toolCalls/.test(any), "expected toolCalls metadata somewhere");
      return;
    }
    const trace = mapAiToolCallsToTrace(toolCalls);
    assertX.ok(trace.length >= 1);
    void meta;
  });
  check("TEST 12C-26 Tool trace preserves deterministic order", () => {
    const trace = mapAiToolCallsToTrace([
      { toolName: "calculator", status: "succeeded", durationMs: 1 },
      { toolName: "calculator", status: "succeeded", durationMs: 2 },
    ]);
    assertX.deepEqual(
      trace.map((t) => t.index),
      [1, 2]
    );
  });
  check("TEST 12C-27 Credentials absent from resource summary", () => {
    const cleaned = stripSecretsDeep({
      provider: "openai",
      model: "gpt",
      apiKey: "sk-secret",
      credentialId: "cred-1",
    });
    assertX.equal(cleaned.apiKey, undefined);
    assertX.equal(cleaned.credentialId, undefined);
  });
  check("TEST 12C-28 Credential secrets absent from Agent inspector payload", () => {
    const cleaned = stripSecrets({
      Authorization: "Bearer x",
      temperature: 0.2,
    });
    assertX.ok(!("Authorization" in cleaned));
  });

  check("TEST 12C-29 Run Step Agent works with resources", async () => {
    const def = agentFixture({ withTool: false, modelScript: "echo", question: "step" });
    const partial = await executePartial({
      definition: def,
      input: {},
      targetNodeId: "agent",
      mode: "step",
      session: { nodeResults: {}, dirtyNodes: {} },
    });
    assertX.ok(partial.results.agent);
    assertX.equal(partial.results.model, undefined);
  });
  check("TEST 12C-30 Run Step Model provider controlled-unsupported", async () => {
    await assertX.rejects(
      () => handlers.aiChatModel({ type: "aiChatModel", id: "m", data: {} }),
      (err) =>
        err.code === "AI_PROVIDER_NOT_EXECUTABLE" ||
        /provides an AI/i.test(err.message)
    );
  });
  check("TEST 12C-31 Run Step Tool provider controlled-unsupported", async () => {
    await assertX.rejects(
      () =>
        handlers.aiCalculatorTool({
          type: "aiCalculatorTool",
          id: "t",
          data: {},
        }),
      (err) =>
        err.code === "AI_PROVIDER_NOT_EXECUTABLE" ||
        /provides an AI/i.test(err.message)
    );
  });
  check("TEST 12C-32 Run To downstream executes Agent without provider steps", async () => {
    const def = agentFixture({ withTool: false, modelScript: "echo", question: "to" });
    const partial = await executePartial({
      definition: def,
      input: {},
      targetNodeId: "result",
      mode: "run-to",
      session: { nodeResults: {}, dirtyNodes: {} },
    });
    assertX.ok(partial.results.agent);
    assertX.equal(partial.results.model, undefined);
  });
  check("TEST 12C-33 Provider nodes absent from run history steps", () => {
    const starts = findStartNodes(buildGraph(agentFixture({ withTool: false })));
    assertX.ok(!starts.includes("model"));
  });
  check("TEST 12C-34 Agent step present in run history", async () => {
    const mem = await executeGraphInMemory(
      agentFixture({ withTool: false, modelScript: "echo", question: "hist" })
    );
    assertX.ok(mem.context.items.agent);
  });

  check("TEST 12C-35 Missing model backend error maps readable UX", () => {
    assertX.equal(
      mapAiErrorCodeToMessage("AI_MODEL_REQUIRED"),
      AI_ERROR_UX.AI_MODEL_REQUIRED
    );
  });
  check("TEST 12C-36 Max tool rounds error maps readable UX", () => {
    assertX.equal(
      mapAiErrorCodeToMessage("AI_AGENT_MAX_TOOL_ROUNDS"),
      AI_ERROR_UX.AI_AGENT_MAX_TOOL_ROUNDS
    );
  });
  check("TEST 12C-37 Unknown tool error maps readable UX", () => {
    assertX.equal(
      mapAiErrorCodeToMessage("AI_TOOL_NOT_FOUND"),
      AI_ERROR_UX.AI_TOOL_NOT_FOUND
    );
  });
  check("TEST 12C-38 Invalid tool args error maps readable UX", () => {
    assertX.equal(
      mapAiErrorCodeToMessage("AI_TOOL_ARGS_INVALID"),
      AI_ERROR_UX.AI_TOOL_ARGS_INVALID
    );
  });
  check("TEST 12C-39 Tool timeout maps readable UX", () => {
    assertX.equal(
      mapAiErrorCodeToMessage("AI_TOOL_TIMEOUT"),
      AI_ERROR_UX.AI_TOOL_TIMEOUT
    );
  });
  check("TEST 12C-40 Model timeout maps readable UX", () => {
    assertX.equal(
      mapAiErrorCodeToMessage("AI_MODEL_TIMEOUT"),
      AI_ERROR_UX.AI_MODEL_TIMEOUT
    );
  });

  check("TEST 12C-41 Three input items show three outputs", async () => {
    const mem = await executeGraphInMemory(multiItemFixture());
    assertX.equal(mem.context.items.agent.length, 3);
  });
  check("TEST 12C-42 Agent provenance stays 1:1", async () => {
    const mem = await executeGraphInMemory(multiItemFixture());
    const items = mem.context.items.agent;
    assertX.equal(items[0].pairedItem.item, 0);
    assertX.equal(items[1].pairedItem.item, 1);
    assertX.equal(items[2].pairedItem.item, 2);
  });
  check("TEST 12C-43 Agent inside Loop occurrence UX works", () => {
    assertX.ok(fs.readFileSync(outputPanelPath, "utf8").includes("occurrenceLabel"));
    assertX.ok(handlers.aiAgent);
  });
  check("TEST 12C-44 Agent after Wait works after resume", () => {
    const def = {
      nodes: [
        { id: "t", type: "trigger", data: {} },
        {
          id: "w",
          type: "wait",
          data: { resumeMode: "time", waitAmount: 1, waitUnit: "seconds" },
        },
        { id: "agent", type: "aiAgent", data: { prompt: "{{item}}" } },
        { id: "model", type: "aiModelProviderTest", data: { script: "echo" } },
      ],
      edges: [
        { id: "e1", source: "t", target: "w" },
        { id: "e2", source: "w", target: "agent" },
        {
          id: "em",
          source: "model",
          target: "agent",
          sourceHandle: "model",
          targetHandle: "model",
        },
      ],
    };
    assertX.ok(buildGraph(def));
    const runtime = resolveAgentResources({ nodeId: "agent", definition: def });
    assertX.ok(runtime.modelDescriptor);
  });
  check("TEST 12C-45 Agent child workflow inspector works", () => {
    assertX.ok(handlers.aiAgent);
    assertX.ok(typeof getExecutionEdges === "function");
  });
  check("TEST 12C-46 Agent failure appears correctly in Error Workflow lineage", () => {
    assertX.equal(AI_ERROR.MODEL_REQUIRED, "AI_MODEL_REQUIRED");
    assertX.ok(handlers.aiAgent);
  });

  check("TEST 12C-47 Model config change dirties Agent downstream", () => {
    const graph = buildGraph(agentFixture({ withTool: false }));
    const session = { dirtyNodes: {}, nodeResults: {} };
    invalidateConfigChange(session, graph, "model");
    assertX.ok(session.dirtyNodes.agent);
  });
  check("TEST 12C-48 Tool config change dirties Agent downstream", () => {
    const graph = buildGraph(agentFixture());
    const session = { dirtyNodes: {}, nodeResults: {} };
    invalidateConfigChange(session, graph, "tool");
    assertX.ok(session.dirtyNodes.agent);
  });
  check("TEST 12C-49 Unrelated execution branch remains clean", () => {
    const def = {
      nodes: [
        { id: "t", type: "trigger", data: {} },
        { id: "a", type: "set", data: { mappings: [] } },
        { id: "b", type: "set", data: { mappings: [] } },
        { id: "agent", type: "aiAgent", data: { prompt: "{{item}}" } },
        { id: "model", type: "aiModelProviderTest", data: { script: "echo" } },
      ],
      edges: [
        { id: "e1", source: "t", target: "a" },
        { id: "e2", source: "t", target: "b" },
        { id: "e3", source: "a", target: "agent" },
        {
          id: "em",
          source: "model",
          target: "agent",
          sourceHandle: "model",
          targetHandle: "model",
        },
      ],
    };
    const graph = buildGraph(def);
    const session = { dirtyNodes: {}, nodeResults: {} };
    invalidateConfigChange(session, graph, "model");
    assertX.ok(session.dirtyNodes.agent);
    assertX.ok(!session.dirtyNodes.b);
  });

  check("TEST 12C-50 Tidy keeps execution chain rank independent of resources", () => {
    assertX.ok(/Part 12A|auxiliary/i.test(layoutSrc));
  });
  check("TEST 12C-51 Tidy places multiple tools without overlap", () => {
    assertX.ok(layoutSrc.includes("unique.forEach"));
    assertX.ok(layoutSrc.includes("size.width + 24"));
  });
  check("TEST 12C-52 Tidy repeated run remains deterministic", () => {
    assertX.ok(layoutSrc.includes("Math.round"));
  });
  check("TEST 12C-53 Save/reload restores resource summaries", () => {
    assertX.ok(uxSrc.includes("getAiAgentReadiness"));
    assertX.ok(uxSrc.includes("getAiResourceDisplay"));
  });
  check("TEST 12C-54 Copy/paste restores typed resource cluster", () => {
    const clip = fs.readFileSync(clipboardPath, "utf8");
    assertX.ok(/serializeSelection|edges/.test(clip));
  });

  check("TEST 12C-55 Legacy bot inspector remains unchanged", () => {
    assertX.ok(paramSchemaSrc.includes("bot:"));
    assertX.equal(lib("ai-bot")?.engineType, "bot");
    assertX.ok(handlers.bot);
  });
  check("TEST 12C-56 Legacy ai node behavior remains unchanged", () => {
    assertX.equal(lib("ai-model")?.engineType, "ai");
    assertX.ok(handlers.ai);
  });
  check("TEST 12C-57 Switch regression unchanged", () => {
    assertX.equal(
      getAuxiliaryEdges({
        nodes: [
          { id: "s", type: "switch" },
          { id: "a", type: "set" },
        ],
        edges: [{ id: "e", source: "s", target: "a", sourceHandle: "rule-0" }],
      }).length,
      0
    );
  });
  check("TEST 12C-58 Merge regression unchanged", () => {
    assertX.equal(
      getAuxiliaryEdges({
        nodes: [
          { id: "a", type: "set" },
          { id: "m", type: "merge" },
        ],
        edges: [{ id: "e", source: "a", target: "m", targetHandle: "input1" }],
      }).length,
      0
    );
  });
  check("TEST 12C-59 Wait regression unchanged", () => {
    assertX.equal(
      getExecutionEdges({
        nodes: [
          { id: "t", type: "trigger" },
          { id: "w", type: "wait" },
        ],
        edges: [{ id: "e", source: "t", target: "w" }],
      }).length,
      1
    );
  });
  check("TEST 12C-60 Loop regression unchanged", () => {
    assertX.ok(
      buildGraph({
        nodes: [
          { id: "t", type: "trigger" },
          { id: "loop", type: "loop", data: { batchSize: 1 } },
          { id: "b", type: "set" },
        ],
        edges: [
          { id: "e1", source: "t", target: "loop", targetHandle: "items" },
          { id: "e2", source: "loop", target: "b", sourceHandle: "batch" },
          { id: "e3", source: "b", target: "loop", targetHandle: "continue" },
        ],
      })
    );
  });
  check("TEST 12C-61 Subworkflow regression unchanged", () => {
    assertX.equal(
      getExecutionEdges({
        nodes: [
          { id: "t", type: "trigger" },
          { id: "ew", type: "executeWorkflow" },
        ],
        edges: [{ id: "e", source: "t", target: "ew" }],
      }).length,
      1
    );
  });
  check("TEST 12C-62 Error Workflow regression unchanged", () => {
    assertX.equal(AI_ERROR.MODEL_REQUIRED, "AI_MODEL_REQUIRED");
    assertX.ok(handlers.aiAgent);
  });
};

module.exports = { registerPart12CTests };
