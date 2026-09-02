/**
 * Central workflow item provenance (pairedItem) engine.
 * Applies node-contract policies after handlers run — handlers stay unaware.
 */

const { getEngineContract } = require("../config/nodeContract");

/** @typedef {{ json: Record<string, unknown>, binary?: Record<string, unknown>, pairedItem?: number | { item: number, input?: number } | Array<{ item: number, input?: number }> }} WorkflowItem */

const isPlainObject = (v) =>
  v != null && typeof v === "object" && !Array.isArray(v);

/** Deep-clone JSON-serializable workflow data; binary refs are not copied. */
const cloneJsonData = (value) => {
  if (value == null || typeof value !== "object") return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    if (Array.isArray(value)) return [...value];
    return { ...value };
  }
};

/**
 * Canonical runtime item. Plain handler objects become { json }.
 * Existing pairedItem / binary are preserved.
 */
const normalizeItem = (raw, fallbackIndex = 0, options = {}) => {
  const assignDefaultPairedItem = options.assignDefaultPairedItem !== false;

  if (raw == null) {
    const item = { json: {} };
    if (assignDefaultPairedItem) item.pairedItem = { item: fallbackIndex };
    return item;
  }

  if (isPlainObject(raw) && isPlainObject(raw.json) && !Array.isArray(raw.json)) {
    const item = {
      json: cloneJsonData(raw.json),
    };
    if (raw.binary && isPlainObject(raw.binary)) {
      item.binary = raw.binary;
    }
    if (raw.pairedItem !== undefined) {
      item.pairedItem = raw.pairedItem;
    } else if (assignDefaultPairedItem) {
      item.pairedItem = { item: fallbackIndex };
    }
    return item;
  }

  if (isPlainObject(raw)) {
    const { pairedItem, binary, json, ...rest } = raw;
    const payload =
      json && isPlainObject(json) && Object.keys(rest).length === 0
        ? json
        : isPlainObject(json)
          ? { ...rest, ...json }
          : { ...rest };
    const item = { json: cloneJsonData(payload) };
    if (binary && isPlainObject(binary)) item.binary = binary;
    if (pairedItem !== undefined) item.pairedItem = pairedItem;
    else if (assignDefaultPairedItem) item.pairedItem = { item: fallbackIndex };
    return item;
  }

  const item = {
    json: { value: raw },
  };
  if (assignDefaultPairedItem) item.pairedItem = { item: fallbackIndex };
  return item;
};

/** Deep-clone json; binary reference preserved (no byte copying). */
const cloneItem = (item) => {
  const normalized = normalizeItem(item, 0);
  return {
    json: cloneJsonData(normalized.json),
    ...(normalized.binary ? { binary: normalized.binary } : {}),
    ...(normalized.pairedItem !== undefined
      ? { pairedItem: cloneJsonData(normalized.pairedItem) }
      : {}),
  };
};

const normalizeItems = (items) =>
  (Array.isArray(items) ? items : []).map((item, index) =>
    normalizeItem(item, index)
  );

const isValidPairedItem = (pairedItem) => {
  if (pairedItem == null) return false;
  if (typeof pairedItem === "number") {
    return Number.isInteger(pairedItem) && pairedItem >= 0;
  }
  if (Array.isArray(pairedItem)) {
    return (
      pairedItem.length > 0 &&
      pairedItem.every(
        (ref) =>
          ref &&
          typeof ref === "object" &&
          Number.isInteger(ref.item) &&
          ref.item >= 0 &&
          (ref.input === undefined ||
            (Number.isInteger(ref.input) && ref.input >= 0))
      )
    );
  }
  if (typeof pairedItem === "object") {
    return (
      Number.isInteger(pairedItem.item) &&
      pairedItem.item >= 0 &&
      (pairedItem.input === undefined ||
        (Number.isInteger(pairedItem.input) && pairedItem.input >= 0))
    );
  }
  return false;
};

const sanitizePairedItem = (pairedItem) =>
  isValidPairedItem(pairedItem) ? cloneJsonData(pairedItem) : undefined;

const withProvenance = (item, pairedItem, sourceItem, options = {}) => {
  const normalized = normalizeItem(item, 0, { assignDefaultPairedItem: false });
  const explicit =
    options.overwriteProvenance === true
      ? undefined
      : sanitizePairedItem(normalized.pairedItem);
  const linked = {
    ...cloneItem(normalized),
    pairedItem: explicit ?? pairedItem,
  };
  if (!linked.binary && sourceItem?.binary) {
    linked.binary = sourceItem.binary;
  }
  return linked;
};

const linkAt = (item, index, sourceItem) =>
  withProvenance(item, { item: index }, sourceItem, { overwriteProvenance: true });

/** identityBySurvival — survivors link to their position in immediate input */
const preserveSurvivor = (item, inputIndex, sourceItem) =>
  linkAt(item, inputIndex, sourceItem);

const findInputIndexByReference = (inputItems, candidate) => {
  const idx = inputItems.findIndex((inp) => inp === candidate);
  if (idx >= 0) return idx;
  const cand = normalizeItem(candidate, -1).json;
  return inputItems.findIndex((inp) => {
    const a = normalizeItem(inp, -1).json;
    try {
      return JSON.stringify(a) === JSON.stringify(cand);
    } catch {
      return false;
    }
  });
};

/** identity1to1 — out[i] ← in[i] by immediate input position */
const applyIdentity1to1 = (inputItems, outputItems) => {
  const inputs = normalizeItems(inputItems);
  return outputItems.map((out, i) => linkAt(out, i, inputs[i]));
};

/** identityBySurvival — survivors keep upstream index, never renumbered */
const applyIdentityBySurvival = (inputItems, outputItems) => {
  const inputs = normalizeItems(inputItems);
  return outputItems.map((out) => {
    const inputIndex = findInputIndexByReference(inputs, out);
    const idx = inputIndex >= 0 ? inputIndex : 0;
    return preserveSurvivor(out, idx, inputs[idx]);
  });
};

/** fanOut — every child links to the source item's position in immediate input */
const applyFanOut = (inputItems, outputItems, sourceIndex = 0) => {
  const inputs = normalizeItems(inputItems);
  const src =
    sourceIndex >= 0 && sourceIndex < inputs.length ? sourceIndex : 0;
  const source = inputs[src];
  return outputItems.map((out) =>
    withProvenance(out, { item: src }, source, { overwriteProvenance: true })
  );
};

/** fanIn — one output references every contributing immediate-input position */
const applyFanIn = (inputItems, outputItems) => {
  const inputs = normalizeItems(inputItems);
  const links = inputs.map((_, i) => ({ item: i }));
  if (outputItems.length === 0) return [];
  const [first, ...rest] = outputItems;
  return [
    withProvenance(first, links, inputs[0], { overwriteProvenance: true }),
    ...rest.map((out) =>
      withProvenance(out, links, inputs[0], { overwriteProvenance: true })
    ),
  ];
};

/** routing / perBranchIdentity — passthrough with preserved indices */
const applyRouting = (inputItems, outputItems) =>
  applyIdentityBySurvival(inputItems, outputItems);

/** manual — Code node and similar */
const applyManual = (inputItems, outputItems, options = {}) => {
  const inputs = normalizeItems(inputItems);
  const mode = options.codeMode || "all";

  if (mode === "each") {
    return outputItems.map((out, i) =>
      withProvenance(out, { item: i }, inputs[i])
    );
  }

  if (outputItems.length === inputs.length && inputs.length > 0) {
    return outputItems.map((out, i) =>
      withProvenance(out, { item: i }, inputs[i])
    );
  }

  return outputItems.map((out) => {
    const normalized = normalizeItem(out, 0, { assignDefaultPairedItem: false });
    if (isValidPairedItem(normalized.pairedItem)) {
      return cloneItem(normalized);
    }
    return cloneItem(out);
  });
};

/** multiPort — basic merge provenance (Part 5 will extend) */
const applyMultiPort = (inputItems, outputItems, options = {}) => {
  const mode = options.mergeMode || "append";
  if (mode === "combine") {
    return applyFanIn(inputItems, outputItems);
  }
  return applyIdentityBySurvival(inputItems, outputItems);
};

/** Triggers / terminals — no provenance links */
const applyNone = (outputItems) =>
  outputItems.map((out) => {
    const item = cloneItem(out);
    delete item.pairedItem;
    return item;
  });

/**
 * Detect splitOut fan-out source index (mirrors handler semantics).
 */
const detectSplitOutSourceIndex = (inputItems, nodeData = {}) => {
  const field = String(nodeData.fieldName || "").trim();
  const inputs = normalizeItems(inputItems);
  if (!field) {
    return inputs.length === 1 ? 0 : -1;
  }
  for (let i = 0; i < inputs.length; i += 1) {
    const payload = inputs[i].json || {};
    const val = field.includes(".")
      ? field.split(".").reduce((cur, key) => (cur == null ? undefined : cur[key]), payload)
      : payload[field];
    if (Array.isArray(val)) return i;
  }
  return 0;
};

/**
 * Operation-aware policy resolution — contract baseline + runtime metadata.
 */
const resolveProvenancePolicy = (
  nodeType,
  nodeData = {},
  resultMetadata = {}
) => {
  const base = getEngineContract(nodeType).pairedItemPolicy || "identity1to1";
  const inputCount = Number(resultMetadata.inputCount) || 0;
  const outputCount = Number(resultMetadata.outputCount) || 0;

  if (nodeType === "http") {
    if (resultMetadata.fanOut || (inputCount === 1 && outputCount > 1)) {
      return "fanOut";
    }
    return "identity1to1";
  }

  if (nodeType === "spreadsheet") {
    const operation = String(nodeData.operation || "read").toLowerCase();
    if (operation === "write") {
      return outputCount === 1 ? "fanIn" : "identity1to1";
    }
    if (inputCount === 1 && outputCount > 1) return "fanOut";
    if (outputCount === inputCount && inputCount > 0) return "identity1to1";
    return "fanOut";
  }

  if (nodeType === "document") {
    if (inputCount === 1 && outputCount > 1) return "fanOut";
    return "identity1to1";
  }

  return base;
};

/**
 * Main entry — normalize handler output and apply contract policy.
 */
const applyNodeProvenance = (
  nodeType,
  inputItems,
  rawOutputItems,
  options = {}
) => {
  const outputs = (Array.isArray(rawOutputItems) ? rawOutputItems : []).map(
    (o) => o
  );
  const inputs = Array.isArray(inputItems) ? inputItems : [];
  const policy = resolveProvenancePolicy(
    nodeType,
    options.nodeData || {},
    {
      inputCount: inputs.length,
      outputCount: outputs.length,
      fanOut: options.resultMetadata?.fanOut,
    }
  );

  if (outputs.length === 0) return [];

  switch (policy) {
    case "none":
      return applyNone(outputs);

    case "identity1to1": {
      if (inputs.length === 1 && outputs.length > 1) {
        return applyFanOut(inputs, outputs, 0);
      }
      if (outputs.length === inputs.length) {
        return applyIdentity1to1(inputs, outputs);
      }
      if (inputs.length === 0) {
        return outputs.map((out, i) => linkAt(out, i));
      }
      return outputs.map((out, i) =>
        i < inputs.length ? linkAt(out, i, inputs[i]) : cloneItem(out)
      );
    }

    case "fanOut": {
      const field = String(options.nodeData?.fieldName || "").trim();
      if (!field && inputs.length === outputs.length) {
        return applyIdentity1to1(inputs, outputs);
      }
      const sourceIndex =
        options.fanOutSourceIndex ??
        detectSplitOutSourceIndex(inputs, options.nodeData || {});
      return applyFanOut(inputs, outputs, sourceIndex >= 0 ? sourceIndex : 0);
    }

    case "identityBySurvival":
      return applyIdentityBySurvival(inputs, outputs);

    case "fanIn":
      return applyFanIn(inputs, outputs);

    case "routing":
      return applyRouting(inputs, outputs);

    case "multiPort":
      return applyMultiPort(inputs, outputs, options);

    case "manual":
      return applyManual(inputs, outputs, options);

    default:
      return applyIdentity1to1(inputs, outputs);
  }
};

/**
 * Validate all pairedItem metadata on finalized items (dev/test aid).
 */
const validateItemsProvenance = (items) => {
  const issues = [];
  for (let i = 0; i < items.length; i += 1) {
    const pi = items[i]?.pairedItem;
    if (pi === undefined) continue;
    if (!isValidPairedItem(pi)) {
      issues.push(`item ${i}: invalid pairedItem`);
    }
  }
  return issues;
};

/**
 * Normalize node execution result items for cache / downstream / persistence.
 */
const normalizeNodeOutput = (node, inputItems, rawItems, extraOptions = {}) => {
  const nodeType = node.type || node.data?.nodeType || "noop";
  const rawOutputItems = Array.isArray(rawItems) ? rawItems : [];
  const options = {
    ...extraOptions,
    nodeData: node.data || {},
    mergeMode: node.data?.mode,
    codeMode: node.data?.mode === "each" ? "each" : "all",
    resultMetadata: {
      inputCount: Array.isArray(inputItems) ? inputItems.length : 0,
      outputCount: rawOutputItems.length,
      fanOut: extraOptions.resultMetadata?.fanOut,
    },
  };

  if (nodeType === "splitOut") {
    options.fanOutSourceIndex = detectSplitOutSourceIndex(
      inputItems,
      node.data || {}
    );
  }

  if (nodeType === "http") {
    options.resultMetadata.fanOut =
      options.resultMetadata.inputCount === 1 &&
      options.resultMetadata.outputCount > 1;
  }

  const provenanceItems = applyNodeProvenance(
    nodeType,
    inputItems,
    rawOutputItems,
    options
  );

  const issues = validateItemsProvenance(provenanceItems);
  if (issues.length > 0 && process.env.NODE_ENV !== "production") {
    console.warn("[workflow-provenance]", nodeType, issues.join("; "));
  }

  return provenanceItems;
};

/** Attach canonical items to a persisted output object (backward compatible). */
const attachCanonicalItemsToOutput = (output, items) => {
  if (output && typeof output === "object" && !Array.isArray(output)) {
    return { ...output, items };
  }
  if (output == null) {
    return { items };
  }
  return { value: output, items };
};

/** JSON round-trip check for persistence tests */
const serializeItems = (items) => JSON.parse(JSON.stringify(items));

/** Walk pairedItem chain backward through staged node outputs to the root item */
const walkProvenanceChain = (stages, outputItem) => {
  if (!Array.isArray(stages) || stages.length === 0 || outputItem == null) {
    return null;
  }
  let current = outputItem;
  for (let stage = stages.length - 1; stage >= 1; stage -= 1) {
    const predecessor = stages[stage - 1];
    const pi = current.pairedItem;
    const index = typeof pi === "number" ? pi : pi?.item;
    if (!Number.isInteger(index) || index < 0) return null;
    current = predecessor[index] ?? null;
    if (!current) return null;
  }
  return current;
};

/** Walk from aggregate fanIn refs through each contributor to root */
const walkFanInContributors = (stages, outputItem) => {
  const pi = outputItem?.pairedItem;
  if (!Array.isArray(pi) || stages.length < 2) return [];
  const predecessor = stages[stages.length - 2];
  return pi
    .map((ref) => {
      const contributor = predecessor[ref.item];
      return contributor
        ? walkProvenanceChain(stages.slice(0, -1), contributor)
        : null;
    })
    .filter(Boolean);
};

/** Walk one hop: given item's pairedItem index, return upstream item at that index */
const resolveUpstreamItem = (upstreamItems, pairedItem) => {
  const index =
    typeof pairedItem === "number" ? pairedItem : pairedItem?.item;
  if (!Number.isInteger(index) || index < 0) return null;
  return upstreamItems[index] ?? null;
};

module.exports = {
  normalizeItem,
  normalizeItems,
  cloneItem,
  cloneJsonData,
  isValidPairedItem,
  validateItemsProvenance,
  resolveProvenancePolicy,
  applyNodeProvenance,
  normalizeNodeOutput,
  attachCanonicalItemsToOutput,
  serializeItems,
  resolveUpstreamItem,
  walkProvenanceChain,
  walkFanInContributors,
  detectSplitOutSourceIndex,
  applyIdentity1to1,
  applyIdentityBySurvival,
  applyFanOut,
  applyFanIn,
  applyRouting,
  applyManual,
  applyMultiPort,
  applyNone,
};
