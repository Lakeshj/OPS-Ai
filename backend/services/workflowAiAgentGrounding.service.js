/**
 * M8.15.2 — Generic AI Agent tool-grounding policy (provider-agnostic).
 * No Instagram/platform hardcoding: uses connected tool inventory + fallback phrasing.
 */

const GROUNDING_RETRY_USER_MESSAGE = [
  "Relevant connected tools are available.",
  "Use the appropriate tool to retrieve the requested live data before answering.",
  "Do not give generic access instructions when a connected tool can fetch the data.",
].join(" ");

/** Phrases that mean the model claimed it cannot access data that tools can fetch. */
const GENERIC_ACCESS_DENIAL_RE =
  /\b(i\s+(do\s+not|don't)\s+have\s+access|i\s+would\s+typically\s+need\s+access|i\s+need\s+access\s+to\s+your|if\s+you\s+have\s+access|if\s+you\s+(can\s+)?(provide|share|give)\s+(me\s+)?(access|data)|check\s+your\s+(account|dashboard|instagram|ads|analytics|crm)|you\s+can\s+manually|log\s+in\s+to\s+your|i\s+cannot\s+(access|retrieve|see)\s+(your|the)|i\s+can't\s+(access|retrieve|see)\s+(your|the)|without\s+access\s+to\s+your)\b/i;

const looksLikeGenericAccessDenial = (text) => {
  const raw = String(text || "").trim();
  if (!raw) return false;
  return GENERIC_ACCESS_DENIAL_RE.test(raw);
};

/**
 * Build the system appendix listing connected tools + grounding rules.
 * Descriptions already include whenToUse via composeToolDescription.
 */
const buildToolsSystemAppendix = (tools = []) => {
  const list = Array.isArray(tools) ? tools : [];
  if (list.length === 0) return "";

  const inventoryLines = list.map((t) => {
    const name = String(t?.name || "tool").trim() || "tool";
    const desc = String(t?.description || t?.displayName || name)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 360);
    return `- ${name}: ${desc}`;
  });

  return [
    "## Available tools",
    "Each tool below retrieves live or account-specific data from a connected system.",
    "What it owns / when to call it is described on each line.",
    ...inventoryLines,
    "",
    "## Tool grounding policy",
    "If the user asks for live, current, account-specific, workspace-specific,",
    "or external-system data and a relevant connected tool is available,",
    "you MUST use the tool before answering.",
    "",
    "Do not answer with generic instructions such as:",
    '"you would typically...", "if you have access...", "check your dashboard..."',
    "when the connected tool can retrieve the requested data.",
    "",
    "Do not invent metrics, posts, leads, or spend figures.",
    "Do not call tools for pure writing, rewriting, or summarization of text the user already provided.",
    "If a connected tool fails, say the tool returned an error — do not pretend the integration does not exist.",
  ].join("\n");
};

/**
 * Whether a no-tool final answer should trigger exactly one grounding retry.
 */
const shouldTriggerGroundingRetry = ({
  toolsAvailableCount,
  toolsRequestedCount,
  toolsUsedCount,
  groundingRetryTriggered,
  assistantText,
}) => {
  if (groundingRetryTriggered) return false;
  if (Number(toolsAvailableCount) <= 0) return false;
  if (Number(toolsRequestedCount) > 0 || Number(toolsUsedCount) > 0) {
    return false;
  }
  return looksLikeGenericAccessDenial(assistantText);
};

module.exports = {
  GROUNDING_RETRY_USER_MESSAGE,
  looksLikeGenericAccessDenial,
  buildToolsSystemAppendix,
  shouldTriggerGroundingRetry,
};
