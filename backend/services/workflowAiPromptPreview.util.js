/**
 * Resolve the effective AI system/user prompts the same way runLlmNode does,
 * so Expression Preview and OUTPUT can show what the model actually receives
 * (including GSC MCP grounding that is not stored in the Parameters field).
 */

const {
  interpolate,
  resolveExpressionInput,
  getItemPayload,
  attachRuntimeDataToPrompt,
  resolveRuntimePromptPayload,
} = require("./workflowNodes.service");

const AI_PROMPT_PARAM_NAMES = new Set([
  "systemPrompt",
  "systemInstruction",
  "prompt",
]);

const AI_NODE_TYPES = new Set(["ai", "bot", "aiGenerate", "aiAgent"]);

const isAiPromptParameter = (parameterName) =>
  AI_PROMPT_PARAM_NAMES.has(String(parameterName || ""));

const isAiPromptNodeType = (nodeType) =>
  AI_NODE_TYPES.has(String(nodeType || ""));

/**
 * @param {{
 *   node?: { type?: string, data?: Record<string, unknown> },
 *   context: object,
 *   systemPromptTemplate?: string,
 *   userPromptTemplate?: string,
 * }} opts
 */
const resolveEffectiveAiPrompts = ({
  node,
  context,
  systemPromptTemplate,
  userPromptTemplate,
} = {}) => {
  const data = node?.data || {};
  let systemPrompt = String(
    systemPromptTemplate != null
      ? systemPromptTemplate
      : data.systemPrompt || data.systemInstruction || ""
  );
  let userPrompt = String(
    userPromptTemplate != null ? userPromptTemplate : data.prompt || "{{input}}"
  );

  const expressionInput = resolveExpressionInput(context);
  const exprScope = {
    input: expressionInput,
    steps: context.steps,
    item: context.item != null ? getItemPayload(context.item) : expressionInput,
    items: context.items,
    inputItems: context.inputItems,
  };

  if (systemPrompt.includes("{{")) {
    systemPrompt = String(interpolate(systemPrompt, exprScope) ?? "");
  }
  if (userPrompt.includes("{{")) {
    userPrompt = String(interpolate(userPrompt, exprScope) ?? "");
  }

  let gscGrounded = false;
  let runtimeDataAttached = false;
  try {
    const {
      applyAiGrounding,
    } = require("../../plugins/gsc-mcp/src/contracts/intelligenceContext");
    const groundingInput =
      context.item != null
        ? context.item
        : Array.isArray(context.inputItems) && context.inputItems.length
          ? context.inputItems.length === 1
            ? context.inputItems[0]
            : context.inputItems
          : expressionInput;
    const grounded = applyAiGrounding({
      systemPrompt,
      userPrompt,
      input: groundingInput,
    });
    if (grounded.grounded) {
      systemPrompt = grounded.systemPrompt;
      userPrompt = grounded.userPrompt;
      gscGrounded = true;
    }
  } catch (err) {
    if (
      err?.code === "MCP_PROPERTY_REQUIRED" ||
      err?.code === "MCP_INTEL_CONTEXT_INVALID"
    ) {
      throw err;
    }
  }

  if (!gscGrounded) {
    const runtimePayload = resolveRuntimePromptPayload(context);
    const attached = attachRuntimeDataToPrompt(userPrompt, runtimePayload);
    userPrompt = attached.prompt;
    runtimeDataAttached = attached.attached;
  }

  return {
    systemPrompt,
    userPrompt,
    gscGrounded,
    runtimeDataAttached,
  };
};

const effectivePromptForParameter = (parameterName, effective) => {
  const name = String(parameterName || "");
  if (name === "prompt") return effective.userPrompt;
  if (name === "systemPrompt" || name === "systemInstruction") {
    return effective.systemPrompt;
  }
  return null;
};

module.exports = {
  AI_PROMPT_PARAM_NAMES,
  isAiPromptParameter,
  isAiPromptNodeType,
  resolveEffectiveAiPrompts,
  effectivePromptForParameter,
};
