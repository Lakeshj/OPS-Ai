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
  return type === "trigger" || type === "schedule" || type === "webhook";
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
const createScheduler = (graph) => {
  const startIds = new Set(findStartNodes(graph).map((n) => n.id));
  const backEdges = findBackEdges(graph);
  const edgeState = new Map();
  const nodeState = new Map();
  const loopCounts = new Map();

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

  const settleOutgoing = (node, nextHandle, skipAll = false, activeHandles = null) => {
    const outgoing = graph.outgoing.get(node.id) || [];
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
      edgeState.set(key, activeKeys.has(key) ? "active" : "skipped");
    }
    return outgoing.filter(
      (e) => backEdges.has(edgeKey(e)) && edgeState.get(edgeKey(e)) === "active"
    );
  };

  /** A live back edge re-opens its cycle so the nodes inside can run again. */
  const reopenCycle = (backEdge) => {
    const key = edgeKey(backEdge);
    const count = (loopCounts.get(key) || 0) + 1;
    loopCounts.set(key, count);
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

  return {
    backEdges,
    edgeState,
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
      for (const back of settleOutgoing(node, nextHandle, false, activeHandles))
        reopenCycle(back);
    },
    skip(node) {
      nodeState.set(node.id, "skipped");
      settleOutgoing(node, null, true);
    },
    stateOf: (nodeId) => nodeState.get(nodeId) || null,
  };
};

const executeRun = async (runId) => {
  const [runRows] = await pool.execute(
    `SELECT r.*, w.definition_json, w.workspace_id, w.id AS workflow_id
     FROM workflow_runs r
     INNER JOIN workflows w ON w.id = r.workflow_id
     WHERE r.id = ?`,
    [runId]
  );
  if (runRows.length === 0) {
    throw new Error(`Run not found: ${runId}`);
  }

  const run = runRows[0];
  const definition = parseJson(run.definition_json, { version: 1, nodes: [], edges: [] });
  const input = parseJson(run.input_json, {});
  const graph = buildGraph(definition);
  const isProductionRun =
    input?.source === "schedule" || input?.source === "webhook";

  await pool.execute(
    `UPDATE workflow_runs
     SET status = 'running', started_at = COALESCE(started_at, CURRENT_TIMESTAMP), error = NULL
     WHERE id = ?`,
    [runId]
  );

  const context = {
    input,
    steps: {},
    items: {},
    inputItems: [],
    runId,
    workspaceId: run.workspace_id,
    workflowId: run.workflow_id,
  };

  const scheduler = createScheduler(graph);
  const runErrors = [];
  let finalOutput = null;

  try {
    for (;;) {
      const next = scheduler.next();
      if (!next) break;
      const { node, action } = next;

      if (action === "skip") {
        scheduler.skip(node);
        await pool.execute(
          `INSERT INTO workflow_run_steps
            (id, run_id, node_id, node_type, status, started_at, finished_at)
           VALUES (?, ?, ?, ?, 'skipped', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            uuidv4(),
            runId,
            node.id,
            node.type || node.data?.nodeType || "unknown",
          ]
        );
        continue;
      }

      {
        const nodeType = node.type || node.data?.nodeType || "unknown";
        const stepId = uuidv4();
        const stepInput = {
          nodeType,
          nodeData: compactValue(node.data || {}),
          contextInput: compactValue(context.input),
          incoming: buildIncomingSnapshot(graph, node.id, context),
        };

        await pool.execute(
          `INSERT INTO workflow_run_steps
            (id, run_id, node_id, node_type, status, input_json, started_at)
           VALUES (?, ?, ?, ?, 'running', ?, CURRENT_TIMESTAMP)`,
          [stepId, runId, node.id, nodeType, JSON.stringify(stepInput)]
        );

        context.inputItems = collectIncomingItems(graph, node.id, context);
        prepareNodeExecutionInputs(graph, node.id, context, {
          edgeState: scheduler.edgeState,
        });
        context.currentNodeId = node.id;
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

        // Disabled nodes passthrough input unchanged (output 0 only).
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

        if (!failure) {
          let items;
          if (nodeType === "switch" && result.outputsByPort) {
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
          context.steps[node.id] = output;

          await updateStep(stepId, {
            status: "succeeded",
            attempts,
            input_json: JSON.stringify({
              ...stepInput,
              itemsIn: context.inputItems.length,
              resolved: compactValue(result.resolved ?? null),
            }),
            output_json: JSON.stringify(output),
            finished_at: new Date(),
          });

          if (result.terminal || nodeType === "result") {
            finalOutput = output;
          }

          scheduler.complete(node, result.nextHandle, {
            activeHandles: result.activeHandles,
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

        if (policy.onError === "stop") throw failure;

        // continue / route: expose the failure downstream instead of aborting.
        const errorOutput = { error: message, failed: true, nodeId: node.id };
        context.steps[node.id] = errorOutput;
        context.items[node.id] = [errorOutput];
        runErrors.push({ nodeId: node.id, error: message });

        scheduler.complete(node, policy.onError === "route" ? "error" : null);
      }
    }

    // Nodes set to continue/route on failure keep the run alive, but the
    // failures are still surfaced rather than silently swallowed.
    const warning =
      runErrors.length > 0
        ? runErrors.map((e) => `${e.nodeId}: ${e.error}`).join("\n")
        : null;

    await pool.execute(
      `UPDATE workflow_runs
       SET status = 'succeeded',
           output_json = ?,
           finished_at = CURRENT_TIMESTAMP,
           error = ?
       WHERE id = ?`,
      [
        JSON.stringify(
          finalOutput ?? {
            steps: Object.fromEntries(
              Object.entries(context.steps).map(([id, value]) => [id, value])
            ),
          }
        ),
        warning,
        runId,
      ]
    );

    return {
      status: "succeeded",
      output: finalOutput ?? { steps: { ...context.steps } },
      warning,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await pool.execute(
      `UPDATE workflow_runs
       SET status = 'failed', error = ?, finished_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [message, runId]
    );
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
  const target = graph.byId.get(targetNodeId);
  if (!target) throw new Error(`Node not found: ${targetNodeId}`);

  const ancestors = new Set();
  const stack = [...(graph.incoming.get(targetNodeId) || []).map((e) => e.source)];
  while (stack.length > 0) {
    const id = stack.pop();
    if (ancestors.has(id)) continue;
    ancestors.add(id);
    for (const e of graph.incoming.get(id) || []) stack.push(e.source);
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

    results[node.id] = {
      nodeId: node.id,
      status: "succeeded",
      output,
      items,
      portOutputs,
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
 */
const buildExpressionPreviewContext = (
  definition,
  sessionOrResults,
  nodeId,
  itemIndex = 0,
  runInput = {}
) => {
  const graph = buildGraph(definition);
  const { steps, items, pinnedNodeIds, staleNodeIds } = seedEditorExpressionData(
    definition,
    sessionOrResults
  );
  const inputPreview = getNodeInputPreview(
    definition,
    sessionOrResults,
    nodeId,
    runInput
  );
  const safeIndex =
    Number.isInteger(itemIndex) && itemIndex >= 0 ? itemIndex : 0;
  const currentItem = inputPreview.items[safeIndex] ?? null;

  return {
    context: {
      input: runInput || {},
      steps,
      items,
      graph,
      currentNodeId: nodeId,
      currentItemIndex: safeIndex,
      inputItems: inputPreview.items,
      currentItem,
      item: currentItem,
    },
    itemIndex: safeIndex,
    pinnedNodeIds,
    staleNodeIds,
  };
};

module.exports = {
  executeRun,
  executePartial,
  getNodeInputPreview,
  buildExpressionPreviewContext,
  buildGraph,
  findStartNodes,
  findBackEdges,
  createScheduler,
  finalizeNodeItems,
};
