const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/database");
const { executeNode, deriveItems } = require("./workflowNodes.service");
const { compactValue } = require("../utils/workflowDebug");
const {
  normalizeNodeOutput,
  cloneItem,
  attachCanonicalItemsToOutput,
} = require("./workflowProvenance.service");
const {
  getNodeCacheStatus,
  isCacheUsableForExecution,
  reconcileSessionWithDefinition,
  propagateDownstreamDirty,
} = require("./workflowGraphInvalidation.service");
const {
  isMultiInputNode,
  prepareNodeExecutionInputs,
  buildPortInputPreview,
  getRequiredMergePorts,
  areRequiredPortsSettled,
  hasPortError,
  collectPortInputs,
  PORT_STATES,
  MERGE_PORT_IDS,
} = require("./workflowMultiInput.service");
const {
  getSwitchOutputPortIds,
} = require("./workflowDynamicPorts.service");
const {
  buildExecutionSnapshot,
  suspendRunAtWait,
  claimDueWaitForRun,
  getRecoverableWaitForRun,
  updateWaitProgressSnapshot,
  markWaitResumed,
  generateResumeToken,
  hashResumeToken,
  sealResumeToken,
  WAIT_MODES,
  resolveWaitMode,
  normalizeWaitSnapshot,
} = require("./workflowWait.service");
const {
  claimDueChildDependency,
  notifyParentOfChildTerminal,
  invokeSubworkflow,
  buildChildWaitSnapshot,
  WAITING_REASON_CHILD,
  SUBWORKFLOW_SOURCE,
  boundaryItems,
  CHILD_CANCELLED_CODE,
  CHILD_FAILED_CODE,
} = require("./workflowSubworkflow.service");
const {
  createRunData,
  recordOccurrence,
  nextRunIndex,
  applyLatestView,
  buildInputSources,
  fromLegacyContext,
} = require("./workflowOccurrence.service");
const {
  validateControlledCycles: validateLoopTopology,
  definitionHasLoop,
  assertLoopRuntimeNotEnabled: assertNoLoopRuntime,
  analyzeLoopRegion,
  isLoopNode,
} = require("./workflowLoopGraph.service");
const {
  validateLoopForExecution: validateLoopRuntime,
  loopReopenNodeIds,
  isLoopBackEdge,
  serializeLoopControllers,
  restoreLoopControllers,
  LOOP_PORTS,
} = require("./workflowLoopRuntime.service");

const LOOP_EDITOR_UNSUPPORTED = "LOOP_EDITOR_UNSUPPORTED";

/** Loop / body membership for a node (V1 single-region). */
const findLoopMembership = (graph, nodeId) => {
  for (const node of graph.nodes || []) {
    if (!isLoopNode(node)) continue;
    const region = analyzeLoopRegion(graph, node.id);
    if (!region?.ok) continue;
    if (nodeId === node.id) return { kind: "loop", region };
    if (region.bodyNodes?.has(nodeId)) return { kind: "body", region };
  }
  return null;
};

const collectAncestorIds = (graph, targetNodeId) => {
  const ancestors = new Set();
  const stack = [...(graph.incoming.get(targetNodeId) || []).map((e) => e.source)];
  while (stack.length > 0) {
    const id = stack.pop();
    if (ancestors.has(id)) continue;
    ancestors.add(id);
    for (const e of graph.incoming.get(id) || []) stack.push(e.source);
  }
  return ancestors;
};

/** Expand partial node set so each included Loop brings its full body. */
const expandPartialIdsWithLoopBodies = (graph, seedIds) => {
  const ids = new Set(seedIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of graph.nodes || []) {
      if (!isLoopNode(node) || !ids.has(node.id)) continue;
      const region = analyzeLoopRegion(graph, node.id);
      if (!region?.ok) continue;
      for (const bodyId of region.bodyNodes || []) {
        if (!ids.has(bodyId)) {
          ids.add(bodyId);
          changed = true;
        }
      }
    }
  }
  return ids;
};

const pruneDefinitionToNodeIds = (definition, ids) => ({
  version: definition?.version ?? 1,
  nodes: (definition?.nodes || []).filter((n) => ids.has(n.id)),
  edges: (definition?.edges || []).filter(
    (e) => ids.has(e.source) && ids.has(e.target)
  ),
});

const resultsFromRunData = (runData, ids) => {
  const results = {};
  for (const id of ids) {
    const list = runData?.[id];
    if (!Array.isArray(list) || list.length === 0) continue;
    const latest = list[list.length - 1];
    results[id] = {
      nodeId: id,
      status: latest.status || "succeeded",
      output: latest.output,
      items: latest.items,
      portOutputs: latest.portOutputs || undefined,
      error: latest.error || null,
      executionIndex: latest.runIndex ?? list.length - 1,
      occurrences: list,
      executionTimeMs: 0,
      cacheState: latest.status === "failed" ? "dirty" : "clean",
    };
  }
  return results;
};

const throwLoopEditorUnsupported = (message) => {
  const err = new Error(message);
  err.code = LOOP_EDITOR_UNSUPPORTED;
  err.statusCode = 400;
  throw err;
};

const normalizeEditorSession = (sessionOrLegacy) => {
  if (sessionOrLegacy?.nodeResults) {
    return {
      nodeResults: sessionOrLegacy.nodeResults,
      dirtyNodes: sessionOrLegacy.dirtyNodes || {},
    };
  }
  return {
    nodeResults: sessionOrLegacy || {},
    dirtyNodes: {},
  };
};

const parseJson = (value, fallback = null) => {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

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

const isStartType = (n) => {
  const type = n.type || n.data?.nodeType;
  return (
    type === "trigger" ||
    type === "schedule" ||
    type === "webhook" ||
    type === "workflowTrigger"
  );
};

const findStartNodes = (graph) => {
  const targets = new Set(graph.edges.map((e) => e.target));
  const starts = graph.nodes.filter((n) => isStartType(n) && !targets.has(n.id));
  if (starts.length > 0) return starts;
  return graph.nodes.filter((n) => !targets.has(n.id));
};

const edgeKey = (edge) =>
  edge.id || `${edge.source}->${edge.target}#${edge.sourceHandle || ""}`;

/** Outgoing edges the node actually activated, given the handle it chose. */
const pickActiveEdges = (graph, fromNodeId, nextHandle) => {
  const edges = graph.outgoing.get(fromNodeId) || [];
  if (nextHandle) {
    const matching = edges.filter(
      (e) => String(e.sourceHandle || "") === String(nextHandle)
    );
    // Fall back to unlabelled edges when the graph has no handle-specific wiring.
    return matching.length > 0
      ? matching
      : edges.filter((e) => !e.sourceHandle || e.sourceHandle === "default");
  }
  return edges.filter(
    (e) => !e.sourceHandle || e.sourceHandle === "default"
  );
};

const pickNextNodes = (graph, fromNodeId, nextHandle) =>
  pickActiveEdges(graph, fromNodeId, nextHandle)
    .map((e) => graph.byId.get(e.target))
    .filter(Boolean);

/**
 * Edges that point back into an ancestor. They are excluded from readiness
 * checks so a cycle cannot deadlock the scheduler.
 */
const findBackEdges = (graph) => {
  const color = new Map();
  const back = new Set();

  const visit = (startId) => {
    const stack = [{ id: startId, index: 0 }];
    color.set(startId, 1);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const edges = graph.outgoing.get(frame.id) || [];
      if (frame.index >= edges.length) {
        color.set(frame.id, 2);
        stack.pop();
        continue;
      }
      const edge = edges[frame.index];
      frame.index += 1;
      const state = color.get(edge.target) || 0;
      if (state === 1) {
        back.add(edgeKey(edge));
      } else if (state === 0) {
        color.set(edge.target, 1);
        stack.push({ id: edge.target, index: 0 });
      }
    }
  };

  for (const node of graph.nodes) {
    if (!color.get(node.id)) visit(node.id);
  }
  return back;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MAX_RETRIES = 5;
const MAX_LOOP_ITERATIONS = 100;

/** Per-node failure behaviour, defaulting to the previous stop-the-run policy. */
const errorPolicy = (node) => {
  const data = node.data || {};
  const onError = ["stop", "continue", "route"].includes(data.onError)
    ? data.onError
    : "stop";
  const retries = Math.min(Math.max(Number(data.retries) || 0, 0), MAX_RETRIES);
  const retryDelayMs = Math.min(
    Math.max(Number(data.retryDelayMs) || 1000, 0),
    60000
  );
  return { onError, retries, retryDelayMs };
};

/**
 * Development aid: a node can pin an output so a slow or paid call is not
 * repeated on every test run. Pinning is deliberately per-node opt-in.
 */
const pinnedResult = (node) => {
  const data = node.data || {};
  if (!data.pinned) return null;
  const nodeType = node.type || node.data?.nodeType;
  if (nodeType === "switch" && data.pinnedPortOutputs) {
    return {
      output: data.pinnedOutput ?? { pinned: true },
      resolved: { pinned: true },
      portOutputs: data.pinnedPortOutputs,
      items: Object.values(data.pinnedPortOutputs).flat(),
    };
  }
  if (data.pinnedOutput === undefined) return null;
  return {
    output: data.pinnedOutput,
    resolved: { pinned: true },
    items: Array.isArray(data.pinnedItems) ? data.pinnedItems : undefined,
  };
};

const nodeTypeOf = (node) => node?.type || node?.data?.nodeType || "noop";

const getUpstreamItemsForEdge = (edge, context) => {
  const portOutputs = context.portOutputs?.[edge.source];
  if (portOutputs && edge.sourceHandle) {
    const portItems = portOutputs[String(edge.sourceHandle)];
    return Array.isArray(portItems) ? portItems.map((item) => cloneItem(item)) : [];
  }
  const upstream = context.items?.[edge.source];
  if (!Array.isArray(upstream)) return [];
  return upstream.map((item) => cloneItem(item));
};

const applyPortOutputsToContext = (nodeId, portOutputs, context) => {
  if (!portOutputs || typeof portOutputs !== "object") return;
  if (!context.portOutputs) context.portOutputs = {};
  context.portOutputs[nodeId] = portOutputs;
  const flat = [];
  for (const items of Object.values(portOutputs)) {
    if (Array.isArray(items)) flat.push(...items);
  }
  context.items[nodeId] = flat;
};

/** Outputs of the upstream nodes that fed this one — "what entered this node". */
const buildIncomingSnapshot = (graph, nodeId, context) => {
  const edges = graph.incoming.get(nodeId) || [];
  const snapshot = {};
  for (const edge of edges) {
    if (!(edge.source in context.steps)) continue;
    snapshot[edge.source] = compactValue(context.steps[edge.source]);
  }
  return snapshot;
};

/** Items from upstream nodes connected to this node (respects sourceHandle routing). */
const collectIncomingItems = (graph, nodeId, context) => {
  const edges = graph.incoming.get(nodeId) || [];
  const items = [];
  for (const edge of edges) {
    items.push(...getUpstreamItemsForEdge(edge, context));
  }
  return items;
};

const finalizeSwitchOutputs = (node, inputItems, result) => {
  const rawByPort = result.outputsByPort || {};
  const portOutputs = {};
  for (const [portId, rawItems] of Object.entries(rawByPort)) {
    portOutputs[portId] = normalizeNodeOutput(
      node,
      inputItems,
      Array.isArray(rawItems) ? rawItems : [],
      { routingPort: portId }
    );
  }
  const flat = Object.values(portOutputs).flat();
  result.items = flat;
  result.output = attachCanonicalItemsToOutput(result.output ?? {}, flat);
  result.portOutputs = portOutputs;
  return { portOutputs, items: flat };
};

/**
 * Derive raw items from handler result, apply provenance policy, sync output.items.
 */
const finalizeNodeItems = (node, inputItems, result, extraOptions = {}) => {
  const rawItems = Array.isArray(result.items)
    ? result.items
    : deriveItems(result.output);
  const items = normalizeNodeOutput(node, inputItems, rawItems, {
    ...extraOptions,
    resultMetadata: {
      fanOut:
        (node.type || node.data?.nodeType) === "http" &&
        inputItems.length === 1 &&
        rawItems.length > 1,
      ...(extraOptions.resultMetadata || {}),
    },
  });

  result.output = attachCanonicalItemsToOutput(result.output, items);
  result.items = items;

  return items;
};

const updateStep = async (stepId, fields) => {
  const sets = [];
  const params = [];
  for (const [key, value] of Object.entries(fields)) {
    sets.push(`${key} = ?`);
    params.push(value);
  }
  params.push(stepId);
  await pool.execute(
    `UPDATE workflow_run_steps SET ${sets.join(", ")} WHERE id = ?`,
    params
  );
};

/**
 * Decides what runs next. A node waits until every incoming edge is settled
 * (active or skipped), which is what lets Merge join two branches, and a
 * branch that was not taken propagates "skipped" downstream instead of
 * stalling the nodes behind it.
 */
const createScheduler = (graph, restored = null) => {
  const startIds = new Set(findStartNodes(graph).map((n) => n.id));
  const backEdges = findBackEdges(graph);
  const edgeState = new Map(
    Array.isArray(restored?.edgeState) ? restored.edgeState : []
  );
  const nodeState = new Map(
    Array.isArray(restored?.nodeState) ? restored.nodeState : []
  );
  const loopCounts = new Map(
    Array.isArray(restored?.loopCounts) ? restored.loopCounts : []
  );
  const closedLoops = new Set(
    Array.isArray(restored?.closedLoops) ? restored.closedLoops : []
  );

  const staticIncoming = (nodeId) =>
    (graph.incoming.get(nodeId) || []).filter((e) => !backEdges.has(edgeKey(e)));

  const isReady = (node) =>
    staticIncoming(node.id).every((e) => edgeState.has(edgeKey(e)));

  const isActivated = (node) =>
    startIds.has(node.id) ||
    (graph.incoming.get(node.id) || []).some(
      (e) => edgeState.get(edgeKey(e)) === "active"
    );

  const allIncomingSkipped = (node) => {
    const incoming = staticIncoming(node.id);
    return (
      incoming.length > 0 &&
      incoming.every((e) => edgeState.get(edgeKey(e)) === "skipped")
    );
  };

  const settleOutgoing = (node, nextHandle, skipAll = false, activeHandles = null, pendingHandles = null) => {
    const outgoing = graph.outgoing.get(node.id) || [];
    const pending = new Set(
      Array.isArray(pendingHandles) ? pendingHandles.map(String) : []
    );
    let activeKeys;
    if (skipAll) {
      activeKeys = new Set();
    } else if (Array.isArray(activeHandles) && activeHandles.length > 0) {
      activeKeys = new Set(
        outgoing
          .filter((e) => activeHandles.includes(String(e.sourceHandle || "")))
          .map(edgeKey)
      );
    } else if (nextHandle) {
      activeKeys = new Set(
        pickActiveEdges(graph, node.id, nextHandle).map(edgeKey)
      );
    } else {
      activeKeys = new Set(
        outgoing
          .filter((e) => !e.sourceHandle || e.sourceHandle === "default")
          .map(edgeKey)
      );
    }
    for (const edge of outgoing) {
      const key = edgeKey(edge);
      const handle = String(edge.sourceHandle || "");
      if (pending.has(handle)) {
        edgeState.delete(key); // leave unsettled (e.g. Loop.batch after done)
        continue;
      }
      edgeState.set(key, activeKeys.has(key) ? "active" : "skipped");
    }
    return outgoing.filter(
      (e) => backEdges.has(edgeKey(e)) && edgeState.get(edgeKey(e)) === "active"
    );
  };

  /**
   * A live (or skipped Loop.continue) back edge re-opens body nodes so they
   * can run the next iteration. Loop reopen is limited to Loop + body region
   * (never done descendants).
   */
  const reopenCycle = (backEdge) => {
    const key = edgeKey(backEdge);
    const count = (loopCounts.get(key) || 0) + 1;
    loopCounts.set(key, count);

    const loopScoped = loopReopenNodeIds(graph, backEdge);
    if (loopScoped) {
      if (closedLoops.has(backEdge.target)) {
        return; // Loop.done already emitted — never reactivate body
      }
      // Finite Loop: iteration budget is controller.expectedIterations;
      // keep a hard ceiling as safety net.
      if (count > MAX_LOOP_ITERATIONS) {
        throw new Error(
          `Loop ${backEdge.target} exceeded ${MAX_LOOP_ITERATIONS} reopen events — internal Loop-state error`
        );
      }
      for (const id of loopScoped) {
        nodeState.delete(id);
        for (const e of graph.outgoing.get(id) || []) {
          edgeState.delete(edgeKey(e));
        }
        // Clear stale port outputs for body so Merge/Switch cannot mix iterations
        if (id !== backEdge.target && typeof reopenClearPort === "function") {
          reopenClearPort(id);
        }
      }
      return;
    }

    if (count > MAX_LOOP_ITERATIONS) {
      throw new Error(
        `Loop ${backEdge.source} → ${backEdge.target} exceeded ${MAX_LOOP_ITERATIONS} iterations — add a condition that ends the loop`
      );
    }

    const cycle = new Set();
    const stack = [backEdge.target];
    while (stack.length > 0) {
      const id = stack.pop();
      if (cycle.has(id)) continue;
      cycle.add(id);
      for (const e of graph.outgoing.get(id) || []) {
        if (backEdges.has(edgeKey(e))) continue;
        stack.push(e.target);
      }
    }

    for (const id of cycle) {
      nodeState.delete(id);
      for (const e of graph.outgoing.get(id) || []) edgeState.delete(edgeKey(e));
    }
  };

  /** Optional hook set by executeRun to clear context.portOutputs on body reopen. */
  let reopenClearPort = null;

  const maybeReopenLoopContinue = (node, settledSkipped = false) => {
    for (const edge of graph.outgoing.get(node.id) || []) {
      if (!backEdges.has(edgeKey(edge))) continue;
      if (!isLoopBackEdge(graph, edge)) continue;
      if (settledSkipped || edgeState.get(edgeKey(edge)) === "active") {
        // Ensure skipped continue is visible as settled for advance checks.
        if (settledSkipped && !edgeState.has(edgeKey(edge))) {
          edgeState.set(edgeKey(edge), "skipped");
        }
      }
    }
  };

  /**
   * Continue settlement advances iteration only when all body nodes are settled
   * (done or skipped), so parallel body branches cannot leak mid-iteration.
   */
  const tryAdvanceLoopAfterBodySettle = (fromNodeId) => {
    for (const edge of graph.outgoing.get(fromNodeId) || []) {
      if (!isLoopBackEdge(graph, edge)) continue;
      const regionIds = loopReopenNodeIds(graph, edge);
      if (!regionIds) continue;
      const bodyReady = [...regionIds].every((id) => {
        if (id === edge.target) return true; // Loop itself may still be "done" until reopen
        return nodeState.has(id);
      });
      if (!bodyReady) continue;
      const st = edgeState.get(edgeKey(edge));
      if (st === "active" || st === "skipped") {
        reopenCycle(edge);
      }
    }
  };

  return {
    backEdges,
    edgeState,
    nodeState,
    loopCounts,
    closedLoops,
    setReopenClearPort(fn) {
      reopenClearPort = fn;
    },
    next() {
      for (const node of graph.nodes) {
        if (nodeState.has(node.id)) continue;
        if (!isReady(node)) continue;
        // Skipping is decided before activation, otherwise a node behind an
        // untaken branch would never settle and would stall everything after it.
        if (allIncomingSkipped(node)) return { node, action: "skip" };
        if (!isActivated(node)) continue;
        return { node, action: "run" };
      }
      return null;
    },
    complete(node, nextHandle, options = {}) {
      nodeState.set(node.id, "done");
      const activeHandles = options.activeHandles || null;
      const pendingHandles = options.pendingHandles || null;
      if (
        (node.type === "loop" || node.data?.nodeType === "loop") &&
        Array.isArray(activeHandles) &&
        activeHandles.includes(LOOP_PORTS.DONE)
      ) {
        closedLoops.add(node.id);
      }
      for (const back of settleOutgoing(
        node,
        nextHandle,
        false,
        activeHandles,
        pendingHandles
      )) {
        if (isLoopBackEdge(graph, back)) {
          tryAdvanceLoopAfterBodySettle(node.id);
        } else {
          reopenCycle(back);
        }
      }
      tryAdvanceLoopAfterBodySettle(node.id);
    },
    skip(node) {
      nodeState.set(node.id, "skipped");
      settleOutgoing(node, null, true);
      maybeReopenLoopContinue(node, true);
      tryAdvanceLoopAfterBodySettle(node.id);
    },
    stateOf: (nodeId) => nodeState.get(nodeId) || null,
  };
};

const executeRun = async (runId, options = {}) => {
  const claimToken =
    options.claimToken ||
    `worker-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const now = options.now instanceof Date ? options.now : new Date();

  const [runRows] = await pool.execute(
    `SELECT r.*, w.definition_json AS live_definition_json, w.workspace_id, w.id AS workflow_id
     FROM workflow_runs r
     INNER JOIN workflows w ON w.id = r.workflow_id
     WHERE r.id = ?`,
    [runId]
  );
  if (runRows.length === 0) {
    throw new Error(`Run not found: ${runId}`);
  }

  const run = runRows[0];

  // Prefer immutable snapshot taken at enqueue; fall back to live only for legacy rows.
  const definition = parseJson(
    run.definition_snapshot_json || run.live_definition_json,
    { version: 1, nodes: [], edges: [] }
  );
  const input = parseJson(run.input_json, {});
  const graph = buildGraph(definition);
  const loopCheck = validateLoopRuntime(graph);
  if (!loopCheck.ok) {
    const err = new Error(loopCheck.errors[0] || "Invalid Loop topology");
    if (loopCheck.code) err.code = loopCheck.code;
    throw err;
  }
  const isProductionRun =
    input?.source === "schedule" || input?.source === "webhook";

  const {
    markRunFailedAndEnsureDispatch,
    ERROR_WORKFLOW_SOURCE,
  } = require("./workflowErrorRouting.service");
  const isSubworkflowInvocation = input?.source === SUBWORKFLOW_SOURCE;
  const isErrorWorkflowInvocation = input?.source === ERROR_WORKFLOW_SOURCE;

  let scheduler;
  let context;
  let runErrors = [];
  let finalOutput = null;
  let resumeWait = null;

  const applyChildResumeFromSnapshot = async (depClaim) => {
    const snap = normalizeWaitSnapshot(depClaim.snapshot || {});
    scheduler = createScheduler(graph, snap.scheduler || null);
    context = {
      input: snap.context?.input || input,
      steps: { ...(snap.context?.steps || {}) },
      items: { ...(snap.context?.items || {}) },
      portOutputs: { ...(snap.context?.portOutputs || {}) },
      runData: snap.runData || fromLegacyContext(snap.context || {}),
      loopControllers: restoreLoopControllers(snap.loopControllers),
      inputItems: [],
      runId,
      workspaceId: run.workspace_id,
      workflowId: run.workflow_id,
      editorMode: false,
      useProductionPins: isProductionRun,
      now,
    };
    applyLatestView(context);
    finalOutput = snap.finalOutput ?? null;
    runErrors = Array.isArray(snap.runErrors) ? [...snap.runErrors] : [];

    const parentNodeId = depClaim.parentNodeId;
    const execIndex = Number(depClaim.parentExecutionIndex) || 0;
    const childResult = depClaim.childResult || {};
    const stepId = depClaim.parentStepId || snap.waitStepId || null;

    if (childResult.status !== "succeeded") {
      const code =
        childResult.error?.code ||
        (childResult.status === "cancelled"
          ? CHILD_CANCELLED_CODE
          : CHILD_FAILED_CODE);
      const message =
        childResult.error?.message ||
        `Child workflow run ${childResult.status || "failed"}`;
      const errOutput = {
        error: message,
        code,
        childRunId: depClaim.childRunId,
        failed: true,
      };
      context.steps[parentNodeId] = errOutput;
      context.items[parentNodeId] = [errOutput];
      if (!context.runData) context.runData = createRunData();
      recordOccurrence(context.runData, {
        nodeId: parentNodeId,
        runIndex: execIndex,
        status: "failed",
        items: [errOutput],
        output: errOutput,
        stepId,
        error: message,
        completedAt: new Date().toISOString(),
      });
      applyLatestView(context);
      if (stepId) {
        await updateStep(stepId, {
          status: "failed",
          error: message,
          output_json: JSON.stringify(errOutput),
          finished_at: new Date(),
        });
      }
      const err = new Error(message);
      err.code = code;
      err.childRunId = depClaim.childRunId;
      err.failedNodeId = parentNodeId;
      err.failedExecutionIndex = execIndex;
      err.failedNodeType = "executeWorkflow";
      throw err;
    }

    const items = Array.isArray(childResult.items) ? childResult.items : [];
    const output = attachCanonicalItemsToOutput(
      {
        childRunId: depClaim.childRunId,
        itemCount: items.length,
      },
      items
    );
    context.steps[parentNodeId] = output;
    context.items[parentNodeId] = items;
    if (!context.runData) context.runData = createRunData();
    recordOccurrence(context.runData, {
      nodeId: parentNodeId,
      runIndex: execIndex,
      status: "succeeded",
      items,
      output,
      stepId,
      completedAt: new Date().toISOString(),
    });
    applyLatestView(context);
    if (stepId) {
      await updateStep(stepId, {
        status: "succeeded",
        output_json: JSON.stringify(output),
        finished_at: new Date(),
      });
    }

    const node = graph.byId.get(parentNodeId);
    if (node) {
      scheduler.complete(node, null);
    }
  };

  const applyWaitResumeFromSnapshot = async (waitRow, { executeWaitNode }) => {
    const snap = normalizeWaitSnapshot(waitRow.snapshot || {});
    scheduler = createScheduler(graph, snap.scheduler || null);
      context = {
        input: snap.context?.input || input,
        steps: { ...(snap.context?.steps || {}) },
        items: { ...(snap.context?.items || {}) },
        portOutputs: { ...(snap.context?.portOutputs || {}) },
        runData: snap.runData || fromLegacyContext(snap.context || {}),
        loopControllers: restoreLoopControllers(snap.loopControllers),
        inputItems: [],
        runId,
        workspaceId: run.workspace_id,
        workflowId: run.workflow_id,
        editorMode: false,
        useProductionPins: isProductionRun,
        resumingWaitNodeId: snap.waitNodeId,
        waitResumeAt: waitRow.resume_at,
        waitResumeMechanism: waitRow.resume_mechanism || waitRow.resume_mode,
        now,
      };
    applyLatestView(context);
    finalOutput = snap.finalOutput ?? null;
    runErrors = Array.isArray(snap.runErrors) ? [...snap.runErrors] : [];

    const waitNode = graph.byId.get(snap.waitNodeId);
    if (!waitNode) {
      throw new Error(
        `Wait resume failed: node ${snap.waitNodeId} missing from definition snapshot`
      );
    }

    if (executeWaitNode) {
      const waitInputItems = Array.isArray(snap.waitInputItems)
        ? snap.waitInputItems
        : [];
      context.inputItems = waitInputItems;
      context.currentNodeId = waitNode.id;
      context.graph = graph;

      const waitResult = await executeNode(waitNode, {
        ...context,
        resumingWaitNodeId: waitNode.id,
      });
      const waitItems = finalizeNodeItems(waitNode, waitInputItems, waitResult);
      context.items[waitNode.id] = waitItems;
      context.steps[waitNode.id] = waitResult.output ?? null;
      if (!context.runData) context.runData = createRunData();
      // Resume updates the SAME Wait occurrence (never nextRunIndex).
      const waitExecutionIndex =
        snap.waitExecutionIndex != null
          ? Number(snap.waitExecutionIndex) || 0
          : 0;
      context.currentRunIndex = waitExecutionIndex;
      recordOccurrence(context.runData, {
        nodeId: waitNode.id,
        runIndex: waitExecutionIndex,
        status: "succeeded",
        items: waitItems,
        output: waitResult.output ?? null,
        inputSources: null,
        stepId: snap.waitStepId || waitRow.step_id,
        completedAt: new Date().toISOString(),
      });
      applyLatestView(context);

      await markWaitResumed(
        waitRow.id,
        snap.waitStepId || waitRow.step_id,
        waitResult.output
      );

      scheduler.complete(waitNode, waitResult.nextHandle, {
        activeHandles: waitResult.activeHandles,
      });

      // Persist post-Wait progress so crash mid-downstream can restore
      // without cold-starting the graph or replaying upstream.
      const progressSnap = buildExecutionSnapshot({
        waitNodeId: waitNode.id,
        waitStepId: snap.waitStepId || waitRow.step_id,
        waitInputItems,
        context,
        scheduler,
        finalOutput,
        runErrors,
        waitCompleted: true,
      });
      await updateWaitProgressSnapshot(waitRow.id, progressSnap);
    }
    // else: waitCompleted progress restore — scheduler already includes Wait done
  };

  if (run.status === "waiting") {
    if (run.waiting_reason === WAITING_REASON_CHILD) {
      const depClaim = await claimDueChildDependency(runId, claimToken);
      if (!depClaim) {
        return { status: "waiting", deferred: true };
      }
      await applyChildResumeFromSnapshot(depClaim);
    } else {
      resumeWait = await claimDueWaitForRun(runId, claimToken, now);
      if (!resumeWait) {
        // Not due yet, another worker claimed it, or cancel won the race.
        return { status: "waiting", deferred: true };
      }
      await applyWaitResumeFromSnapshot(resumeWait, { executeWaitNode: true });
    }
  } else if (run.status === "cancelled") {
    return { status: "cancelled" };
  } else if (run.status === "running") {
    // Crash recovery: claimed wait (before markWaitResumed) or progress snapshot.
    const recoverable = await getRecoverableWaitForRun(runId);
    if (recoverable?.recoveryMode === "claimed") {
      await applyWaitResumeFromSnapshot(recoverable, { executeWaitNode: true });
    } else if (recoverable?.recoveryMode === "progress") {
      await applyWaitResumeFromSnapshot(recoverable, { executeWaitNode: false });
    } else {
      await pool.execute(
        `UPDATE workflow_runs
         SET status = 'running', started_at = COALESCE(started_at, CURRENT_TIMESTAMP), error = NULL,
             waiting_node_id = NULL, resume_at = NULL
         WHERE id = ? AND status IN ('queued', 'running')`,
        [runId]
      );

      context = {
        input,
        steps: {},
        items: {},
        portOutputs: {},
        runData: createRunData(),
        loopControllers: {},
        inputItems: [],
        runId,
        workspaceId: run.workspace_id,
        workflowId: run.workflow_id,
        editorMode: false,
        useProductionPins: isProductionRun,
        now,
      };
      scheduler = createScheduler(graph);
    }
  } else if (run.status === "queued") {
    await pool.execute(
      `UPDATE workflow_runs
       SET status = 'running', started_at = COALESCE(started_at, CURRENT_TIMESTAMP), error = NULL,
           waiting_node_id = NULL, resume_at = NULL
       WHERE id = ? AND status = 'queued'`,
      [runId]
    );

    context = {
      input,
      steps: {},
      items: {},
      portOutputs: {},
      runData: createRunData(),
      loopControllers: {},
      inputItems: [],
      runId,
      workspaceId: run.workspace_id,
      workflowId: run.workflow_id,
      editorMode: false,
      useProductionPins: isProductionRun,
      now,
    };
    scheduler = createScheduler(graph);
  } else {
    // Terminal run — do not re-execute.
    return { status: run.status };
  }

  scheduler.setReopenClearPort((nodeId) => {
    if (context.portOutputs) delete context.portOutputs[nodeId];
  });

  try {
    for (;;) {
      // Cancel/resume race: stop before further side effects if cancelled.
      const [liveRows] = await pool.execute(
        `SELECT status FROM workflow_runs WHERE id = ?`,
        [runId]
      );
      if (liveRows[0]?.status === "cancelled") {
        return { status: "cancelled" };
      }

      const next = scheduler.next();
      if (!next) break;
      const { node, action } = next;

      if (action === "skip") {
        const skipIndex = nextRunIndex(context.runData || createRunData(), node.id);
        if (!context.runData) context.runData = createRunData();
        scheduler.skip(node);
        await pool.execute(
          `INSERT INTO workflow_run_steps
            (id, run_id, node_id, execution_index, node_type, status, started_at, finished_at)
           VALUES (?, ?, ?, ?, ?, 'skipped', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            uuidv4(),
            runId,
            node.id,
            skipIndex,
            node.type || node.data?.nodeType || "unknown",
          ]
        );
        recordOccurrence(context.runData, {
          nodeId: node.id,
          runIndex: skipIndex,
          status: "skipped",
          items: [],
          output: null,
        });
        continue;
      }

      {
        const nodeType = node.type || node.data?.nodeType || "unknown";
        if (!context.runData) context.runData = createRunData();

        // Sub-workflow invocation uses Workflow Trigger entry — never fire
        // the child's Schedule/Webhook/Manual Trigger as the entry point.
        if (
          isSubworkflowInvocation &&
          (nodeType === "schedule" ||
            nodeType === "webhook" ||
            nodeType === "trigger" ||
            nodeType === "errorTrigger")
        ) {
          const skipIndex = nextRunIndex(context.runData, node.id);
          scheduler.skip(node);
          await pool.execute(
            `INSERT INTO workflow_run_steps
              (id, run_id, node_id, execution_index, node_type, status, started_at, finished_at)
             VALUES (?, ?, ?, ?, ?, 'skipped', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [uuidv4(), runId, node.id, skipIndex, nodeType]
          );
          recordOccurrence(context.runData, {
            nodeId: node.id,
            runIndex: skipIndex,
            status: "skipped",
            items: [],
            output: { skipped: true, reason: "subworkflow_entry" },
          });
          continue;
        }

        if (
          isErrorWorkflowInvocation &&
          (nodeType === "schedule" ||
            nodeType === "webhook" ||
            nodeType === "trigger" ||
            nodeType === "workflowTrigger")
        ) {
          const skipIndex = nextRunIndex(context.runData, node.id);
          scheduler.skip(node);
          await pool.execute(
            `INSERT INTO workflow_run_steps
              (id, run_id, node_id, execution_index, node_type, status, started_at, finished_at)
             VALUES (?, ?, ?, ?, ?, 'skipped', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [uuidv4(), runId, node.id, skipIndex, nodeType]
          );
          recordOccurrence(context.runData, {
            nodeId: node.id,
            runIndex: skipIndex,
            status: "skipped",
            items: [],
            output: { skipped: true, reason: "error_workflow_entry" },
          });
          continue;
        }

        const executionIndex = nextRunIndex(context.runData, node.id);
        const inputSources = buildInputSources(graph, node.id, context.runData);
        const stepId = uuidv4();
        const stepInput = {
          nodeType,
          nodeData: compactValue(node.data || {}),
          contextInput: compactValue(context.input),
          incoming: buildIncomingSnapshot(graph, node.id, context),
          executionIndex,
          inputSources,
        };

        await pool.execute(
          `INSERT INTO workflow_run_steps
            (id, run_id, node_id, execution_index, node_type, status, input_json, started_at)
           VALUES (?, ?, ?, ?, ?, 'running', ?, CURRENT_TIMESTAMP)`,
          [stepId, runId, node.id, executionIndex, nodeType, JSON.stringify(stepInput)]
        );

        context.inputItems = collectIncomingItems(graph, node.id, context);
        prepareNodeExecutionInputs(graph, node.id, context, {
          edgeState: scheduler.edgeState,
        });
        context.currentNodeId = node.id;
        context.currentRunIndex = executionIndex;
        context.currentInputSources = inputSources;
        context.graph = graph;

        if (
          nodeType === "merge" &&
          context.portInputs &&
          hasPortError(
            context.portInputs,
            getRequiredMergePorts(graph, node.id)
          )
        ) {
          throw new Error("Merge cannot run: a required input port has an error");
        }

        const policy = errorPolicy(node);
        const pinned = isProductionRun ? null : pinnedResult(node);
        let result = pinned;
        let failure = null;
        let attempts = 0;

        if (!pinned && node.data?.disabled) {
          const incomingItems = context.inputItems;
          const passthrough =
            incomingItems.length > 0
              ? incomingItems
              : deriveItems(
                  Object.values(buildIncomingSnapshot(graph, node.id, context))[0]
                );
          result = {
            output:
              passthrough.length === 1
                ? passthrough[0]?.json ?? passthrough[0]
                : { items: passthrough },
            items: passthrough,
            resolved: { disabled: true, passthrough: true },
          };
        } else if (!pinned) {
          const savedItems = context.inputItems;
          if (node.data?.executeOnce && savedItems.length > 1) {
            context.inputItems = savedItems.slice(0, 1);
          }
          for (let attempt = 1; attempt <= policy.retries + 1; attempt += 1) {
            attempts = attempt;
            try {
              result = await executeNode(node, context);
              failure = null;
              break;
            } catch (err) {
              failure = err;
              if (attempt <= policy.retries) {
                await sleep(policy.retryDelayMs * attempt);
              }
            }
          }
          context.inputItems = savedItems;
        }

        // Durable Wait suspension — persist and release worker.
        if (!failure && result?.suspend) {
          const mode = resolveWaitMode({
            resumeMode: result.resumeMode || node.data?.resumeMode,
          });
          const resumeAt =
            mode === WAIT_MODES.TIME && result.resumeAt
              ? new Date(result.resumeAt)
              : null;

          let resumeTokenHash = null;
          let resumeTokenCiphertext = null;
          if (mode === WAIT_MODES.EXTERNAL) {
            const rawToken = generateResumeToken();
            resumeTokenHash = hashResumeToken(rawToken);
            resumeTokenCiphertext = sealResumeToken(rawToken);
            // Raw token is sealed for authorized reveal only — never in snapshot.
          }

          // Same occurrence: waiting → (later) succeeded. Do not allocate a new index.
          recordOccurrence(context.runData, {
            nodeId: node.id,
            runIndex: executionIndex,
            status: "waiting",
            items: Array.isArray(context.inputItems) ? context.inputItems : [],
            output: {
              waiting: true,
              resumeMode: mode,
              resumeAt: resumeAt ? resumeAt.toISOString() : null,
            },
            inputSources,
            stepId,
            startedAt: new Date().toISOString(),
          });
          applyLatestView(context);

          const snapshot = buildExecutionSnapshot({
            waitNodeId: node.id,
            waitStepId: stepId,
            waitExecutionIndex: executionIndex,
            waitInputItems: context.inputItems,
            context,
            scheduler,
            finalOutput,
            runErrors,
          });
          await suspendRunAtWait({
            runId,
            workflowId: run.workflow_id,
            nodeId: node.id,
            stepId,
            resumeAt,
            resumeMode: mode,
            resumeTokenHash,
            resumeTokenCiphertext,
            snapshot,
            jobId: options.jobId || null,
          });
          return {
            status: "waiting",
            resumeAt: resumeAt ? resumeAt.toISOString() : null,
            resumeMode: mode,
            waitingNodeId: node.id,
          };
        }

        // Part 10B — Execute Workflow: durable child invocation via 10A service.
        if (!failure && result?.invokeChild) {
          const childWorkflowId = String(result.childWorkflowId || "").trim();
          const inputItems = Array.isArray(result.items)
            ? result.items
            : Array.isArray(context.inputItems)
              ? context.inputItems
              : [];

          recordOccurrence(context.runData, {
            nodeId: node.id,
            runIndex: executionIndex,
            status: "waiting",
            items: inputItems,
            output: {
              waiting: true,
              waitingReason: WAITING_REASON_CHILD,
              childWorkflowId,
            },
            inputSources,
            stepId,
            startedAt: new Date().toISOString(),
          });
          applyLatestView(context);

          const snapshot = buildChildWaitSnapshot({
            parentNodeId: node.id,
            parentExecutionIndex: executionIndex,
            parentStepId: stepId,
            childRunId: null,
            waitInputItems: inputItems,
            context,
            scheduler,
            finalOutput,
            runErrors,
          });

          const authUser = {
            userId: run.created_by,
            role: "system",
          };

          let inv;
          try {
            inv = await invokeSubworkflow({
              parentRunId: runId,
              parentNodeId: node.id,
              parentExecutionIndex: executionIndex,
              parentStepId: stepId,
              childWorkflowId,
              inputItems,
              parentSnapshot: snapshot,
              authUser,
              jobId: options.jobId || null,
            });
          } catch (err) {
            const message =
              err instanceof Error ? err.message : String(err);
            await updateStep(stepId, {
              status: "failed",
              attempts,
              error: message,
              finished_at: new Date(),
            });
            throw err;
          }

          // Child already terminal (reuse) — claim/resume path will apply result.
          if (inv.terminal && !inv.waiting) {
            const {
              getSubworkflowResult,
            } = require("./workflowSubworkflow.service");
            const childResult = await getSubworkflowResult(inv.childRunId);
            if (childResult.status !== "succeeded") {
              const code =
                childResult.error?.code ||
                (childResult.status === "cancelled"
                  ? CHILD_CANCELLED_CODE
                  : CHILD_FAILED_CODE);
              const message =
                childResult.error?.message ||
                `Child workflow run ${childResult.status || "failed"}`;
              const failErr = new Error(message);
              failErr.code = code;
              throw failErr;
            }
            const items = Array.isArray(childResult.items)
              ? childResult.items
              : [];
            const output = attachCanonicalItemsToOutput(
              {
                childRunId: inv.childRunId,
                childWorkflowId,
                itemCount: items.length,
              },
              items
            );
            context.steps[node.id] = output;
            context.items[node.id] = items;
            recordOccurrence(context.runData, {
              nodeId: node.id,
              runIndex: executionIndex,
              status: "succeeded",
              items,
              output,
              inputSources,
              stepId,
              completedAt: new Date().toISOString(),
            });
            applyLatestView(context);
            await updateStep(stepId, {
              status: "succeeded",
              attempts,
              output_json: JSON.stringify(output),
              finished_at: new Date(),
            });
            scheduler.complete(node, null);
            continue;
          }

          return {
            status: "waiting",
            waitingReason: WAITING_REASON_CHILD,
            waitingNodeId: node.id,
            childRunId: inv.childRunId,
          };
        }

        if (!failure) {
          let items;
          const occurrenceInputSources = result.inputSources || inputSources;
          if (nodeType === "loop" && result.portOutputs) {
            applyPortOutputsToContext(node.id, result.portOutputs, context);
            items = Array.isArray(result.items) ? result.items : [];
            result.output = attachCanonicalItemsToOutput(
              result.output ?? {},
              items
            );
          } else if (nodeType === "switch" && result.outputsByPort) {
            const finalized = finalizeSwitchOutputs(node, context.inputItems, result);
            items = finalized.items;
            applyPortOutputsToContext(node.id, finalized.portOutputs, context);
          } else {
            items = finalizeNodeItems(node, context.inputItems, result, {
              portInputs: context.portInputs,
            });
            context.items[node.id] = items;
          }
          const output = result.output ?? null;
          if (node.data?.alwaysOutputData && items.length === 0) {
            items = [{ json: {} }];
            result.output = attachCanonicalItemsToOutput(output, items);
            result.items = items;
          }

          // Part 10B.1 — Result node keeps historical occurrence items (derived
          // from output.result). Callable return is the *incoming* WorkflowItem[]
          // at Result, persisted separately so it cannot be confused with the
          // mapFrom scalar wrapper.
          let persistedOutput = result.output ?? output;
          if (nodeType === "result") {
            const callableReturnItems = boundaryItems(
              Array.isArray(context.inputItems) ? context.inputItems : []
            );
            persistedOutput = {
              ...(persistedOutput && typeof persistedOutput === "object"
                ? persistedOutput
                : { result: persistedOutput }),
              __callableReturnItems: callableReturnItems,
            };
            result.output = persistedOutput;
            context.__callableReturnItems = callableReturnItems;
            context.__callableReturnResultNodeId = node.id;
            context.__callableReturnOccurrenceCount =
              (Number(context.__callableReturnOccurrenceCount) || 0) + 1;
          }

          context.steps[node.id] = persistedOutput;

          recordOccurrence(context.runData, {
            nodeId: node.id,
            runIndex: executionIndex,
            status: "succeeded",
            items,
            output: persistedOutput,
            portOutputs: context.portOutputs?.[node.id] || null,
            inputSources: occurrenceInputSources,
            stepId,
            completedAt: new Date().toISOString(),
            ...(result.loopMeta ? { executionContext: result.loopMeta } : {}),
          });
          applyLatestView(context);

          await updateStep(stepId, {
            status: "succeeded",
            attempts,
            input_json: JSON.stringify({
              ...stepInput,
              itemsIn: context.inputItems.length,
              resolved: compactValue(result.resolved ?? null),
              loopMeta: result.loopMeta || null,
            }),
            output_json: JSON.stringify(persistedOutput),
            finished_at: new Date(),
          });

          if (result.terminal || nodeType === "result") {
            finalOutput = persistedOutput;
          }

          scheduler.complete(node, result.nextHandle, {
            activeHandles: result.activeHandles,
            pendingHandles: result.pendingHandles,
          });
          continue;
        }

        const message =
          failure instanceof Error ? failure.message : String(failure);
        await updateStep(stepId, {
          status: "failed",
          attempts,
          input_json: JSON.stringify({
            ...stepInput,
            resolved: compactValue(failure?.resolved ?? null),
          }),
          error: message,
          finished_at: new Date(),
        });

        if (policy.onError === "stop") {
          if (failure && typeof failure === "object") {
            failure.failedNodeId = node.id;
            failure.failedExecutionIndex = executionIndex;
            failure.failedNodeType = nodeType;
          }
          throw failure;
        }

        const errorOutput = { error: message, failed: true, nodeId: node.id };
        context.steps[node.id] = errorOutput;
        context.items[node.id] = [errorOutput];
        recordOccurrence(context.runData, {
          nodeId: node.id,
          runIndex: executionIndex,
          status: "failed",
          items: [errorOutput],
          output: errorOutput,
          inputSources,
          stepId,
          error: message,
          completedAt: new Date().toISOString(),
        });
        applyLatestView(context);
        runErrors.push({ nodeId: node.id, error: message });

        scheduler.complete(node, policy.onError === "route" ? "error" : null);
      }
    }

    const warning =
      runErrors.length > 0
        ? runErrors.map((e) => `${e.nodeId}: ${e.error}`).join("\n")
        : null;

    let outputPayload =
      finalOutput ?? {
        steps: Object.fromEntries(
          Object.entries(context.steps).map(([id, value]) => [id, value])
        ),
      };

    if (isSubworkflowInvocation && finalOutput) {
      const resultNodes = (definition.nodes || []).filter(
        (n) => (n.type || n.data?.nodeType) === "result"
      );
      if (resultNodes.length === 1) {
        // Mirror of Result step __callableReturnItems — compatibility cache only.
        // Authoritative read path is getSubworkflowResult → Result step row.
        if (Number(context.__callableReturnOccurrenceCount) > 1) {
          throw new Error(
            "Callable Result executed more than once; return is ambiguous"
          );
        }
        const items = Array.isArray(context.__callableReturnItems)
          ? context.__callableReturnItems
          : null;
        if (Array.isArray(items)) {
          outputPayload = {
            ...finalOutput,
            __subworkflowItems: boundaryItems(items),
          };
        }
      }
    }

    await pool.execute(
      `UPDATE workflow_runs
       SET status = 'succeeded',
           output_json = ?,
           finished_at = CURRENT_TIMESTAMP,
           error = ?,
           waiting_node_id = NULL,
           waiting_reason = NULL,
           resume_at = NULL
       WHERE id = ? AND status = 'running'`,
      [JSON.stringify(outputPayload), warning, runId]
    );

    const [finalRows] = await pool.execute(
      `SELECT status, parent_run_id FROM workflow_runs WHERE id = ?`,
      [runId]
    );
    if (finalRows[0]?.status === "cancelled") {
      return { status: "cancelled" };
    }

    if (finalRows[0]?.parent_run_id) {
      try {
        await notifyParentOfChildTerminal(runId);
      } catch {
        // reconcileOrphanedChildWaits recovers
      }
    }

    return {
      status: "succeeded",
      output: outputPayload,
      warning,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await markRunFailedAndEnsureDispatch(runId, message, { err });
    } catch {
      // Fallback: at least mark failed if dispatch helper fails.
      await pool.execute(
        `UPDATE workflow_runs
         SET status = 'failed', error = ?, finished_at = CURRENT_TIMESTAMP,
             waiting_node_id = NULL, waiting_reason = NULL, resume_at = NULL
         WHERE id = ? AND status IN ('queued', 'running', 'waiting')`,
        [message, runId]
      );
    }
    if (run.parent_run_id) {
      try {
        await notifyParentOfChildTerminal(runId);
      } catch {
        // reconcile recovers
      }
    }
    throw err;
  }
};

/**
 * Editor-only partial execution. Does not create workflow_runs rows.
 * mode: "step" runs target only (upstream from cache/pins), "run-to" includes target.
 */
const executePartial = async ({
  definition,
  input = {},
  targetNodeId,
  mode = "step",
  session = {},
  sessionNodeResults,
  useProductionPins = false,
}) => {
  const editorSession = normalizeEditorSession(
    sessionNodeResults != null ? { nodeResults: sessionNodeResults, dirtyNodes: session.dirtyNodes } : session
  );
  reconcileSessionWithDefinition(editorSession, definition);

  const graph = buildGraph(definition);
  const cycleCheck = validateLoopTopology(graph);
  if (!cycleCheck.ok) {
    throw new Error(cycleCheck.errors[0] || "Invalid workflow cycle");
  }
  const target = graph.byId.get(targetNodeId);
  if (!target) throw new Error(`Node not found: ${targetNodeId}`);

  const membership = findLoopMembership(graph, targetNodeId);
  if (membership?.kind === "loop") {
    throwLoopEditorUnsupported(
      "Loop runs as a complete region. Use Run to a node after Done, or Execute workflow."
    );
  }
  if (membership?.kind === "body") {
    throwLoopEditorUnsupported(
      "Iteration-level rerun inside Loop isn't supported yet. Use Execute workflow or Run to a node after Done."
    );
  }

  const ancestors = collectAncestorIds(graph, targetNodeId);

  // Path includes a Loop region → execute Loop as a complete unit (not step-through).
  const pathIds = new Set(ancestors);
  if (mode !== "upstream") pathIds.add(targetNodeId);
  const pathTouchesLoop = [...pathIds].some((id) => findLoopMembership(graph, id));

  if (pathTouchesLoop) {
    const loopCheck = validateLoopRuntime(graph);
    if (!loopCheck.ok) {
      const err = new Error(loopCheck.errors[0] || "Invalid Loop topology");
      if (loopCheck.code) err.code = loopCheck.code;
      throw err;
    }

    const seedIds = new Set(ancestors);
    if (mode === "run-to" || mode === "step") seedIds.add(targetNodeId);
    const ids = expandPartialIdsWithLoopBodies(graph, seedIds);
    // Upstream of Loop.items must be present for the controller
    for (const id of ancestors) ids.add(id);

    const pruned = pruneDefinitionToNodeIds(definition, ids);
    const startMs = Date.now();
    const mem = await executeGraphInMemory(pruned, { input });
    const resultIds =
      mode === "upstream"
        ? new Set([...ids].filter((id) => id !== targetNodeId))
        : ids;
    const results = resultsFromRunData(mem.runData, resultIds);

    return {
      targetNodeId,
      mode,
      results,
      input,
      durationMs: Date.now() - startMs,
      inputItems: collectIncomingItems(graph, targetNodeId, mem.context || {}),
      editorSession,
    };
  }

  const nodeNeedsExecution = (nodeId) => {
    const node = graph.byId.get(nodeId);
    if (!node) return false;
    const status = getNodeCacheStatus(editorSession, nodeId, node, graph);
    if (status === "pinned" || status === "clean") return false;
    return true;
  };

  const nodesToRun = new Set();
  if (mode === "run-to") {
    nodesToRun.add(targetNodeId);
    for (const id of ancestors) {
      if (nodeNeedsExecution(id)) nodesToRun.add(id);
    }
  } else if (mode === "upstream") {
    for (const id of ancestors) {
      if (nodeNeedsExecution(id)) nodesToRun.add(id);
    }
  } else {
    nodesToRun.add(targetNodeId);
    for (const id of ancestors) {
      if (nodeNeedsExecution(id)) nodesToRun.add(id);
    }
  }

  const topo = [];
  const visited = new Set();
  const visit = (id) => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const e of graph.incoming.get(id) || []) visit(e.source);
    if (nodesToRun.has(id)) topo.push(graph.byId.get(id));
  };
  visit(targetNodeId);

  const context = {
    input,
    steps: {},
    items: {},
    portOutputs: {},
    runData: createRunData(),
    inputItems: [],
    runId: null,
    workspaceId: null,
    workflowId: null,
    editorMode: true,
    useProductionPins,
  };

  for (const node of definition?.nodes || []) {
    const pinned = useProductionPins ? null : pinnedResult(node);
    if (!pinned) continue;
    if (pinned.output !== undefined) context.steps[node.id] = pinned.output;
    if (pinned.portOutputs) {
      applyPortOutputsToContext(node.id, pinned.portOutputs, context);
    } else if (Array.isArray(pinned.items)) {
      context.items[node.id] = pinned.items;
    }
  }

  for (const [nodeId, cached] of Object.entries(editorSession.nodeResults)) {
    const node = graph.byId.get(nodeId);
    const status = getNodeCacheStatus(editorSession, nodeId, node, graph);
    if (!isCacheUsableForExecution(status)) continue;
    if (cached?.output !== undefined) context.steps[nodeId] = cached.output;
    if (cached?.portOutputs) {
      applyPortOutputsToContext(nodeId, cached.portOutputs, context);
    } else if (Array.isArray(cached?.items)) {
      context.items[nodeId] = cached.items;
    }
  }

  const results = {};
  const startMs = Date.now();

  for (const node of topo) {
    if (!node) continue;
    const nodeStart = Date.now();

    const status = getNodeCacheStatus(editorSession, node.id, node, graph);
    const hasCached =
      isCacheUsableForExecution(status) && !nodesToRun.has(node.id);
    if (hasCached) {
      const cached = editorSession.nodeResults[node.id];
      if (cached?.portOutputs) {
        applyPortOutputsToContext(node.id, cached.portOutputs, context);
      } else if (Array.isArray(cached?.items)) {
        context.items[node.id] = cached.items;
      }
      results[node.id] = {
        nodeId: node.id,
        status: "succeeded",
        output: cached.output,
        items: cached.items,
        portOutputs: cached.portOutputs,
        executionTimeMs: 0,
        cached: true,
        cacheState: status === "pinned" ? "pinned" : "clean",
      };
      continue;
    }

    context.inputItems = collectIncomingItems(graph, node.id, context);
    prepareNodeExecutionInputs(graph, node.id, context);
    context.currentNodeId = node.id;
    context.graph = graph;
    const pinned = useProductionPins ? null : pinnedResult(node);
    let result;
    let failure = null;

    const nodeType = node.type || node.data?.nodeType || "unknown";
    if (
      nodeType === "merge" &&
      context.portInputs &&
      hasPortError(context.portInputs, getRequiredMergePorts(graph, node.id))
    ) {
      results[node.id] = {
        nodeId: node.id,
        status: "failed",
        error: "Merge cannot run: a required input port has an error",
        executionTimeMs: Date.now() - nodeStart,
        cacheState: "dirty",
      };
      if (mode === "step" && node.id === targetNodeId) break;
      throw new Error("Merge cannot run: a required input port has an error");
    }

    if (!pinned && node.data?.disabled) {
      const incomingItems = context.inputItems;
      const passthrough =
        incomingItems.length > 0
          ? incomingItems
          : deriveItems(
              Object.values(buildIncomingSnapshot(graph, node.id, context))[0]
            );
      result = {
        output:
          passthrough.length === 1
            ? passthrough[0]?.json ?? passthrough[0]
            : { items: passthrough },
        items: passthrough,
        resolved: { disabled: true, passthrough: true },
      };
    } else if (pinned) {
      result = pinned;
      if (pinned.portOutputs) {
        applyPortOutputsToContext(node.id, pinned.portOutputs, context);
      }
    } else {
      const savedItems = context.inputItems;
      if (node.data?.executeOnce && savedItems.length > 1) {
        context.inputItems = savedItems.slice(0, 1);
      }
      try {
        result = await executeNode(node, context);
      } catch (err) {
        failure = err;
      }
      context.inputItems = savedItems;
    }

    if (failure) {
      results[node.id] = {
        nodeId: node.id,
        status: "failed",
        error: failure instanceof Error ? failure.message : String(failure),
        executionTimeMs: Date.now() - nodeStart,
        cacheState: "dirty",
      };
      if (mode === "step" && node.id === targetNodeId) break;
      throw failure;
    }

    const output = result.output ?? null;
    let items;
    let portOutputs;
    if (nodeType === "switch" && result.outputsByPort) {
      const finalized = finalizeSwitchOutputs(node, context.inputItems, result);
      items = finalized.items;
      portOutputs = finalized.portOutputs;
      applyPortOutputsToContext(node.id, portOutputs, context);
    } else {
      items = finalizeNodeItems(node, context.inputItems, result, {
        portInputs: context.portInputs,
      });
      context.items[node.id] = items;
    }
    if (node.data?.alwaysOutputData && items.length === 0) {
      items = [{ json: {} }];
      result.output = attachCanonicalItemsToOutput(output, items);
      result.items = items;
    }
    context.steps[node.id] = output;

    const executionIndex = nextRunIndex(context.runData, node.id);
    recordOccurrence(context.runData, {
      nodeId: node.id,
      runIndex: executionIndex,
      status: "succeeded",
      items,
      output,
      portOutputs: portOutputs || null,
      inputSources: buildInputSources(graph, node.id, context.runData),
      completedAt: new Date().toISOString(),
    });
    applyLatestView(context);

    results[node.id] = {
      nodeId: node.id,
      status: "succeeded",
      output,
      items,
      portOutputs,
      executionIndex,
      occurrences: context.runData[node.id],
      executionTimeMs: Date.now() - nodeStart,
      cacheState: pinned ? "pinned" : "clean",
    };

    if (mode === "step" && node.id === targetNodeId) break;
  }

  return {
    targetNodeId,
    mode,
    results,
    input,
    durationMs: Date.now() - startMs,
    inputItems: collectIncomingItems(graph, targetNodeId, context),
    editorSession,
  };
};

const getNodeInputPreview = (
  definition,
  sessionOrResults,
  nodeId,
  runInput = {}
) => {
  const editorSession = normalizeEditorSession(sessionOrResults);
  reconcileSessionWithDefinition(editorSession, definition);
  const graph = buildGraph(definition);
  const context = { steps: {}, items: {} };

  for (const node of definition?.nodes || []) {
    const pinned = pinnedResult(node);
    if (!pinned) continue;
    if (pinned.output !== undefined) context.steps[node.id] = pinned.output;
    if (pinned.portOutputs) {
      applyPortOutputsToContext(node.id, pinned.portOutputs, context);
    } else if (Array.isArray(pinned.items)) {
      context.items[node.id] = pinned.items;
    }
  }

  const staleNodeIds = [];
  const nodeCacheStatus = {};

  for (const [id, cached] of Object.entries(editorSession.nodeResults || {})) {
    const node = graph.byId.get(id);
    const status = getNodeCacheStatus(editorSession, id, node, graph);
    nodeCacheStatus[id] = status;
    if (!isCacheUsableForExecution(status)) {
      if (status === "dirty" || status === "error") staleNodeIds.push(id);
      continue;
    }
    if (cached?.output !== undefined) context.steps[id] = cached.output;
    if (cached?.portOutputs) {
      applyPortOutputsToContext(id, cached.portOutputs, context);
    } else if (Array.isArray(cached?.items)) {
      context.items[id] = cached.items;
    }
  }

  for (const node of definition?.nodes || []) {
    if (nodeCacheStatus[node.id]) continue;
    const status = getNodeCacheStatus(editorSession, node.id, node, graph);
    nodeCacheStatus[node.id] = status;
  }

  const incoming = buildIncomingSnapshot(graph, nodeId, context);
  const node = graph.byId.get(nodeId);
  const portPreview = buildPortInputPreview(graph, nodeId, context);
  let items = collectIncomingItems(graph, nodeId, context);

  if (items.length === 0 && Object.keys(incoming).length > 0 && !portPreview) {
    for (const output of Object.values(incoming)) {
      items.push(...deriveItems(output));
    }
  }

  const upstreamEdges = graph.incoming.get(nodeId) || [];
  if (
    items.length === 0 &&
    upstreamEdges.length === 0 &&
    runInput &&
    typeof runInput === "object" &&
    Object.keys(runInput).length > 0
  ) {
    items = [{ triggered: true, kind: "manual", input: runInput }];
  }

  const upstreamIds = upstreamEdges.map((e) => e.source);
  const relevantStale = staleNodeIds.filter((id) => upstreamIds.includes(id));

  return {
    nodeId,
    incoming,
    items,
    portInputs: portPreview,
    stale: relevantStale.length > 0,
    staleNodeIds: relevantStale,
    nodeCacheStatus,
  };
};

/** Seed editor-session + pinned node data for read-only expression preview. */
const seedEditorExpressionData = (definition, sessionOrResults = {}) => {
  const editorSession = normalizeEditorSession(sessionOrResults);
  const graph = buildGraph(definition);
  const steps = {};
  const items = {};
  const pinnedNodeIds = new Set();
  const staleNodeIds = [];

  for (const node of definition?.nodes || []) {
    const pinned = pinnedResult(node);
    if (!pinned) continue;
    pinnedNodeIds.add(node.id);
    if (pinned.output !== undefined) steps[node.id] = pinned.output;
    if (Array.isArray(pinned.items)) items[node.id] = pinned.items;
  }

  for (const [id, cached] of Object.entries(editorSession.nodeResults)) {
    const node = graph.byId.get(id);
    const status = getNodeCacheStatus(editorSession, id, node, graph);
    if (!isCacheUsableForExecution(status)) {
      if (status === "dirty" || status === "error") staleNodeIds.push(id);
      continue;
    }
    if (cached?.output !== undefined) steps[id] = cached.output;
    if (Array.isArray(cached?.items)) items[id] = cached.items;
  }

  return { steps, items, pinnedNodeIds, staleNodeIds };
};

/**
 * Build resolver context for expression preview (never executes nodes).
 * Optional runIndex pins the current node's occurrence (Loop body iteration).
 */
const buildExpressionPreviewContext = (
  definition,
  sessionOrResults,
  nodeId,
  itemIndex = 0,
  runInput = {},
  runIndex = null
) => {
  const graph = buildGraph(definition);
  const editorSession = normalizeEditorSession(sessionOrResults);
  const { steps, items, pinnedNodeIds, staleNodeIds } = seedEditorExpressionData(
    definition,
    sessionOrResults
  );

  const runData = {};
  for (const [id, cached] of Object.entries(editorSession.nodeResults || {})) {
    if (Array.isArray(cached?.occurrences) && cached.occurrences.length > 0) {
      runData[id] = cached.occurrences;
    } else if (cached?.output !== undefined || Array.isArray(cached?.items)) {
      runData[id] = [
        {
          runIndex: cached.executionIndex ?? 0,
          status: cached.status || "succeeded",
          items: Array.isArray(cached.items) ? cached.items : [],
          output: cached.output ?? null,
          portOutputs: cached.portOutputs || null,
          inputSources: null,
        },
      ];
    }
  }

  let currentInputSources = null;
  let inputItems = [];
  const selectedRunIndex =
    runIndex != null && Number.isInteger(Number(runIndex))
      ? Number(runIndex)
      : null;

  if (selectedRunIndex != null && Array.isArray(runData[nodeId])) {
    const occ =
      runData[nodeId].find((o) => o.runIndex === selectedRunIndex) || null;
    if (occ) {
      currentInputSources = occ.inputSources || null;
      // Resolve input items from predecessor occurrences when possible
      if (occ.inputSources && typeof occ.inputSources === "object") {
        const collected = [];
        for (const src of Object.values(occ.inputSources)) {
          if (!src || src.mode === "perItem" || !src.nodeId) continue;
          const list = runData[src.nodeId];
          const srcOcc = Array.isArray(list)
            ? list.find((o) => o.runIndex === (src.runIndex ?? 0))
            : null;
          if (!srcOcc) continue;
          if (
            src.outputPort &&
            srcOcc.portOutputs &&
            Array.isArray(srcOcc.portOutputs[src.outputPort])
          ) {
            collected.push(...srcOcc.portOutputs[src.outputPort]);
          } else if (Array.isArray(srcOcc.items)) {
            collected.push(...srcOcc.items);
          }
        }
        if (collected.length > 0) inputItems = collected;
      }
      // Prefer this occurrence's own items as "current node output" pin for steps.* of self
      if (Array.isArray(occ.items)) {
        items[nodeId] = occ.items;
      }
      if (occ.output !== undefined) steps[nodeId] = occ.output;
    }
  }

  if (inputItems.length === 0) {
    const inputPreview = getNodeInputPreview(
      definition,
      sessionOrResults,
      nodeId,
      runInput
    );
    inputItems = inputPreview.items || [];
  }

  const safeIndex =
    Number.isInteger(itemIndex) && itemIndex >= 0 ? itemIndex : 0;
  const currentItem = inputItems[safeIndex] ?? null;

  return {
    context: {
      input: runInput || {},
      steps,
      items,
      graph,
      runData,
      currentNodeId: nodeId,
      currentRunIndex: selectedRunIndex,
      currentInputSources,
      currentItemIndex: safeIndex,
      inputItems,
      currentItem,
      item: currentItem,
    },
    itemIndex: safeIndex,
    pinnedNodeIds,
    staleNodeIds,
  };
};

/**
 * In-memory production-style graph execution (no DB). Used by Part 9B tests
 * and internal verification. Honors Loop runtime.
 */
const executeGraphInMemory = async (definition, options = {}) => {
  const input = options.input || {};
  const now = options.now instanceof Date ? options.now : new Date();
  const graph = buildGraph(definition);
  const loopCheck = validateLoopRuntime(graph);
  if (!loopCheck.ok) {
    const err = new Error(loopCheck.errors[0] || "Invalid Loop topology");
    if (loopCheck.code) err.code = loopCheck.code;
    throw err;
  }

  const context = {
    input,
    steps: {},
    items: {},
    portOutputs: {},
    runData: createRunData(),
    loopControllers: {},
    inputItems: [],
    runId: options.runId || null,
    workspaceId: null,
    workflowId: null,
    editorMode: false,
    useProductionPins: true,
    graph,
    now,
  };

  const scheduler = createScheduler(graph);
  scheduler.setReopenClearPort((nodeId) => {
    if (context.portOutputs) delete context.portOutputs[nodeId];
  });

  const runErrors = [];
  let finalOutput = null;
  const stepLog = [];

  for (;;) {
    const next = scheduler.next();
    if (!next) break;
    const { node, action } = next;

    if (action === "skip") {
      const skipIndex = nextRunIndex(context.runData, node.id);
      scheduler.skip(node);
      recordOccurrence(context.runData, {
        nodeId: node.id,
        runIndex: skipIndex,
        status: "skipped",
        items: [],
        output: null,
      });
      stepLog.push({ nodeId: node.id, action: "skip", runIndex: skipIndex });
      continue;
    }

    const nodeType = node.type || node.data?.nodeType || "unknown";
    const executionIndex = nextRunIndex(context.runData, node.id);
    const inputSources = buildInputSources(graph, node.id, context.runData);

    context.inputItems = collectIncomingItems(graph, node.id, context);
    prepareNodeExecutionInputs(graph, node.id, context, {
      edgeState: scheduler.edgeState,
    });
    context.currentNodeId = node.id;
    context.currentRunIndex = executionIndex;
    context.currentInputSources = inputSources;
    context.graph = graph;

    const policy = {
      retries: Number(node.data?.retryOnFail) > 0 ? Number(node.data?.maxTries || 1) - 1 : 0,
      retryDelayMs: 0,
      onError: node.data?.onError || "stop",
    };

    let result = null;
    let failure = null;
    let attempts = 0;
    for (let attempt = 1; attempt <= policy.retries + 1; attempt += 1) {
      attempts = attempt;
      try {
        result = await executeNode(node, context);
        failure = null;
        break;
      } catch (err) {
        failure = err;
      }
    }

    if (result?.suspend) {
      const err = new Error("Wait suspension is not supported in executeGraphInMemory");
      err.code = "WAIT_IN_MEMORY_UNSUPPORTED";
      throw err;
    }

    if (result?.invokeChild) {
      const err = new Error(
        "Execute Workflow requires a durable parent run and is not supported in-memory"
      );
      err.code = "EXECUTE_WORKFLOW_IN_MEMORY_UNSUPPORTED";
      throw err;
    }

    if (!failure) {
      let items;
      const occurrenceInputSources = result.inputSources || inputSources;
      if (nodeType === "loop" && result.portOutputs) {
        applyPortOutputsToContext(node.id, result.portOutputs, context);
        items = Array.isArray(result.items) ? result.items : [];
        result.output = attachCanonicalItemsToOutput(result.output ?? {}, items);
      } else if (nodeType === "switch" && result.outputsByPort) {
        const finalized = finalizeSwitchOutputs(node, context.inputItems, result);
        items = finalized.items;
        applyPortOutputsToContext(node.id, finalized.portOutputs, context);
      } else {
        items = finalizeNodeItems(node, context.inputItems, result, {
          portInputs: context.portInputs,
        });
        context.items[node.id] = items;
      }
      const output = result.output ?? null;
      context.steps[node.id] = output;
      recordOccurrence(context.runData, {
        nodeId: node.id,
        runIndex: executionIndex,
        status: "succeeded",
        items,
        output,
        portOutputs: context.portOutputs?.[node.id] || null,
        inputSources: occurrenceInputSources,
        completedAt: new Date().toISOString(),
        ...(result.loopMeta ? { executionContext: result.loopMeta } : {}),
      });
      applyLatestView(context);
      stepLog.push({
        nodeId: node.id,
        action: "run",
        runIndex: executionIndex,
        status: "succeeded",
        attempts,
        loopMeta: result.loopMeta || null,
      });
      if (result.terminal || nodeType === "result") finalOutput = output;
      scheduler.complete(node, result.nextHandle, {
        activeHandles: result.activeHandles,
        pendingHandles: result.pendingHandles,
      });
      continue;
    }

    const message = failure instanceof Error ? failure.message : String(failure);
    recordOccurrence(context.runData, {
      nodeId: node.id,
      runIndex: executionIndex,
      status: "failed",
      items: [{ json: { error: message } }],
      output: { error: message },
      inputSources,
      error: message,
    });
    applyLatestView(context);
    stepLog.push({
      nodeId: node.id,
      action: "run",
      runIndex: executionIndex,
      status: "failed",
      error: message,
    });
    if (policy.onError === "stop") throw failure;
    runErrors.push({ nodeId: node.id, error: message });
    scheduler.complete(node, policy.onError === "route" ? "error" : null);
  }

  return {
    status: runErrors.length ? "succeeded_with_errors" : "succeeded",
    context,
    runData: context.runData,
    loopControllers: context.loopControllers,
    finalOutput,
    runErrors,
    stepLog,
  };
};

module.exports = {
  executeRun,
  executePartial,
  executeGraphInMemory,
  getNodeInputPreview,
  buildExpressionPreviewContext,
  buildGraph,
  findStartNodes,
  findBackEdges,
  createScheduler,
  finalizeNodeItems,
  finalizeSwitchOutputs,
  validateControlledCycles: (definitionOrGraph) => {
    const graph =
      definitionOrGraph?.byId != null
        ? definitionOrGraph
        : buildGraph(definitionOrGraph);
    return validateLoopTopology(graph);
  },
  validateLoopForExecution: (definitionOrGraph) => {
    const graph =
      definitionOrGraph?.byId != null
        ? definitionOrGraph
        : buildGraph(definitionOrGraph);
    return validateLoopRuntime(graph);
  },
  assertLoopRuntimeNotEnabled: (definitionOrGraph) => {
    const graph =
      definitionOrGraph?.byId != null
        ? definitionOrGraph
        : buildGraph(definitionOrGraph);
    return assertNoLoopRuntime(graph);
  },
};
