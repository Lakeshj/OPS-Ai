/**
 * Common MCP AI grounding facade for workflow LLM nodes.
 *
 * Recognizes two structured intelligence sources (same architecture family):
 * 1) GSC IntelligenceContext  — plugins/gsc-mcp (unchanged)
 * 2) GA4 IntelligenceContext  — plugins/ga4-mcp
 *
 * Source is detected from structured markers/contracts BEFORE any source
 * path is initialized. A missing GSC property is only an error when the
 * input is actually GSC intelligence — never for GA4-only workflows.
 *
 * Native GA4 runReport grounding stays in workflowGa4AiGrounding.js.
 */

const itemPayload = (item) => {
  if (item && typeof item === "object" && !Array.isArray(item) && "json" in item) {
    return item.json;
  }
  return item;
};

const isPlainObject = (v) =>
  v != null && typeof v === "object" && !Array.isArray(v);

const collectPayloads = (input) => {
  if (input == null) return [];
  if (Array.isArray(input)) {
    return input.map(itemPayload).filter(isPlainObject);
  }
  const payload = itemPayload(input);
  if (isPlainObject(payload)) {
    // Nested IntelligenceContext on a node output blob
    if (isPlainObject(payload.intelligenceContext)) {
      return [payload.intelligenceContext];
    }
    return [payload];
  }
  return [];
};

/** Strict GSC markers / contracts — not the broad capability-section heuristic. */
const isGscMarkedPayload = (payload) => {
  if (!isPlainObject(payload)) return false;
  if (payload.__gscIntelligence === true) return true;
  if (payload.__gscCapabilitySection === true) return true;
  if (payload.kind === "gsc_intelligence_context") return true;
  if (payload.source === "google_search_console") return true;
  return false;
};

/** Strict GA4 markers / contracts. */
const isGa4MarkedPayload = (payload) => {
  if (!isPlainObject(payload)) return false;
  if (payload.__ga4Intelligence === true) return true;
  if (payload.__ga4CapabilitySection === true) return true;
  if (payload.kind === "ga4_intelligence_context") return true;
  if (payload.source === "google_analytics") return true;
  try {
    const ga4 = require("../../plugins/ga4-mcp/src/contracts/intelligenceContext");
    if (typeof ga4.looksLikeGa4McpRow === "function" && ga4.looksLikeGa4McpRow(payload)) {
      return true;
    }
    if (
      typeof ga4.looksLikeGa4IntelligencePayload === "function" &&
      ga4.looksLikeGa4IntelligencePayload(payload)
    ) {
      return true;
    }
  } catch {
    /* plugin unavailable */
  }
  return false;
};

/**
 * Determine MCP intelligence source before initializing any source path.
 * Returns 'gsc' | 'ga4' | null.
 *
 * GA4 markers win over GSC's broad capability-section heuristic so that
 * GA4 empty envelopes / sections never trigger GSC property validation.
 */
const detectMcpIntelligenceSource = (input) => {
  const payloads = collectPayloads(input);
  if (!payloads.length) return null;

  const ga4Count = payloads.filter(isGa4MarkedPayload).length;
  const gscCount = payloads.filter(isGscMarkedPayload).length;

  if (ga4Count > 0 && gscCount === 0) return "ga4";
  if (gscCount > 0 && ga4Count === 0) return "gsc";
  if (gscCount > 0 && ga4Count > 0) {
    // Mixed batch should not happen in normal graphs; prefer explicit GSC markers.
    return "gsc";
  }

  // No strict markers — fall back to plugin tryBuild (non-throwing detection).
  try {
    const gsc = require("../../plugins/gsc-mcp/src/contracts/intelligenceContext");
    if (Array.isArray(input)) {
      const built = gsc.tryBuildFromWorkflowItems(input);
      // Reject GSC false-positives on GA4-shaped sections (capability+results+count
      // without GSC markers). Only accept when every payload is GSC-marked OR
      // tryBuild succeeded AND no payload looks GA4.
      if (built.ok && payloads.every(isGscMarkedPayload)) return "gsc";
    } else if (
      gsc.looksLikeGscIntelligencePayload(payloads[0]) &&
      isGscMarkedPayload(payloads[0])
    ) {
      return "gsc";
    }
  } catch {
    /* ignore */
  }

  try {
    const ga4 = require("../../plugins/ga4-mcp/src/contracts/intelligenceContext");
    if (Array.isArray(input)) {
      const built = ga4.tryBuildFromWorkflowItems(input);
      if (built.ok) return "ga4";
    } else if (ga4.looksLikeGa4IntelligencePayload(payloads[0])) {
      return "ga4";
    }
  } catch {
    /* ignore */
  }

  return null;
};

const resolveMcpGroundingInput = (context, expressionInput) => {
  if (context?.item != null) return context.item;
  const incoming = Array.isArray(context?.inputItems) ? context.inputItems : [];
  if (incoming.length === 1) return incoming[0];
  if (incoming.length > 1) return incoming;
  return expressionInput;
};

/**
 * Apply GSC or GA4 IntelligenceContext grounding based on detected source.
 * @returns {{
 *   grounded: boolean,
 *   groundingApplied: boolean,
 *   source: 'gsc'|'ga4'|null,
 *   systemPrompt: string,
 *   userPrompt: string,
 *   userInstructions: string|null,
 *   intelligenceContext: object|null,
 *   empty?: boolean,
 * }}
 */
const applyMcpAiGrounding = ({
  systemPrompt = "",
  userPrompt = "",
  input,
  context,
} = {}) => {
  const groundingInput =
    input !== undefined
      ? input
      : resolveMcpGroundingInput(context, context?.input);

  const source = detectMcpIntelligenceSource(groundingInput);

  if (source === "gsc") {
    const {
      applyAiGrounding,
    } = require("../../plugins/gsc-mcp/src/contracts/intelligenceContext");
    const gsc = applyAiGrounding({
      systemPrompt,
      userPrompt,
      input: groundingInput,
    });
    if (gsc.grounded) {
      return {
        ...gsc,
        source: "gsc",
      };
    }
    return {
      grounded: false,
      groundingApplied: false,
      source: null,
      systemPrompt,
      userPrompt,
      userInstructions: String(systemPrompt || "").trim() || null,
      intelligenceContext: null,
    };
  }

  if (source === "ga4") {
    const {
      applyAiGrounding: applyGa4IntelGrounding,
    } = require("../../plugins/ga4-mcp/src/contracts/intelligenceContext");
    const ga4 = applyGa4IntelGrounding({
      systemPrompt,
      userPrompt,
      input: groundingInput,
    });
    if (ga4.grounded) {
      return {
        ...ga4,
        source: "ga4",
      };
    }
    return {
      grounded: false,
      groundingApplied: false,
      source: null,
      systemPrompt,
      userPrompt,
      userInstructions: String(systemPrompt || "").trim() || null,
      intelligenceContext: null,
    };
  }

  // Neither GSC nor GA4 MCP intelligence — do not initialize either path.
  return {
    grounded: false,
    groundingApplied: false,
    source: null,
    systemPrompt,
    userPrompt,
    userInstructions: String(systemPrompt || "").trim() || null,
    intelligenceContext: null,
  };
};

/** True when upstream items are GSC or GA4 MCP intelligence-shaped. */
const looksLikeMcpIntelligenceInput = (input) =>
  detectMcpIntelligenceSource(input) != null;

module.exports = {
  applyMcpAiGrounding,
  resolveMcpGroundingInput,
  looksLikeMcpIntelligenceInput,
  detectMcpIntelligenceSource,
  isGscMarkedPayload,
  isGa4MarkedPayload,
};
