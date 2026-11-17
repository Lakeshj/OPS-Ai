const path = require("path");
const manifest = require("../manifest.json");
const { loadConfig } = require("./config");
const { ERROR, PluginError } = require("./errors");
const { provider, tools, WRITE_TOOL_IDS } = require("./contracts/tools");
const { createExecutor } = require("./executor");

/**
 * Instagram MCP plugin facade.
 * Tool definitions and the thin read-only executor live here.
 * OAuth and Graph HTTP stay in shared backend Instagram services.
 */
const createPlugin = (overrides = {}) => {
  const config = loadConfig(overrides);
  const executor = overrides.runtime ? createExecutor(overrides.runtime) : null;
  return {
    manifest,
    config,
    provider,
    tools,
    executor,
    createExecutor,
    WRITE_TOOL_IDS,
    async close() {
      /* no sessions / transports */
    },
  };
};

module.exports = {
  createPlugin,
  createExecutor,
  loadConfig,
  manifest,
  provider,
  tools,
  WRITE_TOOL_IDS,
  ERROR,
  PluginError,
  pluginRoot: path.join(__dirname, ".."),
};
