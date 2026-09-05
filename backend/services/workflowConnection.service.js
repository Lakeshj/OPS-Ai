/**
 * Part 12A — Typed auxiliary ports + connection-class foundation.
 *
 * Authoritative strategy: connectionKind is DERIVED from endpoint port
 * contracts (not persisted on edges). Legacy edges without typed handles
 * normalize to execution / workflow-items.
 *
 * Two graph projections:
 * - execution: WorkflowItem scheduling / provenance / expressions / tidy rank
 * - auxiliary: resource bindings + dirty invalidation only
 */

const CONNECTION_KIND = Object.freeze({
  EXECUTION: "execution",
  AUXILIARY: "auxiliary",
});

const DATA_TYPE = Object.freeze({
  WORKFLOW_ITEMS: "workflow-items",
  AI_MODEL: "ai-model",
  AI_TOOL: "ai-tool",
  AI_MEMORY: "ai-memory",
});

const DATA_TYPE_LABEL = Object.freeze({
  [DATA_TYPE.WORKFLOW_ITEMS]: "workflow data",
  [DATA_TYPE.AI_MODEL]: "AI model",
  [DATA_TYPE.AI_TOOL]: "AI tool",
  [DATA_TYPE.AI_MEMORY]: "AI memory",
});

/** Map legacy PortKind → connection semantics */
const KIND_TO_SEMANTICS = Object.freeze({
  main: {
    connectionKind: CONNECTION_KIND.EXECUTION,
    dataType: DATA_TYPE.WORKFLOW_ITEMS,
  },
  error: {
    connectionKind: CONNECTION_KIND.EXECUTION,
    dataType: DATA_TYPE.WORKFLOW_ITEMS,
  },
  true: {
    connectionKind: CONNECTION_KIND.EXECUTION,
    dataType: DATA_TYPE.WORKFLOW_ITEMS,
  },
  false: {
    connectionKind: CONNECTION_KIND.EXECUTION,
    dataType: DATA_TYPE.WORKFLOW_ITEMS,
  },
  fallback: {
    connectionKind: CONNECTION_KIND.EXECUTION,
    dataType: DATA_TYPE.WORKFLOW_ITEMS,
  },
  ai_languageModel: {
    connectionKind: CONNECTION_KIND.AUXILIARY,
    dataType: DATA_TYPE.AI_MODEL,
  },
  ai_tool: {
    connectionKind: CONNECTION_KIND.AUXILIARY,
    dataType: DATA_TYPE.AI_TOOL,
  },
  ai_memory: {
    connectionKind: CONNECTION_KIND.AUXILIARY,
    dataType: DATA_TYPE.AI_MEMORY,
  },
});

const mainIn = (id = "main", label = "Input", maxConnections = 1) => ({
  id,
  kind: "main",
  direction: "in",
  connectionKind: CONNECTION_KIND.EXECUTION,
  dataType: DATA_TYPE.WORKFLOW_ITEMS,
  maxConnections,
  label,
});

const mainOut = (id = "main", label = "Output") => ({
  id,
  kind: "main",
  direction: "out",
  connectionKind: CONNECTION_KIND.EXECUTION,
  dataType: DATA_TYPE.WORKFLOW_ITEMS,
  label,
});

const auxIn = (id, dataType, label, opts = {}) => ({
  id,
  kind:
    dataType === DATA_TYPE.AI_MODEL
      ? "ai_languageModel"
      : dataType === DATA_TYPE.AI_TOOL
        ? "ai_tool"
        : "ai_memory",
  direction: "in",
  connectionKind: CONNECTION_KIND.AUXILIARY,
  dataType,
  // undefined = unlimited (do not default to 1 — tools are multi-connect)
  maxConnections: Object.prototype.hasOwnProperty.call(opts, "maxConnections")
    ? opts.maxConnections
    : 1,
  required: Boolean(opts.required),
  label,
});

const auxOut = (id, dataType, label) => ({
  id,
  kind:
    dataType === DATA_TYPE.AI_MODEL
      ? "ai_languageModel"
      : dataType === DATA_TYPE.AI_TOOL
        ? "ai_tool"
        : "ai_memory",
  direction: "out",
  connectionKind: CONNECTION_KIND.AUXILIARY,
  dataType,
  label,
});

/**
 * Minimal port registry for engine + validation.
 * Keep aligned with frontend nodeContract.ts.
 * Test-only AI fixtures are Part 12A scaffolding (runtime disabled).
 */
const NODE_PORT_CONTRACTS = {
  trigger: { inputs: [], outputs: [mainOut()] },
  schedule: { inputs: [], outputs: [mainOut()] },
  webhook: { inputs: [], outputs: [mainOut()] },
  workflowTrigger: { inputs: [], outputs: [mainOut()] },
  errorTrigger: { inputs: [], outputs: [mainOut()] },
  set: { inputs: [mainIn()], outputs: [mainOut()] },
  splitOut: { inputs: [mainIn()], outputs: [mainOut()] },
  filter: { inputs: [mainIn()], outputs: [mainOut()] },
  limit: { inputs: [mainIn()], outputs: [mainOut()] },
  sort: { inputs: [mainIn()], outputs: [mainOut()] },
  removeDuplicates: { inputs: [mainIn()], outputs: [mainOut()] },
  aggregate: { inputs: [mainIn()], outputs: [mainOut()] },
  merge: {
    inputs: [
      mainIn("input1", "Input 1", 1),
      mainIn("input2", "Input 2", 1),
    ],
    outputs: [mainOut()],
  },
  switch: { inputs: [mainIn()], outputs: [mainOut()] },
  code: { inputs: [mainIn()], outputs: [mainOut()] },
  condition: {
    inputs: [mainIn()],
    outputs: [
      { ...mainOut("true", "True"), kind: "true" },
      { ...mainOut("false", "False"), kind: "false" },
    ],
  },
  document: { inputs: [mainIn()], outputs: [mainOut()] },
  spreadsheet: { inputs: [mainIn()], outputs: [mainOut()] },
  email: { inputs: [mainIn()], outputs: [mainOut()] },
  http: { inputs: [mainIn()], outputs: [mainOut()] },
  wait: { inputs: [mainIn()], outputs: [mainOut()] },
  executeWorkflow: { inputs: [mainIn()], outputs: [mainOut()] },
  loop: {
    inputs: [
      mainIn("items", "Items", 1),
      mainIn("continue", "Continue", 1),
    ],
    outputs: [
      mainOut("batch", "Batch"),
      mainOut("done", "Done"),
    ],
  },
  result: { inputs: [mainIn()], outputs: [] },
  noop: { inputs: [mainIn()], outputs: [mainOut()] },
  integration: { inputs: [mainIn()], outputs: [mainOut()] },
  ai: { inputs: [mainIn()], outputs: [mainOut()] },
  bot: {
    inputs: [
      mainIn(),
      auxIn("ai_languageModel", DATA_TYPE.AI_MODEL, "Chat Model", {
        maxConnections: 1,
        required: true,
      }),
      auxIn("ai_memory", DATA_TYPE.AI_MEMORY, "Memory", {
        maxConnections: 1,
        required: false,
      }),
      auxIn("ai_tool", DATA_TYPE.AI_TOOL, "Tool", {
        maxConnections: undefined,
        required: false,
      }),
    ],
    outputs: [mainOut()],
  },
  // Part 12A/12B test fixtures + production AI Agent
  aiModelProviderTest: {
    inputs: [],
    outputs: [auxOut("model", DATA_TYPE.AI_MODEL, "Model")],
    isAuxiliaryProvider: true,
  },
  aiToolProviderTest: {
    inputs: [],
    outputs: [auxOut("tool", DATA_TYPE.AI_TOOL, "Tool")],
    isAuxiliaryProvider: true,
  },
  aiMemoryProviderTest: {
    inputs: [],
    outputs: [auxOut("memory", DATA_TYPE.AI_MEMORY, "Memory")],
    isAuxiliaryProvider: true,
  },
  aiCalculatorTool: {
    inputs: [],
    outputs: [auxOut("tool", DATA_TYPE.AI_TOOL, "Tool")],
    isAuxiliaryProvider: true,
  },
  aiHttpTool: {
    inputs: [],
    outputs: [auxOut("tool", DATA_TYPE.AI_TOOL, "Tool")],
    isAuxiliaryProvider: true,
  },
  aiChatModel: {
    inputs: [],
    outputs: [auxOut("model", DATA_TYPE.AI_MODEL, "Model")],
    isAuxiliaryProvider: true,
  },
  aiAgentTest: {
    inputs: [
      mainIn(),
      auxIn("model", DATA_TYPE.AI_MODEL, "Chat Model", {
        maxConnections: 1,
        required: true,
      }),
      auxIn("tools", DATA_TYPE.AI_TOOL, "Tools", {
        maxConnections: undefined,
        required: false,
      }),
      auxIn("memory", DATA_TYPE.AI_MEMORY, "Memory", {
        maxConnections: 1,
        required: false,
      }),
    ],
    outputs: [mainOut()],
  },
  aiAgent: {
    inputs: [
      mainIn(),
      auxIn("model", DATA_TYPE.AI_MODEL, "Chat Model", {
        maxConnections: 1,
        required: true,
      }),
      auxIn("tools", DATA_TYPE.AI_TOOL, "Tools", {
        maxConnections: undefined,
        required: false,
      }),
      auxIn("memory", DATA_TYPE.AI_MEMORY, "Memory", {
        maxConnections: 1,
        required: false,
      }),
    ],
    outputs: [mainOut()],
  },
};

const nodeTypeOf = (node) =>
  (node && (node.type || node.data?.nodeType)) || "noop";

const getPortContract = (nodeType) =>
  NODE_PORT_CONTRACTS[nodeType] || NODE_PORT_CONTRACTS.noop;

const enrichPort = (port) => {
  if (!port) return null;
  if (port.connectionKind && port.dataType) return port;
  const mapped = KIND_TO_SEMANTICS[port.kind] || KIND_TO_SEMANTICS.main;
  return {
    ...port,
    connectionKind: port.connectionKind || mapped.connectionKind,
    dataType: port.dataType || mapped.dataType,
  };
};

const listInputPorts = (nodeType) =>
  (getPortContract(nodeType).inputs || []).map(enrichPort);

const listOutputPorts = (nodeType) =>
  (getPortContract(nodeType).outputs || []).map(enrichPort);

/** Synthetic execution port for Switch dynamic rule / fallback handles. */
const dynamicExecutionOut = (handleId) =>
  enrichPort({
    id: String(handleId),
    kind: "main",
    direction: "out",
    connectionKind: CONNECTION_KIND.EXECUTION,
    dataType: DATA_TYPE.WORKFLOW_ITEMS,
    label: String(handleId),
  });

const findInputPort = (nodeType, handleId) => {
  const ports = listInputPorts(nodeType);
  if (handleId == null || handleId === "" || handleId === "default") {
    return ports.find((p) => p.id === "main") || ports[0] || null;
  }
  const found = ports.find((p) => p.id === handleId);
  return found || null;
};

const findOutputPort = (nodeType, handleId) => {
  const ports = listOutputPorts(nodeType);
  if (handleId == null || handleId === "" || handleId === "default") {
    return ports.find((p) => p.id === "main") || ports[0] || null;
  }
  const found = ports.find((p) => p.id === handleId);
  if (found) return found;
  // Part 12A: Switch rule IDs are dynamic execution outs — not unknown typed ports.
  if (nodeType === "switch") {
    return dynamicExecutionOut(handleId);
  }
  return null;
};

const isAuxiliaryOnlyProvider = (nodeType) =>
  Boolean(getPortContract(nodeType).isAuxiliaryProvider);

/**
 * Derive connection class for an edge from endpoint contracts.
 */
const getEdgeConnectionMeta = (edge, byId) => {
  const source = byId.get(edge.source);
  const target = byId.get(edge.target);
  if (!source || !target) {
    return {
      connectionKind: CONNECTION_KIND.EXECUTION,
      dataType: DATA_TYPE.WORKFLOW_ITEMS,
      valid: false,
      error: "Unknown endpoint node",
    };
  }
  const sourceType = nodeTypeOf(source);
  const targetType = nodeTypeOf(target);
  const outPort = findOutputPort(sourceType, edge.sourceHandle);
  const inPort = findInputPort(targetType, edge.targetHandle);

  if (!outPort) {
    return {
      connectionKind: CONNECTION_KIND.EXECUTION,
      dataType: DATA_TYPE.WORKFLOW_ITEMS,
      valid: false,
      error: `Unknown output port: ${edge.sourceHandle || "main"}`,
      code: "UNKNOWN_TYPED_PORT",
    };
  }
  if (!inPort) {
    return {
      connectionKind: CONNECTION_KIND.EXECUTION,
      dataType: DATA_TYPE.WORKFLOW_ITEMS,
      valid: false,
      error: `Unknown input port: ${edge.targetHandle || "main"}`,
      code: "UNKNOWN_TYPED_PORT",
    };
  }

  const out = enrichPort(outPort);
  const inn = enrichPort(inPort);
  if (out.connectionKind !== inn.connectionKind || out.dataType !== inn.dataType) {
    const expect = DATA_TYPE_LABEL[inn.dataType] || inn.dataType;
    return {
      connectionKind: inn.connectionKind,
      dataType: inn.dataType,
      valid: false,
      error:
        inn.connectionKind === CONNECTION_KIND.AUXILIARY
          ? `This port expects an ${expect}.`
          : `Incompatible connection types.`,
      code: "INCOMPATIBLE_PORT_TYPE",
    };
  }

  return {
    connectionKind: out.connectionKind,
    dataType: out.dataType,
    valid: true,
    sourcePort: out,
    targetPort: inn,
  };
};

const isExecutionEdge = (edge, byId) => {
  const meta = getEdgeConnectionMeta(edge, byId);
  return meta.connectionKind === CONNECTION_KIND.EXECUTION;
};

const isAuxiliaryEdge = (edge, byId) => {
  const meta = getEdgeConnectionMeta(edge, byId);
  return meta.connectionKind === CONNECTION_KIND.AUXILIARY;
};

const buildById = (definition) => {
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  return new Map(nodes.map((n) => [n.id, n]));
};

const getExecutionEdges = (definition) => {
  const byId = buildById(definition);
  const edges = Array.isArray(definition?.edges) ? definition.edges : [];
  return edges.filter((e) => isExecutionEdge(e, byId));
};

const getAuxiliaryEdges = (definition) => {
  const byId = buildById(definition);
  const edges = Array.isArray(definition?.edges) ? definition.edges : [];
  return edges.filter((e) => isAuxiliaryEdge(e, byId));
};

/**
 * Validate a prospective connection (save / canvas / reconnect).
 */
const validateTypedConnection = ({
  sourceType,
  targetType,
  sourceHandle,
  targetHandle,
  existingEdges = [],
  sourceId,
  targetId,
}) => {
  const outPort = findOutputPort(sourceType, sourceHandle);
  const inPort = findInputPort(targetType, targetHandle);
  if (!outPort) {
    return {
      ok: false,
      code: "UNKNOWN_TYPED_PORT",
      message: `Unknown output port: ${sourceHandle || "main"}`,
    };
  }
  if (!inPort) {
    return {
      ok: false,
      code: "UNKNOWN_TYPED_PORT",
      message: `Unknown input port: ${targetHandle || "main"}`,
    };
  }
  const out = enrichPort(outPort);
  const inn = enrichPort(inPort);
  if (out.connectionKind !== inn.connectionKind || out.dataType !== inn.dataType) {
    const expect = DATA_TYPE_LABEL[inn.dataType] || inn.dataType;
    return {
      ok: false,
      code: "INCOMPATIBLE_PORT_TYPE",
      message:
        inn.connectionKind === CONNECTION_KIND.AUXILIARY
          ? `This port expects an ${expect}.`
          : out.connectionKind === CONNECTION_KIND.AUXILIARY
            ? `Cannot connect ${DATA_TYPE_LABEL[out.dataType] || out.dataType} to workflow data.`
            : "Incompatible connection types.",
    };
  }
  if (inn.maxConnections === 1 && sourceId && targetId) {
    const taken = existingEdges.some(
      (e) =>
        e.target === targetId &&
        (e.targetHandle || null) === (targetHandle || null) &&
        !(
          e.source === sourceId &&
          (e.sourceHandle || null) === (sourceHandle || null)
        )
    );
    if (taken) {
      const label = inn.label || DATA_TYPE_LABEL[inn.dataType] || inn.id;
      return {
        ok: false,
        code: "MAX_CONNECTIONS",
        message:
          inn.dataType === DATA_TYPE.AI_MODEL
            ? "Only one Chat Model can be connected."
            : inn.dataType === DATA_TYPE.AI_MEMORY
              ? "Only one memory can be connected."
              : `Only one connection allowed on ${label}.`,
      };
    }
  }
  return {
    ok: true,
    connectionKind: out.connectionKind,
    dataType: out.dataType,
  };
};

/**
 * Validate all edges in a definition (unknown ports, type mismatch, cardinality).
 */
const validateDefinitionConnections = (definition) => {
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  const edges = Array.isArray(definition?.edges) ? definition.edges : [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const errors = [];

  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) {
      errors.push(`Edge ${edge.id || ""} references missing node`);
      continue;
    }
    const result = validateTypedConnection({
      sourceType: nodeTypeOf(source),
      targetType: nodeTypeOf(target),
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      existingEdges: edges,
      sourceId: edge.source,
      targetId: edge.target,
    });
    if (!result.ok) {
      errors.push(result.message);
    }
  }

  const counts = new Map();
  for (const edge of edges) {
    const key = `${edge.target}::${edge.targetHandle || "main"}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const [key, count] of counts) {
    const [targetId, handle] = key.split("::");
    const target = byId.get(targetId);
    if (!target) continue;
    const port = findInputPort(
      nodeTypeOf(target),
      handle === "main" ? null : handle
    );
    if (port?.maxConnections != null && count > port.maxConnections) {
      errors.push(
        port.dataType === DATA_TYPE.AI_MODEL
          ? "Only one Chat Model can be connected."
          : `Port ${port.label || port.id} exceeds max connections.`
      );
    }
  }

  return { ok: errors.length === 0, errors };
};

/**
 * Resolve auxiliary bindings for a consumer node.
 * Tool order: stable by edge.id ascending (persisted edge identity).
 */
const resolveAuxiliaryBindings = ({ nodeId, definition }) => {
  const byId = buildById(definition);
  const node = byId.get(nodeId);
  if (!node) {
    return { model: [], tools: [], memory: [] };
  }
  const auxEdges = getAuxiliaryEdges(definition).filter(
    (e) => e.target === nodeId
  );
  const sorted = [...auxEdges].sort((a, b) =>
    String(a.id || "").localeCompare(String(b.id || ""))
  );

  const model = [];
  const tools = [];
  const memory = [];

  for (const edge of sorted) {
    const meta = getEdgeConnectionMeta(edge, byId);
    if (!meta.valid) continue;
    const binding = {
      edgeId: edge.id,
      sourceNodeId: edge.source,
      sourceHandle: edge.sourceHandle || null,
      targetHandle: edge.targetHandle || null,
      dataType: meta.dataType,
      sourceType: nodeTypeOf(byId.get(edge.source)),
    };
    if (meta.dataType === DATA_TYPE.AI_MODEL) model.push(binding);
    else if (meta.dataType === DATA_TYPE.AI_TOOL) tools.push(binding);
    else if (meta.dataType === DATA_TYPE.AI_MEMORY) memory.push(binding);
  }

  return { model, tools, memory };
};

/**
 * Nodes that consume an auxiliary provider (for dirty invalidation).
 */
const getAuxiliaryConsumers = (definition, providerNodeId) => {
  return getAuxiliaryEdges(definition)
    .filter((e) => e.source === providerNodeId)
    .map((e) => e.target);
};

module.exports = {
  CONNECTION_KIND,
  DATA_TYPE,
  DATA_TYPE_LABEL,
  NODE_PORT_CONTRACTS,
  getPortContract,
  listInputPorts,
  listOutputPorts,
  findInputPort,
  findOutputPort,
  enrichPort,
  isAuxiliaryOnlyProvider,
  getEdgeConnectionMeta,
  isExecutionEdge,
  isAuxiliaryEdge,
  getExecutionEdges,
  getAuxiliaryEdges,
  validateTypedConnection,
  validateDefinitionConnections,
  resolveAuxiliaryBindings,
  getAuxiliaryConsumers,
  nodeTypeOf,
};
