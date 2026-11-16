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

const DATASET_ALIASES = new Set([
  "dataset",
  "all",
  "all_items",
  "all-items",
  "allitems",
  "entire_dataset",
  "entire-dataset",
  "entiredataset",
  "entire dataset",
  "run_once",
  "run-once",
  "once",
]);

const ITEM_ALIASES = new Set([
  "item",
  "per_item",
  "per-item",
  "peritem",
  "per item",
  "each",
  "each_item",
  "each-item",
]);

/**
 * Flatten common saved-node shapes so contextScope is found after save/reload.
 * @param {unknown} nodeOrData
 * @returns {Record<string, unknown>}
 */
const readAiNodeConfig = (nodeOrData = {}) => {
  if (nodeOrData == null || typeof nodeOrData !== "object") return {};
  const root = /** @type {Record<string, unknown>} */ (nodeOrData);
  const data =
    root.data && typeof root.data === "object" && !Array.isArray(root.data)
      ? /** @type {Record<string, unknown>} */ (root.data)
      : root;
  const nestedCandidates = [data.parameters, data.params, data.settings];
  let nested = {};
  for (const candidate of nestedCandidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      nested = { ...nested, .../** @type {Record<string, unknown>} */ (candidate) };
    }
  }
  return {
    ...nested,
    ...data,
    contextScope:
      data.contextScope ??
      nested.contextScope ??
      root.contextScope ??
      data.agentContextScope ??
      nested.agentContextScope,
  };
};

/**
 * @param {Record<string, unknown>|unknown} [dataOrNode]
 * @returns {"item"|"dataset"}
 */
const resolveAiContextScope = (dataOrNode = {}) => {
  const data = readAiNodeConfig(dataOrNode);
  const rawSource = data.contextScope ?? data.agentContextScope ?? "";
  const raw = Array.isArray(rawSource)
    ? String(rawSource[0] ?? "")
    : typeof rawSource === "object" && rawSource != null
      ? String(
          /** @type {Record<string, unknown>} */ (rawSource).value ??
            /** @type {Record<string, unknown>} */ (rawSource).id ??
            ""
        )
      : String(rawSource);
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ");

  if (DATASET_ALIASES.has(normalized)) return CONTEXT_SCOPE.DATASET;
  if (ITEM_ALIASES.has(normalized)) return CONTEXT_SCOPE.ITEM;
  if (data.includeAllInputItems === true) return CONTEXT_SCOPE.DATASET;
  return CONTEXT_SCOPE.ITEM;
};

const isDatasetContextScope = (dataOrNode) =>
  resolveAiContextScope(dataOrNode) === CONTEXT_SCOPE.DATASET;

/** Shared parameter schema fragment for frontend/backend docs. */
const CONTEXT_SCOPE_PARAM = Object.freeze({
  name: "contextScope",
  displayName: "Context Scope",
  type: "options",
  default: "item",
  options: [
    {
      name: "Per Item",
      value: "item",
      description: "Run once for each incoming item",
    },
    {
      name: "Entire Dataset",
      value: "dataset",
      description: "Analyze all incoming items together once",
    },
  ],
  description:
    "Per Item: run once for each incoming item. Entire Dataset: analyze all incoming items together once.",
});

module.exports = {
  CONTEXT_SCOPE,
  resolveAiContextScope,
  readAiNodeConfig,
  isDatasetContextScope,
  CONTEXT_SCOPE_PARAM,
  // Backward-compatible Agent alias
  resolveAgentContextScope: resolveAiContextScope,
};
