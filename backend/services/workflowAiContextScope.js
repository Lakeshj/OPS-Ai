/**
 * Shared AI Context Scope (regular AI + Basic AI Agent).
 * Explicit node config only — never inferred from prompt wording.
 *
 * item    = one model turn per incoming WorkflowItem (default)
 * dataset = one model turn over the full incoming set
 */

const CONTEXT_SCOPE = Object.freeze({
  ITEM: "item",
  DATASET: "dataset",
});

/**
 * @param {Record<string, unknown>} [data]
 * @returns {"item"|"dataset"}
 */
const resolveAiContextScope = (data = {}) => {
  const raw = String(data.contextScope || data.agentContextScope || "")
    .trim()
    .toLowerCase();
  if (
    raw === "dataset" ||
    raw === "all" ||
    raw === "all_items" ||
    raw === "all-items"
  ) {
    return CONTEXT_SCOPE.DATASET;
  }
  if (raw === "item" || raw === "per_item" || raw === "per-item") {
    return CONTEXT_SCOPE.ITEM;
  }
  if (data.includeAllInputItems === true) return CONTEXT_SCOPE.DATASET;
  return CONTEXT_SCOPE.ITEM;
};

/** Shared parameter schema fragment for frontend/backend docs. */
const CONTEXT_SCOPE_PARAM = Object.freeze({
  name: "contextScope",
  displayName: "Context Scope",
  type: "options",
  default: "item",
  options: [
    { name: "Per Item", value: "item" },
    { name: "Entire Dataset", value: "dataset" },
  ],
  description:
    "Per Item: run once for each incoming item. Entire Dataset: analyze all incoming items together in one AI turn.",
});

module.exports = {
  CONTEXT_SCOPE,
  resolveAiContextScope,
  CONTEXT_SCOPE_PARAM,
  // Backward-compatible Agent alias
  resolveAgentContextScope: resolveAiContextScope,
};
