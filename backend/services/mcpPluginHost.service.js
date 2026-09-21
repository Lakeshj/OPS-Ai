/**
 * OpsAi host for the GSC MCP plugin (Phase 1).
 * Loads plugins/gsc-mcp and bridges google_gsc credentials.
 */
const path = require("path");
const AppError = require("../utils/AppError");

const PLUGIN_ROOT = path.join(__dirname, "../../plugins/gsc-mcp");

let pluginSingleton = null;

const loadPluginModule = () =>
  // eslint-disable-next-line import/no-dynamic-require, global-require
  require(path.join(PLUGIN_ROOT, "src/index.js"));

const getPlugin = () => {
  if (pluginSingleton) return pluginSingleton;
  const mod = loadPluginModule();
  const transport = process.env.OPSAI_GSC_MCP_TRANSPORT || "mock";
  pluginSingleton = mod.createPlugin({ transport });
  return pluginSingleton;
};

const resetPluginForTests = async () => {
  if (pluginSingleton?.close) {
    await pluginSingleton.close().catch(() => null);
  }
  pluginSingleton = null;
};

const resolveAuthContext = async ({ credentialId, workspaceId, authUser }) => {
  if (!credentialId) {
    return { workspaceId };
  }
  const googleOAuth = require("./googleOAuth.service");
  if (workspaceId && authUser) {
    const { assertWorkspaceAccess } = require("./authorization.service");
    await assertWorkspaceAccess(authUser, workspaceId);
  }

  const cred = await googleOAuth.loadCredential(credentialId, workspaceId);
  if (cred.type !== "google_gsc") {
    throw new AppError(
      "GSC MCP requires a google_gsc credential",
      400,
      "MCP_AUTH_REQUIRED"
    );
  }

  let secret = { ...(cred.secret || {}) };
  try {
    const valid = await googleOAuth.getValidAccessToken(
      secret,
      cred.config || {}
    );
    if (valid && typeof valid === "object") {
      secret = { ...secret, ...valid };
    }
  } catch {
    // Keep whatever token we have; mock transport still works.
  }
  const accessToken = secret.accessToken || "";

  const app = googleOAuth.resolveOAuthApp(secret, cred.config || {});

  return {
    workspaceId: cred.workspaceId,
    credentialId: cred.id,
    accessToken,
    refreshToken: secret.refreshToken || "",
    clientId: app.clientId || "",
    clientSecret: app.clientSecret || secret.clientSecret || "",
    grantedScopes: Array.isArray(secret.scopes) ? secret.scopes : [],
    accountEmail: cred.config?.accountEmail || "",
  };
};

const listGscMcpTools = async ({
  credentialId,
  workspaceId,
  authUser,
  audience,
}) => {
  const plugin = getPlugin();
  const authContext = credentialId
    ? await resolveAuthContext({ credentialId, workspaceId, authUser })
    : { workspaceId };
  const tools = await plugin.listTools(authContext, {
    audience: audience || "agent",
  });
  return {
    tools,
    metrics: plugin.contracts?.metrics?.metricOptionsForUi?.() || [],
    systemHints: plugin.systemPromptHints(),
    audience: audience || "agent",
  };
};

const executeGscMcpTool = async ({
  toolId,
  toolArgs,
  mode,
  credentialId,
  workspaceId,
  authUser,
}) => {
  const plugin = getPlugin();
  const authContext = credentialId
    ? await resolveAuthContext({ credentialId, workspaceId, authUser })
    : { workspaceId };
  return plugin.executeWorkflowTool({
    toolId,
    toolArgs: toolArgs || {},
    mode: mode || "raw",
    authContext,
  });
};

const executeGscMcpNode = async (node, context) => {
  const err = new Error(
    "GSC MCP is not a user-facing workflow node. Use the Google Search Console node for analytics, then GSC MCP Tools to process those rows. Capability APIs remain available for the Assistant and future intelligence nodes."
  );
  err.code = "MCP_NOT_USER_FACING";
  throw err;
};

/**
 * Main-flow processor: GSC → GSC MCP Tools → Filter/Sort/AI.
 * No credentials — consumes previous-node WorkflowItems only.
 */
const executeGscMcpToolsProcessor = async (node, context) => {
  const plugin = getPlugin();
  const data = node.data || {};
  // Canonical multi-select: capabilities[]. Keep capability for legacy configs.
  // Important: [] must win over falling through to "ctr_opportunities".
  const hasCapabilitiesField = Object.prototype.hasOwnProperty.call(
    data,
    "capabilities"
  );
  const hasCapabilityField = Object.prototype.hasOwnProperty.call(
    data,
    "capability"
  );
  const selected = hasCapabilitiesField
    ? data.capabilities
    : hasCapabilityField
      ? data.capability
      : data.operation ?? "ctr_opportunities";
  const result = plugin.processUpstreamItems({
    capability: selected,
    capabilities: Array.isArray(data.capabilities) ? data.capabilities : undefined,
    inputItems: context.inputItems || [],
    title: data.title ? String(data.title) : undefined,
    nodeData: data,
    previousRows: Array.isArray(data.previousRows) ? data.previousRows : undefined,
    context,
    sourceMeta: {
      property: data.property || data.siteUrl || undefined,
      period: {
        start: data.startDate || undefined,
        end: data.endDate || undefined,
      },
    },
  });
  if (!result.ok) {
    const err = new Error(
      result.error?.message || "GSC MCP Tools processing failed"
    );
    err.code = result.error?.code || "MCP_TOOL_FAILED";
    err.meta = {
      receivedCapability: data.capability,
      receivedCapabilities: data.capabilities,
      selected,
      ...(result.output || {}),
    };
    throw err;
  }
  if (result.output && typeof result.output === "object") {
    const byCap = {};
    for (const it of result.items || []) {
      const row = it?.json || it;
      const cap = row && typeof row === "object" ? String(row.capability || "") : "";
      if (!cap || !row.opportunity_type) continue;
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
    };
    if (typeof console !== "undefined" && console.debug) {
      console.debug("[gsc-mcp-tools]", result.output.runtimeDiagnostics);
    }
  }
  return result;
};

const intentHints = (text) => {
  const plugin = getPlugin();
  return {
    suggestions: plugin.suggestToolsForIntent(text),
    systemHints: plugin.systemPromptHints(),
  };
};

/** Shared facade for Assistant / Agent / future GSC intelligence nodes */
const executeCapability = async ({
  toolId,
  toolArgs,
  mode,
  credentialId,
  workspaceId,
  authUser,
}) =>
  executeGscMcpTool({
    toolId,
    toolArgs,
    mode,
    credentialId,
    workspaceId,
    authUser,
  });

const getCapabilityContracts = () => {
  const plugin = getPlugin();
  return plugin.contracts;
};

module.exports = {
  getPlugin,
  resetPluginForTests,
  listGscMcpTools,
  executeGscMcpTool,
  executeGscMcpNode,
  executeGscMcpToolsProcessor,
  executeCapability,
  getCapabilityContracts,
  resolveAuthContext,
  intentHints,
  PLUGIN_ROOT,
};
