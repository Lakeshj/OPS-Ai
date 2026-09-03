/**
 * Part 9A — Loop contract topology + controlled-cycle validation.
 * Does NOT implement Loop runtime (Part 9B).
 */

const LOOP_PORTS = Object.freeze({
  ITEMS: "items",
  CONTINUE: "continue",
  BATCH: "batch",
  DONE: "done",
});

const LOOP_RUNTIME_NOT_ENABLED = "LOOP_RUNTIME_NOT_ENABLED";

const nodeTypeOf = (node) => node?.type || node?.data?.nodeType || "unknown";

const isLoopNode = (node) => nodeTypeOf(node) === "loop";

const edgeKey = (edge) =>
  edge.id || `${edge.source}->${edge.target}#${edge.sourceHandle || ""}→${edge.targetHandle || ""}`;

/**
 * Sanctioned Loop back-edge: target is Loop, targetHandle = continue.
 */
const isLoopBackEdge = (graph, edge) => {
  if (!edge) return false;
  const target = graph.byId.get(edge.target);
  if (!isLoopNode(target)) return false;
  return String(edge.targetHandle || "") === LOOP_PORTS.CONTINUE;
};

const buildAdjacency = (edges) => {
  const outgoing = new Map();
  const incoming = new Map();
  for (const edge of edges) {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source).push(edge);
    if (!incoming.has(edge.target)) incoming.set(edge.target, []);
    incoming.get(edge.target).push(edge);
  }
  return { outgoing, incoming };
};

/**
 * Forward DAG projection: full graph minus sanctioned loop-back edges.
 */
const projectForwardDag = (graph) => {
  const loopBackEdges = [];
  const forwardEdges = [];
  for (const edge of graph.edges || []) {
    if (isLoopBackEdge(graph, edge)) loopBackEdges.push(edge);
    else forwardEdges.push(edge);
  }
  const { outgoing, incoming } = buildAdjacency(forwardEdges);
  return {
    nodes: graph.nodes,
    edges: forwardEdges,
    byId: graph.byId,
    outgoing,
    incoming,
    loopBackEdges,
  };
};

/** DFS detect any cycle in a projected graph (no sanctioned back-edges). */
const hasCycle = (graphLike) => {
  const color = new Map(); // 0=white 1=gray 2=black
  const visit = (id) => {
    const c = color.get(id) || 0;
    if (c === 1) return true;
    if (c === 2) return false;
    color.set(id, 1);
    for (const edge of graphLike.outgoing.get(id) || []) {
      if (visit(edge.target)) return true;
    }
    color.set(id, 2);
    return false;
  };
  for (const node of graphLike.nodes || []) {
    if (!color.has(node.id) && visit(node.id)) return true;
  }
  return false;
};

/**
 * Nodes reachable from Loop.batch along forward edges (excluding Loop itself
 * via continue). Body of the loop.
 */
const collectBatchDescendants = (graph, loopNodeId) => {
  const body = new Set();
  const stack = [];
  for (const edge of graph.outgoing.get(loopNodeId) || []) {
    if (String(edge.sourceHandle || "") === LOOP_PORTS.BATCH) {
      stack.push(edge.target);
    }
  }
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === loopNodeId || body.has(id)) continue;
    body.add(id);
    for (const edge of graph.outgoing.get(id) || []) {
      // Do not walk through Loop.continue back into the Loop
      if (edge.target === loopNodeId) continue;
      stack.push(edge.target);
    }
  }
  return body;
};

const collectDoneDescendants = (graph, loopNodeId) => {
  const descendants = new Set();
  const stack = [];
  for (const edge of graph.outgoing.get(loopNodeId) || []) {
    if (String(edge.sourceHandle || "") === LOOP_PORTS.DONE) {
      stack.push(edge.target);
    }
  }
  while (stack.length > 0) {
    const id = stack.pop();
    if (descendants.has(id)) continue;
    descendants.add(id);
    for (const edge of graph.outgoing.get(id) || []) {
      stack.push(edge.target);
    }
  }
  return descendants;
};

/**
 * Analyze a single Loop node's region.
 */
const analyzeLoopRegion = (graph, loopNodeId) => {
  const loop = graph.byId.get(loopNodeId);
  if (!isLoopNode(loop)) {
    return { ok: false, error: `Node ${loopNodeId} is not a Loop` };
  }

  const itemsEdges = (graph.incoming.get(loopNodeId) || []).filter(
    (e) => String(e.targetHandle || "") === LOOP_PORTS.ITEMS
  );
  const continueEdges = (graph.incoming.get(loopNodeId) || []).filter(
    (e) => String(e.targetHandle || "") === LOOP_PORTS.CONTINUE
  );
  const batchEdges = (graph.outgoing.get(loopNodeId) || []).filter(
    (e) => String(e.sourceHandle || "") === LOOP_PORTS.BATCH
  );
  const doneEdges = (graph.outgoing.get(loopNodeId) || []).filter(
    (e) => String(e.sourceHandle || "") === LOOP_PORTS.DONE
  );

  const bodyNodes = collectBatchDescendants(graph, loopNodeId);
  const doneDescendants = collectDoneDescendants(graph, loopNodeId);

  return {
    ok: true,
    loopNodeId,
    itemsEdges,
    continueEdges,
    batchEdges,
    doneEdges,
    bodyNodes,
    doneDescendants,
    backEdge: continueEdges[0] || null,
  };
};

/**
 * Validate entire definition for controlled cycles.
 * Returns { ok, errors[], loopRegions[], loopBackEdges[], forwardDag }
 */
const validateControlledCycles = (graph) => {
  const errors = [];
  const loopNodes = (graph.nodes || []).filter(isLoopNode);
  const loopRegions = [];

  // Nested loops: Loop whose body contains another Loop — unsupported V1
  for (const loop of loopNodes) {
    const region = analyzeLoopRegion(graph, loop.id);
    loopRegions.push(region);
    if (!region.ok) {
      errors.push(region.error);
      continue;
    }

    if (region.continueEdges.length === 0) {
      // Incomplete Loop (no back-edge yet) is allowed while drafting.
      // Runtime will still refuse execution.
      continue;
    }

    if (region.continueEdges.length > 1) {
      errors.push(
        `Loop ${loop.id}: exactly one continue back-edge is allowed (found ${region.continueEdges.length})`
      );
    }

    for (const edge of region.continueEdges) {
      if (edge.source === loop.id) {
        errors.push(
          `Loop ${loop.id}: self-edge into continue is not supported in V1`
        );
        continue;
      }
      // Source must be in batch body of THIS loop
      if (!region.bodyNodes.has(edge.source)) {
        errors.push(
          `Loop ${loop.id}: continue back-edge from ${edge.source} is not in this Loop's batch body`
        );
      }
      // Must target same loop
      if (edge.target !== loop.id) {
        errors.push(
          `Loop ${loop.id}: continue edge must return to the same Loop`
        );
      }
      // Done descendants must not feed continue
      if (region.doneDescendants.has(edge.source)) {
        errors.push(
          `Loop ${loop.id}: done-branch node ${edge.source} cannot reconnect to continue`
        );
      }
    }

    // Nested Loop in body is unsupported V1 (with or without its own back-edge).
    for (const bodyId of region.bodyNodes) {
      const bodyNode = graph.byId.get(bodyId);
      if (isLoopNode(bodyNode)) {
        errors.push(
          `Nested Loop is not supported in V1 (Loop ${bodyId} inside ${loop.id})`
        );
      }
    }
  }

  // Reject back-edge into Loop.items (cycle into wrong port)
  for (const edge of graph.edges || []) {
    const target = graph.byId.get(edge.target);
    if (!isLoopNode(target)) continue;
    const th = String(edge.targetHandle || "");
    if (th === LOOP_PORTS.ITEMS) {
      // items is forward only — if source is reachable from batch, it's invalid cycle into items
      const region = loopRegions.find((r) => r.loopNodeId === edge.target);
      if (region?.bodyNodes?.has(edge.source)) {
        errors.push(
          `Loop ${edge.target}: body node ${edge.source} cannot connect to items (use continue)`
        );
      }
    }
  }

  // Generic cycles: after removing sanctioned continue edges, graph must be DAG
  const forwardDag = projectForwardDag(graph);
  if (hasCycle(forwardDag)) {
    errors.push(
      "Graph contains a cycle that is not a sanctioned Loop.continue back-edge"
    );
  }

  // Any edge that creates a cycle but is NOT a Loop.continue is invalid
  // (covered by forward DAG cycle check)

  return {
    ok: errors.length === 0,
    errors,
    loopRegions,
    loopBackEdges: forwardDag.loopBackEdges,
    forwardDag,
  };
};

/**
 * True when definition contains any Loop node (runtime not enabled yet).
 */
const definitionHasLoop = (graph) =>
  (graph.nodes || []).some(isLoopNode);

/**
 * Assert Loop runtime is not used. Throws Error with code LOOP_RUNTIME_NOT_ENABLED.
 */
const assertLoopRuntimeNotEnabled = (graph) => {
  if (!definitionHasLoop(graph)) return;
  const err = new Error(
    "Loop runtime is not enabled yet. Controlled Loop topology is recognized but execution starts in Part 9B."
  );
  err.code = LOOP_RUNTIME_NOT_ENABLED;
  throw err;
};

module.exports = {
  LOOP_PORTS,
  LOOP_RUNTIME_NOT_ENABLED,
  isLoopNode,
  isLoopBackEdge,
  projectForwardDag,
  hasCycle,
  analyzeLoopRegion,
  validateControlledCycles,
  definitionHasLoop,
  assertLoopRuntimeNotEnabled,
  collectBatchDescendants,
  collectDoneDescendants,
  edgeKey,
};
