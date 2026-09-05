/**
 * Part 12A — Typed connection classes (execution vs auxiliary).
 * Mirrors backend/services/workflowConnection.service.js for canvas UX.
 * Authoritative connectionKind is DERIVED from port contracts (not edge JSON).
 */

import { getNodeContract, type NodePortDef, type PortKind } from "./nodeContract";
import type { WorkflowNodeType } from "./types";

export type ConnectionKind = "execution" | "auxiliary";

export type PortDataType =
  | "workflow-items"
  | "ai-model"
  | "ai-tool"
  | "ai-memory";

export const CONNECTION_KIND = {
  EXECUTION: "execution" as const,
  AUXILIARY: "auxiliary" as const,
};

export const DATA_TYPE = {
  WORKFLOW_ITEMS: "workflow-items" as const,
  AI_MODEL: "ai-model" as const,
  AI_TOOL: "ai-tool" as const,
  AI_MEMORY: "ai-memory" as const,
};

export const DATA_TYPE_LABEL: Record<PortDataType, string> = {
  "workflow-items": "workflow data",
  "ai-model": "AI model",
  "ai-tool": "AI tool",
  "ai-memory": "AI memory",
};

const KIND_TO_SEMANTICS: Record<
  PortKind,
  { connectionKind: ConnectionKind; dataType: PortDataType }
> = {
  main: { connectionKind: "execution", dataType: "workflow-items" },
  error: { connectionKind: "execution", dataType: "workflow-items" },
  true: { connectionKind: "execution", dataType: "workflow-items" },
  false: { connectionKind: "execution", dataType: "workflow-items" },
  fallback: { connectionKind: "execution", dataType: "workflow-items" },
  ai_languageModel: { connectionKind: "auxiliary", dataType: "ai-model" },
  ai_tool: { connectionKind: "auxiliary", dataType: "ai-tool" },
  ai_memory: { connectionKind: "auxiliary", dataType: "ai-memory" },
};

export const enrichPort = (port: NodePortDef): NodePortDef & {
  connectionKind: ConnectionKind;
  dataType: PortDataType;
} => {
  const mapped = KIND_TO_SEMANTICS[port.kind] || KIND_TO_SEMANTICS.main;
  return {
    ...port,
    connectionKind: port.connectionKind || mapped.connectionKind,
    dataType: port.dataType || mapped.dataType,
  };
};

export const isAuxiliaryPort = (port: NodePortDef | null | undefined): boolean =>
  Boolean(port && enrichPort(port).connectionKind === "auxiliary");

export const isExecutionPort = (port: NodePortDef | null | undefined): boolean =>
  !port || enrichPort(port).connectionKind === "execution";

const findInputPort = (
  nodeType: WorkflowNodeType | string,
  handleId: string | null | undefined
): NodePortDef | null => {
  try {
    const ports = getNodeContract(nodeType as WorkflowNodeType).inputs || [];
    if (handleId == null || handleId === "" || handleId === "default") {
      return ports.find((p) => p.id === "main") || ports[0] || null;
    }
    return ports.find((p) => p.id === handleId) || null;
  } catch {
    return null;
  }
};

const findOutputPort = (
  nodeType: WorkflowNodeType | string,
  handleId: string | null | undefined
): NodePortDef | null => {
  try {
    const ports = getNodeContract(nodeType as WorkflowNodeType).outputs || [];
    if (handleId == null || handleId === "" || handleId === "default") {
      return ports.find((p) => p.id === "main") || ports[0] || null;
    }
    const found = ports.find((p) => p.id === handleId);
    if (found) return found;
    if (nodeType === "switch") {
      return {
        id: String(handleId),
        kind: "main",
        direction: "out",
        connectionKind: "execution",
        dataType: "workflow-items",
        label: String(handleId),
      };
    }
    return null;
  } catch {
    return null;
  }
};

export type TypedConnectionResult =
  | { ok: true; connectionKind: ConnectionKind; dataType: PortDataType }
  | { ok: false; code: string; message: string };

export const validateTypedConnection = (args: {
  sourceType: string;
  targetType: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  existingEdges?: Array<{
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }>;
  sourceId?: string;
  targetId?: string;
}): TypedConnectionResult => {
  const outPort = findOutputPort(args.sourceType, args.sourceHandle);
  const inPort = findInputPort(args.targetType, args.targetHandle);
  if (!outPort) {
    return {
      ok: false,
      code: "UNKNOWN_TYPED_PORT",
      message: `Unknown output port: ${args.sourceHandle || "main"}`,
    };
  }
  if (!inPort) {
    return {
      ok: false,
      code: "UNKNOWN_TYPED_PORT",
      message: `Unknown input port: ${args.targetHandle || "main"}`,
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
        inn.connectionKind === "auxiliary"
          ? `This port expects an ${expect}.`
          : out.connectionKind === "auxiliary"
            ? `Cannot connect ${DATA_TYPE_LABEL[out.dataType] || out.dataType} to workflow data.`
            : "Incompatible connection types.",
    };
  }
  if (inn.maxConnections === 1 && args.sourceId && args.targetId) {
    const taken = (args.existingEdges || []).some(
      (e) =>
        e.target === args.targetId &&
        (e.targetHandle || null) === (args.targetHandle || null) &&
        !(
          e.source === args.sourceId &&
          (e.sourceHandle || null) === (args.sourceHandle || null)
        )
    );
    if (taken) {
      return {
        ok: false,
        code: "MAX_CONNECTIONS",
        message:
          inn.dataType === "ai-model"
            ? "Only one Chat Model can be connected."
            : inn.dataType === "ai-memory"
              ? "Only one memory can be connected."
              : `Only one connection allowed on ${inn.label || inn.id}.`,
      };
    }
  }
  return {
    ok: true,
    connectionKind: out.connectionKind,
    dataType: out.dataType,
  };
};

export const getEdgeConnectionKind = (
  edge: {
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  },
  nodes: Array<{ id: string; type?: string | null }>
): ConnectionKind => {
  const source = nodes.find((n) => n.id === edge.source);
  const target = nodes.find((n) => n.id === edge.target);
  if (!source || !target) return "execution";
  const result = validateTypedConnection({
    sourceType: String(source.type || ""),
    targetType: String(target.type || ""),
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
  });
  if (result.ok) return result.connectionKind;
  // Unknown / invalid: do not treat as auxiliary WorkflowItem bypass
  if (result.code === "INCOMPATIBLE_PORT_TYPE") {
    const out = findOutputPort(String(source.type || ""), edge.sourceHandle);
    if (out && enrichPort(out).connectionKind === "auxiliary") return "auxiliary";
  }
  return "execution";
};

export const isAuxiliaryEdge = (
  edge: {
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  },
  nodes: Array<{ id: string; type?: string | null }>
): boolean => getEdgeConnectionKind(edge, nodes) === "auxiliary";

/** Tool binding order: stable by edge.id ascending. */
export const resolveAuxiliaryBindings = (args: {
  nodeId: string;
  nodes: Array<{ id: string; type?: string | null }>;
  edges: Array<{
    id?: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }>;
}) => {
  const aux = args.edges
    .filter(
      (e) => e.target === args.nodeId && isAuxiliaryEdge(e, args.nodes)
    )
    .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));

  const model: typeof aux = [];
  const tools: typeof aux = [];
  const memory: typeof aux = [];

  for (const edge of aux) {
    const target = args.nodes.find((n) => n.id === edge.target);
    const inPort = findInputPort(
      String(target?.type || ""),
      edge.targetHandle
    );
    if (!inPort) continue;
    const dt = enrichPort(inPort).dataType;
    if (dt === "ai-model") model.push(edge);
    else if (dt === "ai-tool") tools.push(edge);
    else if (dt === "ai-memory") memory.push(edge);
  }

  return { model, tools, memory };
};
