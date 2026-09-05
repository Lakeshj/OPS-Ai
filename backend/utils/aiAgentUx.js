/**
 * Part 12C — AI workspace UX helpers mirrored for smoke tests.
 * Keep in sync with frontend/src/modules/workflows/aiAgentUx.ts
 */

const AI_ERROR_UX = Object.freeze({
  AI_MODEL_REQUIRED: "Connect a Chat Model to this Agent.",
  AI_MODEL_TIMEOUT: "The model request timed out.",
  AI_MODEL_PROVIDER_ERROR: "The AI model request failed.",
  AI_PROVIDER_UNSUPPORTED: "The AI model request failed.",
  AI_AGENT_MAX_TOOL_ROUNDS:
    "The Agent reached the maximum number of tool-call rounds.",
  AI_TOOL_NOT_FOUND:
    "The model requested a tool that isn't connected to this Agent.",
  AI_TOOL_ARGS_INVALID:
    "The model returned invalid input for the selected tool.",
  AI_TOOL_CALL_INVALID:
    "The model returned invalid input for the selected tool.",
  AI_TOOL_SCHEMA_INVALID:
    "The model returned invalid input for the selected tool.",
  AI_TOOL_TIMEOUT: "The tool took too long to respond.",
  AI_MEMORY_NOT_SUPPORTED: "Memory is not supported yet.",
  AI_DUPLICATE_TOOL_NAME:
    "Two tools share the same name. Rename one before running.",
  AI_PROVIDER_NOT_EXECUTABLE:
    "This node provides a resource to an AI Agent and does not run by itself.",
});

const mapAiErrorCodeToMessage = (code, fallback) => {
  const c = String(code || "").trim();
  if (AI_ERROR_UX[c]) return AI_ERROR_UX[c];
  if (c === "AI_TOOL_FAILED") return String(fallback || "A tool call failed.").trim();
  return String(fallback || (c ? `AI Agent failed (${c}).` : "AI Agent failed.")).trim();
};

const getAiAgentReadiness = (agentNodeId, edges, nodes) => {
  const byId = new Map((nodes || []).map((n) => [n.id, n]));
  const into = (port) =>
    (edges || [])
      .filter(
        (e) =>
          e.target === agentNodeId &&
          String(e.targetHandle || "main") === String(port)
      )
      .slice()
      .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));

  const modelEdges = into("model");
  const toolEdges = into("tools");
  const memoryEdges = into("memory");
  const modelNode = modelEdges[0] ? byId.get(modelEdges[0].source) : null;
  const toolNames = toolEdges
    .map((e) => {
      const n = byId.get(e.source);
      if (!n) return null;
      return String(n.data?.toolName || n.data?.name || n.data?.label || n.type);
    })
    .filter(Boolean);

  const missingModel = !modelNode;
  const memoryConnected = memoryEdges.length > 0;
  return {
    ready: !missingModel && !memoryConnected,
    missingModel,
    modelConnected: Boolean(modelNode),
    modelLabel: modelNode
      ? [
          modelNode.data?.provider,
          modelNode.data?.model,
        ]
          .filter(Boolean)
          .join(" / ") || String(modelNode.type)
      : null,
    toolCount: toolEdges.length,
    toolNames,
    unsupportedMemory: memoryConnected,
    memoryConnected,
    issues: [
      ...(missingModel ? ["Model required"] : []),
      ...(memoryConnected ? ["Memory is not supported yet"] : []),
    ],
  };
};

const mapAiToolCallsToTrace = (toolCalls) => {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls.map((call, index) => {
    const status = String(call?.status || "unknown");
    return {
      index: index + 1,
      label: String(call?.toolName || "Tool").trim() || "Tool",
      status: status.charAt(0).toUpperCase() + status.slice(1),
      durationMs:
        typeof call?.durationMs === "number" ? call.durationMs : null,
      failed: status.toLowerCase() === "failed",
    };
  });
};

const stripSecretsDeep = (value) => {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(stripSecretsDeep);
  if (typeof value !== "object") return value;
  const blocked = /secret|token|password|authorization|api[_-]?key|credential/i;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (blocked.test(k)) continue;
    out[k] = stripSecretsDeep(v);
  }
  return out;
};

module.exports = {
  AI_ERROR_UX,
  mapAiErrorCodeToMessage,
  getAiAgentReadiness,
  mapAiToolCallsToTrace,
  stripSecretsDeep,
};
