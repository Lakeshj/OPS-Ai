/**
 * Part 14D.5 — Standalone AI Generate (main-flow, one model call per item).
 * Distinct from aiAgent (no tools/memory/loop) and aiChatModel (auxiliary).
 */

let testComplete = null;

const withAiGenerateTestComplete = async (complete, fn) => {
  const prev = testComplete;
  testComplete = complete;
  try {
    return await fn();
  } finally {
    testComplete = prev;
  }
};

const payloadOf = (item) => {
  if (item && typeof item === "object" && "json" in item) return item.json;
  return item;
};

const executeAiGenerate = async (node, context) => {
  const {
    runLlmNodeForItem,
    interpolate,
    attachRuntimeDataToPrompt,
    resolveRuntimePromptPayload,
  } = require("./workflowNodes.service");
  const data = node.data || {};
  if (!String(data.provider || data.model || "").trim() && !data.model) {
    // model still has a default in runLlmNode; require explicit prompt
  }
  const prompt = String(data.prompt || "").trim();
  if (!prompt) {
    throw new Error("AI Generate requires a prompt");
  }

  const incoming =
    Array.isArray(context.inputItems) && context.inputItems.length
      ? context.inputItems
      : [{ json: context.input ?? {} }];

  const items = [];
  for (let i = 0; i < incoming.length; i += 1) {
    const src = incoming[i];
    const itemContext = {
      ...context,
      input: payloadOf(src) ?? context.input,
      item: src,
      inputItems: [src],
    };
    if (testComplete) {
      const {
        applyAiGrounding,
      } = require("../../plugins/gsc-mcp/src/contracts/intelligenceContext");
      let userPrompt = interpolate(data.prompt || "{{input}}", itemContext);
      let systemPrompt = interpolate(data.systemPrompt || "", itemContext);
      const model = interpolate(data.model || "gpt-4o-mini", itemContext);
      let groundedOk = false;
      try {
        const grounded = applyAiGrounding({
          systemPrompt,
          userPrompt,
          input: payloadOf(src) ?? itemContext.input,
        });
        if (grounded.grounded) {
          systemPrompt = grounded.systemPrompt;
          userPrompt = grounded.userPrompt;
          groundedOk = true;
        }
      } catch (err) {
        if (
          err?.code === "MCP_PROPERTY_REQUIRED" ||
          err?.code === "MCP_INTEL_CONTEXT_INVALID"
        ) {
          throw err;
        }
      }
      if (!groundedOk) {
        const runtimePayload =
          resolveRuntimePromptPayload(itemContext) ?? payloadOf(src);
        userPrompt = attachRuntimeDataToPrompt(userPrompt, runtimePayload).prompt;
      }
      const text = await testComplete({
        prompt: userPrompt,
        systemPrompt,
        model,
        item: payloadOf(src),
        index: i,
        outputFormat: data.outputFormat || "text",
      });
      items.push({
        json: {
          text: String(text ?? ""),
          provider: data.provider || "openai",
          model: model || "gpt-4o-mini",
          promptsUsed: {
            systemPrompt,
            userPrompt,
            gscGrounded: groundedOk,
          },
        },
      });
      continue;
    }
    const result = await runLlmNodeForItem(node, itemContext, {
      requireBot: false,
    });
    items.push({
      json: {
        text: result.output?.text || "",
        json: result.output?.json ?? undefined,
        provider: result.output?.provider,
        model: result.output?.model,
        promptsUsed: result.output?.promptsUsed,
        systemPrompt: result.output?.systemPrompt,
        userPrompt: result.output?.userPrompt,
      },
    });
  }

  const firstPrompts = items[0]?.json?.promptsUsed || null;
  return {
    items,
    output: {
      text: items.length === 1 ? items[0].json.text : items.map((it) => it.json.text),
      itemCount: items.length,
      isLlm: true,
      ...(firstPrompts
        ? {
            promptsUsed: firstPrompts,
            systemPrompt: firstPrompts.systemPrompt,
            userPrompt: firstPrompts.userPrompt,
          }
        : {}),
    },
    resolved: {
      provider: data.provider || "openai",
      model: data.model || "gpt-4o-mini",
      perItem: true,
      agent: false,
      tools: false,
    },
  };
};

module.exports = {
  executeAiGenerate,
  withAiGenerateTestComplete,
};
