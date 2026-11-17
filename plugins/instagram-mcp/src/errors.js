/**
 * Instagram MCP error codes. The host turns these into AppError.
 */

const ERROR = Object.freeze({
  MCP_CREDENTIAL_REQUIRED: "MCP_CREDENTIAL_REQUIRED",
  MCP_UNKNOWN_TOOL: "MCP_UNKNOWN_TOOL",
  MCP_EXECUTION_FAILED: "MCP_EXECUTION_FAILED",
  INSTAGRAM_SOURCE_REQUIRED: "INSTAGRAM_SOURCE_REQUIRED",
  INSTAGRAM_PERMISSION_DENIED: "INSTAGRAM_PERMISSION_DENIED",
});

class PluginError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = "InstagramMcpPluginError";
    this.code = code || ERROR.MCP_EXECUTION_FAILED;
    this.statusCode = statusCode;
  }
}

module.exports = { ERROR, PluginError };
