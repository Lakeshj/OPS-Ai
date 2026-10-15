/**
 * Meta Ads MCP error codes. The host turns these into AppError.
 */

const ERROR = Object.freeze({
  META_CREDENTIAL_REQUIRED: "META_CREDENTIAL_REQUIRED",
  META_PERMISSION_DENIED: "META_PERMISSION_DENIED",
  MCP_CREDENTIAL_REQUIRED: "MCP_CREDENTIAL_REQUIRED",
  MCP_CREDENTIAL_UNAUTHORIZED: "MCP_CREDENTIAL_UNAUTHORIZED",
  MCP_UNKNOWN_TOOL: "MCP_UNKNOWN_TOOL",
  MCP_EXECUTION_FAILED: "MCP_EXECUTION_FAILED",
});

class PluginError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = "MetaAdsMcpPluginError";
    this.code = code || ERROR.MCP_EXECUTION_FAILED;
    this.statusCode = statusCode;
  }
}

module.exports = { ERROR, PluginError };
