/**
 * Google Ads MCP error codes. The host turns these into AppError.
 * Codes match the existing workflow executor.
 */

const ERROR = Object.freeze({
  GOOGLE_ADS_QUERY: "GOOGLE_ADS_QUERY",
  GOOGLE_ADS_CUSTOMER_INVALID: "GOOGLE_ADS_CUSTOMER_INVALID",
  GOOGLE_ADS_QUOTA: "GOOGLE_ADS_QUOTA",
  GOOGLE_ADS_DEVELOPER_TOKEN: "GOOGLE_ADS_DEVELOPER_TOKEN",
  USER_PERMISSION_DENIED: "USER_PERMISSION_DENIED",
  CUSTOMER_NOT_ENABLED: "CUSTOMER_NOT_ENABLED",
  MCP_CREDENTIAL_REQUIRED: "MCP_CREDENTIAL_REQUIRED",
  MCP_CREDENTIAL_UNAUTHORIZED: "MCP_CREDENTIAL_UNAUTHORIZED",
  MCP_UNKNOWN_TOOL: "MCP_UNKNOWN_TOOL",
  MCP_EXECUTION_FAILED: "MCP_EXECUTION_FAILED",
});

class PluginError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = "GoogleAdsMcpPluginError";
    this.code = code || ERROR.MCP_EXECUTION_FAILED;
    this.statusCode = statusCode;
  }
}

module.exports = { ERROR, PluginError };
