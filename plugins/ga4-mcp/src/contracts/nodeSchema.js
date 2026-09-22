/**
 * Node contract / schema for future canvas registration (ga4McpTool).
 * UI wiring is intentionally deferred — this is the plugin-side contract only.
 */

const {
  PROCESSOR_CAPABILITY_IDS,
  TOOL_LABELS,
  CAPABILITY_DEFS,
} = require("./capabilities");
const { FILTER_DEFAULTS } = require("./filters");

const NODE_TYPE = "ga4McpTool";

const capabilityOptionsForUi = () =>
  PROCESSOR_CAPABILITY_IDS.map((id) => ({
    name: TOOL_LABELS[id] || id,
    value: id,
  }));

/**
 * Parameter schema description for OpsAi node registration (future Step).
 * Multi-select `capabilities` is the canonical field.
 */
const nodeParameterSchema = () => [
  {
    name: "capabilities",
    displayName: "Capabilities",
    type: "multiOptions",
    required: true,
    default: [],
    options: capabilityOptionsForUi(),
    description:
      "Select one or more GA4 analysis capabilities. Each runs independently on the same upstream googleAnalytics rows.",
  },
  {
    name: "capabilitySettings",
    displayName: "Capability settings",
    type: "collection",
    required: false,
    default: {},
    description:
      "Optional per-capability filter overrides (keyed by capability id).",
  },
];

const nodeContract = () => ({
  type: NODE_TYPE,
  displayName: "GA4 MCP Tools",
  description:
    "Analyze upstream googleAnalytics rows. No Google OAuth or runReport on this node.",
  group: "transform",
  authOnNode: false,
  credentialTypes: [],
  inputs: ["main"],
  outputs: ["main"],
  requiresUpstream: ["googleAnalytics"],
  parameters: nodeParameterSchema(),
  capabilities: PROCESSOR_CAPABILITY_IDS.map((id) => ({
    ...CAPABILITY_DEFS[id],
    filterDefaults: FILTER_DEFAULTS[id] || {},
  })),
  rules: {
    multiSelectIndependent: true,
    preserveCapabilityIdentity: true,
    noGoogleApi: true,
    noOAuth: true,
    pagePerformanceIsData: true,
    aiMustNotReplaceScore: true,
  },
});

module.exports = {
  NODE_TYPE,
  capabilityOptionsForUi,
  nodeParameterSchema,
  nodeContract,
};
