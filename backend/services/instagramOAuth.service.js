/**
 * Instagram Unified Login (Facebook Login for Business config_id).
 * Separate from Meta Ads — credential type remains `instagram`.
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
  REQUIRED_SCOPE,
  TOKEN_KIND_UNIFIED,
  AUTH_MODE_UNIFIED,
  normalizeGrantedScope,
  authorizeUrl,
  shortLivedTokenUrl,
  appCredentials,
  getInstagramIntegrationStatus,
} = require("../config/instagramGraph");
const {
  withInstagramAuthTestHooks,
  loadCredentialRow,
  discoverInstagramAccount,
  listAccessibleInstagramAccounts,
  reconnectState,
  missingPermissions,
  stripSecrets,
  markCredentialReconnectRequired,
} = require("./workflowInstagramAuth.service");

const TOKEN_KIND = TOKEN_KIND_UNIFIED;
const MESSAGE_TYPE = "opsai-instagram-oauth";
const FLOW = "instagram";

const hooks = {
  transport: null,
  now: () => Date.now(),
  insertCredential: null,
  updateCredential: null,
  logger: () => {},
};

const withInstagramOAuthTestHooks = async (overrides, fn) => {
  const prev = { ...hooks };
  for (const [key, value] of Object.entries(overrides || {})) {
    if (value !== undefined) hooks[key] = value;
  }
  try {
    return await withInstagramAuthTestHooks(
      {
        transport: overrides?.transport,
        now: overrides?.now,
        loadCredential: overrides?.loadCredential,
        logger: overrides?.logger,
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
  if (dot < 8) {
    throw new AppError("Invalid Instagram OAuth state", 400, "INSTAGRAM_OAUTH_STATE");
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
    throw new AppError("Invalid Instagram OAuth state", 400, "INSTAGRAM_OAUTH_STATE");
  }
  const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (!parsed || parsed.flow !== FLOW) {
    throw new AppError("Invalid Instagram OAuth state", 400, "INSTAGRAM_OAUTH_STATE");
  }
  if (Number(parsed.exp) < hooks.now()) {
    throw new AppError(
      "Instagram connect expired. Start again.",
      400,
      "INSTAGRAM_OAUTH_STATE"
    );
  }
  return parsed;
};

const consumed = new Set();
const consumeNonce = (parsed) => {
  const nonce = String(parsed?.nonce || "");
  if (!/^[a-f0-9]{16}$/.test(nonce)) {
    throw new AppError("Invalid Instagram OAuth state", 400, "INSTAGRAM_OAUTH_STATE");
  }
  if (consumed.has(nonce)) {
    throw new AppError(
      "Instagram connect was already used. Start again.",
      400,
      "INSTAGRAM_OAUTH_STATE"
    );
  }
  consumed.add(nonce);
};

const resetInstagramOAuthNonceStore = () => consumed.clear();

const requireApp = () => {
  const status = getInstagramIntegrationStatus();
  if (!status.instagramIntegrationConfigured) {
    const missing = status.missingConfigKeys.join(", ");
    hooks.logger({
      event: "instagram_platform_not_configured",
      missingConfigKeys: status.missingConfigKeys,
    });
    throw new AppError(
      "Instagram integration is not configured on this OpsAi server.",
      500,
      "INSTAGRAM_APP_NOT_CONFIGURED"
    );
  }
  return appCredentials();
};

const callTransport = async (url, options = {}) => {
  if (hooks.transport) return hooks.transport(url, options);
  const res = await fetch(url, options);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: { message: "Instagram token response was not JSON" } };
  }
  return { ok: res.ok, status: res.status, body };
};

const parsePermissions = (raw) => {
  if (Array.isArray(raw)) {
    return [...new Set(raw.map(String).map((s) => s.trim()).filter(Boolean))];
  }
  if (typeof raw === "string" && raw.trim()) {
    return [
      ...new Set(
        raw
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      ),
    ];
  }
  return [];
};

const unwrapTokenPayload = (body) => {
  if (!body || typeof body !== "object") return {};
  if (Array.isArray(body.data) && body.data[0]) return body.data[0];
  return body;
};

/**
 * Unified Login: exchange authorization code on graph.facebook.com.
 * No Instagram Login ig_exchange_token hop — SUAT comes from this exchange.
 */
const exchangeAuthorizationCode = async ({ code, app }) => {
  const cleaned = String(code || "").replace(/#_$/, "").trim();
  const params = new URLSearchParams({
    client_id: app.appId,
    client_secret: app.appSecret,
    redirect_uri: app.redirectUri,
    code: cleaned,
  });
  const res = await callTransport(`${shortLivedTokenUrl()}?${params.toString()}`, {
    method: "GET",
  });
  hooks.logger({
    event: "instagram_unified_code_exchange",
    status: res?.status,
    ok: Boolean(res?.ok),
  });
  if (!res?.ok) {
    throw new AppError(
      stripSecrets(res?.body?.error_message || res?.body?.error?.message) ||
        "Instagram authorization failed.",
      400,
      "INSTAGRAM_OAUTH_EXCHANGE"
    );
  }
  const payload = unwrapTokenPayload(res.body);
  const accessToken = String(payload.access_token || "").trim();
  if (!accessToken) {
    throw new AppError(
      "Instagram authorization failed.",
      400,
      "INSTAGRAM_OAUTH_EXCHANGE"
    );
  }
  return {
    accessToken,
    userId: String(payload.user_id || payload.id || "").trim(),
    expiresIn: Number(payload.expires_in),
    permissions: parsePermissions(payload.permissions).map(normalizeGrantedScope),
  };
};

/** @deprecated Unified Login has no ig_exchange_token — identity passthrough for tests. */
const exchangeLongLived = async ({ shortLivedToken }) => ({
  accessToken: String(shortLivedToken || ""),
  expiresIn: null,
  tokenType: "bearer",
});

/**
 * Unified SUAT is not refreshed via ig_refresh_token.
 * Caller should mark reconnectRequired when the token is invalid.
 */
const refreshLongLivedToken = async () => {
  throw new AppError(
    "Instagram login expired. Reconnect Instagram.",
    401,
    "INSTAGRAM_TOKEN_INVALID"
  );
};

const expiresAtFrom = (expiresIn) => {
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    return new Date(hooks.now() + expiresIn * 1000).toISOString();
  }
  return null;
};

const publicConfigFrom = ({ secret, account, missingScopes }) => ({
  connected: true,
  authMode: AUTH_MODE_UNIFIED,
  tokenKind: TOKEN_KIND,
  expiresAt: secret.expiresAt || null,
  grantedPermissions: Array.isArray(secret.grantedPermissions)
    ? secret.grantedPermissions
    : [],
  missingPermissions: Array.isArray(missingScopes) ? missingScopes : [],
  instagramUserId: account.id,
  username: account.username,
  accountType: account.accountType || "",
  profilePictureUrl: account.profilePictureUrl || "",
  name: account.name || "",
  clientBusinessId: secret.clientBusinessId || "",
  reconnectRequired: false,
  reconnectSoon: false,
});

/**
 * Safe schema probe — never logs secrets. Used before INSERT and by status.
 */
const inspectInstagramCredentialSchema = async () => {
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
    const instagramTypeSupported = typeCol.includes("'instagram'");
    return {
      credentialSchemaReady: instagramTypeSupported && configJsonColumnPresent,
      instagramTypeSupported,
      configJsonColumnPresent,
    };
  } catch (err) {
    return {
      credentialSchemaReady: false,
      instagramTypeSupported: false,
      configJsonColumnPresent: false,
      schemaCheckErrorClass: String(err?.code || "SCHEMA_CHECK_FAILED").slice(0, 40),
    };
  }
};

const logCredentialPersistFailure = (err, meta = {}) => {
  const message = String(err?.message || "");
  const constraintMatch = message.match(/CONSTRAINT [`']([^`']+)[`']/i);
  const keyMatch = message.match(/for key [`']([^`']+)[`']/i);
  const columnMatch = message.match(/column [`']([^`']+)[`']/i);
  const payload = {
    event: "instagram_oauth_stage",
    stage: "credential_persist_failed",
    operation: meta.operation || "unknown",
    errorName: String(err?.name || "Error").slice(0, 60),
    errorCode: String(err?.code || "").slice(0, 60),
    sqlState: err?.sqlState ? String(err.sqlState).slice(0, 16) : undefined,
    errno: Number.isFinite(err?.errno) ? err.errno : undefined,
    constraintName: constraintMatch
      ? constraintMatch[1].slice(0, 80)
      : keyMatch
        ? keyMatch[1].slice(0, 80)
        : undefined,
    columnName: columnMatch ? columnMatch[1].slice(0, 64) : undefined,
    workspaceIdPresent: Boolean(meta.workspaceId),
    userIdPresent: Boolean(meta.userId),
    instagramUserIdPresent: Boolean(meta.instagramUserId),
    credentialType: "instagram",
  };
  if (typeof hooks.logger === "function") hooks.logger(payload);
  // Always emit sanitized diagnostics to process logs (hooks.logger may be a no-op).
  console.error("[instagram-oauth]", JSON.stringify(payload));
};

const classifyCredentialSaveError = (err) => {
  const code = String(err?.code || "");
  const message = String(err?.message || "");
  if (
    code === "ER_INSTAGRAM_ENUM_MISSING" ||
    code === "ER_INSTAGRAM_CONFIG_JSON_MISSING" ||
    code === "WARN_DATA_TRUNCATED" ||
    code === "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD" ||
    code === "ER_WRONG_VALUE_FOR_TYPE" ||
    /Data truncated for column ['`]?type['`]?/i.test(message) ||
    /unknown.*instagram|invalid.*instagram/i.test(message)
  ) {
    return new AppError(
      "Instagram credential type is not available in the database schema.",
      500,
      "INSTAGRAM_CREDENTIAL_SCHEMA"
    );
  }
  if (code === "ER_BAD_FIELD_ERROR" || /Unknown column/i.test(message)) {
    return new AppError(
      "Instagram credential could not be saved.",
      500,
      "INSTAGRAM_CREDENTIAL_SCHEMA"
    );
  }
  if (
    code === "ER_NO_REFERENCED_ROW" ||
    code === "ER_NO_REFERENCED_ROW_2" ||
    code === "ER_INSTAGRAM_WORKSPACE_MISSING" ||
    code === "ER_INSTAGRAM_USER_MISSING"
  ) {
    return new AppError(
      "Instagram credential could not be saved.",
      500,
      "INSTAGRAM_CREDENTIAL_FK"
    );
  }
  if (code === "ER_DUP_ENTRY") {
    return new AppError(
      "Instagram credential could not be saved.",
      500,
      "INSTAGRAM_CREDENTIAL_SAVE_FAILED"
    );
  }
  if (
    code === "INSTAGRAM_CREDENTIAL_ENCRYPT_FAILED" ||
    /encrypt|WORKFLOW_CREDENTIALS_KEY/i.test(message)
  ) {
    return new AppError(
      "Instagram credential could not be saved.",
      500,
      "INSTAGRAM_CREDENTIAL_ENCRYPT_FAILED"
    );
  }
  return new AppError(
    "Instagram credential could not be saved.",
    500,
    "INSTAGRAM_CREDENTIAL_SAVE_FAILED"
  );
};

const encryptInstagramSecret = (secret) => {
  try {
    return encryptSecret(secret);
  } catch (err) {
    const wrapped = new AppError(
      "Instagram credential could not be encrypted.",
      500,
      "INSTAGRAM_CREDENTIAL_ENCRYPT_FAILED"
    );
    wrapped.cause = err;
    throw wrapped;
  }
};

const assertPersistTargets = async ({ workspaceId, userId }) => {
  const schema = await inspectInstagramCredentialSchema();
  if (!schema.instagramTypeSupported) {
    const err = new Error("workflow_credentials.type ENUM missing instagram");
    err.code = "ER_INSTAGRAM_ENUM_MISSING";
    err.sqlState = "SCHEMA";
    throw err;
  }
  if (!schema.configJsonColumnPresent) {
    const err = new Error("workflow_credentials.config_json column missing");
    err.code = "ER_INSTAGRAM_CONFIG_JSON_MISSING";
    err.sqlState = "SCHEMA";
    throw err;
  }
  const [ws] = await pool.execute(`SELECT id FROM workspaces WHERE id = ? LIMIT 1`, [
    workspaceId,
  ]);
  if (!ws.length) {
    const err = new Error("workspace missing for Instagram credential");
    err.code = "ER_INSTAGRAM_WORKSPACE_MISSING";
    err.sqlState = "FK";
    throw err;
  }
  const [users] = await pool.execute(`SELECT id FROM users WHERE id = ? LIMIT 1`, [
    userId,
  ]);
  if (!users.length) {
    const err = new Error("user missing for Instagram credential");
    err.code = "ER_INSTAGRAM_USER_MISSING";
    err.sqlState = "FK";
    throw err;
  }
};

const insertInstagramCredentialRow = async ({
  id,
  workspaceId,
  name,
  encryptedSecret,
  configJson,
  userId,
}) => {
  await pool.execute(
    `INSERT INTO workflow_credentials
      (id, workspace_id, name, type, secret_json, config_json, created_by)
     VALUES (?, ?, ?, 'instagram', ?, ?, ?)`,
    [id, workspaceId, name, encryptedSecret, JSON.stringify(configJson), userId]
  );
};

const saveConnectedCredential = async ({ parsed, secret, account, missingScopes }) => {
  const configJson = publicConfigFrom({ secret, account, missingScopes });
  const meta = {
    workspaceId: parsed.workspaceId,
    userId: parsed.userId,
    instagramUserId: account?.id || secret?.instagramUserId,
  };

  if (parsed.credentialId && hooks.updateCredential) {
    await hooks.updateCredential(parsed.credentialId, secret, configJson);
    return parsed.credentialId;
  }
  if (parsed.credentialId) {
    const existing = await loadCredentialRow(parsed.credentialId, parsed.workspaceId);
    if (existing && existing.type === "instagram") {
      const mergedConfig = {
        ...existing.config,
        ...configJson,
      };
      try {
        await pool.execute(
          `UPDATE workflow_credentials SET secret_json = ?, config_json = ? WHERE id = ?`,
          [
            encryptInstagramSecret(secret),
            JSON.stringify(mergedConfig),
            parsed.credentialId,
          ]
        );
        return parsed.credentialId;
      } catch (err) {
        logCredentialPersistFailure(err, { ...meta, operation: "update" });
        throw classifyCredentialSaveError(err);
      }
    }
  }

  if (hooks.insertCredential) {
    const id = uuidv4();
    const name = parsed.name || "Instagram";
    await hooks.insertCredential({ id, name, secret, config: configJson, parsed });
    return id;
  }

  try {
    await assertPersistTargets({
      workspaceId: parsed.workspaceId,
      userId: parsed.userId,
    });
  } catch (err) {
    logCredentialPersistFailure(err, { ...meta, operation: "precheck" });
    throw classifyCredentialSaveError(err);
  }

  const encryptedSecret = encryptInstagramSecret(secret);
  let id = uuidv4();
  let name = await allocateUniqueCredentialName(
    parsed.workspaceId,
    parsed.name || "Instagram",
    { type: "instagram" }
  );

  try {
    await insertInstagramCredentialRow({
      id,
      workspaceId: parsed.workspaceId,
      name,
      encryptedSecret,
      configJson,
      userId: parsed.userId,
    });
    return id;
  } catch (err) {
    // Unique name race — allocate a fresh name once and retry insert only.
    if (String(err?.code || "") === "ER_DUP_ENTRY") {
      try {
        id = uuidv4();
        name = await allocateUniqueCredentialName(
          parsed.workspaceId,
          parsed.name || "Instagram",
          { type: "instagram" }
        );
        await insertInstagramCredentialRow({
          id,
          workspaceId: parsed.workspaceId,
          name,
          encryptedSecret,
          configJson,
          userId: parsed.userId,
        });
        return id;
      } catch (retryErr) {
        logCredentialPersistFailure(retryErr, {
          ...meta,
          operation: "insert_retry",
        });
        throw classifyCredentialSaveError(retryErr);
      }
    }
    logCredentialPersistFailure(err, { ...meta, operation: "insert" });
    throw classifyCredentialSaveError(err);
  }
};

const startInstagramOAuth = async ({ workspaceId, name, credentialId }, authUser) => {
  await assertWorkspaceAccess(authUser, workspaceId);
  const app = requireApp();
  const actorUserId = String(authUser?.userId || authUser?.id || "").trim();
  if (!actorUserId) throw new AppError("Not authenticated", 401, "UNAUTHORIZED");
  if (credentialId) {
    const existing = await loadCredentialRow(credentialId, workspaceId);
    if (!existing || existing.type !== "instagram") {
      throw new AppError("Instagram credential not found", 404, "NOT_FOUND");
    }
  }
  const state = signState({
    flow: FLOW,
    workspaceId,
    userId: actorUserId,
    name: String(name || "Instagram").slice(0, 80),
    credentialId: credentialId || null,
    authMode: AUTH_MODE_UNIFIED,
    loginConfigId: app.loginConfigId,
    // Expected permissions from server config — not sent as OAuth scope.
    scopes: [...OAUTH_SCOPES],
    exp: hooks.now() + 10 * 60 * 1000,
    nonce: crypto.randomBytes(8).toString("hex"),
  });
  // Unified Login: config_id replaces scope. Do not send instagram_business_*.
  // Meta requires override_default_response_type=true so response_type=code wins for SUAT.
  const params = new URLSearchParams({
    client_id: app.appId,
    config_id: app.loginConfigId,
    redirect_uri: app.redirectUri,
    state,
    response_type: "code",
    override_default_response_type: "true",
    // Prefer showing login chooser even if a Facebook session exists.
    prompt: "login",
  });
  let callbackOrigin = "";
  try {
    callbackOrigin = new URL(app.redirectUri).origin;
  } catch {
    callbackOrigin = "";
  }
  return {
    url: `${authorizeUrl()}?${params.toString()}`,
    callbackOrigin,
    redirectUri: app.redirectUri,
    authMode: AUTH_MODE_UNIFIED,
    loginConfigId: app.loginConfigId,
    scopes: [...OAUTH_SCOPES],
    apiVersion: API_VERSION,
  };
};

const finishInstagramOAuth = async (code, state) => {
  const parsed = verifyState(state);
  consumeNonce(parsed);
  const app = requireApp();
  hooks.logger({ event: "instagram_oauth_stage", stage: "state_validation" });

  let exchanged;
  try {
    exchanged = await exchangeAuthorizationCode({ code, app });
    hooks.logger({ event: "instagram_oauth_stage", stage: "code_exchange" });
  } catch (err) {
    if (err instanceof AppError && String(err.code || "").startsWith("INSTAGRAM_")) {
      throw err;
    }
    throw new AppError(
      "Instagram OAuth callback could not be completed.",
      400,
      "INSTAGRAM_OAUTH_EXCHANGE"
    );
  }

  // Prefer observed grants; Unified Login often omits permissions on exchange —
  // fall back to configured V1 list (source recorded on credential).
  const granted = exchanged.permissions.length
    ? exchanged.permissions
    : [...OAUTH_SCOPES];
  const permissionSource = exchanged.permissions.length
    ? "observed"
    : "configuration";
  if (!granted.map(normalizeGrantedScope).includes(REQUIRED_SCOPE)) {
    throw new AppError(
      "Instagram did not grant basic access. Reconnect and allow Instagram professional account access.",
      403,
      "INSTAGRAM_PERMISSION_DENIED"
    );
  }
  const missingScopes = missingPermissions(granted, OAUTH_SCOPES);
  let preferredInstagramUserId = "";
  if (parsed.credentialId) {
    try {
      const existing = await loadCredentialRow(
        parsed.credentialId,
        parsed.workspaceId
      );
      preferredInstagramUserId = String(
        existing?.config?.instagramUserId ||
          existing?.secret?.instagramUserId ||
          ""
      ).trim();
    } catch {
      preferredInstagramUserId = "";
    }
  }

  let account;
  try {
    account = await discoverInstagramAccount({
      accessToken: exchanged.accessToken,
      authMode: AUTH_MODE_UNIFIED,
      preferredInstagramUserId,
    });
    hooks.logger({
      event: "instagram_oauth_stage",
      stage: "instagram_discovery",
    });
  } catch (err) {
    if (err instanceof AppError && String(err.code || "").startsWith("INSTAGRAM_")) {
      throw err;
    }
    throw new AppError(
      "Instagram authorization succeeded, but no Instagram account was available.",
      403,
      "INSTAGRAM_ACCOUNT_DISCOVERY_FAILED"
    );
  }

  const secret = {
    accessToken: exchanged.accessToken,
    tokenKind: TOKEN_KIND,
    authMode: AUTH_MODE_UNIFIED,
    expiresAt: expiresAtFrom(exchanged.expiresIn),
    grantedPermissions: granted.map(normalizeGrantedScope),
    permissionSource,
    loginConfigId: app.loginConfigId,
    clientBusinessId: account.clientBusinessId || "",
    instagramUserId: account.id,
    username: account.username,
  };

  let credentialId;
  try {
    credentialId = await saveConnectedCredential({
      parsed,
      secret,
      account,
      missingScopes,
    });
    hooks.logger({
      event: "instagram_oauth_stage",
      stage: "credential_persist",
    });
  } catch (err) {
    if (err instanceof AppError && String(err.code || "").startsWith("INSTAGRAM_")) {
      throw err;
    }
    logCredentialPersistFailure(err, {
      operation: "save",
      workspaceId: parsed.workspaceId,
      userId: parsed.userId,
      instagramUserId: account?.id,
    });
    throw classifyCredentialSaveError(err);
  }

  // Safe live OAuth summary — never includes tokens/secrets.
  const discoveryTrace =
    account?.discoveryTrace && typeof account.discoveryTrace === "object"
      ? account.discoveryTrace
      : {};
  console.error(
    "[instagram-oauth]",
    JSON.stringify({
      event: "instagram_oauth_result",
      oauth_start: "PASS",
      callback: "PASS",
      code_exchange: "PASS",
      token_has_instagram_basic: discoveryTrace.token_has_instagram_basic,
      token_has_pages_read_engagement:
        discoveryTrace.token_has_pages_read_engagement,
      token_has_business_management:
        discoveryTrace.token_has_business_management,
      token_has_ads_read: discoveryTrace.token_has_ads_read,
      token_has_ads_management: discoveryTrace.token_has_ads_management,
      candidate_business_ids: discoveryTrace.candidate_business_ids,
      businesses: discoveryTrace.businesses,
      granular_target_ids: discoveryTrace.granular_target_ids_count,
      instagram_asset_targets: discoveryTrace.instagram_asset_targets,
      instagram_business_assets_resolved:
        discoveryTrace.instagram_business_assets_resolved,
      instagram_users_resolved: discoveryTrace.instagram_users_resolved,
      resolved_ig_user_id: discoveryTrace.resolved_ig_user_id,
      resolved_ig_username: discoveryTrace.resolved_ig_username,
      discoverySource: discoveryTrace.discoverySource,
      credential_persist: "PASS",
    })
  );

  return {
    credentialId,
    workspaceId: parsed.workspaceId,
    missingPermissions: missingScopes,
  };
};

const testInstagramCredential = async (credentialId, authUser) => {
  const cred = await loadCredentialRow(credentialId);
  if (!cred || cred.type !== "instagram") {
    throw new AppError("Instagram credential not found", 404, "NOT_FOUND");
  }
  await assertWorkspaceAccess(authUser, cred.workspaceId);
  let secret = { ...(cred.secret || {}) };
  let cfg = { ...(cred.config || {}) };
  let life = reconnectState(secret, cfg);
  if (life.reconnectRequired) {
    await markCredentialReconnectRequired(credentialId, "expired");
    throw new AppError(
      "Instagram login expired. Reconnect Instagram.",
      401,
      "INSTAGRAM_TOKEN_INVALID"
    );
  }
  // Unified SUAT: no ig_refresh_token. Reconnect when expired/invalid.
  const account = await discoverInstagramAccount({
    credentialId,
    workspaceId: cred.workspaceId,
    authMode: AUTH_MODE_UNIFIED,
  });
  const granted = Array.isArray(secret.grantedPermissions)
    ? secret.grantedPermissions
    : Array.isArray(cfg.grantedPermissions)
      ? cfg.grantedPermissions
      : [];
  return {
    ok: true,
    type: "instagram",
    apiVersion: API_VERSION,
    instagramUserId: account.id,
    username: account.username,
    accountType: account.accountType,
    expiresAt: secret.expiresAt || cfg.expiresAt || null,
    reconnectSoon: life.reconnectSoon,
    grantedPermissions: granted,
    missingPermissions: missingPermissions(granted, OAUTH_SCOPES),
  };
};

const allowedFrontendOrigins = () =>
  String(config.cors?.origin || "http://localhost:3001")
    .split(",")
    .map((part) => part.trim().replace(/\/$/, ""))
    .filter(Boolean);

const sanitizeCallbackError = (err) => {
  const code = String(err?.code || "");
  if (code === "INSTAGRAM_PERMISSION_PAGES_READ_ENGAGEMENT_REQUIRED") {
    return (
      stripSecrets(err.message) ||
      "pages_read_engagement is required to resolve Instagram accounts shared through Business Manager."
    );
  }
  if (code === "INSTAGRAM_REQUIRED_PERMISSION_MISSING") {
    return (
      stripSecrets(err.message) ||
      "A required Instagram permission was not granted. Reconnect and allow the requested access."
    );
  }
  if (code === "INSTAGRAM_BUSINESS_CONTEXT_NOT_FOUND") {
    return (
      stripSecrets(err.message) ||
      "Instagram business context was not found for this login."
    );
  }
  if (code === "INSTAGRAM_SELECTED_ASSET_NOT_RESOLVABLE") {
    return (
      stripSecrets(err.message) ||
      "Instagram assets were shared, but none could be resolved for API access."
    );
  }
  if (
    code === "INSTAGRAM_NO_ACCESSIBLE_ACCOUNT" ||
    code === "INSTAGRAM_ACCOUNT_DISCOVERY_FAILED"
  ) {
    return (
      stripSecrets(err.message) ||
      "Instagram authorization succeeded, but no accessible Instagram account was found."
    );
  }
  if (
    code === "INSTAGRAM_CREDENTIAL_SAVE_FAILED" ||
    code === "INSTAGRAM_CREDENTIAL_FK" ||
    code === "INSTAGRAM_CREDENTIAL_ENCRYPT_FAILED"
  ) {
    return "Instagram credential could not be saved.";
  }
  if (code === "INSTAGRAM_CREDENTIAL_SCHEMA") {
    return (
      stripSecrets(err.message) ||
      "Instagram credential type is not available in the database schema."
    );
  }
  if (code === "INSTAGRAM_APP_NOT_CONFIGURED") {
    return "Instagram OAuth configuration mismatch.";
  }
  if (
    code === "INSTAGRAM_OAUTH_EXCHANGE" ||
    code === "INSTAGRAM_OAUTH_STATE" ||
    code === "INSTAGRAM_PERMISSION_DENIED"
  ) {
    return (
      stripSecrets(err.message) ||
      "Instagram OAuth callback could not be completed."
    );
  }
  if (code.startsWith("INSTAGRAM_")) {
    return (
      stripSecrets(err.message) ||
      "Instagram OAuth callback could not be completed."
    );
  }
  // DB / unexpected — never expose driver details.
  if (
    code.startsWith("ER_") ||
    code === "ECONNREFUSED" ||
    /sql|database|pool|encrypt/i.test(String(err?.message || ""))
  ) {
    return "Instagram credential could not be saved.";
  }
  return "Instagram OAuth callback could not be completed.";
};

const oauthCallbackHtml = ({ ok, credentialId, error }) => {
  const payload = ok
    ? { type: MESSAGE_TYPE, ok: true, credentialId }
    : {
        type: MESSAGE_TYPE,
        ok: false,
        error: String(error || "Instagram connect failed"),
      };
  const json = JSON.stringify(payload);
  const origins = JSON.stringify(allowedFrontendOrigins());
  const visible = ok
    ? "Instagram connected. You can close this window."
    : `Instagram connect failed: ${payload.error || "Instagram connect failed"}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>OpsAi Instagram OAuth</title></head><body>
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
  FLOW,
  OAUTH_SCOPES,
  withInstagramOAuthTestHooks,
  resetInstagramOAuthNonceStore,
  signState,
  verifyState,
  exchangeAuthorizationCode,
  exchangeLongLived,
  refreshLongLivedToken,
  startInstagramOAuth,
  finishInstagramOAuth,
  testInstagramCredential,
  listAccessibleInstagramAccounts,
  reconnectState,
  sanitizeCallbackError,
  oauthCallbackHtml,
  applyOAuthPopupResponseHeaders,
  getInstagramIntegrationStatus,
  inspectInstagramCredentialSchema,
  classifyCredentialSaveError,
  logCredentialPersistFailure,
};
