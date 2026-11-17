/**
 * Instagram MCP tool definitions for the dynamic registry.
 */

const { commonToolDefinitions, WRITE_TOOL_IDS } = require("./common");
const { performanceToolDefinitions } = require("./performance");

const provider = Object.freeze({
  id: "instagram",
  displayName: "Instagram",
  authType: "instagram",
  credentialType: "instagram",
});

const tools = Object.freeze([
  ...commonToolDefinitions(provider),
  ...performanceToolDefinitions(provider),
]);

module.exports = { provider, tools, WRITE_TOOL_IDS };
