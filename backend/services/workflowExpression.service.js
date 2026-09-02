/**
 * OpsAi workflow expression thread-walking (Part 3A).
 * Resolves {{steps.<nodeId>.*}} through pairedItem provenance chains.
 */

const {
  getIncomingEdgeForInputIndex,
  normalizeMergeIncomingEdges,
} = require("./workflowMultiInput.service");

const getItemPayload = (item) => {
  if (item == null) return item;
  if (typeof item !== "object" || Array.isArray(item)) return item;
  if (
    item.json &&
    typeof item.json === "object" &&
    !Array.isArray(item.json)
  ) {
    return item.json;
  }
  const { pairedItem, binary, json, ...rest } = item;
  if (Object.keys(rest).length > 0) return rest;
  return item;
};

const getByPath = (source, path) => {
  if (source == null) return undefined;
  let cur = getItemPayload(source);
  for (const part of String(path).split(".")) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
};

const REASONS = {
  TARGET_NOT_EXECUTED: "TARGET_NOT_EXECUTED",
  PROVENANCE_MISSING: "PROVENANCE_MISSING",
  PROVENANCE_AMBIGUOUS: "PROVENANCE_AMBIGUOUS",
  TARGET_NOT_IN_PATH: "TARGET_NOT_IN_PATH",
  ITEM_INDEX_OUT_OF_RANGE: "ITEM_INDEX_OUT_OF_RANGE",
  INVALID_REFERENCE: "INVALID_REFERENCE",
};

class ExpressionReferenceError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.name = "ExpressionReferenceError";
    this.reason = meta.reason || REASONS.INVALID_REFERENCE;
    this.currentNodeId = meta.currentNodeId ?? null;
    this.targetNodeId = meta.targetNodeId ?? null;
    this.currentItemIndex = meta.currentItemIndex ?? null;
  }
}

const getPairedIndex = (pairedItem) => {
  if (typeof pairedItem === "number") return pairedItem;
  if (pairedItem && typeof pairedItem === "object" && !Array.isArray(pairedItem)) {
    return pairedItem.item;
  }
  return undefined;
};

const getPairedInputPort = (pairedItem) => {
  if (pairedItem && typeof pairedItem === "object" && !Array.isArray(pairedItem)) {
    return pairedItem.input;
  }
  return undefined;
};

const getPredecessorForPort = (graph, nodeId, portIndex) => {
  const edge = getIncomingEdgeForInputIndex(graph, nodeId, portIndex);
  return edge?.source || null;
};

const resolveIncomingPredecessor = (graph, nodeId, pairedItem) => {
  const incoming = normalizeMergeIncomingEdges(graph, nodeId);
  if (incoming.length === 0) return null;
  if (incoming.length === 1) return incoming[0].source;

  const port = getPairedInputPort(pairedItem);
  if (!Number.isInteger(port) || port < 0) return null;
  return getPredecessorForPort(graph, nodeId, port);
};

/** True when targetNodeId is upstream of nodeId in the execution graph. */
const isUpstreamNode = (graph, targetNodeId, nodeId) => {
  if (!graph?.incoming || targetNodeId === nodeId) return targetNodeId === nodeId;
  const visited = new Set();
  const stack = [nodeId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === targetNodeId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const edge of graph.incoming.get(id) || []) {
      stack.push(edge.source);
    }
  }
  return false;
};

const getTargetItems = (context, targetNodeId) => {
  const items = context.items?.[targetNodeId];
  if (Array.isArray(items)) return items;
  return null;
};

const legacyPositionalItem = (context, targetNodeId, currentItemIndex) => {
  const targetItems = getTargetItems(context, targetNodeId);
  if (!targetItems || targetItems.length === 0) return null;

  if (targetItems.length === 1) {
    return { item: targetItems[0], mode: "legacy_single" };
  }

  const current =
    context.currentItem ??
    (currentItemIndex != null ? context.inputItems?.[currentItemIndex] : null);
  if (current?.pairedItem !== undefined) return null;

  const allLegacy = targetItems.every((ti) => ti.pairedItem === undefined);
  if (!allLegacy) return null;

  if (
    currentItemIndex != null &&
    Number.isInteger(currentItemIndex) &&
    currentItemIndex >= 0 &&
    currentItemIndex < targetItems.length &&
    Array.isArray(context.inputItems) &&
    context.inputItems.length === targetItems.length
  ) {
    return { item: targetItems[currentItemIndex], mode: "legacy_positional" };
  }

  return null;
};

const resolveWithoutItemContext = (context, targetNodeId) => {
  const targetItems = getTargetItems(context, targetNodeId);
  if (targetItems?.length === 1) {
    return { status: "resolved", item: targetItems[0], mode: "legacy_single" };
  }
  if (targetItems && targetItems.length > 1) {
    return { status: "error", reason: REASONS.PROVENANCE_AMBIGUOUS };
  }
  if (context.steps?.[targetNodeId] !== undefined) {
    return { status: "legacy_flat", output: context.steps[targetNodeId] };
  }
  return { status: "error", reason: REASONS.TARGET_NOT_EXECUTED };
};

/**
 * Walk pairedItem hops from the current item to the target node's item.
 */
const resolveReferencedItem = ({
  currentNodeId,
  currentItem,
  currentItemIndex,
  targetNodeId,
  context,
  graph,
}) => {
  if (!targetNodeId) {
    return { status: "error", reason: REASONS.INVALID_REFERENCE };
  }

  const hasTargetOutput =
    context.steps?.[targetNodeId] !== undefined ||
    getTargetItems(context, targetNodeId) != null;

  if (!hasTargetOutput) {
    return { status: "error", reason: REASONS.TARGET_NOT_EXECUTED };
  }

  let item = currentItem ?? null;
  if (!item && currentItemIndex != null && Array.isArray(context.inputItems)) {
    item = context.inputItems[currentItemIndex] ?? null;
  }

  if (currentNodeId && targetNodeId === currentNodeId) {
    if (item) return { status: "resolved", item, mode: "self" };
    return resolveWithoutItemContext(context, targetNodeId);
  }

  if (!item) {
    return resolveWithoutItemContext(context, targetNodeId);
  }

  if (!graph?.incoming || !currentNodeId) {
    const legacy = legacyPositionalItem(context, targetNodeId, currentItemIndex);
    if (legacy) return { status: "resolved", item: legacy.item, mode: legacy.mode };
    if (context.steps?.[targetNodeId] !== undefined) {
      return { status: "legacy_flat", output: context.steps[targetNodeId] };
    }
    return { status: "error", reason: REASONS.PROVENANCE_MISSING };
  }

  if (!isUpstreamNode(graph, targetNodeId, currentNodeId)) {
    return { status: "error", reason: REASONS.TARGET_NOT_IN_PATH };
  }

  let nodeId = currentNodeId;
  let current = item;

  const resolvePredecessor = (fromNodeId, pairedRef) => {
    const incoming = normalizeMergeIncomingEdges(graph, fromNodeId);
    if (incoming.length === 0) return null;
    if (incoming.length === 1) return incoming[0].source;
    const port = getPairedInputPort(pairedRef);
    if (!Number.isInteger(port) || port < 0) return null;
    return getPredecessorForPort(graph, fromNodeId, port);
  };

  const pi0 = current?.pairedItem;
  if (Array.isArray(pi0)) {
    const producerNodeId = (() => {
      const incoming = normalizeMergeIncomingEdges(graph, nodeId);
      if (incoming.length === 1) return incoming[0].source;
      return nodeId;
    })();

    const contributors = pi0
      .map((ref) => ({
        ref,
        pred: resolvePredecessor(producerNodeId, ref),
      }))
      .filter((c) => c.pred);

    const directMatches = contributors.filter((c) => c.pred === targetNodeId);
    if (directMatches.length > 1) {
      return { status: "error", reason: REASONS.PROVENANCE_AMBIGUOUS };
    }
    const direct = directMatches[0];
    if (direct) {
      const predItems = getTargetItems(context, direct.pred);
      const resolved = predItems?.[direct.ref.item];
      if (resolved) {
        return { status: "resolved", item: resolved, mode: "thread" };
      }
    }

    const upstreamMatches = contributors.filter((c) =>
      isUpstreamNode(graph, targetNodeId, c.pred)
    );
    if (upstreamMatches.length > 1) {
      return { status: "error", reason: REASONS.PROVENANCE_AMBIGUOUS };
    }
    if (upstreamMatches.length === 1) {
      const { ref, pred } = upstreamMatches[0];
      const predItems = getTargetItems(context, pred);
      const resolved = predItems?.[ref.item];
      if (!resolved) {
        return { status: "error", reason: REASONS.ITEM_INDEX_OUT_OF_RANGE };
      }
      current = resolved;
      nodeId = pred;
      if (nodeId === targetNodeId) {
        return { status: "resolved", item: current, mode: "thread" };
      }
    } else {
      return { status: "error", reason: REASONS.PROVENANCE_AMBIGUOUS };
    }
  } else {
    const currentIncoming = normalizeMergeIncomingEdges(graph, nodeId);
    if (currentIncoming.length === 1) {
      nodeId = currentIncoming[0].source;
    } else if (currentIncoming.length > 1) {
      const port = getPairedInputPort(current.pairedItem);
      if (!Number.isInteger(port) || port < 0) {
        return { status: "error", reason: REASONS.PROVENANCE_AMBIGUOUS };
      }
      const pred = getPredecessorForPort(graph, nodeId, port);
      if (!pred) {
        return { status: "error", reason: REASONS.PROVENANCE_AMBIGUOUS };
      }
      nodeId = pred;
    }

    if (nodeId === targetNodeId) {
      return { status: "resolved", item: current, mode: "thread" };
    }
  }

  for (let hop = 0; hop < 128; hop += 1) {
    const pi = current?.pairedItem;
    if (Array.isArray(pi)) {
      const contributors = pi
        .map((ref) => ({
          ref,
          pred: resolvePredecessor(nodeId, ref),
        }))
        .filter((c) => c.pred);

      const directMatches = contributors.filter((c) => c.pred === targetNodeId);
    if (directMatches.length > 1) {
      return { status: "error", reason: REASONS.PROVENANCE_AMBIGUOUS };
    }
    const direct = directMatches[0];
      if (direct) {
        const predItems = getTargetItems(context, direct.pred);
        const resolved = predItems?.[direct.ref.item];
        if (resolved) {
          return { status: "resolved", item: resolved, mode: "thread" };
        }
      }

      const upstreamMatches = contributors.filter((c) =>
        isUpstreamNode(graph, targetNodeId, c.pred)
      );
      if (upstreamMatches.length > 1) {
        return { status: "error", reason: REASONS.PROVENANCE_AMBIGUOUS };
      }
      if (upstreamMatches.length === 1) {
        const { ref, pred } = upstreamMatches[0];
        const predItems = getTargetItems(context, pred);
        const resolved = predItems?.[ref.item];
        if (!resolved) {
          return { status: "error", reason: REASONS.ITEM_INDEX_OUT_OF_RANGE };
        }
        current = resolved;
        nodeId = pred;
        if (nodeId === targetNodeId) {
          return { status: "resolved", item: current, mode: "thread" };
        }
        continue;
      }
      return { status: "error", reason: REASONS.PROVENANCE_AMBIGUOUS };
    }

    const inputIndex = getPairedIndex(pi);
    if (!Number.isInteger(inputIndex) || inputIndex < 0) {
      const legacy = legacyPositionalItem(context, targetNodeId, currentItemIndex);
      if (legacy) {
        return { status: "resolved", item: legacy.item, mode: legacy.mode };
      }
      return { status: "error", reason: REASONS.PROVENANCE_MISSING };
    }

    const predecessorNodeId = resolvePredecessor(nodeId, pi);
    if (!predecessorNodeId) {
      return { status: "error", reason: REASONS.TARGET_NOT_IN_PATH };
    }

    const predecessorItems = getTargetItems(context, predecessorNodeId);
    if (!predecessorItems) {
      return { status: "error", reason: REASONS.TARGET_NOT_EXECUTED };
    }

    const upstream = predecessorItems[inputIndex];
    if (!upstream) {
      return { status: "error", reason: REASONS.ITEM_INDEX_OUT_OF_RANGE };
    }

    current = upstream;
    nodeId = predecessorNodeId;

    if (nodeId === targetNodeId) {
      return { status: "resolved", item: current, mode: "thread" };
    }
  }

  return { status: "error", reason: REASONS.INVALID_REFERENCE };
};

/**
 * OpsAi explicit step-output accessors — $ prefix avoids collision with JSON field names.
 * Ordinary paths (e.g. steps.node.first.name) read json.first.name via thread-walking.
 */
const ACCESSOR_PREFIX = "$";

const parseStepsKey = (key) => {
  if (!key.startsWith("steps.")) return null;
  const rest = key.slice("steps.".length);
  const dot = rest.indexOf(".");
  if (dot === -1) {
    return { nodeId: rest, mode: "flat", path: "" };
  }

  const nodeId = rest.slice(0, dot);
  const tail = rest.slice(dot + 1);
  if (!nodeId || !tail) return null;

  if (tail.startsWith(`${ACCESSOR_PREFIX}all[`)) {
    const allMatch = tail.match(/^\$all\[(\d+)\](?:\.(.+))?$/);
    if (allMatch) {
      return {
        nodeId,
        mode: "all",
        index: Number(allMatch[1]),
        path: allMatch[2] || "",
      };
    }
  }

  if (tail.startsWith(`${ACCESSOR_PREFIX}item.`)) {
    return { nodeId, mode: "item", path: tail.slice(`${ACCESSOR_PREFIX}item.`.length) };
  }
  if (tail === `${ACCESSOR_PREFIX}item`) {
    return { nodeId, mode: "item", path: "" };
  }
  if (tail.startsWith(`${ACCESSOR_PREFIX}first.`)) {
    return { nodeId, mode: "first", path: tail.slice(`${ACCESSOR_PREFIX}first.`.length) };
  }
  if (tail === `${ACCESSOR_PREFIX}first`) {
    return { nodeId, mode: "first", path: "" };
  }
  if (tail.startsWith(`${ACCESSOR_PREFIX}last.`)) {
    return { nodeId, mode: "last", path: tail.slice(`${ACCESSOR_PREFIX}last.`.length) };
  }
  if (tail === `${ACCESSOR_PREFIX}last`) {
    return { nodeId, mode: "last", path: "" };
  }

  return { nodeId, mode: "thread", path: tail };
};

const readPath = (source, path) => {
  if (!path) return getItemPayload(source);
  const payload = getItemPayload(source);
  return getByPath(payload, path);
};

const readFlatPath = (output, path) => {
  if (!path) return output ?? "";
  let cur = output;
  for (const part of path.split(".")) {
    if (cur == null) return "";
    cur = cur[part];
  }
  return cur ?? "";
};

const ambiguityMessage = (targetNodeId) =>
  `Multiple upstream items correspond to this item for step "${targetNodeId}". Use an explicit disambiguator: $first, $last, or $all[index] (for example {{steps.${targetNodeId}.$first.field}}).`;

const isLegacyExpressionContext = (context) =>
  !context.graph && !context.currentNodeId && context.currentItem == null;

const resolveStepsExpression = (parsed, context) => {
  const { nodeId, mode, path } = parsed;
  const meta = {
    currentNodeId: context.currentNodeId ?? null,
    targetNodeId: nodeId,
    currentItemIndex: context.currentItemIndex ?? null,
  };

  if (mode === "flat") {
    return context.steps?.[nodeId] ?? "";
  }

  const targetItems = getTargetItems(context, nodeId);

  if (mode === "first" || mode === "last" || mode === "all") {
    if (!targetItems || targetItems.length === 0) {
      throw new ExpressionReferenceError(
        `Step "${nodeId}" has not been executed yet.`,
        { ...meta, reason: REASONS.TARGET_NOT_EXECUTED }
      );
    }
    if (mode === "first") {
      return readPath(targetItems[0], path);
    }
    if (mode === "last") {
      return readPath(targetItems[targetItems.length - 1], path);
    }
    const idx = parsed.index;
    if (!Number.isInteger(idx) || idx < 0 || idx >= targetItems.length) {
      throw new ExpressionReferenceError(
        `Item index ${idx} is out of range for step "${nodeId}".`,
        { ...meta, reason: REASONS.ITEM_INDEX_OUT_OF_RANGE }
      );
    }
    return readPath(targetItems[idx], path);
  }

  if (mode === "item") {
    const resolved = resolveReferencedItem({
      currentNodeId: context.currentNodeId,
      currentItem: context.currentItem,
      currentItemIndex: context.currentItemIndex,
      targetNodeId: nodeId,
      context,
      graph: context.graph,
    });
    if (resolved.status === "resolved") {
      return readPath(resolved.item, path);
    }
    throwExpressionError(resolved, meta);
  }

  // Automatic thread-walking for steps.<nodeId>.<field> (ordinary JSON paths)
  if (isLegacyExpressionContext(context)) {
    return readFlatPath(context.steps?.[nodeId], path);
  }

  const resolved = resolveReferencedItem({
    currentNodeId: context.currentNodeId,
    currentItem: context.currentItem,
    currentItemIndex: context.currentItemIndex,
    targetNodeId: nodeId,
    context,
    graph: context.graph,
  });

  if (resolved.status === "resolved") {
    return readPath(resolved.item, path);
  }

  if (resolved.status === "legacy_flat") {
    return readFlatPath(resolved.output, path);
  }

  throwExpressionError(resolved, meta);
};

const throwExpressionError = (resolved, meta) => {
  switch (resolved.reason) {
    case REASONS.PROVENANCE_AMBIGUOUS:
      throw new ExpressionReferenceError(ambiguityMessage(meta.targetNodeId), {
        ...meta,
        reason: REASONS.PROVENANCE_AMBIGUOUS,
      });
    case REASONS.TARGET_NOT_IN_PATH:
      throw new ExpressionReferenceError(
        `Step "${meta.targetNodeId}" is not in the provenance path for the current item.`,
        { ...meta, reason: REASONS.TARGET_NOT_IN_PATH }
      );
    case REASONS.TARGET_NOT_EXECUTED:
      throw new ExpressionReferenceError(
        `Step "${meta.targetNodeId}" has not been executed yet.`,
        { ...meta, reason: REASONS.TARGET_NOT_EXECUTED }
      );
    case REASONS.ITEM_INDEX_OUT_OF_RANGE:
      throw new ExpressionReferenceError(
        `Referenced item index is out of range for step "${meta.targetNodeId}".`,
        { ...meta, reason: REASONS.ITEM_INDEX_OUT_OF_RANGE }
      );
    case REASONS.PROVENANCE_MISSING:
      throw new ExpressionReferenceError(
        `Cannot resolve step "${meta.targetNodeId}" for the current item because provenance metadata is missing.`,
        { ...meta, reason: REASONS.PROVENANCE_MISSING }
      );
    default:
      throw new ExpressionReferenceError(
        `Cannot resolve reference to step "${meta.targetNodeId}".`,
        { ...meta, reason: REASONS.INVALID_REFERENCE }
      );
  }
};

module.exports = {
  ExpressionReferenceError,
  REASONS,
  ACCESSOR_PREFIX,
  resolveReferencedItem,
  resolveStepsExpression,
  parseStepsKey,
  isUpstreamNode,
  isLegacyExpressionContext,
};
