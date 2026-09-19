const path = require("path");
const manifest = require("../manifest.json");
const { loadConfig } = require("./config");
const { createMcpClient } = require("./connector/mcpClient");
const {
  executeWorkflowTool,
  resultToWorkflowItems,
  workflowToolOptions,
} = require("./adapters/workflowNode");
const {
  buildAiToolDescriptors,
  attachGscMcpExecutors,
} = require("./adapters/aiAgentTool");
const {
  processUpstreamItems,
  capabilityOptionsForUi,
  PROCESSOR_CAPABILITY_IDS,
} = require("./adapters/processUpstream");
const {
  suggestToolsForIntent,
  systemPromptHints,
} = require("./adapters/chatIntent");
const { runIntelligence } = require("./intelligence");
const { runAction } = require("./actions");
const { ERROR, PluginError } = require("./errors");
const { MOCK_TOOLS } = require("./connector/transportMock");
const { buildCatalog } = require("./registry/toolCatalog");
const { AUDIENCES } = require("./contracts/capabilities");
const metrics = require("./contracts/metrics");
const capabilities = require("./contracts/capabilities");

const createPlugin = (overrides = {}) => {
  const config = loadConfig(overrides);
  const client = createMcpClient(config);

  return {
    manifest,
    config,
    client,
    contracts: { metrics, capabilities },
    async listTools(authContext, options = {}) {
      return client.listTools(authContext || {}, {
        audience: options.audience || AUDIENCES.AGENT,
      });
    },
    async callTool(toolId, args, authContext) {
      return executeWorkflowTool({
        client,
        toolId,
        toolArgs: args || {},
        authContext: authContext || {},
        mode: "raw",
      });
    },
    /** Stable facade for Assistant / Agent / future intelligence nodes */
    async executeCapability(toolId, args, authContext, options = {}) {
      return executeWorkflowTool({
        client,
        toolId,
        toolArgs: args || {},
        authContext: authContext || {},
        mode: options.mode || "raw",
      });
    },
    executeWorkflowTool: (opts) =>
      executeWorkflowTool({ client, ...opts }),
    resultToWorkflowItems,
    workflowToolOptions,
    buildAiToolDescriptors,
    attachGscMcpExecutors: (descriptors, authContext) =>
      attachGscMcpExecutors(descriptors, { client, authContext }),
    processUpstreamItems,
    capabilityOptionsForUi,
    PROCESSOR_CAPABILITY_IDS,
    suggestToolsForIntent,
    systemPromptHints,
    runIntelligence,
    runAction,
    async close() {
      await client.close();
    },
  };
};

const getStaticCatalog = (overrides = {}, options = {}) => {
  const config = loadConfig(overrides);
  const discovered = MOCK_TOOLS.map((t) => ({
    id: t.name,
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    source: "external",
    externalName: t.name,
  }));
  return buildCatalog(discovered, config, {
    audience: options.audience || AUDIENCES.AGENT,
  });
};

module.exports = {
  createPlugin,
  loadConfig,
  manifest,
  ERROR,
  PluginError,
  getStaticCatalog,
  AUDIENCES,
  metrics,
  capabilities,
  processUpstreamItems,
  capabilityOptionsForUi,
  PROCESSOR_CAPABILITY_IDS,
  intelligenceFilters: require("./contracts/intelligenceFilters"),
  intelligenceContext: require("./contracts/intelligenceContext"),
  pluginRoot: path.join(__dirname, ".."),
};
