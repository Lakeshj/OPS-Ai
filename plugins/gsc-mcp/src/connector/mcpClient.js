const { loadConfig } = require("../config");
const { createConnectionManager } = require("./connectionManager");
const { buildAuthEnv, assertToolScopes } = require("../auth/authBridge");
const {
  buildCatalog,
  assertToolAllowed,
  getOpsAiTool,
} = require("../registry/toolCatalog");
const { PluginError, ERROR, normalizeResult } = require("../errors");

const createMcpClient = (configOverrides = {}) => {
  const config = loadConfig(configOverrides);
  const manager = createConnectionManager(config);
  let cachedCatalog = null;

  const sessionFor = async (authContext) => {
    const { env, authKey } = buildAuthEnv(authContext, config);
    return manager.acquire(authKey, env);
  };

  return {
    config,
    async listTools(authContext = {}, options = {}) {
      const session = await sessionFor(authContext);
      const discovered = await session.listTools();
      cachedCatalog = buildCatalog(discovered, config, {
        audience: options.audience,
      });
      return cachedCatalog;
    },
    async getCatalog(authContext = {}, options = {}) {
      if (cachedCatalog && !options.audience) return cachedCatalog;
      return this.listTools(authContext, options);
    },
    async callTool(toolIdOrName, args = {}, authContext = {}) {
      const catalog = await this.getCatalog(authContext, {
        audience: "assistant",
      });
      const tool =
        getOpsAiTool(catalog, toolIdOrName) ||
        catalog.find(
          (t) =>
            t.name === toolIdOrName ||
            t.externalName === toolIdOrName ||
            t.id === toolIdOrName
        );
      if (!tool) {
        throw new PluginError(
          `Unknown GSC MCP tool: ${toolIdOrName}`,
          ERROR.MCP_VALIDATION,
          { toolIdOrName }
        );
      }
      assertToolAllowed(tool, config);
      assertToolScopes(tool, authContext, config);

      const externalName = tool.externalName || tool.name;
      const session = await sessionFor(authContext);
      const result = await session.callTool(
        externalName,
        args && typeof args === "object" ? args : {}
      );
      return normalizeResult(tool.id, result);
    },
    async close() {
      cachedCatalog = null;
      await manager.releaseAll();
    },
  };
};

module.exports = { createMcpClient };
