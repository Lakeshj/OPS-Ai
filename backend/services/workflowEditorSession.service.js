/**
 * In-memory editor session cache for partial runs (execute step / run-to).
 * Keyed by workflowId + userId. Production runs do not use this cache.
 */

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
      updatedAt: new Date().toISOString(),
    });
  }
  return sessions.get(key);
};

const setSessionInput = (workflowId, userId, input) => {
  const session = getSession(workflowId, userId);
  session.input = input || {};
  session.updatedAt = new Date().toISOString();
  return session;
};

const setNodeResult = (workflowId, userId, nodeId, result) => {
  const session = getSession(workflowId, userId);
  session.nodeResults[nodeId] = {
    nodeId,
    status: result.status || "succeeded",
    output: result.output,
    items: result.items,
    error: result.error || null,
    executionTimeMs: result.executionTimeMs,
    updatedAt: new Date().toISOString(),
  };
  session.updatedAt = new Date().toISOString();
  return session.nodeResults[nodeId];
};

const getNodeResult = (workflowId, userId, nodeId) => {
  const session = getSession(workflowId, userId);
  return session.nodeResults[nodeId] || null;
};

const clearNodeAndDownstream = (workflowId, userId, nodeId, downstreamIds) => {
  const session = getSession(workflowId, userId);
  delete session.nodeResults[nodeId];
  for (const id of downstreamIds || []) {
    delete session.nodeResults[id];
  }
  session.updatedAt = new Date().toISOString();
};

const invalidateFrom = (workflowId, userId, nodeIds) => {
  const session = getSession(workflowId, userId);
  for (const id of nodeIds || []) {
    delete session.nodeResults[id];
  }
  session.updatedAt = new Date().toISOString();
};

const getDownstreamIds = (graph, fromNodeId) => {
  const visited = new Set();
  const stack = [fromNodeId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    for (const edge of graph.outgoing.get(id) || []) {
      stack.push(edge.target);
    }
  }
  visited.delete(fromNodeId);
  return [...visited];
};

const formatSession = (session) => ({
  workflowId: session.workflowId,
  input: session.input,
  nodeResults: session.nodeResults,
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
  formatSession,
};
