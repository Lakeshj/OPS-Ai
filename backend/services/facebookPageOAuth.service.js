/**
 * Facebook Page Native user OAuth + Page discovery.
 * Independent of Meta Ads and Instagram OAuth services.
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
  getFacebookPageIntegrationStatus,
} = require("../config/facebookPageGraph");
const {
  facebookGraphRequest,
  loadCredentialRow,
  stripSecrets,
  withFacebookPageTestHooks,
  presentPage,
} = require("./workflowFacebookPage.service");

const TOKEN_KIND = "user_long_lived";
const MESSAGE_TYPE = "opsai-facebook-page-oauth";

const hooks = {
  transport: null,
  now: () => Date.now(),
  insertCredential: null,
  updateCredential: null,
};

const withFacebookPageOAuthTestHooks = async (overrides, fn) => {
  const prev = { ...hooks };
  Object.assign(hooks, overrides || {});
  try {
    return await withFacebookPageTestHooks(
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
  const sig = crypto
    .createHmac("sha256", stateSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
};

const verifyState = (state) => {
  const raw = String(state || "");
  const dot = raw.lastIndexOf(".");
  if (dot < 8) {
    throw new AppError("Invalid Facebook Page OAuth state", 400, "FACEBOOK_PAGE_OAUTH_STATE");
  }
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = crypto
    .createHmac("sha256", stateSecret())
    .update(body)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new AppError("Invalid Facebook Page OAuth state", 400, "FACEBOOK_PAGE_OAUTH_STATE");
  }
  const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (!parsed || parsed.flow !== "facebook_page") {
    throw new AppError("Invalid Facebook Page OAuth state", 400, "FACEBOOK_PAGE_OAUTH_STATE");
  }
  if (Number(parsed.exp) < hooks.now()) {
    throw new AppError(
      "Facebook Page connect expired. Start again.",
      400,
      "FACEBOOK_PAGE_OAUTH_STATE"
    );
  }
  return parsed;
};

const consumed = new Set();
const consumeNonce = (parsed) => {
  const nonce = String(parsed?.nonce || "");
  if (!/^[a-f0-9]{16}$/.test(nonce)) {
    throw new AppError("Invalid Facebook Page OAuth state", 400, "FACEBOOK_PAGE_OAUTH_STATE");
  }
  if (consumed.has(nonce)) {
    throw new AppError(
      "Facebook Page connect was already used. Start again.",
      400,
      "FACEBOOK_PAGE_OAUTH_STATE"
    );
  }
  consumed.add(nonce);
};

const resetFacebookPageOAuthNonceStore = () => consumed.clear();

const requireApp = () => {
  const app = appCredentials();
  if (!app.appId || !app.appSecret) {
    const status = getFacebookPageIntegrationStatus();
    const missing =
      (status.missingConfigKeys || []).join(", ") ||
      "FACEBOOK_PAGE_APP_ID, FACEBOOK_PAGE_APP_SECRET";
    throw new AppError(
      `Facebook Page app credentials are not configured. Set ${missing} (or META_APP_* / INSTAGRAM_APP_* when using the same Meta developer app).`,
      500,
      "FACEBOOK_PAGE_APP_NOT_CONFIGURED"
    );
  }
  return app;
};

const oauthTransport = async (url, options) => {
  if (hooks.transport) return hooks.transport(url, options);
  const res = await fetch(url, options);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: { message: "non-json" } };
  }
  return { ok: res.ok, status: res.status, body };
};

const exchangeCode = async (code) => {
  const app = requireApp();
  const params = new URLSearchParams({
    client_id: app.appId,
    client_secret: app.appSecret,
    redirect_uri: app.redirectUri,
    code: String(code || ""),
  });
  const res = await oauthTransport(`${tokenUrl()}?${params.toString()}`, {
    method: "GET",
  });
  if (!res?.ok) {
    throw new AppError(
      stripSecrets(res?.body?.error?.message) || "Facebook Page code exchange failed",
      400,
      "FACEBOOK_PAGE_OAUTH_EXCHANGE"
    );
  }
  return res.body;
};

const exchangeLongLived = async (shortToken) => {
  const app = requireApp();
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: app.appId,
    client_secret: app.appSecret,
    fb_exchange_token: String(shortToken || ""),
  });
  const res = await oauthTransport(`${tokenUrl()}?${params.toString()}`, {
    method: "GET",
  });
  if (!res?.ok) {
    throw new AppError(
      stripSecrets(res?.body?.error?.message) || "Facebook Page token exchange failed",
      400,
      "FACEBOOK_PAGE_OAUTH_EXCHANGE"
    );
  }
  return res.body;
};

const debugToken = async (inputToken) => {
  const app = requireApp();
  const appToken = `${app.appId}|${app.appSecret}`;
  const params = new URLSearchParams({
    input_token: String(inputToken || ""),
    access_token: appToken,
  });
  const res = await oauthTransport(
    `${graphBaseUrl()}/debug_token?${params.toString()}`,
    { method: "GET" }
  );
  if (!res?.ok) return null;
  return res.body?.data || null;
};

const discoverPages = async (userAccessToken) => {
  const rows = [];
  let after = "";
  for (let page = 0; page < 10; page += 1) {
    const body = await facebookGraphRequest({
      accessToken: userAccessToken,
      path: "me/accounts",
      query: {
        fields:
          "id,name,access_token,tasks,category,fan_count,followers_count,link,username,picture.type(large)",
        limit: "50",
        after: after || undefined,
      },
    });
    const data = Array.isArray(body?.data) ? body.data : [];
    rows.push(...data);
    after = String(body?.paging?.cursors?.after || "");
    if (!after || !data.length) break;
  }
  return rows;
};

const startFacebookPageOAuth = async (
  { workspaceId, name, credentialId },
  authUser
) => {
  await assertWorkspaceAccess(authUser, workspaceId);
  const app = requireApp();
  const status = getFacebookPageIntegrationStatus();
  if (!status.facebookPageIntegrationConfigured) {
    throw new AppError(
      "Facebook Page is not configured on the server.",
      500,
      "FACEBOOK_PAGE_APP_NOT_CONFIGURED"
    );
  }
  const nonce = crypto.randomBytes(8).toString("hex");
  const state = signState({
    flow: "facebook_page",
    workspaceId,
    name: name || "Facebook Page",
    credentialId: credentialId || null,
    userId: authUser.id || authUser.userId,
    nonce,
    exp: hooks.now() + 10 * 60 * 1000,
  });
  const params = new URLSearchParams({
    client_id: app.appId,
    redirect_uri: app.redirectUri,
    state,
    response_type: "code",
    scope: OAUTH_SCOPES.join(","),
  });
  return {
    url: `${dialogUrl()}?${params.toString()}`,
    scopes: [...OAUTH_SCOPES],
    callbackOrigin: new URL(app.redirectUri).origin,
    apiVersion: API_VERSION,
  };
};

const finishFacebookPageOAuth = async (code, state) => {
  const parsed = verifyState(state);
  consumeNonce(parsed);

  const short = await exchangeCode(code);
  const shortToken = String(short?.access_token || "").trim();
  if (!shortToken) {
    throw new AppError(
      "Facebook Page did not return an access token.",
      400,
      "FACEBOOK_PAGE_OAUTH_EXCHANGE"
    );
  }
  const long = await exchangeLongLived(shortToken);
  const accessToken = String(long?.access_token || shortToken).trim();
  const expiresIn = Number(long?.expires_in || short?.expires_in || 0);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(hooks.now() + expiresIn * 1000).toISOString()
    : null;

  const debug = await debugToken(accessToken);
  const me = await facebookGraphRequest({
    accessToken,
    path: "me",
    query: { fields: "id,name" },
  });
  const pageRows = await discoverPages(accessToken);
  if (!pageRows.length) {
    throw new AppError(
      "No Facebook Pages were returned for this login. Confirm pages_show_list and Page roles.",
      400,
      "FACEBOOK_PAGE_NONE_FOUND"
    );
  }

  const pagesSecret = {};
  const pagesConfig = [];
  for (const row of pageRows) {
    const pageId = String(row.id || "").trim();
    const pageToken = String(row.access_token || "").trim();
    if (!pageId || !pageToken) continue;
    pagesSecret[pageId] = {
      accessToken: pageToken,
      tasks: Array.isArray(row.tasks) ? row.tasks : [],
      name: row.name == null ? "" : String(row.name),
    };
    const presented = presentPage(row);
    pagesConfig.push({
      pageId: presented.pageId,
      pageName: presented.name,
      category: presented.category,
      username: presented.username,
      link: presented.link,
      fanCount: presented.fanCount,
      followersCount: presented.followersCount,
      pictureUrl: presented.pictureUrl,
      tasks: Array.isArray(row.tasks) ? row.tasks : [],
    });
  }
  if (!Object.keys(pagesSecret).length) {
    throw new AppError(
      "Facebook Pages were found but Page access tokens were missing.",
      400,
      "FACEBOOK_PAGE_TOKEN_MISSING"
    );
  }

  const selectedPageId =
    pagesConfig.find((p) => p.pageId)?.pageId || "";

  const secret = {
    accessToken,
    tokenKind: TOKEN_KIND,
    expiresAt,
    metaUserId: me?.id || debug?.user_id || "",
    metaDisplayName: me?.name || "",
    pages: pagesSecret,
    grantedScopes: Array.isArray(debug?.scopes) ? debug.scopes : [...OAUTH_SCOPES],
  };
  const configJson = {
    metaUserId: secret.metaUserId,
    metaDisplayName: secret.metaDisplayName,
    selectedPageId,
    pages: pagesConfig,
    expiresAt,
  };

  const credentialId = parsed.credentialId || uuidv4();
  const name = await allocateUniqueCredentialName(
    parsed.workspaceId,
    parsed.name || "Facebook Page",
    { excludeId: parsed.credentialId || null }
  );

  if (parsed.credentialId) {
    const existing = await loadCredentialRow(parsed.credentialId, parsed.workspaceId);
    if (!existing || existing.type !== "facebook_page") {
      throw new AppError(
        "Facebook Page credential not found for reconnect.",
        404,
        "NOT_FOUND"
      );
    }
    if (hooks.updateCredential) {
      await hooks.updateCredential(credentialId, secret, configJson);
    } else {
      await pool.execute(
        `UPDATE workflow_credentials SET name = ?, secret_json = ?, config_json = ? WHERE id = ?`,
        [name, encryptSecret(secret), JSON.stringify(configJson), credentialId]
      );
    }
  } else if (hooks.insertCredential) {
    await hooks.insertCredential({
      id: credentialId,
      workspaceId: parsed.workspaceId,
      name,
      type: "facebook_page",
      secret,
      config: configJson,
      createdBy: parsed.userId,
    });
  } else {
    await pool.execute(
      `INSERT INTO workflow_credentials
       (id, workspace_id, name, type, secret_json, config_json, created_by)
       VALUES (?, ?, ?, 'facebook_page', ?, ?, ?)`,
      [
        credentialId,
        parsed.workspaceId,
        name,
        encryptSecret(secret),
        JSON.stringify(configJson),
        parsed.userId,
      ]
    );
  }

  return { credentialId, selectedPageId, pageCount: pagesConfig.length };
};

const listFacebookPages = async (credentialId, authUser) => {
  const cred = await loadCredentialRow(credentialId);
  if (!cred || cred.type !== "facebook_page") {
    throw new AppError("Facebook Page credential not found", 404, "NOT_FOUND");
  }
  await assertWorkspaceAccess(authUser, cred.workspaceId);
  return {
    apiVersion: API_VERSION,
    metaUserId: cred.secret?.metaUserId || cred.config?.metaUserId || "",
    metaDisplayName:
      cred.secret?.metaDisplayName || cred.config?.metaDisplayName || "",
    selectedPageId: cred.config?.selectedPageId || "",
    pages: Array.isArray(cred.config?.pages) ? cred.config.pages : [],
  };
};

const selectFacebookPage = async (credentialId, pageId, authUser) => {
  const id = String(pageId || "").trim();
  if (!/^\d{1,30}$/.test(id)) {
    throw new AppError("A numeric Facebook Page id is required.", 400, "FACEBOOK_PAGE_REQUIRED");
  }
  const cred = await loadCredentialRow(credentialId);
  if (!cred || cred.type !== "facebook_page") {
    throw new AppError("Facebook Page credential not found", 404, "NOT_FOUND");
  }
  await assertWorkspaceAccess(authUser, cred.workspaceId);
  const pages = cred.secret?.pages || {};
  if (!pages[id]?.accessToken) {
    throw new AppError(
      "That Facebook Page is not on this connection. Reconnect Facebook.",
      400,
      "FACEBOOK_PAGE_NOT_ACCESSIBLE"
    );
  }
  const nextConfig = { ...(cred.config || {}), selectedPageId: id };
  if (hooks.updateCredential) {
    await hooks.updateCredential(credentialId, cred.secret, nextConfig);
  } else {
    await pool.execute(
      `UPDATE workflow_credentials SET config_json = ? WHERE id = ?`,
      [JSON.stringify(nextConfig), credentialId]
    );
  }
  return { pageId: id };
};

const allowedFrontendOrigins = () =>
  String(config.cors?.origin || "http://localhost:3001")
    .split(",")
    .map((part) => part.trim().replace(/\/$/, ""))
    .filter(Boolean);

const sanitizeCallbackError = (err) => {
  const code = String(err?.code || "");
  if (code.startsWith("FACEBOOK_PAGE_")) return stripSecrets(err.message);
  return "Facebook Page connect failed";
};

const oauthCallbackHtml = ({ ok, credentialId, error }) => {
  const payload = ok
    ? { type: MESSAGE_TYPE, ok: true, credentialId }
    : {
        type: MESSAGE_TYPE,
        ok: false,
        error: String(error || "Facebook Page connect failed"),
      };
  const json = JSON.stringify(payload);
  const origins = JSON.stringify(allowedFrontendOrigins());
  const visible = ok
    ? "Facebook Page connected. You can close this window."
    : `Facebook Page connect failed: ${payload.error}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>OpsAi Facebook Page OAuth</title></head><body>
<p id="msg">${String(visible).replace(/</g, "&lt;")}</p>
<script>
(function(){
  var payload = ${json};
  var origins = ${origins};
  for (var i = 0; i < origins.length; i++) {
    try { window.opener && window.opener.postMessage(payload, origins[i]); } catch (e) {}
  }
})();
</script>
</body></html>`;
};

const handleFacebookPageOAuthCallback = async (query) => {
  try {
    if (query.error) {
      return oauthCallbackHtml({
        ok: false,
        error: stripSecrets(query.error_description || query.error),
      });
    }
    const finished = await finishFacebookPageOAuth(query.code, query.state);
    return oauthCallbackHtml({ ok: true, credentialId: finished.credentialId });
  } catch (err) {
    return oauthCallbackHtml({ ok: false, error: sanitizeCallbackError(err) });
  }
};

module.exports = {
  MESSAGE_TYPE,
  OAUTH_SCOPES,
  API_VERSION,
  withFacebookPageOAuthTestHooks,
  resetFacebookPageOAuthNonceStore,
  startFacebookPageOAuth,
  finishFacebookPageOAuth,
  listFacebookPages,
  selectFacebookPage,
  handleFacebookPageOAuthCallback,
  getFacebookPageIntegrationStatus,
  discoverPages,
};
