const ERROR = Object.freeze({
  MCP_UNAVAILABLE: "MCP_UNAVAILABLE",
  MCP_TOOL_FAILED: "MCP_TOOL_FAILED",
  MCP_AUTH_REQUIRED: "MCP_AUTH_REQUIRED",
  MCP_TOOL_BLOCKED: "MCP_TOOL_BLOCKED",
  MCP_SCOPE_INSUFFICIENT: "MCP_SCOPE_INSUFFICIENT",
  MCP_VALIDATION: "MCP_VALIDATION",
});

class PluginError extends Error {
  constructor(message, code, meta = {}) {
    super(message);
    this.name = "GscMcpPluginError";
    this.code = code || ERROR.MCP_TOOL_FAILED;
    this.meta = meta;
  }
}

const normalizeResult = (toolId, payload, extra = {}) => {
  if (payload && typeof payload === "object" && payload.ok === false) {
    return {
      toolId,
      ok: false,
      data: null,
      warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
      error: payload.error || {
        code: ERROR.MCP_TOOL_FAILED,
        message: String(payload.message || "MCP tool failed"),
      },
      raw: payload.raw,
      ...extra,
    };
  }
  return {
    toolId,
    ok: true,
    data: payload?.data !== undefined ? payload.data : payload,
    warnings: Array.isArray(payload?.warnings) ? payload.warnings : [],
    raw: payload?.raw,
    ...extra,
  };
};

module.exports = { ERROR, PluginError, normalizeResult };
