/**
 * In-memory editor session cache for partial runs (execute step / run-to).
 * Keyed by workflowId + userId. Production runs do not use this cache.
 */

const {
  getDownstreamIds,
  markNodesDirty,
  markNodeClean,
  applyInvalidationEvent,
  computeNodeExecutionSignature,
  reconcileSessionWithDefinition,
} = require("./workflowGraphInvalidation.service");
const { buildGraph } = require("./workflowEngine.service");

const sessions = new Map();

const sessionKey = (workflowId, userId) => `${workflowId}:${userId || "anon"}`;

const getSession = (workflowId, userId) => {
  const key = sessionKey(workflowId, userId);
  if (!sessions.has(key)) {
    sessions.set(key, {
      workflowId,
      userId: userId || null,
      input: {},
      nodeResults: {},
      dirtyNodes: {},
      updatedAt: new Date().toISOString(),
    });
  }
  const session = sessions.get(key);
  if (!session.dirtyNodes) session.dirtyNodes = {};
  return session;
};

const setSessionInput = (workflowId, userId, input) => {
  const session = getSession(workflowId, userId);
  session.input = input || {};
  session.updatedAt = new Date().toISOString();
  return session;
};

const setNodeResult = (workflowId, userId, nodeId, result, definition) => {
  const session = getSession(workflowId, userId);
  let executionSignature;
  if (definition) {
    const graph = buildGraph(definition);
    const node = graph.byId.get(nodeId);
    if (node) executionSignature = computeNodeExecutionSignature(node, graph);
  }

  session.nodeResults[nodeId] = {
    nodeId,
    status: result.status || "succeeded",
    output: result.output,
    items: result.items,
    portOutputs: result.portOutputs,
    error: result.error || null,
    executionTimeMs: result.executionTimeMs,
    executionIndex: result.executionIndex ?? 0,
    // Part 9A: optional occurrence list for future multi-run inspector
    occurrences: Array.isArray(result.occurrences)
      ? result.occurrences
      : result.output !== undefined
        ? [
            {
              runIndex: result.executionIndex ?? 0,
              status: result.status || "succeeded",
              items: result.items,
              output: result.output,
              portOutputs: result.portOutputs || null,
            },
          ]
        : undefined,
    cacheState: result.status === "failed" ? "dirty" : "clean",
    executionSignature,
    updatedAt: new Date().toISOString(),
  };
  if (result.status !== "failed") {
    markNodeClean(session, nodeId, executionSignature);
  } else {
    markNodesDirty(session, [nodeId], "execution_failed");
  }
  session.updatedAt = new Date().toISOString();
  return session.nodeResults[nodeId];
};

const getNodeResult = (workflowId, userId, nodeId) => {
  const session = getSession(workflowId, userId);
  return session.nodeResults[nodeId] || null;
};

/** @deprecated Prefer markDirty via invalidateEditorSession */
const clearNodeAndDownstream = (workflowId, userId, nodeId, downstreamIds) => {
  const session = getSession(workflowId, userId);
  delete session.nodeResults[nodeId];
  for (const id of downstreamIds || []) {
    delete session.nodeResults[id];
  }
  session.updatedAt = new Date().toISOString();
};

/** @deprecated Prefer applyInvalidationEvent — retains stale cache with dirty flag */
const invalidateFrom = (workflowId, userId, nodeIds) => {
  const session = getSession(workflowId, userId);
  markNodesDirty(session, nodeIds, "legacy_invalidate");
};

const invalidateEditorSession = (workflowId, userId, definition, event) => {
  const session = getSession(workflowId, userId);
  const result = applyInvalidationEvent(session, definition, event);
  return {
    session: formatSession(session),
    affected: result.affected,
  };
};

const prepareSessionForDefinition = (workflowId, userId, definition) => {
  const session = getSession(workflowId, userId);
  if (definition) reconcileSessionWithDefinition(session, definition);
  return session;
};

const formatSession = (session) => ({
  workflowId: session.workflowId,
  input: session.input,
  nodeResults: session.nodeResults,
  dirtyNodes: session.dirtyNodes || {},
  updatedAt: session.updatedAt,
});

module.exports = {
  getSession,
  setSessionInput,
  setNodeResult,
  getNodeResult,
  clearNodeAndDownstream,
  invalidateFrom,
  getDownstreamIds,
  invalidateEditorSession,
  prepareSessionForDefinition,
  formatSession,
};
