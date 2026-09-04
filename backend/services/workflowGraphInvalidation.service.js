/**
 * Centralized editor-session graph invalidation (Part 4).
 * Dirty state tracks execution-cache validity — not UI selection or canvas geometry.
 */

const crypto = require("node:crypto");

/** Node data keys that do not affect execution output. */
const UI_ONLY_DATA_KEYS = new Set([
  "runStatus",
  "runPreview",
  "label",
]);

const buildGraph = (definition) => {
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  const edges = Array.isArray(definition?.edges) ? definition.edges : [];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const outgoing = new Map();
  const incoming = new Map();
  for (const edge of edges) {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source).push(edge);
    if (!incoming.has(edge.target)) incoming.set(edge.target, []);
    incoming.get(edge.target).push(edge);
  }

  return { nodes, edges, byId, outgoing, incoming };
};

const isPinnedNode = (node) => {
  const data = node?.data || {};
  return Boolean(data.pinned && data.pinnedOutput !== undefined);
};

const stableValue = (value) => {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableValue(value[k])}`).join(",")}}`;
};

/** Hash execution-affecting node config + incoming edge identities. */
const computeNodeExecutionSignature = (node, graph) => {
  const data = { ...(node?.data || {}) };
  for (const key of UI_ONLY_DATA_KEYS) delete data[key];

  const incoming = (graph.incoming.get(node.id) || [])
    .map((edge) => ({
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || null,
      targetHandle: edge.targetHandle || null,
    }))
    .sort((a, b) =>
      `${a.source}:${a.sourceHandle}:${a.target}:${a.targetHandle}`.localeCompare(
        `${b.source}:${b.sourceHandle}:${b.target}:${b.targetHandle}`
      )
    );

  const payload = {
    type: node.type || node.data?.nodeType || "unknown",
    data,
    incoming,
  };

  return crypto
    .createHash("sha256")
    .update(stableValue(payload))
    .digest("hex")
    .slice(0, 16);
};

/** Cycle-safe downstream traversal (excludes start node by default). */
const getDownstreamIds = (graph, fromNodeId, includeSelf = false) => {
  const visited = new Set();
  const stack = [fromNodeId];
  const outgoingMap = graph.executionOutgoing || graph.outgoing;
  while (stack.length > 0) {
    const id = stack.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    for (const edge of outgoingMap.get(id) || []) {
      stack.push(edge.target);
    }
  }
  if (!includeSelf) visited.delete(fromNodeId);
  return [...visited];
};

/**
 * Invalidation seeds: execution children + auxiliary consumers of this node.
 * Distinct from scheduler graph (auxiliary edges do not schedule).
 */
const getInvalidationNeighborIds = (graph, fromNodeId) => {
  const ids = new Set();
  for (const edge of (graph.executionOutgoing || graph.outgoing).get(fromNodeId) || []) {
    ids.add(edge.target);
  }
  const definition =
    graph.definition ||
    ({
      nodes: graph.nodes || [],
      edges: graph.edges || [],
    });
  try {
    const { getAuxiliaryConsumers } = require("./workflowConnection.service");
    for (const consumerId of getAuxiliaryConsumers(definition, fromNodeId)) {
      ids.add(consumerId);
    }
  } catch {
    /* connection service unavailable */
  }
  return [...ids];
};

const ensureDirtyMap = (session) => {
  if (!session.dirtyNodes) session.dirtyNodes = {};
  return session.dirtyNodes;
};

const markNodesDirty = (session, nodeIds, reason) => {
  const dirtyNodes = ensureDirtyMap(session);
  const now = new Date().toISOString();
  for (const id of nodeIds || []) {
    dirtyNodes[id] = { dirty: true, reason, since: now };
    const cached = session.nodeResults?.[id];
    if (cached) {
      cached.cacheState = "dirty";
    }
  }
  session.updatedAt = now;
};

const markNodeClean = (session, nodeId, executionSignature) => {
  const dirtyNodes = ensureDirtyMap(session);
  delete dirtyNodes[nodeId];
  if (session.nodeResults?.[nodeId]) {
    session.nodeResults[nodeId].cacheState = "clean";
    if (executionSignature) {
      session.nodeResults[nodeId].executionSignature = executionSignature;
    }
  }
  session.updatedAt = new Date().toISOString();
};

const removeNodeCache = (session, nodeId) => {
  if (session.nodeResults?.[nodeId]) delete session.nodeResults[nodeId];
  if (session.dirtyNodes?.[nodeId]) delete session.dirtyNodes[nodeId];
};

/**
 * Walk downstream from startNodeId. When stopAtPinned is true, pinned nodes act as
 * barriers — they and their descendants are not marked dirty.
 * Part 12A: hops follow execution edges; auxiliary provider→consumer is a one-hop
 * invalidation edge only (via getInvalidationNeighborIds at each visited node).
 */
const propagateDownstreamDirty = (
  session,
  graph,
  startNodeId,
  reason,
  { stopAtPinned = false, includeStart = false } = {}
) => {
  const marked = [];
  const visited = new Set();
  const stack = includeStart
    ? [startNodeId]
    : [...getInvalidationNeighborIds(graph, startNodeId)];

  while (stack.length > 0) {
    const id = stack.pop();
    if (visited.has(id)) continue;
    visited.add(id);

    const node = graph.byId.get(id);
    if (stopAtPinned && node && isPinnedNode(node)) continue;

    marked.push(id);
    for (const nextId of getInvalidationNeighborIds(graph, id)) {
      stack.push(nextId);
    }
  }

  markNodesDirty(session, marked, reason);
  return marked;
};

const invalidateConfigChange = (session, graph, nodeId, reason = "config_change") => {
  markNodesDirty(session, [nodeId], reason);
  const downstream = propagateDownstreamDirty(session, graph, nodeId, reason, {
    stopAtPinned: true,
  });
  return { affected: [nodeId, ...downstream] };
};

const invalidatePinSet = (session, graph, nodeId) => {
  const downstream = propagateDownstreamDirty(session, graph, nodeId, "pin_set", {
    stopAtPinned: false,
  });
  return { affected: downstream };
};

const invalidatePinContentChange = (session, graph, nodeId) => {
  const downstream = propagateDownstreamDirty(session, graph, nodeId, "pin_content", {
    stopAtPinned: false,
  });
  return { affected: downstream };
};

const invalidateUnpin = (session, graph, nodeId) => {
  markNodesDirty(session, [nodeId], "unpin");
  const downstream = propagateDownstreamDirty(session, graph, nodeId, "unpin", {
    stopAtPinned: false,
  });
  return { affected: [nodeId, ...downstream] };
};

const invalidateEdgeTarget = (session, graph, targetNodeId) => {
  markNodesDirty(session, [targetNodeId], "edge_change");
  const downstream = propagateDownstreamDirty(
    session,
    graph,
    targetNodeId,
    "edge_change",
    { stopAtPinned: false }
  );
  return { affected: [targetNodeId, ...downstream] };
};

const edgeEndpoints = (endpoints = {}) => ({
  source: String(endpoints.source || ""),
  target: String(endpoints.target || ""),
  sourceHandle:
    endpoints.sourceHandle === undefined ? null : endpoints.sourceHandle,
  targetHandle:
    endpoints.targetHandle === undefined ? null : endpoints.targetHandle,
});

const endpointsEqual = (left, right) =>
  left.source === right.source &&
  left.target === right.target &&
  left.sourceHandle === right.sourceHandle &&
  left.targetHandle === right.targetHandle;

/**
 * Port-aware reconnect invalidation.
 * Invalidates the previous target cone when the target changes, and always
 * invalidates the current target cone when any endpoint/port changes.
 */
const invalidateEdgeReconnect = (session, graph, event) => {
  const previous = edgeEndpoints(event.previous || {});
  const current = edgeEndpoints(event.current || {});
  if (endpointsEqual(previous, current)) return { affected: [] };

  const affected = new Set();

  if (previous.target && previous.target !== current.target) {
    invalidateEdgeTarget(session, graph, previous.target).affected.forEach((id) =>
      affected.add(id)
    );
  }

  if (current.target) {
    invalidateEdgeTarget(session, graph, current.target).affected.forEach((id) =>
      affected.add(id)
    );
  }

  return { affected: [...affected] };
};

const invalidateNodeDelete = (session, graph, nodeId) => {
  removeNodeCache(session, nodeId);
  const downstream = getDownstreamIds(graph, nodeId, false);
  markNodesDirty(session, downstream, "node_deleted");
  return { affected: [nodeId, ...downstream] };
};

const invalidateInsertNode = (session, graph, newNodeId, downstreamFromTarget) => {
  const affected = new Set([newNodeId]);
  markNodesDirty(session, [newNodeId], "insert_node");
  for (const targetId of downstreamFromTarget || []) {
    invalidateEdgeTarget(session, graph, targetId).affected.forEach((id) =>
      affected.add(id)
    );
  }
  return { affected: [...affected] };
};

/**
 * Apply a single editor invalidation event against the in-memory session.
 */
const applyInvalidationEvent = (session, definition, event) => {
  const graph = buildGraph(definition);
  switch (event?.type) {
    case "params":
    case "disabled":
      return invalidateConfigChange(session, graph, event.nodeId, event.type);
    case "pin":
      if (event.unpinned) return invalidateUnpin(session, graph, event.nodeId);
      if (event.pinContentChanged) {
        return invalidatePinContentChange(session, graph, event.nodeId);
      }
      return invalidatePinSet(session, graph, event.nodeId);
    case "edge": {
      const affected = new Set();
      if (event.previousTarget) {
        invalidateEdgeTarget(session, graph, event.previousTarget).affected.forEach(
          (id) => affected.add(id)
        );
      }
      if (event.targetNodeId) {
        invalidateEdgeTarget(session, graph, event.targetNodeId).affected.forEach(
          (id) => affected.add(id)
        );
      }
      return { affected: [...affected] };
    }
    case "edge_reconnect":
      return invalidateEdgeReconnect(session, graph, event);
    case "delete":
      return invalidateNodeDelete(session, graph, event.nodeId);
    case "insert_node":
      return invalidateInsertNode(
        session,
        graph,
        event.newNodeId,
        event.downstreamTargets
      );
    default:
      return { affected: [] };
  }
};

const isNodeDirty = (session, nodeId) =>
  Boolean(session.dirtyNodes?.[nodeId]?.dirty);

/**
 * Cache usability for partial execution / preview.
 * Returns: pinned | clean | dirty | missing | error
 */
const getNodeCacheStatus = (session, nodeId, node, graph) => {
  if (!node) return "missing";
  if (isPinnedNode(node)) return "pinned";

  const cached = session.nodeResults?.[nodeId];
  if (!cached) return "missing";
  if (cached.status === "failed") return "error";
  if (isNodeDirty(session, nodeId) || cached.cacheState === "dirty") {
    return "dirty";
  }

  const signature = computeNodeExecutionSignature(node, graph);
  if (cached.executionSignature && cached.executionSignature !== signature) {
    return "dirty";
  }

  if (cached.output === undefined && !Array.isArray(cached.items)) {
    return "missing";
  }

  return cached.cacheState === "clean" || !cached.cacheState ? "clean" : "dirty";
};

const isCacheUsableForExecution = (status) =>
  status === "clean" || status === "pinned";

/** Auto-mark nodes whose signature no longer matches the current definition. */
const reconcileSessionWithDefinition = (session, definition) => {
  const graph = buildGraph(definition);
  const affected = new Set();

  for (const node of definition?.nodes || []) {
    const cached = session.nodeResults?.[node.id];
    if (!cached || isNodeDirty(session, node.id)) continue;

    const signature = computeNodeExecutionSignature(node, graph);
    if (cached.executionSignature && cached.executionSignature !== signature) {
      markNodesDirty(session, [node.id], "signature_mismatch");
      propagateDownstreamDirty(session, graph, node.id, "signature_mismatch", {
        stopAtPinned: true,
      }).forEach((id) => affected.add(id));
      affected.add(node.id);
    }
  }

  return { affected: [...affected] };
};

const collectUpstreamDirtyNodeIds = (session, graph, nodeId, definition) => {
  const dirty = new Set();
  const visited = new Set();
  const incomingMap = graph.executionIncoming || graph.incoming;
  const stack = [...(incomingMap.get(nodeId) || []).map((e) => e.source)];
  try {
    const { getAuxiliaryEdges } = require("./workflowConnection.service");
    const def =
      definition ||
      graph.definition || {
        nodes: graph.nodes || [],
        edges: graph.edges || [],
      };
    for (const e of getAuxiliaryEdges(def).filter((edge) => edge.target === nodeId)) {
      stack.push(e.source);
    }
  } catch {
    /* ignore */
  }

  while (stack.length > 0) {
    const id = stack.pop();
    if (visited.has(id)) continue;
    visited.add(id);

    const node = graph.byId.get(id);
    const status = getNodeCacheStatus(session, id, node, graph);
    if (status === "dirty") dirty.add(id);
    if (status === "pinned") continue;

    for (const edge of incomingMap.get(id) || []) {
      stack.push(edge.source);
    }
  }

  return [...dirty];
};

module.exports = {
  computeNodeExecutionSignature,
  getDownstreamIds,
  getInvalidationNeighborIds,
  markNodesDirty,
  markNodeClean,
  removeNodeCache,
  propagateDownstreamDirty,
  invalidateConfigChange,
  invalidateEdgeTarget,
  invalidateEdgeReconnect,
  invalidateNodeDelete,
  invalidatePinSet,
  invalidatePinContentChange,
  invalidateUnpin,
  invalidateInsertNode,
  applyInvalidationEvent,
  isPinnedNode,
  isNodeDirty,
  getNodeCacheStatus,
  isCacheUsableForExecution,
  reconcileSessionWithDefinition,
  collectUpstreamDirtyNodeIds,
  edgeEndpoints,
  endpointsEqual,
};
