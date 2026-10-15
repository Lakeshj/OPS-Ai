/**
 * Meta Ads user OAuth.
 * Web login returns a short-lived token. The server exchanges that once for a
 * long-lived user token. Meta does not provide a refresh token, and an expired
 * token cannot be exchanged. Reconnect is required after expiry.
 *
 * System-user tokens are later/advanced and are not part of this connection.
 */

const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const AppError = require("../utils/AppError");
const config = require("../config");
const { pool } = require("../config/database");
const { encryptSecret } = require("./secretBox.service");
const { assertWorkspaceAccess } = require("./authorization.service");
const { allocateUniqueCredentialName } = require("./credentialName.util");
const {
  API_VERSION,
  OAUTH_SCOPES,
  dialogUrl,
  tokenUrl,
  graphBaseUrl,
  appCredentials,
} = require("../config/metaGraph");
const {
  metaGraphRequest,
  collectPages,
  presentAdAccount,
  loadCredentialRow,
  normalizeAdAccountId,
  stripSecrets,
  mapMetaError,
  withMetaTestHooks,
} = require("./workflowMetaAds.service");

const TOKEN_KIND = "user_long_lived";
const MESSAGE_TYPE = "opsai-meta-oauth";

const hooks = {
  transport: null,
  now: () => Date.now(),
  insertCredential: null,
  updateCredential: null,
  logger: () => {},
};

const withMetaOAuthTestHooks = async (overrides, fn) => {
  const prev = { ...hooks };
  Object.assign(hooks, overrides || {});
  try {
    return await withMetaTestHooks(
      {
        transport: overrides?.transport,
        now: overrides?.now,
        loadCredential: overrides?.loadCredential,
      },
      fn
    );
  } finally {
    Object.assign(hooks, prev);
  }
};

const stateSecret = () =>
  String(config.workflows.credentialsKey || config.jwt.secret || "dev");

const signState = (payload) => {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", stateSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
};

const verifyState = (state) => {
  const raw = String(state || "");
  const dot = raw.lastIndexOf(".");
  if (dot < 8) throw new AppError("Invalid Meta OAuth state", 400, "META_OAUTH_STATE");
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = crypto.createHmac("sha256", stateSecret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new AppError("Invalid Meta OAuth state", 400, "META_OAUTH_STATE");
  }
  const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (!parsed || parsed.flow !== "meta_ads") {
    throw new AppError("Invalid Meta OAuth state", 400, "META_OAUTH_STATE");
  }
  if (Number(parsed.exp) < hooks.now()) {
    throw new AppError("Meta connect expired. Start again.", 400, "META_OAUTH_STATE");
  }
  return parsed;
};

const consumed = new Set();
const consumeNonce = (parsed) => {
  const nonce = String(parsed?.nonce || "");
  if (!/^[a-f0-9]{16}$/.test(nonce)) {
    throw new AppError("Invalid Meta OAuth state", 400, "META_OAUTH_STATE");
  }
  if (consumed.has(nonce)) {
    throw new AppError("Meta connect was already used. Start again.", 400, "META_OAUTH_STATE");
  }
  consumed.add(nonce);
};

const resetMetaOAuthNonceStore = () => consumed.clear();

const requireApp = () => {
  const app = appCredentials();
  if (!app.appId || !app.appSecret) {
    throw new AppError(
      "Meta app credentials are not configured on the server.",
      500,
      "META_APP_NOT_CONFIGURED"
    );
  }
  return app;
};

const callToken = async (params) => {
  const url = `${tokenUrl()}?${params.toString()}`;
  const transport = hooks.transport;
  if (!transport) {
    const res = await fetch(url, { method: "GET" });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { error: { message: "Meta token response was not JSON" } };
    }
    return { ok: res.ok, status: res.status, body };
  }
  return transport(url, { method: "GET" });
};

const tokenFromBody = (res) => {
  if (!res?.ok || !res.body?.access_token) {
    throw mapMetaError(res?.status, res?.body);
  }
  return {
    accessToken: String(res.body.access_token),
    expiresIn: Number(res.body.expires_in),
  };
};

const exchangeAuthorizationCode = async ({ code, app }) => {
  const params = new URLSearchParams({
    client_id: app.appId,
    redirect_uri: app.redirectUri,
    client_secret: app.appSecret,
    code: String(code || ""),
  });
  const res = await callToken(params);
  hooks.logger({ event: "meta_code_exchange", status: res?.status, ok: Boolean(res?.ok) });
  return tokenFromBody(res);
};

const exchangeLongLived = async ({ shortLivedToken, app }) => {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: app.appId,
    client_secret: app.appSecret,
    fb_exchange_token: shortLivedToken,
  });
  const res = await callToken(params);
  hooks.logger({ event: "meta_long_lived_exchange", status: res?.status, ok: Boolean(res?.ok) });
  return tokenFromBody(res);
};

const debugToken = async ({ accessToken, app }) => {
  const params = new URLSearchParams({
    input_token: accessToken,
    access_token: `${app.appId}|${app.appSecret}`,
  });
  const url = `${graphBaseUrl()}/debug_token?${params.toString()}`;
  const transport = hooks.transport;
  const res = transport
    ? await transport(url, { method: "GET" })
    : await (async () => {
        const response = await fetch(url, { method: "GET" });
        const text = await response.text();
        let body = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = null;
        }
        return { ok: response.ok, status: response.status, body };
      })();
  hooks.logger({ event: "meta_debug_token", status: res?.status, ok: Boolean(res?.ok) });
  const data = res?.body?.data;
  if (!res?.ok || !data) return null;
  return data;
};

const expiresAtFrom = (expiresIn, debug) => {
  const debugExpiry = Number(debug?.expires_at);
  if (Number.isFinite(debugExpiry) && debugExpiry > 0) {
    return new Date(debugExpiry * 1000).toISOString();
  }
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    return new Date(hooks.now() + expiresIn * 1000).toISOString();
  }
  return null;
};

const grantedPermissions = (debug) => {
  const scopes = Array.isArray(debug?.scopes) ? debug.scopes.map(String) : [];
  const granular = Array.isArray(debug?.granular_scopes)
    ? debug.granular_scopes.map((row) => String(row?.scope || "")).filter(Boolean)
    : [];
  return [...new Set([...scopes, ...granular])];
};

const publicConfig = (secret) => ({
  connected: true,
  tokenKind: TOKEN_KIND,
  expiresAt: secret.expiresAt || null,
  grantedPermissions: Array.isArray(secret.grantedPermissions)
    ? secret.grantedPermissions
    : [],
  metaUserId: secret.metaUserId || "",
  metaDisplayName: secret.metaDisplayName || "",
  reconnectRequired: false,
});

const saveConnectedCredential = async ({ parsed, secret }) => {
  const configJson = {
    ...publicConfig(secret),
  };
  if (parsed.credentialId && hooks.updateCredential) {
    await hooks.updateCredential(parsed.credentialId, secret, configJson);
    return parsed.credentialId;
  }
  if (parsed.credentialId) {
    await pool.execute(
      `UPDATE workflow_credentials SET secret_json = ?, config_json = ? WHERE id = ?`,
      [encryptSecret(secret), JSON.stringify(configJson), parsed.credentialId]
    );
    return parsed.credentialId;
  }
  const id = uuidv4();
  const name = hooks.insertCredential
    ? parsed.name || "Meta Ads"
    : await allocateUniqueCredentialName(parsed.workspaceId, parsed.name || "Meta Ads");
  if (hooks.insertCredential) {
    await hooks.insertCredential({ id, name, secret, config: configJson, parsed });
    return id;
  }
  await pool.execute(
    `INSERT INTO workflow_credentials
      (id, workspace_id, name, type, secret_json, config_json, created_by)
     VALUES (?, ?, ?, 'meta_ads', ?, ?, ?)`,
    [
      id,
      parsed.workspaceId,
      name,
      encryptSecret(secret),
      JSON.stringify(configJson),
      parsed.userId,
    ]
  );
  return id;
};

const startMetaOAuth = async ({ workspaceId, name, credentialId }, authUser) => {
  await assertWorkspaceAccess(authUser, workspaceId);
  const app = requireApp();
  const actorUserId = String(authUser?.userId || authUser?.id || "").trim();
  if (!actorUserId) throw new AppError("Not authenticated", 401, "UNAUTHORIZED");
  if (credentialId) {
    const existing = await loadCredentialRow(credentialId, workspaceId);
    if (!existing || existing.type !== "meta_ads") {
      throw new AppError("Meta Ads credential not found", 404, "NOT_FOUND");
    }
  }
  const state = signState({
    flow: "meta_ads",
    workspaceId,
    userId: actorUserId,
    name: String(name || "Meta Ads").slice(0, 80),
    credentialId: credentialId || null,
    scopes: [...OAUTH_SCOPES],
    exp: hooks.now() + 10 * 60 * 1000,
    nonce: crypto.randomBytes(8).toString("hex"),
  });
  const params = new URLSearchParams({
    client_id: app.appId,
    redirect_uri: app.redirectUri,
    state,
    response_type: "code",
    scope: OAUTH_SCOPES.join(","),
  });
  let callbackOrigin = "";
  try {
    callbackOrigin = new URL(app.redirectUri).origin;
  } catch {
    callbackOrigin = "";
  }
  return {
    url: `${dialogUrl()}?${params.toString()}`,
    callbackOrigin,
    redirectUri: app.redirectUri,
    scopes: [...OAUTH_SCOPES],
    apiVersion: API_VERSION,
  };
};

const finishMetaOAuth = async (code, state) => {
  const parsed = verifyState(state);
  consumeNonce(parsed);
  const app = requireApp();
  const shortLived = await exchangeAuthorizationCode({ code, app });
  const longLived = await exchangeLongLived({
    shortLivedToken: shortLived.accessToken,
    app,
  });
  const debug = await debugToken({ accessToken: longLived.accessToken, app });
  const permissions = grantedPermissions(debug);
  if (permissions.length && !permissions.includes("ads_read")) {
    throw new AppError(
      "Meta did not grant ads_read. Reconnect and allow ad account read access.",
      403,
      "META_PERMISSION_DENIED"
    );
  }
  const profile = await metaGraphRequest({
    accessToken: longLived.accessToken,
    path: "me",
    query: { fields: "id,name" },
  });
  const secret = {
    accessToken: longLived.accessToken,
    tokenKind: TOKEN_KIND,
    expiresAt: expiresAtFrom(longLived.expiresIn, debug),
    grantedPermissions: permissions.length ? permissions : ["ads_read"],
    metaUserId: String(profile?.id || debug?.user_id || ""),
    metaDisplayName: String(profile?.name || ""),
  };
  const credentialId = await saveConnectedCredential({ parsed, secret });
  return { credentialId, workspaceId: parsed.workspaceId };
};

const reconnectState = (secret) => {
  const expiresAt = secret?.expiresAt ? Date.parse(secret.expiresAt) : NaN;
  if (!Number.isFinite(expiresAt)) return { reconnectRequired: false, reconnectSoon: false };
  const remaining = expiresAt - hooks.now();
  return {
    reconnectRequired: remaining <= 0,
    reconnectSoon: remaining > 0 && remaining <= 7 * 24 * 60 * 60 * 1000,
  };
};

const testMetaCredential = async (credentialId, authUser) => {
  const cred = await loadCredentialRow(credentialId);
  if (!cred || cred.type !== "meta_ads") {
    throw new AppError("Meta Ads credential not found", 404, "NOT_FOUND");
  }
  await assertWorkspaceAccess(authUser, cred.workspaceId);
  const life = reconnectState(cred.secret);
  if (life.reconnectRequired) {
    throw new AppError(
      "Meta login expired. Reconnect Meta Ads.",
      401,
      "META_TOKEN_INVALID"
    );
  }
  const profile = await metaGraphRequest({
    credentialId,
    workspaceId: cred.workspaceId,
    path: "me",
    query: { fields: "id,name" },
  });
  const accounts = await listMetaAdAccounts(credentialId, authUser, { limit: 5, maxPages: 1 });
  return {
    ok: true,
    type: "meta_ads",
    apiVersion: API_VERSION,
    metaUserId: String(profile?.id || ""),
    metaDisplayName: String(profile?.name || ""),
    expiresAt: cred.secret?.expiresAt || null,
    reconnectSoon: life.reconnectSoon,
    adAccountCount: accounts.adAccounts.length,
  };
};

const listMetaAdAccounts = async (credentialId, authUser, options = {}) => {
  const cred = await loadCredentialRow(credentialId);
  if (!cred || cred.type !== "meta_ads") {
    throw new AppError("Meta Ads credential not found", 404, "NOT_FOUND");
  }
  await assertWorkspaceAccess(authUser, cred.workspaceId);
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 50);
  const rows = await collectPages({
    maxPages: options.maxPages || 10,
    maxRows: options.maxRows || 200,
    requestPage: (after) =>
      metaGraphRequest({
        credentialId,
        workspaceId: cred.workspaceId,
        path: "me/adaccounts",
        query: {
          fields: "id,account_id,name,account_status,currency,timezone_name",
          limit,
          after: after || undefined,
        },
      }),
  });
  return {
    apiVersion: API_VERSION,
    metaUserId: cred.secret?.metaUserId || cred.config?.metaUserId || "",
    metaDisplayName: cred.secret?.metaDisplayName || cred.config?.metaDisplayName || "",
    selectedAdAccountId: cred.config?.selectedAdAccountId || "",
    adAccounts: rows.map(presentAdAccount),
  };
};

const selectMetaAdAccount = async (credentialId, adAccountId, authUser) => {
  const numericId = normalizeAdAccountId(adAccountId);
  const cred = await loadCredentialRow(credentialId);
  if (!cred || cred.type !== "meta_ads") {
    throw new AppError("Meta Ads credential not found", 404, "NOT_FOUND");
  }
  await assertWorkspaceAccess(authUser, cred.workspaceId);
  const nextConfig = { ...(cred.config || {}), selectedAdAccountId: numericId };
  if (hooks.updateCredential) {
    await hooks.updateCredential(credentialId, cred.secret, nextConfig);
  } else {
    await pool.execute(
      `UPDATE workflow_credentials SET config_json = ? WHERE id = ?`,
      [JSON.stringify(nextConfig), credentialId]
    );
  }
  return { adAccountId: numericId, apiId: `act_${numericId}` };
};

const allowedFrontendOrigins = () =>
  String(config.cors?.origin || "http://localhost:3001")
    .split(",")
    .map((part) => part.trim().replace(/\/$/, ""))
    .filter(Boolean);

const sanitizeCallbackError = (err) => {
  const code = String(err?.code || "");
  if (code.startsWith("META_")) return stripSecrets(err.message);
  return "Meta connect failed";
};

const oauthCallbackHtml = ({ ok, credentialId, error }) => {
  const payload = ok
    ? { type: MESSAGE_TYPE, ok: true, credentialId }
    : { type: MESSAGE_TYPE, ok: false, error: String(error || "Meta connect failed") };
  const json = JSON.stringify(payload);
  const origins = JSON.stringify(allowedFrontendOrigins());
  const visible = ok
    ? "Meta Ads connected. You can close this window."
    : `Meta connect failed: ${payload.error || "Meta connect failed"}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>OpsAi Meta OAuth</title></head><body>
<p id="msg">${String(visible).replace(/</g, "&lt;")}</p>
<script>
(function(){
  var payload = ${json};
  var origins = ${origins};
  if (window.opener) {
    origins.forEach(function(origin){
      try { window.opener.postMessage(payload, origin); } catch (e) {}
    });
  }
  setTimeout(function(){ try { window.close(); } catch (e) {} }, 1200);
})();
</script>
</body></html>`;
};

const applyOAuthPopupResponseHeaders = (res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; base-uri 'none'; form-action 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'none'"
  );
  res.setHeader("Cross-Origin-Opener-Policy", "unsafe-none");
};

module.exports = {
  TOKEN_KIND,
  MESSAGE_TYPE,
  OAUTH_SCOPES,
  withMetaOAuthTestHooks,
  resetMetaOAuthNonceStore,
  signState,
  exchangeAuthorizationCode,
  exchangeLongLived,
  startMetaOAuth,
  finishMetaOAuth,
  testMetaCredential,
  listMetaAdAccounts,
  selectMetaAdAccount,
  reconnectState,
  sanitizeCallbackError,
  oauthCallbackHtml,
  applyOAuthPopupResponseHeaders,
};
