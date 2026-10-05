/**
 * Thin host for plugins/google-ads-mcp.
 * Injects the shared Google Ads HTTP client and customer-id normalizer.
 * googleAdsMcpTool and legacy mcpDynamicTool (provider google_ads) both use this.
 */
const AppError = require("../utils/AppError");
const googleOAuth = require("./googleOAuth.service");
const { normalizeCustomerId } = require("./workflowGoogleAds.service");
const { createExecutor } = require("../../plugins/google-ads-mcp/src/executor");

const executor = createExecutor({
  AppError,
  apiVersion: googleOAuth.GOOGLE_ADS_API_VERSION,
  normalizeCustomerId,
  googleApiRequest: (spec) => googleOAuth.googleApiRequest(spec),
});

const SOURCE_MESSAGES = Object.freeze({
  none: "Add and configure a Google Ads node first.",
  missing: "The selected Google Ads source is no longer in this workflow.",
  credential: "Configure a Google Ads credential on the selected Google Ads node.",
  customer: "Configure a Customer ID on the selected Google Ads node.",
  ambiguous: "Select which Google Ads node supplies the account.",
});

function sourceError(message, code) {
  return new AppError(message, 400, code);
}

function graphNodes(context) {
  const graph = context?.graph || context?.definition;
  return Array.isArray(graph?.nodes) ? graph.nodes : [];
}

function isGoogleAdsNode(node) {
  const type = node?.type || node?.data?.nodeType;
  return type === "googleAds";
}

function listGoogleAdsSourceNodes(nodes) {
  return (Array.isArray(nodes) ? nodes : []).filter(isGoogleAdsNode);
}

/**
 * UI state for Google Ads Source. Execution uses resolveGoogleAdsAccountContext.
 * showSelector is false when the workflow has exactly one usable Google Ads node.
 */
function googleAdsSourceFieldState(nodes, savedSourceId) {
  const sources = listGoogleAdsSourceNodes(nodes).map((node) => ({
    id: String(node.id),
    label: String(node.data?.label || "Google Ads"),
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
      `${label} on the Google Ads source could not be resolved.`,
      "GOOGLE_ADS_SOURCE_EXPRESSION"
    );
  }
  let resolved;
  try {
    resolved = resolveExpression(text, context || {});
  } catch {
    throw sourceError(
      `${label} on the Google Ads source could not be resolved.`,
      "GOOGLE_ADS_SOURCE_EXPRESSION"
    );
  }
  if (resolved == null || typeof resolved === "object") {
    throw sourceError(
      `${label} on the Google Ads source could not be resolved.`,
      "GOOGLE_ADS_SOURCE_EXPRESSION"
    );
  }
  const value = String(resolved).trim();
  if (!value || value.includes("{{")) {
    throw sourceError(
      `${label} on the Google Ads source could not be resolved.`,
      "GOOGLE_ADS_SOURCE_EXPRESSION"
    );
  }
  return value;
}

function resolveGoogleAdsAccountContext(mcpNode, context = {}, deps = {}) {
  const sources = listGoogleAdsSourceNodes(graphNodes(context));
  const savedId = String(mcpNode?.data?.googleAdsSourceNodeId || "").trim();
  let source = null;
  if (savedId) {
    source = sources.find((node) => String(node.id) === savedId) || null;
    if (!source) {
      throw sourceError(SOURCE_MESSAGES.missing, "GOOGLE_ADS_SOURCE_MISSING");
    }
  } else if (sources.length === 1) {
    source = sources[0];
  } else if (sources.length === 0) {
    throw sourceError(SOURCE_MESSAGES.none, "GOOGLE_ADS_SOURCE_REQUIRED");
  } else {
    throw sourceError(SOURCE_MESSAGES.ambiguous, "GOOGLE_ADS_SOURCE_AMBIGUOUS");
  }

  const data = source.data || {};
  const resolveExpression = deps.resolveExpression;
  const credentialId = resolveSourceValue(
    data.credentialId,
    context,
    resolveExpression,
    "Google Ads credential"
  );
  if (!credentialId) {
    throw sourceError(SOURCE_MESSAGES.credential, "GOOGLE_ADS_SOURCE_CREDENTIAL");
  }
  const customerId = resolveSourceValue(
    data.customerId,
    context,
    resolveExpression,
    "Customer ID"
  );
  if (!customerId) {
    throw sourceError(SOURCE_MESSAGES.customer, "GOOGLE_ADS_SOURCE_CUSTOMER");
  }
  const loginText = data.loginCustomerId == null ? "" : String(data.loginCustomerId).trim();
  const loginCustomerId = loginText
    ? resolveSourceValue(
        data.loginCustomerId,
        context,
        resolveExpression,
        "Login customer ID"
      )
    : "";
  return {
    sourceNodeId: String(source.id),
    credentialId,
    customerId,
    loginCustomerId,
  };
}

module.exports = {
  ...executor,
  SOURCE_MESSAGES,
  listGoogleAdsSourceNodes,
  googleAdsSourceFieldState,
  resolveGoogleAdsAccountContext,
};
