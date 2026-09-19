const { PluginError, ERROR } = require("../errors");

/**
 * Phase 2 stub — native OpsAi MCP transport (not implemented in Phase 1).
 */
const createNativeTransport = () => ({
  async connect() {
    throw new PluginError(
      "Native OpsAi GSC MCP transport is Phase 2. Set transport to stdio or mock.",
      ERROR.MCP_UNAVAILABLE
    );
  },
});

module.exports = { createNativeTransport };
