/**
 * Part 9B — Loop Over Items runtime controller.
 * Finite batching via sanctioned Loop.continue back-edge.
 * Does NOT support nested Loop, Wait-in-body, or editor partial execution.
 */

const {
  LOOP_PORTS,
  isLoopNode,
  isLoopBackEdge,
  analyzeLoopRegion,
  validateControlledCycles,
  projectForwardDag,
} = require("./workflowLoopGraph.service");
const { cloneItem } = require("./workflowProvenance.service");

const WAIT_IN_LOOP_NOT_SUPPORTED = "WAIT_IN_LOOP_NOT_SUPPORTED";
const LOOP_STATE_ERROR = "LOOP_STATE_ERROR";
const INVALID_BATCH_SIZE = "INVALID_BATCH_SIZE";

const LOOP_STATUS = Object.freeze({
  ACTIVE: "active",
  COMPLETED: "completed",
});

const nodeTypeOf = (node) => node?.type || node?.data?.nodeType || "unknown";

const parseBatchSize = (raw) => {
  if (raw == null || raw === "") return 1;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1 || !Number.isFinite(n)) {
    const err = new Error(
      `Loop batchSize must be an integer >= 1 (got ${JSON.stringify(raw)})`
    );
    err.code = INVALID_BATCH_SIZE;
    throw err;
  }
  return n;
};

const expectedIterationsFor = (totalItems, batchSize) => {
  if (totalItems <= 0) return 0;
  return Math.ceil(totalItems / batchSize);
};

const createLoopController = ({
  loopNodeId,
  batchSize,
  initialItems,
  initialInputSource,
}) => {
  const frozen = (initialItems || []).map((item) => cloneItem(item));
  const totalInputItems = frozen.length;
  const expectedIterations = expectedIterationsFor(totalInputItems, batchSize);
  return {
    loopNodeId,
    batchSize,
    initialItems: frozen,
    initialInputSource: initialInputSource || null,
    cursor: 0,
    iterationIndex: 0,
    totalInputItems,
    expectedIterations,
    collectedItems: [],
    collectedItemSources: [],
    status: LOOP_STATUS.ACTIVE,
    doneEmitted: false,
  };
};

const getLoopController = (context, loopNodeId) =>
  context?.loopControllers?.[loopNodeId] || null;

const setLoopController = (context, controller) => {
  if (!context.loopControllers) context.loopControllers = {};
  context.loopControllers[controller.loopNodeId] = controller;
  return controller;
};

const serializeLoopControllers = (controllers) => {
  if (!controllers || typeof controllers !== "object") return {};
  const out = {};
  for (const [id, c] of Object.entries(controllers)) {
    out[id] = {
      ...c,
      initialItems: Array.isArray(c.initialItems)
        ? c.initialItems.map((item) => cloneItem(item))
        : [],
      collectedItems: Array.isArray(c.collectedItems)
        ? c.collectedItems.map((item) => cloneItem(item))
        : [],
      collectedItemSources: Array.isArray(c.collectedItemSources)
        ? c.collectedItemSources.map((s) => ({ ...s }))
        : [],
      initialInputSource: c.initialInputSource
        ? { ...c.initialInputSource }
        : null,
    };
  }
  return out;
};

const restoreLoopControllers = (raw) => serializeLoopControllers(raw || {});

const getLoopPortItems = (graph, loopNodeId, portId, context) => {
  const edges = graph?.incoming?.get(loopNodeId) || [];
  const edge = edges.find((e) => String(e.targetHandle || "") === portId);
  if (!edge) return [];
  const portOutputs = context.portOutputs?.[edge.source];
  if (portOutputs && edge.sourceHandle) {
    const list = portOutputs[String(edge.sourceHandle)];
    if (Array.isArray(list)) return list.map((item) => cloneItem(item));
  }
  const upstream = context.items?.[edge.source];
  if (!Array.isArray(upstream)) return [];
  return upstream.map((item) => cloneItem(item));
};

const getLoopPortSource = (graph, loopNodeId, portId, runData) => {
  const edges = graph?.incoming?.get(loopNodeId) || [];
  const edge = edges.find((e) => String(e.targetHandle || "") === portId);
  if (!edge) return null;
  const list = runData?.[edge.source];
  const latest =
    Array.isArray(list) && list.length > 0 ? list[list.length - 1] : null;
  return {
    nodeId: edge.source,
    runIndex: latest?.runIndex ?? 0,
    outputPort: String(edge.sourceHandle || "main"),
  };
};

const buildBatchItems = (controller) => {
  const { initialItems, cursor, batchSize } = controller;
  const slice = initialItems.slice(cursor, cursor + batchSize);
  return slice.map((item, i) => {
    const cloned = cloneItem(item);
    cloned.pairedItem = { item: cursor + i };
    return cloned;
  });
};

const accumulateContinueItems = (controller, continueItems, continueSource) => {
  const items = Array.isArray(continueItems) ? continueItems : [];
  for (let i = 0; i < items.length; i += 1) {
    controller.collectedItems.push(cloneItem(items[i]));
    controller.collectedItemSources.push({
      nodeId: continueSource?.nodeId || null,
      runIndex: continueSource?.runIndex ?? 0,
      outputPort: continueSource?.outputPort || "main",
      itemIndex: i,
    });
  }
};

const buildDoneItems = (controller) =>
  controller.collectedItems.map((item, i) => {
    const cloned = cloneItem(item);
    cloned.pairedItem = { item: i };
    return cloned;
  });

const buildPerItemContinueSources = (controller) => ({
  mode: "perItem",
  items: controller.collectedItemSources.map((s) => ({ ...s })),
});

const resolvePerItemEntry = (runData, entry) => {
  if (!entry?.nodeId) return null;
  const list = runData?.[entry.nodeId];
  if (!Array.isArray(list)) return null;
  const occ = list.find((o) => o.runIndex === entry.runIndex);
  if (!occ || !Array.isArray(occ.items)) return null;
  const idx = entry.itemIndex != null ? entry.itemIndex : 0;
  return occ.items[idx] ?? null;
};

const validateLoopForExecution = (graph) => {
  const base = validateControlledCycles(graph);
  const errors = [...(base.errors || [])];

  for (const region of base.loopRegions || []) {
    if (!region.ok) continue;
    const loopId = region.loopNodeId;

    if (!region.continueEdges || region.continueEdges.length === 0) {
      errors.push(
        `Loop ${loopId}: continue back-edge is required for execution`
      );
    }
    if (!region.batchEdges || region.batchEdges.length === 0) {
      errors.push(
        `Loop ${loopId}: at least one batch output edge is required for execution`
      );
    }

    for (const bodyId of region.bodyNodes || []) {
      const bodyNode = graph.byId.get(bodyId);
      const type = nodeTypeOf(bodyNode);
      if (type === "wait") {
        errors.push(
          `Wait inside Loop is not supported (node ${bodyId} in Loop ${loopId})`
        );
      }
      for (const edge of graph.outgoing.get(bodyId) || []) {
        if (edge.target === loopId) continue;
        if (region.bodyNodes.has(edge.target)) continue;
        errors.push(
          `Loop ${loopId}: body side exit from ${bodyId} to ${edge.target} is not allowed (use Loop.done)`
        );
      }
    }

    // Every body node must converge to the continue source (no dangling side branches).
    if (region.continueEdges?.[0]) {
      const continueSource = region.continueEdges[0].source;
      const canReachContinue = (startId) => {
        if (startId === continueSource) return true;
        const seen = new Set();
        const stack = [startId];
        while (stack.length > 0) {
          const id = stack.pop();
          if (seen.has(id)) continue;
          seen.add(id);
          if (id === continueSource) return true;
          for (const edge of graph.outgoing.get(id) || []) {
            if (edge.target === loopId) continue;
            if (!region.bodyNodes.has(edge.target) && edge.target !== continueSource) {
              continue;
            }
            stack.push(edge.target);
          }
        }
        return false;
      };
      for (const bodyId of region.bodyNodes || []) {
        if (!canReachContinue(bodyId)) {
          errors.push(
            `Loop ${loopId}: body side exit / dangling node ${bodyId} does not converge to continue`
          );
        }
      }
    }

    const loopNode = graph.byId.get(loopId);
    try {
      parseBatchSize(
        loopNode?.data?.batchSize ?? loopNode?.data?.parameters?.batchSize
      );
    } catch (err) {
      errors.push(err.message);
    }
  }

  const owned = new Map();
  for (const region of base.loopRegions || []) {
    if (!region.ok) continue;
    for (const bodyId of region.bodyNodes || []) {
      if (owned.has(bodyId) && owned.get(bodyId) !== region.loopNodeId) {
        errors.push(
          `Parallel Loop body overlap is not supported (${bodyId} in multiple Loops)`
        );
      }
      owned.set(bodyId, region.loopNodeId);
    }
  }

  const waitInLoop = errors.some((e) =>
    String(e).includes("Wait inside Loop")
  );

  return {
    ok: errors.length === 0,
    errors,
    loopRegions: base.loopRegions,
    loopBackEdges: base.loopBackEdges,
    forwardDag: base.forwardDag || projectForwardDag(graph),
    code: waitInLoop ? WAIT_IN_LOOP_NOT_SUPPORTED : undefined,
  };
};

const executeLoopOccurrence = ({ node, graph, context, runData }) => {
  const loopNodeId = node.id;
  const batchSize = parseBatchSize(
    node.data?.batchSize ?? node.data?.parameters?.batchSize
  );

  let controller = getLoopController(context, loopNodeId);

  if (controller?.doneEmitted || controller?.status === LOOP_STATUS.COMPLETED) {
    const err = new Error(
      `Loop ${loopNodeId}: duplicate activation after completion`
    );
    err.code = LOOP_STATE_ERROR;
    throw err;
  }

  if (!controller) {
    const initialItems = getLoopPortItems(
      graph,
      loopNodeId,
      LOOP_PORTS.ITEMS,
      context
    );
    const initialInputSource = getLoopPortSource(
      graph,
      loopNodeId,
      LOOP_PORTS.ITEMS,
      runData
    );
    controller = createLoopController({
      loopNodeId,
      batchSize,
      initialItems,
      initialInputSource,
    });
    setLoopController(context, controller);

    if (controller.totalInputItems === 0) {
      controller.status = LOOP_STATUS.COMPLETED;
      controller.doneEmitted = true;
      return {
        items: [],
        output: {
          loop: true,
          done: true,
          totalInputItems: 0,
          iterations: 0,
          itemCount: 0,
        },
        portOutputs: {
          [LOOP_PORTS.BATCH]: [],
          [LOOP_PORTS.DONE]: [],
        },
        activeHandles: [LOOP_PORTS.DONE],
        pendingHandles: [LOOP_PORTS.BATCH],
        nextHandle: LOOP_PORTS.DONE,
        loopMeta: { loopNodeId, iterationIndex: 0, phase: "done" },
        inputSources: {
          [LOOP_PORTS.ITEMS]: initialInputSource,
          [LOOP_PORTS.CONTINUE]: { mode: "perItem", items: [] },
        },
      };
    }

    const batchItems = buildBatchItems(controller);
    const batchStart = controller.cursor;
    const batchEnd = controller.cursor + batchItems.length;
    controller.cursor = batchEnd;
    const iterationIndex = controller.iterationIndex;
    controller.iterationIndex += 1;

    if (controller.iterationIndex > controller.expectedIterations) {
      const err = new Error(
        `Loop ${loopNodeId}: exceeded expected ${controller.expectedIterations} iterations`
      );
      err.code = LOOP_STATE_ERROR;
      throw err;
    }

    return {
      items: batchItems,
      output: {
        loop: true,
        batch: true,
        iterationIndex,
        batchStart,
        batchEnd,
        batchSize: batchItems.length,
        totalInputItems: controller.totalInputItems,
      },
      portOutputs: {
        [LOOP_PORTS.BATCH]: batchItems,
        [LOOP_PORTS.DONE]: [],
      },
      activeHandles: [LOOP_PORTS.BATCH],
      pendingHandles: [LOOP_PORTS.DONE],
      nextHandle: LOOP_PORTS.BATCH,
      loopMeta: {
        loopNodeId,
        iterationIndex,
        phase: "batch",
        batchStart,
        batchEnd,
      },
      inputSources: {
        [LOOP_PORTS.ITEMS]: controller.initialInputSource,
      },
    };
  }

  const continueItems = getLoopPortItems(
    graph,
    loopNodeId,
    LOOP_PORTS.CONTINUE,
    context
  );
  const continueSource = getLoopPortSource(
    graph,
    loopNodeId,
    LOOP_PORTS.CONTINUE,
    runData
  );
  accumulateContinueItems(controller, continueItems, continueSource);

  const remaining = controller.totalInputItems - controller.cursor;
  if (remaining > 0) {
    if (controller.iterationIndex >= controller.expectedIterations) {
      const err = new Error(
        `Loop ${loopNodeId}: attempted batch beyond expected ${controller.expectedIterations} iterations`
      );
      err.code = LOOP_STATE_ERROR;
      throw err;
    }

    const batchItems = buildBatchItems(controller);
    const batchStart = controller.cursor;
    const batchEnd = controller.cursor + batchItems.length;
    controller.cursor = batchEnd;
    const iterationIndex = controller.iterationIndex;
    controller.iterationIndex += 1;

    return {
      items: batchItems,
      output: {
        loop: true,
        batch: true,
        iterationIndex,
        batchStart,
        batchEnd,
        batchSize: batchItems.length,
        totalInputItems: controller.totalInputItems,
      },
      portOutputs: {
        [LOOP_PORTS.BATCH]: batchItems,
        [LOOP_PORTS.DONE]: [],
      },
      activeHandles: [LOOP_PORTS.BATCH],
      pendingHandles: [LOOP_PORTS.DONE],
      nextHandle: LOOP_PORTS.BATCH,
      loopMeta: {
        loopNodeId,
        iterationIndex,
        phase: "batch",
        batchStart,
        batchEnd,
      },
      inputSources: {
        [LOOP_PORTS.ITEMS]: controller.initialInputSource,
        [LOOP_PORTS.CONTINUE]: continueSource,
      },
    };
  }

  if (controller.doneEmitted) {
    const err = new Error(`Loop ${loopNodeId}: done already emitted`);
    err.code = LOOP_STATE_ERROR;
    throw err;
  }
  controller.doneEmitted = true;
  controller.status = LOOP_STATUS.COMPLETED;
  const doneItems = buildDoneItems(controller);

  return {
    items: doneItems,
    output: {
      loop: true,
      done: true,
      totalInputItems: controller.totalInputItems,
      iterations: controller.expectedIterations,
      itemCount: doneItems.length,
    },
    portOutputs: {
      [LOOP_PORTS.BATCH]: [],
      [LOOP_PORTS.DONE]: doneItems,
    },
    activeHandles: [LOOP_PORTS.DONE],
    pendingHandles: [LOOP_PORTS.BATCH],
    nextHandle: LOOP_PORTS.DONE,
    loopMeta: {
      loopNodeId,
      iterationIndex: controller.iterationIndex,
      phase: "done",
    },
    inputSources: {
      [LOOP_PORTS.ITEMS]: controller.initialInputSource,
      [LOOP_PORTS.CONTINUE]: buildPerItemContinueSources(controller),
    },
  };
};

const loopReopenNodeIds = (graph, backEdge) => {
  const target = graph.byId.get(backEdge.target);
  if (!isLoopNode(target) || !isLoopBackEdge(graph, backEdge)) {
    return null;
  }
  const region = analyzeLoopRegion(graph, target.id);
  if (!region.ok) return null;
  return new Set([target.id, ...region.bodyNodes]);
};

module.exports = {
  WAIT_IN_LOOP_NOT_SUPPORTED,
  LOOP_STATE_ERROR,
  INVALID_BATCH_SIZE,
  LOOP_STATUS,
  LOOP_PORTS,
  parseBatchSize,
  expectedIterationsFor,
  createLoopController,
  getLoopController,
  setLoopController,
  serializeLoopControllers,
  restoreLoopControllers,
  getLoopPortItems,
  getLoopPortSource,
  buildBatchItems,
  accumulateContinueItems,
  buildDoneItems,
  buildPerItemContinueSources,
  resolvePerItemEntry,
  validateLoopForExecution,
  executeLoopOccurrence,
  loopReopenNodeIds,
  isLoopNode,
  isLoopBackEdge,
};
