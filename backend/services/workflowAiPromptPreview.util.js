/**
 * Resolve AI prompts the same way runLlmNode does for GSC grounding.
 * Preview for Instructions shows the USER-CONTROLLED text; grounding is a flag.
 * Preview for Workflow input / prompt shows the grounded user message (data).
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

const isInstructionsParameter = (parameterName) => {
  const name = String(parameterName || "");
  return name === "systemPrompt" || name === "systemInstruction";
};

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

  const userInstructions = String(systemPrompt || "").trim();
  let mergedSystemPrompt = systemPrompt;
  let mergedUserPrompt = userPrompt;
  let gscGrounded = false;
  let runtimeDataAttached = false;
  let userInstructionsResolved = userInstructions;

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
      mergedSystemPrompt = grounded.systemPrompt;
      mergedUserPrompt = grounded.userPrompt;
      userInstructionsResolved =
        grounded.userInstructions || userInstructions || null;
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
    const attached = attachRuntimeDataToPrompt(mergedUserPrompt, runtimePayload);
    mergedUserPrompt = attached.prompt;
    runtimeDataAttached = attached.attached;
  }

  return {
    /** Merged system message actually sent to the model */
    systemPrompt: mergedSystemPrompt,
    /** Merged user message actually sent to the model */
    userPrompt: mergedUserPrompt,
    /** User-controlled instructions only (for Instructions field preview) */
    userInstructions: userInstructionsResolved,
    gscGrounded,
    groundingApplied: gscGrounded,
    runtimeDataAttached,
  };
};

/**
 * Value shown in the Parameters field Preview for a given parameter.
 * Instructions → user text only; Prompt → workflow/user-request message.
 */
const effectivePromptForParameter = (parameterName, effective) => {
  const name = String(parameterName || "");
  if (name === "prompt") return effective.userPrompt;
  if (name === "systemPrompt" || name === "systemInstruction") {
    return effective.userInstructions || "";
  }
  return null;
};

module.exports = {
  AI_PROMPT_PARAM_NAMES,
  isAiPromptParameter,
  isAiPromptNodeType,
  isInstructionsParameter,
  resolveEffectiveAiPrompts,
  effectivePromptForParameter,
};
