/**
 * Thin host for plugins/instagram-mcp.
 * Resolves Instagram source-node account context and injects native Instagram services.
 * instagramMcpTool uses this. Graph HTTP stays in workflowInstagram*.service.js.
 */
const AppError = require("../utils/AppError");
const ig = require("./workflowInstagram.service");
const igComments = require("./workflowInstagramComments.service");
const { createExecutor } = require("../../plugins/instagram-mcp/src/executor");

const executor = createExecutor({
  AppError,
  getProfile: (spec) => ig.getProfile(spec),
  listMedia: (spec) => ig.listMedia(spec),
  getMedia: (spec) => ig.getMedia(spec),
  listComments: (spec) => igComments.listComments(spec),
  runAccountInsights: (spec) => ig.runAccountInsights(spec),
  runMediaInsights: (spec) => ig.runMediaInsights(spec),
});

const SOURCE_MESSAGES = Object.freeze({
  none: "Add and configure an Instagram node first.",
  missing: "The selected Instagram source is no longer in this workflow.",
  credential: "Configure an Instagram credential on the selected Instagram node.",
  ambiguous: "Select which Instagram node supplies the account.",
});

function sourceError(message, code) {
  return new AppError(message, 400, code);
}

function graphNodes(context) {
  const graph = context?.graph || context?.definition;
  return Array.isArray(graph?.nodes) ? graph.nodes : [];
}

function isInstagramNode(node) {
  const type = node?.type || node?.data?.nodeType;
  return type === "instagram";
}

function listInstagramSourceNodes(nodes) {
  return (Array.isArray(nodes) ? nodes : []).filter(isInstagramNode);
}

/**
 * UI state for Instagram Source. Execution uses resolveInstagramAccountContext.
 * showSelector is false when the workflow has exactly one usable Instagram node.
 */
function instagramSourceFieldState(nodes, savedSourceId) {
  const sources = listInstagramSourceNodes(nodes).map((node) => ({
    id: String(node.id),
    label: String(node.data?.label || "Instagram"),
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
      `${label} on the Instagram source could not be resolved.`,
      "INSTAGRAM_SOURCE_EXPRESSION"
    );
  }
  let resolved;
  try {
    resolved = resolveExpression(text, context || {});
  } catch {
    throw sourceError(
      `${label} on the Instagram source could not be resolved.`,
      "INSTAGRAM_SOURCE_EXPRESSION"
    );
  }
  if (resolved == null || typeof resolved === "object") {
    throw sourceError(
      `${label} on the Instagram source could not be resolved.`,
      "INSTAGRAM_SOURCE_EXPRESSION"
    );
  }
  const value = String(resolved).trim();
  if (!value || value.includes("{{")) {
    throw sourceError(
      `${label} on the Instagram source could not be resolved.`,
      "INSTAGRAM_SOURCE_EXPRESSION"
    );
  }
  return value;
}

function resolveInstagramSourceNode(mcpNode, context = {}) {
  const sources = listInstagramSourceNodes(graphNodes(context));
  const savedId = String(mcpNode?.data?.instagramSourceNodeId || "").trim();
  if (savedId) {
    const source = sources.find((node) => String(node.id) === savedId) || null;
    if (!source) {
      throw sourceError(SOURCE_MESSAGES.missing, "INSTAGRAM_SOURCE_MISSING");
    }
    return source;
  }
  if (sources.length === 1) return sources[0];
  if (sources.length === 0) {
    throw sourceError(SOURCE_MESSAGES.none, "INSTAGRAM_SOURCE_REQUIRED");
  }
  throw sourceError(SOURCE_MESSAGES.ambiguous, "INSTAGRAM_SOURCE_AMBIGUOUS");
}

/**
 * Sync binding: credentialId from the native Instagram source node.
 * Instagram user id is resolved from that credential (never stored on the MCP node).
 */
function resolveInstagramAccountBinding(mcpNode, context = {}, deps = {}) {
  const source = resolveInstagramSourceNode(mcpNode, context);
  const data = source.data || {};
  const resolveExpression = deps.resolveExpression;
  const credentialId = resolveSourceValue(
    data.credentialId,
    context,
    resolveExpression,
    "Instagram credential"
  );
  if (!credentialId) {
    throw sourceError(SOURCE_MESSAGES.credential, "INSTAGRAM_SOURCE_CREDENTIAL");
  }
  const explicitUserId = resolveSourceValue(
    data.instagramUserId,
    context,
    resolveExpression,
    "Instagram user id"
  );
  return {
    sourceNodeId: String(source.id),
    credentialId,
    explicitInstagramUserId: explicitUserId || "",
  };
}

async function resolveInstagramAccountContext(mcpNode, context = {}, deps = {}) {
  const binding = resolveInstagramAccountBinding(mcpNode, context, deps);
  const resolveCredential =
    deps.resolveCredentialContext || ig.resolveCredentialContext;
  const resolved = await resolveCredential({
    credentialId: binding.credentialId,
    workspaceId: context.workspaceId,
  });
  const instagramUserId = String(
    binding.explicitInstagramUserId || resolved.instagramUserId || ""
  ).trim();
  if (!instagramUserId) {
    throw sourceError(
      "Could not read the Instagram professional account from the selected source.",
      "INSTAGRAM_SOURCE_ACCOUNT"
    );
  }
  return {
    sourceNodeId: binding.sourceNodeId,
    credentialId: binding.credentialId,
    instagramUserId,
    cred: resolved.cred,
  };
}

module.exports = {
  ...executor,
  SOURCE_MESSAGES,
  listInstagramSourceNodes,
  instagramSourceFieldState,
  resolveInstagramSourceNode,
  resolveInstagramAccountBinding,
  resolveInstagramAccountContext,
};
