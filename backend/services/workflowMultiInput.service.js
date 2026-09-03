/**
 * Multi-input port collection for blocking nodes (Merge V1).
 * Keeps per-port streams distinct until the node handler combines them.
 */

const { getEngineContract } = require("../config/nodeContract");
const { cloneItem } = require("./workflowProvenance.service");

/** Merge main input port ids from nodeContract (input1, input2). */
const MERGE_PORT_IDS = ["input1", "input2"];

const PORT_STATES = {
  PENDING: "pending",
  ARRIVED_WITH_DATA: "arrived_with_data",
  ARRIVED_EMPTY: "arrived_empty",
  SKIPPED: "skipped",
  ERROR: "error",
};

const nodeTypeOf = (node) => node?.type || node?.data?.nodeType || "noop";

const isMultiInputNode = (node) => {
  const type = nodeTypeOf(node);
  // Loop uses semantic ports items/continue — not Merge input1/input2.
  if (type === "loop") return false;
  const contract = getEngineContract(type);
  return Number(contract.mergeInputs) > 1;
};

/** pairedItem.input index (0-based) for a contract port id. */
const portIdToInputIndex = (portId) => {
  const match = /^input(\d+)$/.exec(String(portId || ""));
  if (!match) return -1;
  return Math.max(0, Number(match[1]) - 1);
};

const inputIndexToPortId = (index) => `input${index + 1}`;

const stableEdgeSort = (a, b) => {
  const idA = String(a.id || `${a.source}->${a.target}`);
  const idB = String(b.id || `${b.source}->${b.target}`);
  return idA.localeCompare(idB);
};

/**
 * Assign legacy merge edges (no targetHandle) to input1/input2 by stable edge id.
 * Returns a copy of edges with targetHandle filled when missing.
 */
const normalizeMergeIncomingEdges = (graph, nodeId) => {
  const node = graph.byId.get(nodeId);
  if (!node || nodeTypeOf(node) !== "merge") {
    return (graph.incoming.get(nodeId) || []).map((e) => ({ ...e }));
  }

  const edges = [...(graph.incoming.get(nodeId) || [])].map((e) => ({ ...e }));
  const legacy = edges
    .filter((e) => !e.targetHandle)
    .sort(stableEdgeSort);

  if (legacy.length === 0) return edges;

  const usedPorts = new Set(
    edges.filter((e) => e.targetHandle).map((e) => e.targetHandle)
  );

  let portIdx = 0;
  for (const edge of legacy) {
    while (
      portIdx < MERGE_PORT_IDS.length &&
      usedPorts.has(MERGE_PORT_IDS[portIdx])
    ) {
      portIdx += 1;
    }
    if (portIdx >= MERGE_PORT_IDS.length) break;
    edge.targetHandle = MERGE_PORT_IDS[portIdx];
    edge._legacyNormalized = true;
    usedPorts.add(MERGE_PORT_IDS[portIdx]);
    portIdx += 1;
  }

  return edges;
};

/**
 * Validation issues for merge wiring (runtime, no DB migration).
 */
const validateMergeWiring = (graph, nodeId) => {
  const issues = [];
  const edges = normalizeMergeIncomingEdges(graph, nodeId);
  const byPort = new Map();

  for (const edge of edges) {
    const port = edge.targetHandle || "__default__";
    if (!byPort.has(port)) byPort.set(port, []);
    byPort.get(port).push(edge);
  }

  for (const [port, portEdges] of byPort.entries()) {
    if (port === "__default__") continue;
    if (portEdges.length > 1) {
      issues.push(
        `Merge port ${port} has ${portEdges.length} connections (max 1)`
      );
    }
    if (!MERGE_PORT_IDS.includes(port)) {
      issues.push(`Merge has unknown target port: ${port}`);
    }
  }

  const unassigned = edges.filter((e) => !e.targetHandle);
  if (unassigned.length > 0) {
    issues.push(
      `Merge has ${unassigned.length} incoming edge(s) without a target port`
    );
  }

  const legacyOverflow =
    edges.filter((e) => !e.targetHandle).length +
    edges.filter((e) => e.targetHandle && !MERGE_PORT_IDS.includes(e.targetHandle))
      .length;
  if (legacyOverflow > MERGE_PORT_IDS.length) {
    issues.push(`Merge has more incoming edges than supported input ports`);
  }

  return issues;
};

const getIncomingEdgeForPort = (graph, nodeId, portId) => {
  const edges = normalizeMergeIncomingEdges(graph, nodeId);
  return edges.find((e) => (e.targetHandle || null) === portId) || null;
};

const getIncomingEdgeForInputIndex = (graph, nodeId, inputIndex) => {
  const portId = inputIndexToPortId(inputIndex);
  return getIncomingEdgeForPort(graph, nodeId, portId);
};

/**
 * Connected merge ports that must settle before execution.
 * Only ports with an incoming edge are required.
 */
const getRequiredMergePorts = (graph, nodeId) => {
  const edges = normalizeMergeIncomingEdges(graph, nodeId);
  const ports = new Set();
  for (const edge of edges) {
    if (edge.targetHandle) ports.add(edge.targetHandle);
  }
  return [...ports].sort();
};

const edgeKey = (edge) =>
  edge.id || `${edge.source}->${edge.target}#${edge.sourceHandle || ""}`;

/**
 * Map scheduler edge state to port input state.
 * edgeState values: "active" | "skipped" (from createScheduler)
 */
const resolvePortStateFromEdge = ({
  edge,
  edgeState,
  context,
  upstreamStatus,
}) => {
  const key = edgeKey(edge);
  const settled = edgeState?.get?.(key) ?? edgeState?.[key];

  if (settled === undefined || settled === null) {
    const upstreamItems = context.items?.[edge.source];
    if (upstreamItems !== undefined) {
      const items = Array.isArray(upstreamItems)
        ? upstreamItems.map((item) => cloneItem(item))
        : [];
      return {
        state:
          items.length > 0
            ? PORT_STATES.ARRIVED_WITH_DATA
            : PORT_STATES.ARRIVED_EMPTY,
        items,
      };
    }
    return { state: PORT_STATES.PENDING, items: [] };
  }

  if (settled === "skipped") {
    return { state: PORT_STATES.SKIPPED, items: [] };
  }

  if (upstreamStatus === "error" || upstreamStatus === "failed") {
    return { state: PORT_STATES.ERROR, items: [] };
  }

  const upstreamItems = context.items?.[edge.source];
  if (!Array.isArray(upstreamItems)) {
    return { state: PORT_STATES.ARRIVED_EMPTY, items: [] };
  }

  const items = upstreamItems.map((item) => cloneItem(item));
  return {
    state:
      items.length > 0 ? PORT_STATES.ARRIVED_WITH_DATA : PORT_STATES.ARRIVED_EMPTY,
    items,
  };
};

/**
 * Build per-port input buffer for a multi-input node.
 */
const collectPortInputs = (graph, nodeId, context, options = {}) => {
  const node = graph.byId.get(nodeId);
  if (!node || !isMultiInputNode(node)) return null;

  const edgeState = options.edgeState || null;
  const upstreamStatuses = options.upstreamStatuses || {};
  const edges = normalizeMergeIncomingEdges(graph, nodeId);
  const ports = {};

  for (const portId of MERGE_PORT_IDS) {
    const edge = edges.find((e) => e.targetHandle === portId);
    if (!edge) continue;

    const upstreamStatus = upstreamStatuses[edge.source] || null;
    const resolved = resolvePortStateFromEdge({
      edge,
      edgeState,
      context,
      upstreamStatus,
    });

    ports[portId] = {
      portId,
      inputIndex: portIdToInputIndex(portId),
      state: resolved.state,
      sourceNodeId: edge.source,
      sourcePort: edge.sourceHandle || "default",
      items: resolved.items,
      edgeId: edge.id || edgeKey(edge),
    };
  }

  return ports;
};

/**
 * Flatten port inputs in port order for legacy callers (append ordering).
 */
const flattenPortItems = (portInputs) => {
  if (!portInputs) return [];
  const items = [];
  for (const portId of MERGE_PORT_IDS) {
    const port = portInputs[portId];
    if (!port || port.state === PORT_STATES.SKIPPED) continue;
    for (const item of port.items) items.push(cloneItem(item));
  }
  return items;
};

/**
 * Whether all required merge ports have settled (not pending).
 */
const areRequiredPortsSettled = (portInputs, requiredPorts) => {
  if (!requiredPorts || requiredPorts.length === 0) return true;
  for (const portId of requiredPorts) {
    const port = portInputs?.[portId];
    if (!port || port.state === PORT_STATES.PENDING) return false;
  }
  return true;
};

const hasPortError = (portInputs, requiredPorts) => {
  for (const portId of requiredPorts || []) {
    if (portInputs?.[portId]?.state === PORT_STATES.ERROR) return true;
  }
  return false;
};

/**
 * Prepare execution context inputs for any node.
 * Single-input nodes: inputItems only (unchanged).
 * Multi-input nodes: portInputs + flattened inputItems for compat.
 */
const prepareNodeExecutionInputs = (graph, nodeId, context, options = {}) => {
  const node = graph.byId.get(nodeId);
  if (!node) {
    context.inputItems = [];
    context.portInputs = null;
    return context;
  }

  if (!isMultiInputNode(node)) {
    const edges = graph.incoming.get(nodeId) || [];
    const items = [];
    for (const edge of edges) {
      const upstream = context.items?.[edge.source];
      if (Array.isArray(upstream)) {
        for (const item of upstream) items.push(cloneItem(item));
      }
    }
    context.inputItems = items;
    context.portInputs = null;
    return context;
  }

  const portInputs = collectPortInputs(graph, nodeId, context, options);
  context.portInputs = portInputs;
  context.inputItems = flattenPortItems(portInputs);
  return context;
};

/**
 * Port-aware incoming snapshot for inspector / preview.
 */
const buildPortInputPreview = (graph, nodeId, context, options = {}) => {
  const node = graph.byId.get(nodeId);
  if (!node || !isMultiInputNode(node)) return null;

  const portInputs = collectPortInputs(graph, nodeId, context, options);
  const preview = {};

  for (const portId of MERGE_PORT_IDS) {
    const port = portInputs?.[portId];
    if (!port) {
      preview[portId] = {
        portId,
        label: `Input ${portIdToInputIndex(portId) + 1}`,
        state: PORT_STATES.PENDING,
        items: [],
        sourceNodeId: null,
      };
      continue;
    }
    preview[portId] = {
      portId,
      label: `Input ${port.inputIndex + 1}`,
      state: port.state,
      items: port.items,
      sourceNodeId: port.sourceNodeId,
      sourcePort: port.sourcePort,
    };
  }

  return preview;
};

const normalizeMergeMode = (mode) => {
  const m = String(mode || "append");
  if (m === "combine") return "combine";
  if (m === "combineByPosition") return "combineByPosition";
  if (m === "combineByKey") return "combineByKey";
  return "append";
};

module.exports = {
  MERGE_PORT_IDS,
  PORT_STATES,
  portIdToInputIndex,
  inputIndexToPortId,
  isMultiInputNode,
  normalizeMergeIncomingEdges,
  validateMergeWiring,
  getIncomingEdgeForPort,
  getIncomingEdgeForInputIndex,
  getRequiredMergePorts,
  collectPortInputs,
  flattenPortItems,
  areRequiredPortsSettled,
  hasPortError,
  prepareNodeExecutionInputs,
  buildPortInputPreview,
  normalizeMergeMode,
  edgeKey,
};
