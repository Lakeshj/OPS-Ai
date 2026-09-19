const crypto = require("crypto");
const { PluginError, ERROR } = require("../errors");
const { TOOL_SCOPE_NEEDS, hasAnyScope } = require("./scopes");

/**
 * Map OpsAi google_gsc credential fields → MCP child process env.
 * Does not log secrets.
 */
const buildAuthEnv = (authContext = {}, config = {}) => {
  const keys = config.envKeys || {};
  const accessKey = keys.accessToken || "GSC_ACCESS_TOKEN";
  const refreshKey = keys.refreshToken || "GOOGLE_REFRESH_TOKEN";
  const clientIdKey = keys.clientId || "GOOGLE_CLIENT_ID";
  const clientSecretKey = keys.clientSecret || "GOOGLE_CLIENT_SECRET";

  const env = {};
  if (authContext.accessToken) env[accessKey] = String(authContext.accessToken);
  if (authContext.refreshToken) {
    env[refreshKey] = String(authContext.refreshToken);
  }
  if (authContext.clientId) env[clientIdKey] = String(authContext.clientId);
  if (authContext.clientSecret) {
    env[clientSecretKey] = String(authContext.clientSecret);
  }

  // Also set common alternate names used by community MCP servers.
  if (authContext.accessToken) {
    env.GOOGLE_ACCESS_TOKEN = String(authContext.accessToken);
  }
  if (authContext.refreshToken) {
    env.GOOGLE_REFRESH_TOKEN = String(authContext.refreshToken);
  }

  const material = [
    authContext.credentialId || "",
    authContext.workspaceId || "",
    authContext.accountEmail || "",
    authContext.accessToken ? "atok" : "",
    authContext.refreshToken ? "rtok" : "",
  ].join("|");
  const authKey = crypto
    .createHash("sha256")
    .update(material)
    .digest("hex")
    .slice(0, 24);

  return { env, authKey };
};

const assertToolScopes = (tool, authContext = {}, _config = {}) => {
  const name = tool.externalName || tool.name || tool.id;
  const needed = TOOL_SCOPE_NEEDS[name];
  if (!needed) return;
  if (!hasAnyScope(authContext.grantedScopes, needed)) {
    // Soft-warn path: inspection often works with readonly; only hard-fail writes.
    if (tool.write) {
      throw new PluginError(
        `GSC credential scopes are insufficient for ${name}. Reconnect Google with full Search Console access.`,
        ERROR.MCP_SCOPE_INSUFFICIENT,
        { tool: name, needed }
      );
    }
  }
  if (
    !authContext.accessToken &&
    !authContext.refreshToken &&
    tool.category === "data"
  ) {
    // Allowed in mock mode; live stdio servers may still fail at API layer.
  }
};

const requireGoogleAuth = (authContext = {}) => {
  if (!authContext.accessToken && !authContext.refreshToken) {
    throw new PluginError(
      "Google Search Console credential required (connect a google_gsc account).",
      ERROR.MCP_AUTH_REQUIRED
    );
  }
};

module.exports = {
  buildAuthEnv,
  assertToolScopes,
  requireGoogleAuth,
};
