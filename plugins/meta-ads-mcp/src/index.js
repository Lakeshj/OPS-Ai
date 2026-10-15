const path = require("path");
const manifest = require("../manifest.json");
const { loadConfig } = require("./config");
const { ERROR, PluginError } = require("./errors");
const { provider, tools } = require("./contracts/tools");
const { createExecutor } = require("./executor");

/**
 * Meta Ads MCP plugin facade.
 * Tool definitions and the read-only executor live here.
 * OAuth and Graph HTTP stay in shared backend services.
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
  ERROR,
  PluginError,
  pluginRoot: path.join(__dirname, ".."),
};
