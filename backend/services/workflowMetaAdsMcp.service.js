/**
 * Thin host for plugins/meta-ads-mcp.
 * Resolves Meta Ads source-node account context and injects the shared Graph client.
 * metaAdsMcpTool uses this. Graph HTTP stays in workflowMetaAds.service.js.
 */
const AppError = require("../utils/AppError");
const metaAds = require("./workflowMetaAds.service");
const { createExecutor } = require("../../plugins/meta-ads-mcp/src/executor");

const executor = createExecutor({
  AppError,
  apiVersion: metaAds.API_VERSION,
  metaGraphRequest: (spec) => metaAds.metaGraphRequest(spec),
  collectPages: (spec) => metaAds.collectPages(spec),
  presentAdAccount: (row) => metaAds.presentAdAccount(row),
  normalizeAdAccountId: (value) => metaAds.normalizeAdAccountId(value),
  runInsightsReport: (spec) => metaAds.runMetaAdsInsights(spec),
});

const SOURCE_MESSAGES = Object.freeze({
  none: "Add and configure a Meta Ads node first.",
  missing: "The selected Meta Ads source is no longer in this workflow.",
  credential: "Configure a Meta Ads credential on the selected Meta Ads node.",
  account: "Select an Ad Account on the selected Meta Ads node.",
  ambiguous: "Select which Meta Ads node supplies the account.",
});

function sourceError(message, code) {
  return new AppError(message, 400, code);
}

function graphNodes(context) {
  const graph = context?.graph || context?.definition;
  return Array.isArray(graph?.nodes) ? graph.nodes : [];
}

function isMetaAdsNode(node) {
  const type = node?.type || node?.data?.nodeType;
  return type === "metaAds";
}

function listMetaAdsSourceNodes(nodes) {
  return (Array.isArray(nodes) ? nodes : []).filter(isMetaAdsNode);
}

/**
 * UI state for Meta Ads Source. Execution uses resolveMetaAdsAccountContext.
 * showSelector is false when the workflow has exactly one usable Meta Ads node.
 */
function metaAdsSourceFieldState(nodes, savedSourceId) {
  const sources = listMetaAdsSourceNodes(nodes).map((node) => ({
    id: String(node.id),
    label: String(node.data?.label || "Meta Ads"),
  }));
  const saved = String(savedSourceId || "").trim();
  const savedOk = Boolean(saved && sources.some((row) => row.id === saved));
  if (sources.length === 0) {
    return {
      showSelector: false,
      message: saved ? SOURCE_MESSAGES.missing : SOURCE_MESSAGES.none,
      sources,
    };
  }
  if (sources.length === 1 && (!saved || savedOk)) {
    return { showSelector: false, message: null, sources };
  }
  if (saved && !savedOk) {
    return { showSelector: true, message: SOURCE_MESSAGES.missing, sources };
  }
  return { showSelector: true, message: null, sources };
}

function resolveSourceValue(raw, context, resolveExpression, label) {
  const text = raw == null ? "" : String(raw).trim();
  if (!text) return "";
  if (!text.includes("{{")) return text;
  if (typeof resolveExpression !== "function") {
    throw sourceError(
      `${label} on the Meta Ads source could not be resolved.`,
      "META_ADS_SOURCE_EXPRESSION"
    );
  }
  let resolved;
  try {
    resolved = resolveExpression(text, context || {});
  } catch {
    throw sourceError(
      `${label} on the Meta Ads source could not be resolved.`,
      "META_ADS_SOURCE_EXPRESSION"
    );
  }
  if (resolved == null || typeof resolved === "object") {
    throw sourceError(
      `${label} on the Meta Ads source could not be resolved.`,
      "META_ADS_SOURCE_EXPRESSION"
    );
  }
  const value = String(resolved).trim();
  if (!value || value.includes("{{")) {
    throw sourceError(
      `${label} on the Meta Ads source could not be resolved.`,
      "META_ADS_SOURCE_EXPRESSION"
    );
  }
  return value;
}

function resolveMetaAdsAccountContext(mcpNode, context = {}, deps = {}) {
  const sources = listMetaAdsSourceNodes(graphNodes(context));
  const savedId = String(mcpNode?.data?.metaAdsSourceNodeId || "").trim();
  let source = null;
  if (savedId) {
    source = sources.find((node) => String(node.id) === savedId) || null;
    if (!source) {
      throw sourceError(SOURCE_MESSAGES.missing, "META_ADS_SOURCE_MISSING");
    }
  } else if (sources.length === 1) {
    source = sources[0];
  } else if (sources.length === 0) {
    throw sourceError(SOURCE_MESSAGES.none, "META_ADS_SOURCE_REQUIRED");
  } else {
    throw sourceError(SOURCE_MESSAGES.ambiguous, "META_ADS_SOURCE_AMBIGUOUS");
  }

  const data = source.data || {};
  const resolveExpression = deps.resolveExpression;
  const credentialId = resolveSourceValue(
    data.credentialId,
    context,
    resolveExpression,
    "Meta Ads credential"
  );
  if (!credentialId) {
    throw sourceError(SOURCE_MESSAGES.credential, "META_ADS_SOURCE_CREDENTIAL");
  }
  const adAccountId = resolveSourceValue(
    data.adAccountId,
    context,
    resolveExpression,
    "Ad Account"
  );
  if (!adAccountId) {
    throw sourceError(SOURCE_MESSAGES.account, "META_ADS_SOURCE_ACCOUNT");
  }
  return {
    sourceNodeId: String(source.id),
    credentialId,
    adAccountId: metaAds.normalizeAdAccountId(adAccountId),
  };
}

module.exports = {
  ...executor,
  SOURCE_MESSAGES,
  listMetaAdsSourceNodes,
  metaAdsSourceFieldState,
  resolveMetaAdsAccountContext,
};
