/**
 * Part 12B — AI Agent runtime (per-item, bounded tool-call loop).
 *
 * Agent is a normal WorkflowItem execution node.
 * Model/Tool providers remain auxiliary (non-scheduled).
 */

const {
  MAX_AGENT_TOOL_ROUNDS,
  DEFAULT_MODEL_TIMEOUT_MS,
  DEFAULT_TOOL_TIMEOUT_MS,
  AI_ERROR,
  AiRuntimeError,
  resolveAgentResources,
  materializeAgentRuntime,
  validateToolArgs,
  normalizeToolResultForModel,
  withTimeout,
  stripSecrets,
} = require("./workflowAiResources.service");

const getItemPayload = (item) => {
  if (item == null) return item;
  if (typeof item !== "object" || Array.isArray(item)) return item;
  if (item.json && typeof item.json === "object" && !Array.isArray(item.json)) {
    return item.json;
  }
  const { pairedItem, binary, json, ...rest } = item;
  if (Object.keys(rest).length > 0) return rest;
  return item;
};

/**
 * Run Agent for one WorkflowItem. Returns output json + safe metadata.
 */
const runAgentForItem = async ({
  node,
  context,
  item,
  itemIndex,
  runtime,
  interpolate,
  resolveExpression,
}) => {
  const data = node.data || {};
  const payload = getItemPayload(item) || {};
  const exprCtx = {
    input: context.input,
    steps: context.steps,
    items: context.items,
    item: payload,
    currentNodeId: node.id,
    graph: context.graph,
  };

  const promptTemplate = data.prompt || data.userPrompt || "{{item}}";
  const systemInstruction =
    data.systemInstruction || data.systemPrompt || "";

  const userPrompt = String(
    interpolate(promptTemplate, exprCtx) ?? ""
  ).trim();
  const systemText = systemInstruction
    ? String(resolveExpression(systemInstruction, exprCtx) ?? "").trim()
    : "";

  if (!userPrompt) {
    throw new AiRuntimeError(
      "AI Agent prompt resolved to empty text for this item.",
      AI_ERROR.TOOL_CALL_INVALID,
      { itemIndex }
    );
  }

  const messages = [];
  if (systemText) {
    messages.push({ role: "system", content: systemText });
  }
  messages.push({ role: "user", content: userPrompt });

  const toolDefs = runtime.tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));

  const toolTrace = [];
  let usageAcc = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let rounds = 0;
  let finalContent = "";
  let finishReason = "stop";

  const modelTimeout =
    Number(data.modelTimeoutMs) ||
    Number(node.data?.timeoutMs) ||
    DEFAULT_MODEL_TIMEOUT_MS;
  const toolTimeout =
    Number(data.toolTimeoutMs) || DEFAULT_TOOL_TIMEOUT_MS;

  for (;;) {
    if (rounds >= MAX_AGENT_TOOL_ROUNDS) {
      throw new AiRuntimeError(
        `AI Agent exceeded max tool rounds (${MAX_AGENT_TOOL_ROUNDS}).`,
        AI_ERROR.MAX_TOOL_ROUNDS,
        { rounds }
      );
    }
    rounds += 1;
    const result = await runtime.model.invoke({
      messages,
      tools: toolDefs,
      timeoutMs: modelTimeout,
      signal: context.abortSignal,
    });

    if (result.usage) {
      usageAcc.inputTokens += Number(result.usage.inputTokens) || 0;
      usageAcc.outputTokens += Number(result.usage.outputTokens) || 0;
      usageAcc.totalTokens += Number(result.usage.totalTokens) || 0;
    }

    const toolCalls = Array.isArray(result.toolCalls) ? result.toolCalls : [];
    if (toolCalls.length === 0) {
      finalContent = String(result.message?.content ?? "");
      finishReason = result.finishReason || "stop";
      break;
    }

    for (const tc of toolCalls) {
      if (!tc || !tc.id || !tc.name) {
        throw new AiRuntimeError(
          "Model returned a malformed tool call.",
          AI_ERROR.TOOL_CALL_INVALID
        );
      }
      if (!runtime.toolsByName.has(tc.name)) {
        throw new AiRuntimeError(
          `Unknown tool "${tc.name}".`,
          AI_ERROR.TOOL_NOT_FOUND,
          { toolName: tc.name }
        );
      }
    }

    messages.push({
      role: "assistant",
      content: result.message?.content || null,
      toolCalls: toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments || {},
      })),
    });

    for (const tc of toolCalls) {
      const tool = runtime.toolsByName.get(tc.name);
      validateToolArgs(tool.inputSchema, tc.arguments || {}, tc.name);
      const started = Date.now();
      let status = "succeeded";
      let toolResult;
      try {
        toolResult = await withTimeout(
          tool.execute(tc.arguments || {}, {
            workspaceId: context.workspaceId,
            runId: context.runId,
            nodeId: node.id,
            itemIndex,
          }),
          toolTimeout,
          AI_ERROR.TOOL_TIMEOUT,
          `Tool ${tc.name}`
        );
      } catch (err) {
        status = "failed";
        toolTrace.push({
          toolName: tc.name,
          callId: tc.id,
          status,
          durationMs: Date.now() - started,
        });
        if (err instanceof AiRuntimeError) throw err;
        throw new AiRuntimeError(
          err instanceof Error ? err.message : String(err),
          AI_ERROR.TOOL_FAILED,
          { toolName: tc.name }
        );
      }
      toolTrace.push({
        toolName: tc.name,
        callId: tc.id,
        status,
        durationMs: Date.now() - started,
      });
      const content = normalizeToolResultForModel(toolResult);
      messages.push({
        role: "tool",
        name: tc.name,
        toolCallId: tc.id,
        content,
      });
    }
  }

  const outputJson = {
    ...payload,
    ai: {
      output: finalContent,
      finishReason,
      provider: runtime.model.provider,
      model: runtime.model.model,
    },
    // Legacy-friendly aliases for Result/mapFrom consumers
    text: finalContent,
  };

  const metadata = {
    kind: "aiAgent",
    itemIndex,
    rounds,
    toolCalls: toolTrace,
    usage: usageAcc.totalTokens ? usageAcc : undefined,
    modelNodeId: runtime.modelDescriptor.nodeId,
    modelProvider: runtime.modelDescriptor.provider,
    // Never include prompts/credentials/raw provider blobs
  };

  return {
    json: outputJson,
    metadata: stripSecrets(metadata),
  };
};

/**
 * Full Agent node handler body.
 */
const executeAiAgent = async (node, context, helpers) => {
  const definition =
    context.graph?.definition ||
    (context.graph
      ? { nodes: context.graph.nodes, edges: context.graph.edges }
      : null);
  if (!definition) {
    throw new AiRuntimeError(
      "AI Agent requires graph definition for resource binding.",
      AI_ERROR.MODEL_REQUIRED
    );
  }

  const resolved = resolveAgentResources({
    nodeId: node.id,
    definition,
  });
  const runtime = materializeAgentRuntime(resolved);

  const inputItems = Array.isArray(context.inputItems) ? context.inputItems : [];
  const items =
    inputItems.length > 0
      ? inputItems
      : [{ json: { triggered: true, input: context.input || {} } }];

  const outItems = [];
  const perItemMeta = [];

  for (let i = 0; i < items.length; i += 1) {
    // Isolation: each item gets a fresh conversation (runtime model may keep
    // internal maps keyed by messages — we pass fresh message arrays per item).
    const { json, metadata } = await runAgentForItem({
      node,
      context,
      item: items[i],
      itemIndex: i,
      runtime,
      interpolate: helpers.interpolate,
      resolveExpression: helpers.resolveExpression,
    });
    outItems.push({
      json,
      pairedItem: { item: i },
    });
    perItemMeta.push(metadata);
  }

  return {
    items: outItems,
    output: {
      text:
        outItems.length === 1
          ? outItems[0].json?.text || outItems[0].json?.ai?.output || ""
          : outItems.map((o) => o.json?.text || o.json?.ai?.output || "").join("\n"),
      items: outItems.map((o) => o.json),
      isLlm: true,
      agent: true,
      // Safe observability on business output (no secrets / raw provider blobs)
      agentMeta: perItemMeta,
    },
    resolved: {
      kind: "aiAgent",
      itemCount: outItems.length,
      modelProvider: runtime.modelDescriptor.provider,
      toolNames: runtime.tools.map((t) => t.name),
      agentMeta: perItemMeta,
    },
  };
};

module.exports = {
  executeAiAgent,
  runAgentForItem,
  getItemPayload,
};
