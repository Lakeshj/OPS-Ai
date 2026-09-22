/**
 * Thin host for plugins/ga4-mcp — upstream-row processor only.
 * No Google OAuth / Analytics API. Does not modify the GSC MCP host.
 */
const path = require("path");

const PLUGIN_ROOT = path.join(__dirname, "../../plugins/ga4-mcp");

let pluginSingleton = null;

const loadPluginModule = () =>
  // eslint-disable-next-line import/no-dynamic-require, global-require
  require(path.join(PLUGIN_ROOT, "src/index.js"));

const getGa4Plugin = () => {
  if (pluginSingleton) return pluginSingleton;
  const mod = loadPluginModule();
  pluginSingleton = mod.createPlugin({});
  return pluginSingleton;
};

const resetGa4PluginForTests = async () => {
  if (pluginSingleton?.close) {
    await pluginSingleton.close().catch(() => null);
  }
  pluginSingleton = null;
};

/**
 * Main-flow processor: googleAnalytics → GA4 MCP Tools → Filter/Sort/AI.
 * No credentials — consumes previous-node WorkflowItems only.
 */
const executeGa4McpToolsProcessor = async (node, context) => {
  const plugin = getGa4Plugin();
  const data = node.data || {};

  const hasCapabilitiesField = Object.prototype.hasOwnProperty.call(
    data,
    "capabilities"
  );
  const hasCapabilityField = Object.prototype.hasOwnProperty.call(
    data,
    "capability"
  );

  // Canonical multi-select: capabilities[]. Explicit [] must not fall through
  // to a default capability.
  const selected = hasCapabilitiesField
    ? data.capabilities
    : hasCapabilityField
      ? data.capability
      : [];

  const inputItems = Array.isArray(context.inputItems) ? context.inputItems : [];
  const first = inputItems[0];
  const firstJson =
    first && typeof first === "object" && !Array.isArray(first)
      ? first.json && typeof first.json === "object" && !Array.isArray(first.json)
        ? first.json
        : first
      : null;
  const handoffDiagnostics = {
    nodeId: node.id,
    inputItemCount: inputItems.length,
    firstItemTopKeys:
      first && typeof first === "object" && !Array.isArray(first)
        ? Object.keys(first).slice(0, 12)
        : [],
    firstItemJsonKeys:
      firstJson && typeof firstJson === "object"
        ? Object.keys(firstJson).slice(0, 20)
        : [],
    rowsDetected: inputItems.length > 0,
  };
  if (typeof console !== "undefined" && console.debug) {
    console.debug("[ga4-mcp-tools:handoff]", handoffDiagnostics);
  }

  const result = plugin.processUpstreamItems({
    capability: selected,
    capabilities: Array.isArray(data.capabilities)
      ? data.capabilities
      : Array.isArray(selected)
        ? selected
        : undefined,
    inputItems,
    nodeData: data,
    context,
  });

  if (!result.ok) {
    const err = new Error(
      result.error?.message || "GA4 MCP Tools processing failed"
    );
    err.code = result.error?.code || "GA4_VALIDATION";
    err.meta = {
      receivedCapability: data.capability,
      receivedCapabilities: data.capabilities,
      selected,
      handoffDiagnostics,
      ...(result.output || {}),
    };
    throw err;
  }

  if (result.output && typeof result.output === "object") {
    const byCap = {};
    for (const it of result.items || []) {
      const row = it?.json || it;
      const cap =
        row && typeof row === "object" ? String(row.capability || "") : "";
      if (!cap) continue;
      byCap[cap] = (byCap[cap] || 0) + 1;
    }
    result.output.runtimeDiagnostics = {
      nodeId: node.id,
      receivedCapability: data.capability,
      receivedCapabilities: data.capabilities,
      selectedCapabilities:
        result.output.capabilities || result.resolved?.capabilities,
      executed: result.output.executed,
      perCapability: result.output.perCapability,
      outputItemCount: Array.isArray(result.items) ? result.items.length : 0,
      outputCapabilities: byCap,
      handoff: handoffDiagnostics,
    };
    if (typeof console !== "undefined" && console.debug) {
      console.debug("[ga4-mcp-tools]", result.output.runtimeDiagnostics);
    }
  }

  return result;
};

module.exports = {
  getGa4Plugin,
  resetGa4PluginForTests,
  executeGa4McpToolsProcessor,
  PLUGIN_ROOT,
};
