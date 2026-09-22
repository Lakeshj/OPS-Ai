const path = require("path");
const manifest = require("../manifest.json");
const { loadConfig } = require("./config");
const { ERROR, PluginError, buildWarning } = require("./errors");
const capabilities = require("./contracts/capabilities");
const output = require("./contracts/output");
const filters = require("./contracts/filters");
const inputValidation = require("./contracts/inputValidation");
const nodeSchema = require("./contracts/nodeSchema");
const intelligenceContext = require("./contracts/intelligenceContext");
const {
  processUpstreamItems,
  capabilityOptionsForUi,
  PROCESSOR_CAPABILITY_IDS,
  normalizeCapabilities,
} = require("./adapters/processUpstream");
const { resultToWorkflowItems } = require("./adapters/workflowNode");
const { runCapability } = require("./capabilities");
const {
  FORBIDDEN_MODULES,
  FORBIDDEN_SOURCE_PATTERNS,
} = require("./registry/allowlist");

/**
 * Create the GA4 MCP Tools plugin facade.
 * Upstream-row processor only — no Google client, no OAuth, no remote MCP.
 */
const createPlugin = (overrides = {}) => {
  const config = loadConfig(overrides);

  if (config.allowGoogleApi || config.allowOAuth || config.allowExternalMcp) {
    throw new PluginError(
      "GA4 MCP Tools forbids Google API, OAuth, and external MCP transports",
      ERROR.GA4_GOOGLE_API_FORBIDDEN
    );
  }

  return {
    manifest,
    config,
    contracts: {
      capabilities,
      output,
      filters,
      inputValidation,
      nodeSchema,
      intelligenceContext,
    },
    processUpstreamItems,
    capabilityOptionsForUi,
    PROCESSOR_CAPABILITY_IDS,
    normalizeCapabilities,
    resultToWorkflowItems,
    runCapability,
    nodeContract: nodeSchema.nodeContract,
    async close() {
      /* no sessions / transports */
    },
  };
};

module.exports = {
  createPlugin,
  loadConfig,
  manifest,
  ERROR,
  PluginError,
  buildWarning,
  capabilities,
  output,
  filters,
  inputValidation,
  nodeSchema,
  intelligenceContext,
  processUpstreamItems,
  capabilityOptionsForUi,
  PROCESSOR_CAPABILITY_IDS,
  normalizeCapabilities,
  resultToWorkflowItems,
  runCapability,
  FORBIDDEN_MODULES,
  FORBIDDEN_SOURCE_PATTERNS,
  pluginRoot: path.join(__dirname, ".."),
};
