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

const metaErrorHint = (body) => {
  const err = body?.error && typeof body.error === "object" ? body.error : null;
  if (!err) return "";
  const code = err.code != null ? String(err.code) : "";
  const subcode = err.error_subcode != null ? String(err.error_subcode) : "";
  const type = err.type != null ? String(err.type) : "";
  const parts = [];
  if (code) parts.push(`code ${code}`);
  if (subcode) parts.push(`subcode ${subcode}`);
  if (type) parts.push(type);
  return parts.length ? ` (${parts.join(", ")})` : "";
};

const pageOAuthError = (message, code, statusCode = 400, extras = {}) => {
  const err = new AppError(message, statusCode, code);
  if (extras.stage) err.stage = String(extras.stage);
  if (extras.metaCode != null) err.metaCode = extras.metaCode;
  if (extras.metaSubcode != null) err.metaSubcode = extras.metaSubcode;
  if (extras.pageCount != null) err.pageCount = extras.pageCount;
  if (extras.grantedScopes != null) err.grantedScopes = extras.grantedScopes;
  return err;
};

const logFacebookPageOAuthStage = (payload) => {
  const safe = {
    event: "facebook_page_oauth_stage",
    ...payload,
  };
  console.error("[facebook-page-oauth]", JSON.stringify(safe));
};

/**
 * Safe schema probe — never logs secrets. Used before INSERT and by status.
 */
const inspectFacebookPageCredentialSchema = async () => {
  try {
    const [typeRows] = await pool.query(
      "SHOW COLUMNS FROM workflow_credentials LIKE 'type'"
    );
    const typeCol = String(typeRows?.[0]?.Type || "");
    const [cfgRows] = await pool.query(
      `SELECT COUNT(*) AS n
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'workflow_credentials'
         AND COLUMN_NAME = 'config_json'`
    );
    const configJsonColumnPresent = Number(cfgRows?.[0]?.n || 0) > 0;
    const facebookPageTypeSupported = typeCol.includes("'facebook_page'");
    return {
      credentialSchemaReady:
        facebookPageTypeSupported && configJsonColumnPresent,
      facebookPageTypeSupported,
      configJsonColumnPresent,
    };
  } catch (err) {
    return {
      credentialSchemaReady: false,
      facebookPageTypeSupported: false,
      configJsonColumnPresent: false,
      schemaCheckErrorClass: String(err?.code || "SCHEMA_CHECK_FAILED").slice(
        0,
        40
      ),
    };
  }
};

const classifyCredentialSaveError = (err) => {
  const code = String(err?.code || "");
  const message = String(err?.message || "");
  if (
    code === "WARN_DATA_TRUNCATED" ||
    code === "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD" ||
    code === "ER_WRONG_VALUE_FOR_TYPE" ||
    /Data truncated for column ['`]?type['`]?/i.test(message) ||
    /unknown.*facebook_page|invalid.*facebook_page/i.test(message)
  ) {
    return pageOAuthError(
      "Facebook Page credential type is not available in the database schema. Apply migration 033_facebook_page_credential.sql.",
      "FACEBOOK_PAGE_CREDENTIAL_SCHEMA",
      500,
      { stage: "credential_persist" }
    );
  }
  if (
    code === "ER_NO_REFERENCED_ROW_2" ||
    code === "ER_NO_REFERENCED_ROW" ||
    /foreign key|CONSTRAINT/i.test(message)
  ) {
    return pageOAuthError(
      "Facebook Page credential could not be saved for this workspace or user.",
      "FACEBOOK_PAGE_CREDENTIAL_FK",
      500,
      { stage: "credential_persist" }
    );
  }
  if (/encrypt|secret|credentialsKey|WORKFLOW.*KEY/i.test(message)) {
    return pageOAuthError(
      "Facebook Page credential could not be encrypted for storage.",
      "FACEBOOK_PAGE_CREDENTIAL_ENCRYPT_FAILED",
      500,
      { stage: "credential_persist" }
    );
  }
  return pageOAuthError(
    "Facebook Page credential could not be saved.",
    "FACEBOOK_PAGE_CREDENTIAL_SAVE_FAILED",
    500,
    { stage: "credential_persist" }
  );
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
    throw pageOAuthError(
      `${stripSecrets(res?.body?.error?.message) || "Facebook Page code exchange failed"}${metaErrorHint(res?.body)}`,
      "FACEBOOK_PAGE_OAUTH_EXCHANGE",
      400,
      {
        stage: "code_exchange",
        metaCode: res?.body?.error?.code ?? null,
        metaSubcode: res?.body?.error?.error_subcode ?? null,
      }
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
    throw pageOAuthError(
      `${stripSecrets(res?.body?.error?.message) || "Facebook Page token exchange failed"}${metaErrorHint(res?.body)}`,
      "FACEBOOK_PAGE_OAUTH_EXCHANGE",
      400,
      {
        stage: "token_exchange",
        metaCode: res?.body?.error?.code ?? null,
        metaSubcode: res?.body?.error?.error_subcode ?? null,
      }
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
  let stage = "state_validation";
  try {
    logFacebookPageOAuthStage({ stage: "state_validation" });
    const parsed = verifyState(state);
    consumeNonce(parsed);

    stage = "code_exchange";
    logFacebookPageOAuthStage({ stage });
    const short = await exchangeCode(code);
    const shortToken = String(short?.access_token || "").trim();
    if (!shortToken) {
      throw pageOAuthError(
        "Facebook Page did not return an access token.",
        "FACEBOOK_PAGE_OAUTH_EXCHANGE",
        400,
        { stage }
      );
    }

    stage = "token_exchange";
    logFacebookPageOAuthStage({ stage });
    const long = await exchangeLongLived(shortToken);
    const accessToken = String(long?.access_token || shortToken).trim();
    const expiresIn = Number(long?.expires_in || short?.expires_in || 0);
    const expiresAt =
      Number.isFinite(expiresIn) && expiresIn > 0
        ? new Date(hooks.now() + expiresIn * 1000).toISOString()
        : null;

    stage = "token_validation";
    logFacebookPageOAuthStage({ stage });
    const debug = await debugToken(accessToken);
    const grantedScopes = Array.isArray(debug?.scopes)
      ? debug.scopes.map(String)
      : [];
    const missingScopes = OAUTH_SCOPES.filter(
      (scope) => !grantedScopes.includes(scope)
    );

    stage = "profile";
    logFacebookPageOAuthStage({ stage });
    let me;
    try {
      me = await facebookGraphRequest({
        accessToken,
        path: "me",
        query: { fields: "id,name" },
      });
    } catch (err) {
      if (err instanceof AppError) {
        err.stage = err.stage || stage;
        throw err;
      }
      throw pageOAuthError(
        stripSecrets(err?.message) || "Facebook profile lookup failed.",
        "FACEBOOK_PAGE_GRAPH_ERROR",
        400,
        { stage }
      );
    }

    stage = "page_discovery";
    logFacebookPageOAuthStage({
      stage,
      grantedScopeCount: grantedScopes.length,
      missingScopeCount: missingScopes.length,
    });
    let pageRows;
    try {
      pageRows = await discoverPages(accessToken);
    } catch (err) {
      if (err instanceof AppError) {
        err.stage = err.stage || stage;
        throw err;
      }
      throw pageOAuthError(
        stripSecrets(err?.message) || "Facebook Page discovery failed.",
        "FACEBOOK_PAGE_GRAPH_ERROR",
        400,
        { stage }
      );
    }
    if (!pageRows.length) {
      throw pageOAuthError(
        missingScopes.length
          ? `No Facebook Pages were returned. Missing permissions: ${missingScopes.join(", ")}. Confirm Page roles and re-authorize.`
          : "No Facebook Pages were returned for this login. Confirm pages_show_list and Page roles.",
        "FACEBOOK_PAGE_NONE_FOUND",
        400,
        {
          stage,
          pageCount: 0,
          grantedScopes,
        }
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
      throw pageOAuthError(
        "Facebook Pages were found but Page access tokens were missing.",
        "FACEBOOK_PAGE_TOKEN_MISSING",
        400,
        { stage, pageCount: pageRows.length }
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
      grantedScopes: grantedScopes.length ? grantedScopes : [...OAUTH_SCOPES],
    };
    const configJson = {
      metaUserId: secret.metaUserId,
      metaDisplayName: secret.metaDisplayName,
      selectedPageId,
      pages: pagesConfig,
      expiresAt,
      grantedPermissions: secret.grantedScopes,
      missingPermissions: missingScopes,
    };

    stage = "credential_persist";
    logFacebookPageOAuthStage({
      stage,
      pageCount: pagesConfig.length,
      reconnect: Boolean(parsed.credentialId),
    });

    if (!hooks.insertCredential && !hooks.updateCredential) {
      const schema = await inspectFacebookPageCredentialSchema();
      if (!schema.credentialSchemaReady) {
        throw pageOAuthError(
          "Facebook Page credential type is not available in the database schema. Apply migration 033_facebook_page_credential.sql.",
          "FACEBOOK_PAGE_CREDENTIAL_SCHEMA",
          500,
          { stage }
        );
      }
    }

    const credentialId = parsed.credentialId || uuidv4();
    let name;
    try {
      name = await allocateUniqueCredentialName(
        parsed.workspaceId,
        parsed.name || "Facebook Page",
        { excludeId: parsed.credentialId || null, type: "facebook_page" }
      );
    } catch (err) {
      throw classifyCredentialSaveError(err);
    }

    try {
      if (parsed.credentialId) {
        const existing = await loadCredentialRow(
          parsed.credentialId,
          parsed.workspaceId
        );
        if (!existing || existing.type !== "facebook_page") {
          throw pageOAuthError(
            "Facebook Page credential not found for reconnect.",
            "FACEBOOK_PAGE_CREDENTIAL_NOT_FOUND",
            404,
            { stage }
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
    } catch (err) {
      if (err instanceof AppError && String(err.code || "").startsWith("FACEBOOK_PAGE_")) {
        throw err;
      }
      logFacebookPageOAuthStage({
        stage: "credential_persist_failed",
        errorCode: String(err?.code || "").slice(0, 60),
        errno: Number.isFinite(err?.errno) ? err.errno : undefined,
        workspaceIdPresent: Boolean(parsed.workspaceId),
        userIdPresent: Boolean(parsed.userId),
        pageCount: pagesConfig.length,
      });
      throw classifyCredentialSaveError(err);
    }

    logFacebookPageOAuthStage({
      stage: "complete",
      pageCount: pagesConfig.length,
      credentialPersisted: true,
    });
    return { credentialId, selectedPageId, pageCount: pagesConfig.length };
  } catch (err) {
    if (err instanceof AppError) {
      if (!err.stage) err.stage = stage;
      logFacebookPageOAuthStage({
        stage: err.stage || stage,
        failed: true,
        errorCode: String(err.code || "").slice(0, 80),
        pageCount: err.pageCount,
      });
      throw err;
    }
    logFacebookPageOAuthStage({
      stage,
      failed: true,
      errorCode: String(err?.code || err?.name || "UNKNOWN").slice(0, 80),
    });
    throw pageOAuthError(
      stripSecrets(err?.message) || "Facebook Page connect failed.",
      "FACEBOOK_PAGE_OAUTH_FAILED",
      400,
      { stage }
    );
  }
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

const STAGE_LABELS = Object.freeze({
  state_validation: "OAuth state validation",
  code_exchange: "Authorization code exchange",
  token_exchange: "Long-lived token exchange",
  token_validation: "Token validation",
  profile: "Facebook profile lookup",
  page_discovery: "Page discovery",
  credential_persist: "Credential save",
});

const sanitizeCallbackError = (err) => {
  const code = String(err?.code || "");
  const stage = String(err?.stage || "").trim();
  const stageLabel = STAGE_LABELS[stage] || stage;
  const baseMessage = stripSecrets(err?.message || "");
  const withStage = (message) =>
    stageLabel ? `${stageLabel}: ${message}` : message;

  if (code === "FACEBOOK_PAGE_CREDENTIAL_SCHEMA") {
    return withStage(
      baseMessage ||
        "Facebook Page credential type is missing from the database. Apply migration 033."
    );
  }
  if (
    code === "FACEBOOK_PAGE_CREDENTIAL_SAVE_FAILED" ||
    code === "FACEBOOK_PAGE_CREDENTIAL_FK" ||
    code === "FACEBOOK_PAGE_CREDENTIAL_ENCRYPT_FAILED"
  ) {
    return withStage(baseMessage || "Facebook Page credential could not be saved.");
  }
  if (code === "FACEBOOK_PAGE_NONE_FOUND") {
    return withStage(
      baseMessage ||
        "No Facebook Pages were returned. Confirm pages_show_list and Page roles."
    );
  }
  if (code === "FACEBOOK_PAGE_TOKEN_MISSING") {
    return withStage(
      baseMessage || "Page access tokens were missing from discovery."
    );
  }
  if (
    code === "FACEBOOK_PAGE_OAUTH_EXCHANGE" ||
    code === "FACEBOOK_PAGE_OAUTH_STATE" ||
    code === "FACEBOOK_PAGE_APP_NOT_CONFIGURED" ||
    code === "FACEBOOK_PAGE_PERMISSION_DENIED" ||
    code === "FACEBOOK_PAGE_GRAPH_ERROR" ||
    code === "FACEBOOK_PAGE_CREDENTIAL_NOT_FOUND" ||
    code === "FACEBOOK_PAGE_OAUTH_FAILED"
  ) {
    return withStage(
      baseMessage || "Facebook Page OAuth callback could not be completed."
    );
  }
  if (code.startsWith("FACEBOOK_PAGE_")) {
    return withStage(
      baseMessage || "Facebook Page OAuth callback could not be completed."
    );
  }
  if (
    code.startsWith("ER_") ||
    code === "ECONNREFUSED" ||
    /sql|database|pool|encrypt/i.test(String(err?.message || ""))
  ) {
    return withStage("Facebook Page credential could not be saved.");
  }
  return withStage(
    baseMessage || "Facebook Page OAuth callback could not be completed."
  );
};

const oauthCallbackHtml = ({ ok, credentialId, error }) => {
  const safeError = String(error || "Facebook Page OAuth callback could not be completed.");
  const payload = ok
    ? { type: MESSAGE_TYPE, ok: true, credentialId }
    : {
        type: MESSAGE_TYPE,
        ok: false,
        error: safeError,
      };
  const json = JSON.stringify(payload);
  const origins = JSON.stringify(allowedFrontendOrigins());
  // Avoid "Facebook Page connect failed: Facebook Page connect failed".
  const visible = ok
    ? "Facebook Page connected. You can close this window."
    : /facebook page/i.test(safeError)
      ? safeError
      : `Facebook Page connect failed: ${safeError}`;
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
        error: `Meta authorization denied: ${stripSecrets(
          query.error_description || query.error
        )}`,
      });
    }
    if (!query.code || !query.state) {
      return oauthCallbackHtml({
        ok: false,
        error:
          "OAuth state validation: Facebook callback was missing code or state.",
      });
    }
    const finished = await finishFacebookPageOAuth(query.code, query.state);
    return oauthCallbackHtml({ ok: true, credentialId: finished.credentialId });
  } catch (err) {
    return oauthCallbackHtml({ ok: false, error: sanitizeCallbackError(err) });
  }
};

const getFacebookPageOAuthPublicStatus = async () => {
  const status = getFacebookPageIntegrationStatus();
  const schema = await inspectFacebookPageCredentialSchema();
  return {
    ...status,
    ...schema,
  };
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
  getFacebookPageOAuthPublicStatus,
  inspectFacebookPageCredentialSchema,
  sanitizeCallbackError,
  discoverPages,
};
