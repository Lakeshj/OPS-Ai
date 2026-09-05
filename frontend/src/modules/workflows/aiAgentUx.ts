/**
 * Part 12C — AI Agent workspace UX helpers (readiness, display, tool trace, errors).
 * Backend remains authoritative at execution time.
 */

import { enrichPort } from "./connectionPorts";
import { getNodeContract } from "./nodeContract";
import type { WorkflowNodeType } from "./types";

export type AiToolCallStatus = "succeeded" | "failed" | string;

export type AiSafeToolCall = {
  toolName?: string;
  callId?: string;
  status?: AiToolCallStatus;
  durationMs?: number;
};

export type AiAgentUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type AiAgentItemMeta = {
  kind?: string;
  itemIndex?: number;
  rounds?: number;
  toolCalls?: AiSafeToolCall[];
  usage?: AiAgentUsage;
  modelNodeId?: string;
  modelProvider?: string;
};

export type AiAgentBusinessAi = {
  output?: unknown;
  finishReason?: string;
  provider?: string;
  model?: string;
};

export type AiAgentOutputItem = {
  ai?: AiAgentBusinessAi;
  text?: string;
  [key: string]: unknown;
};

export type AiResourceRole = "model" | "tool" | "memory" | "agent" | "unknown";

export type AiAgentReadiness = {
  ready: boolean;
  missingModel: boolean;
  modelConnected: boolean;
  modelLabel: string | null;
  toolCount: number;
  toolNames: string[];
  unsupportedMemory: boolean;
  memoryConnected: boolean;
  issues: string[];
};

export type AiResourceDisplay = {
  role: AiResourceRole;
  title: string;
  subtitle: string;
  providerLabel?: string | null;
  modelLabel?: string | null;
  toolName?: string | null;
};

export type AiToolTraceRow = {
  index: number;
  label: string;
  status: string;
  durationMs: number | null;
  failed: boolean;
};

/** No production memory provider is Available in Part 12C. */
export const isAiMemoryRuntimeSupported = (): boolean => false;

export const AI_RESOURCE_PROVIDER_TYPES = new Set([
  "aiChatModel",
  "aiCalculatorTool",
  "aiModelProviderTest",
  "aiToolProviderTest",
  "aiMemoryProviderTest",
]);

export const isAiResourceProviderType = (
  type: string | null | undefined
): boolean => Boolean(type && AI_RESOURCE_PROVIDER_TYPES.has(String(type)));

export const isAiAgentType = (type: string | null | undefined): boolean =>
  String(type) === "aiAgent";

const PROVIDER_DISPLAY: Record<string, string> = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
  gemini: "Gemini",
  test: "Test",
};

export const formatAiProviderLabel = (
  provider: string | null | undefined
): string => {
  const key = String(provider || "").trim().toLowerCase();
  if (!key) return "";
  return PROVIDER_DISPLAY[key] || key;
};

type GraphEdge = {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

type GraphNode = {
  id: string;
  type?: string | null;
  data?: Record<string, unknown> | null;
};

const edgesIntoPort = (
  nodeId: string,
  portId: string,
  edges: GraphEdge[]
): GraphEdge[] =>
  edges
    .filter(
      (e) =>
        e.target === nodeId &&
        String(e.targetHandle || "main") === String(portId)
    )
    .slice()
    .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));

export function getAiResourceDisplay(
  nodeType: string | null | undefined,
  data?: Record<string, unknown> | null
): AiResourceDisplay {
  const type = String(nodeType || "");
  const d = data || {};

  if (type === "aiChatModel" || type === "aiModelProviderTest") {
    const provider = formatAiProviderLabel(
      String(d.provider || (type === "aiModelProviderTest" ? "test" : "") || "")
    );
    const model = String(d.model || "").trim() || null;
    return {
      role: "model",
      title: "Chat Model",
      subtitle: "AI model resource",
      providerLabel: provider || null,
      modelLabel: model,
    };
  }

  if (type === "aiCalculatorTool" || type === "aiToolProviderTest") {
    const toolName =
      String(d.toolName || d.name || "calculator").trim() || "calculator";
    return {
      role: "tool",
      title: "Calculator Tool",
      subtitle: "Provides tool to Agent",
      toolName,
    };
  }

  if (type === "aiMemoryProviderTest") {
    return {
      role: "memory",
      title: "Memory",
      subtitle: "Unsupported in this release",
    };
  }

  if (type === "aiAgent") {
    return {
      role: "agent",
      title: "AI Agent",
      subtitle: "Uses a Chat Model and optional tools",
    };
  }

  return {
    role: "unknown",
    title: type || "Node",
    subtitle: "",
  };
}

export function getAiAgentReadiness(
  agentNodeId: string,
  edges: GraphEdge[],
  nodes: GraphNode[]
): AiAgentReadiness {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const modelEdges = edgesIntoPort(agentNodeId, "model", edges);
  const toolEdges = edgesIntoPort(agentNodeId, "tools", edges);
  const memoryEdges = edgesIntoPort(agentNodeId, "memory", edges);

  const modelNode = modelEdges[0]
    ? nodeById.get(modelEdges[0].source)
    : undefined;
  const modelConnected = Boolean(modelNode);
  const modelDisplay = modelNode
    ? getAiResourceDisplay(String(modelNode.type), modelNode.data || {})
    : null;
  const modelLabel = modelConnected
    ? [modelDisplay?.providerLabel, modelDisplay?.modelLabel]
        .filter(Boolean)
        .join(" / ") ||
      String(modelNode?.data?.label || modelNode?.type || "Chat Model")
    : null;

  const toolNames = toolEdges
    .map((e) => {
      const n = nodeById.get(e.source);
      if (!n) return null;
      const disp = getAiResourceDisplay(String(n.type), n.data || {});
      return disp.toolName || String(n.data?.label || n.type || "Tool");
    })
    .filter((x): x is string => Boolean(x));

  const memoryConnected = memoryEdges.length > 0;
  const unsupportedMemory =
    memoryConnected && !isAiMemoryRuntimeSupported();

  const issues: string[] = [];
  if (!modelConnected) issues.push("Model required");
  if (unsupportedMemory) issues.push("Memory is not supported yet");

  return {
    ready: modelConnected && !unsupportedMemory,
    missingModel: !modelConnected,
    modelConnected,
    modelLabel,
    toolCount: toolEdges.length,
    toolNames,
    unsupportedMemory,
    memoryConnected,
    issues,
  };
}

export function getVisibleAiAuxiliaryInputPorts(
  nodeType: WorkflowNodeType | string
) {
  try {
    const contract = getNodeContract(nodeType as WorkflowNodeType);
    return (contract.inputs || []).filter((port) => {
      const enriched = enrichPort(port);
      if (enriched.connectionKind !== "auxiliary") return false;
      if (enriched.dataType === "ai-memory" && !isAiMemoryRuntimeSupported()) {
        return false;
      }
      return true;
    });
  } catch {
    return [];
  }
}

export function mapAiToolCallsToTrace(
  toolCalls: AiSafeToolCall[] | null | undefined
): AiToolTraceRow[] {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls.map((call, index) => {
    const status = String(call?.status || "unknown");
    const failed = status.toLowerCase() === "failed";
    const duration =
      typeof call?.durationMs === "number" && Number.isFinite(call.durationMs)
        ? call.durationMs
        : null;
    return {
      index: index + 1,
      label: String(call?.toolName || "Tool").trim() || "Tool",
      status: status.charAt(0).toUpperCase() + status.slice(1),
      durationMs: duration,
      failed,
    };
  });
}

export function extractAgentMetaFromStepOutput(
  output: unknown
): AiAgentItemMeta[] {
  if (!output || typeof output !== "object") return [];
  const root = output as Record<string, unknown>;
  const meta = root.agentMeta;
  if (Array.isArray(meta)) return meta as AiAgentItemMeta[];
  return [];
}

export function extractSafeToolCallsForItem(
  output: unknown,
  itemIndex = 0
): AiSafeToolCall[] {
  const metas = extractAgentMetaFromStepOutput(output);
  const entry = metas[itemIndex] || metas[0];
  return Array.isArray(entry?.toolCalls) ? entry.toolCalls : [];
}

export function extractUsageForItem(
  output: unknown,
  itemIndex = 0
): AiAgentUsage | null {
  const metas = extractAgentMetaFromStepOutput(output);
  const entry = metas[itemIndex] || metas[0];
  return entry?.usage && typeof entry.usage === "object" ? entry.usage : null;
}

/** Map backend AI_* codes to readable inspector/canvas copy. */
export function mapAiErrorCodeToMessage(
  code: string | null | undefined,
  fallback?: string | null
): string {
  const c = String(code || "").trim();
  switch (c) {
    case "AI_MODEL_REQUIRED":
      return "Connect a Chat Model to this Agent.";
    case "AI_MODEL_TIMEOUT":
      return "The model request timed out.";
    case "AI_MODEL_PROVIDER_ERROR":
    case "AI_PROVIDER_UNSUPPORTED":
      return "The AI model request failed.";
    case "AI_AGENT_MAX_TOOL_ROUNDS":
      return "The Agent reached the maximum number of tool-call rounds.";
    case "AI_TOOL_NOT_FOUND":
      return "The model requested a tool that isn't connected to this Agent.";
    case "AI_TOOL_ARGS_INVALID":
    case "AI_TOOL_CALL_INVALID":
    case "AI_TOOL_SCHEMA_INVALID":
      return "The model returned invalid input for the selected tool.";
    case "AI_TOOL_TIMEOUT":
      return "The tool took too long to respond.";
    case "AI_TOOL_FAILED":
      return fallback?.trim() || "A tool call failed.";
    case "AI_MEMORY_NOT_SUPPORTED":
      return "Memory is not supported yet.";
    case "AI_DUPLICATE_TOOL_NAME":
      return "Two tools share the same name. Rename one before running.";
    case "AI_PROVIDER_NOT_EXECUTABLE":
      return "This node provides a resource to an AI Agent and does not run by itself.";
    default:
      return (
        fallback?.trim() ||
        (c ? `AI Agent failed (${c}).` : "AI Agent failed.")
      );
  }
}

export function parseAiErrorFromUnknown(err: unknown): {
  code: string | null;
  message: string;
} {
  if (!err) return { code: null, message: "AI Agent failed." };
  if (typeof err === "string") {
    const codeMatch = err.match(/\b(AI_[A-Z0-9_]+)\b/);
    const code = codeMatch?.[1] || null;
    return { code, message: mapAiErrorCodeToMessage(code, err) };
  }
  if (typeof err === "object") {
    const o = err as Record<string, unknown>;
    const code = String(o.code || o.errorCode || o.name || "").trim() || null;
    const raw = String(o.message || o.error || "").trim();
    if (code?.startsWith("AI_")) {
      return { code, message: mapAiErrorCodeToMessage(code, raw) };
    }
    const embedded = raw.match(/\b(AI_[A-Z0-9_]+)\b/);
    if (embedded) {
      return {
        code: embedded[1],
        message: mapAiErrorCodeToMessage(embedded[1], raw),
      };
    }
    return { code: null, message: raw || "AI Agent failed." };
  }
  return { code: null, message: "AI Agent failed." };
}

export function providerResourceExplanation(
  nodeType: string | null | undefined
): string {
  const role = getAiResourceDisplay(nodeType).role;
  if (role === "model") return "This node provides an AI model resource.";
  if (role === "tool") return "This node provides an AI tool resource.";
  if (role === "memory") return "This node provides an AI memory resource.";
  return "This node provides an AI resource.";
}

export function sanitizeResourceSummaryForDisplay(
  summary: Record<string, unknown>
): Record<string, unknown> {
  const blocked = /secret|token|password|authorization|api[_-]?key|credential/i;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(summary)) {
    if (blocked.test(key)) continue;
    if (typeof value === "string" && blocked.test(value)) continue;
    out[key] = value;
  }
  return out;
}

/** Library engine types that should not appear in ordinary execution next-step pickers. */
export function isExcludedFromExecutionNextStep(
  engineType: string | null | undefined
): boolean {
  return isAiResourceProviderType(engineType);
}

export function resourceEdgeLabelForDataType(
  dataType: string | null | undefined
): string {
  switch (dataType) {
    case "ai-model":
      return "Model";
    case "ai-tool":
      return "Tool";
    case "ai-memory":
      return "Memory";
    default:
      return "Resource";
  }
}
