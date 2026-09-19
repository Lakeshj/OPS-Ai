const { PluginError, ERROR } = require("../errors");

const assertAllowlist = (toolName, config) => {
  const blocked = new Set(config?.blockedTools || []);
  if (blocked.has(toolName)) {
    throw new PluginError(
      `Tool ${toolName} is blocked`,
      ERROR.MCP_TOOL_BLOCKED
    );
  }
};

module.exports = { assertAllowlist };
