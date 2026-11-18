/**
 * Instagram credential load, Graph GET helper, and account discovery.
 * Separate from Meta Ads — never routes through workflowMetaAds.service.
 */

const { pool } = require("../config/database");
const AppError = require("../utils/AppError");
const { decryptSecret, encryptSecret } = require("./secretBox.service");
const {
  API_VERSION,
  AUTH_MODE_UNIFIED,
  graphBaseUrl,
  appCredentials,
} = require("../config/instagramGraph");

const hooks = {
  transport: null,
  now: () => Date.now(),
  loadCredential: null,
  logger: () => {},
};

const withInstagramAuthTestHooks = async (overrides, fn) => {
  const prev = { ...hooks };
  for (const [key, value] of Object.entries(overrides || {})) {
    if (value !== undefined) hooks[key] = value;
  }
  try {
    return await fn();
  } finally {
    Object.assign(hooks, prev);
  }
};

const SECRET_RE =
  /((?:access_token|appsecret_proof|client_secret|code|authorization)=)[^&\s]+/gi;

const stripSecrets = (value) =>
  String(value || "").replace(SECRET_RE, "$1[redacted]");

const igError = (message, code, status = 400) => {
  const err = new AppError(stripSecrets(message), status, code);
  return err;
};

const mapInstagramError = (status, body) => {
  const error = body && typeof body === "object" ? body.error || body : {};
  const code = Number(error.code || body?.code);
  const message = stripSecrets(
    error.message || error.error_message || body?.error_message || ""
  );
  if (code === 190 || status === 401) {
    return igError(
      "Instagram login expired or was revoked. Reconnect Instagram.",
      "INSTAGRAM_TOKEN_INVALID",
      401
    );
  }
  if (code === 10 || code === 200 || /permission/i.test(message)) {
    return igError(
      "Instagram denied this request. A required permission is missing — reconnect and grant access.",
      "INSTAGRAM_PERMISSION_DENIED",
      403
    );
  }
  if (
    code === 100 &&
    /nonexisting field|unknown field|unsupported field|invalid field/i.test(
      message
    )
  ) {
    const fieldMatch = message.match(/nonexisting field\s*\(([^)]+)\)/i);
    const field = fieldMatch ? fieldMatch[1] : "";
    return igError(
      field
        ? `Instagram Graph rejected unsupported field (${field}).`
        : "Instagram Graph rejected an unsupported field contract.",
      "INSTAGRAM_INVALID_GRAPH_FIELD",
      400
    );
  }
  if (code === 4 || code === 17 || code === 32 || code === 613 || status === 429) {
    return igError(
      "Instagram rate limit reached. Wait and try again.",
      "INSTAGRAM_RATE_LIMIT",
      429
    );
  }
  return igError(
    message || "Instagram request failed.",
    "INSTAGRAM_GRAPH_ERROR",
    status || 400
  );
};

const defaultTransport = async (url, options = {}) => {
  const res = await fetch(url, options);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: { message: "Instagram returned a non-JSON response" } };
  }
  return { ok: res.ok, status: res.status, body };
};

const loadCredentialRow = async (credentialId, workspaceId) => {
  if (hooks.loadCredential) return hooks.loadCredential(credentialId, workspaceId);
  const [rows] = await pool.execute(
    `SELECT * FROM workflow_credentials WHERE id = ?`,
    [credentialId]
  );
  if (!rows.length) return null;
  if (workspaceId && rows[0].workspace_id !== workspaceId) return null;
  return {
    id: rows[0].id,
    type: rows[0].type,
    name: rows[0].name,
    workspaceId: rows[0].workspace_id,
    secret: decryptSecret(rows[0].secret_json) || {},
    config: (() => {
      try {
        return JSON.parse(rows[0].config_json || "{}");
      } catch {
        return {};
      }
    })(),
  };
};

const reconnectState = (secret, config = {}) => {
  if (config.reconnectRequired || secret?.revoked) {
    return { reconnectRequired: true, reconnectSoon: false };
  }
  const expiresAt = secret?.expiresAt
    ? Date.parse(secret.expiresAt)
    : config.expiresAt
      ? Date.parse(config.expiresAt)
      : NaN;
  if (!Number.isFinite(expiresAt)) {
    return { reconnectRequired: false, reconnectSoon: false };
  }
  const remaining = expiresAt - hooks.now();
  return {
    reconnectRequired: remaining <= 0,
    reconnectSoon: remaining > 0 && remaining <= 7 * 24 * 60 * 60 * 1000,
  };
};

const assertUsableSecret = (secret, config = {}) => {
  const token = String(secret?.accessToken || "").trim();
  if (!token) {
    throw igError(
      "Connect an Instagram account first.",
      "INSTAGRAM_CREDENTIAL_REQUIRED"
    );
  }
  const life = reconnectState(secret, config);
  if (life.reconnectRequired || secret?.revoked) {
    throw igError(
      "Instagram login expired. Reconnect Instagram.",
      "INSTAGRAM_TOKEN_INVALID",
      401
    );
  }
  return token;
};

const markCredentialReconnectRequired = async (credentialId, reason = "expired") => {
  const cred = await loadCredentialRow(credentialId);
  if (!cred || cred.type !== "instagram") return;
  const nextConfig = {
    ...(cred.config || {}),
    connected: false,
    reconnectRequired: true,
    reconnectReason: String(reason || "expired").slice(0, 40),
  };
  const nextSecret = {
    ...(cred.secret || {}),
    revoked: reason === "revoked" ? true : Boolean(cred.secret?.revoked),
  };
  await pool.execute(
    `UPDATE workflow_credentials SET secret_json = ?, config_json = ? WHERE id = ?`,
    [encryptSecret(nextSecret), JSON.stringify(nextConfig), credentialId]
  );
};

/** Instagram Login Graph allowlist — never route Meta Ads writes through here. */
const INSTAGRAM_ALLOWED_METHODS = Object.freeze(["GET", "POST"]);

const resolveAccessToken = async ({ credentialId, workspaceId, accessToken }) => {
  let token = String(accessToken || "").trim();
  if (token) return token;
  if (!credentialId) {
    throw igError(
      "An Instagram credential is required.",
      "INSTAGRAM_CREDENTIAL_REQUIRED"
    );
  }
  const cred = await loadCredentialRow(credentialId, workspaceId);
  if (!cred || cred.type !== "instagram") {
    throw igError(
      "An Instagram credential is required.",
      "INSTAGRAM_CREDENTIAL_REQUIRED"
    );
  }
  try {
    return assertUsableSecret(cred.secret, cred.config);
  } catch (err) {
    if (err?.code === "INSTAGRAM_TOKEN_INVALID") {
      await markCredentialReconnectRequired(credentialId, "expired");
    }
    throw err;
  }
};

/**
 * Instagram Graph request (GET/POST only). Separate from Meta Ads GET-only client.
 */
const instagramGraphRequest = async ({
  credentialId,
  workspaceId,
  accessToken,
  path,
  method = "GET",
  query = {},
  body = null,
}) => {
  const verb = String(method || "GET").toUpperCase();
  if (!INSTAGRAM_ALLOWED_METHODS.includes(verb)) {
    throw igError(
      "Instagram Graph method not allowed for this integration.",
      "INSTAGRAM_METHOD_DENIED",
      403
    );
  }
  const token = await resolveAccessToken({
    credentialId,
    workspaceId,
    accessToken,
  });
  const transport = hooks.transport || defaultTransport;
  let res;
  try {
    if (verb === "GET") {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query || {})) {
        if (value == null || value === "") continue;
        params.set(key, String(value));
      }
      params.set("access_token", token);
      const url = `${graphBaseUrl()}/${String(path || "").replace(/^\//, "")}?${params.toString()}`;
      res = await transport(url, { method: "GET" });
    } else {
      const form = new URLSearchParams();
      const payload =
        body && typeof body === "object" && !Array.isArray(body) ? body : {};
      for (const [key, value] of Object.entries(payload)) {
        if (value == null || value === "") continue;
        form.set(key, String(value));
      }
      for (const [key, value] of Object.entries(query || {})) {
        if (value == null || value === "") continue;
        if (!form.has(key)) form.set(key, String(value));
      }
      form.set("access_token", token);
      const url = `${graphBaseUrl()}/${String(path || "").replace(/^\//, "")}`;
      res = await transport(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
    }
  } catch (err) {
    throw igError(
      stripSecrets(err?.message) || "Instagram request failed.",
      "INSTAGRAM_GRAPH_ERROR"
    );
  }
  if (!res?.ok) {
    const mapped = mapInstagramError(res?.status, res?.body);
    if (mapped.code === "INSTAGRAM_TOKEN_INVALID" && credentialId) {
      await markCredentialReconnectRequired(
        credentialId,
        /revok/i.test(String(res?.body?.error?.message || ""))
          ? "revoked"
          : "expired"
      );
    }
    throw mapped;
  }
  return res.body;
};

/**
 * Instagram Graph GET (M2/M3/M4). Writes use instagramGraphRequest POST.
 * Never uses Meta Ads client.
 */
const instagramGraphGet = async (args) =>
  instagramGraphRequest({ ...args, method: "GET" });

const instagramGraphPost = async (args) =>
  instagramGraphRequest({ ...args, method: "POST" });

const unwrapMePayload = (body) => {
  if (!body || typeof body !== "object") return {};
  if (Array.isArray(body.data) && body.data[0] && typeof body.data[0] === "object") {
    return body.data[0];
  }
  return body;
};

/**
 * Legacy Instagram Login /me fields only (graph.instagram.com era).
 * Unified Login discovery uses IGUser / business-asset paths — not these.
 */
const ME_FIELDS_REQUIRED = "id,username";
/** Optional enrichment — never fail OAuth if one of these is unsupported. */
const ME_FIELDS_OPTIONAL =
  "name,profile_picture_url,followers_count,follows_count,media_count,biography,website,ig_id";
const ME_FIELDS = `${ME_FIELDS_REQUIRED},${ME_FIELDS_OPTIONAL}`;

const normalizeAccountType = (raw) => {
  const value = String(raw || "").trim();
  if (!value) return "";
  const lower = value.toLowerCase();
  if (lower === "business") return "Business";
  if (lower === "media_creator" || lower === "creator") return "Media_Creator";
  return value;
};

/**
 * Canonical instagramUserId:
 * prefer user_id (professional account / media path id), else id (app-scoped).
 */
const resolveInstagramUserId = (row = {}) => {
  const userId = String(row?.user_id || "").trim();
  if (userId) return userId;
  return String(row?.id || "").trim();
};

const presentInstagramAccount = (row) => {
  const id = resolveInstagramUserId(row);
  return {
    id,
    instagramUserId: id,
    username: String(row?.username || "").trim(),
    accountType: normalizeAccountType(row?.account_type),
    name: String(row?.name || "").trim() || undefined,
    profilePictureUrl: String(row?.profile_picture_url || "").trim() || undefined,
    followersCount:
      row?.followers_count == null ? undefined : Number(row.followers_count),
    followsCount: row?.follows_count == null ? undefined : Number(row.follows_count),
    mediaCount: row?.media_count == null ? undefined : Number(row.media_count),
  };
};

const assertProfessionalAccount = (account) => {
  const type = String(account.accountType || "").toLowerCase();
  if (type && type !== "business" && type !== "media_creator") {
    throw igError(
      "Connect an Instagram professional account (Business or Creator).",
      "INSTAGRAM_ACCOUNT_UNSUPPORTED",
      403
    );
  }
  if (!account.id || !account.username) {
    throw igError(
      "Could not read the Instagram professional account. Try reconnecting.",
      "INSTAGRAM_ACCOUNT_DISCOVERY_FAILED"
    );
  }
};

const isUnsupportedFieldError = (err) => {
  const msg = String(err?.message || "");
  const code = String(err?.code || "");
  return (
    (code === "INSTAGRAM_GRAPH_ERROR" ||
      code === "INSTAGRAM_INVALID_GRAPH_FIELD") &&
    /nonexisting field|unknown field|unsupported field|invalid field|\(#100\)/i.test(
      msg
    )
  );
};

const {
  discoverUnifiedInstagramAccount: discoverUnifiedInstagramAccountImpl,
  inspectAccessTokenDebug,
} = require("./workflowInstagramDiscovery.service");

const discoverUnifiedInstagramAccount = async (args) =>
  discoverUnifiedInstagramAccountImpl({
    ...args,
    graphGet: instagramGraphGet,
    transport: hooks.transport || defaultTransport,
    logger: hooks.logger,
    presentInstagramAccount,
    assertProfessionalAccount,
    igError,
  });

/**
 * Discover the Instagram professional account for a credential/token.
 * Unified Login uses assigned_instagram_accounts (SUAT); /me is not the IG user.
 */
const discoverInstagramAccount = async ({
  accessToken,
  credentialId,
  workspaceId,
  authMode,
  preferredInstagramUserId,
}) => {
  let mode = String(authMode || "").trim();
  if (!mode && credentialId) {
    try {
      const cred = await loadCredentialRow(credentialId, workspaceId);
      mode = String(
        cred?.secret?.authMode ||
          cred?.config?.authMode ||
          cred?.secret?.tokenKind ||
          ""
      );
    } catch {
      mode = "";
    }
  }
  const unified =
    mode === AUTH_MODE_UNIFIED ||
    mode === "unified_system_user" ||
    !mode; // server default is Unified Login

  if (unified) {
    return discoverUnifiedInstagramAccount({
      accessToken,
      credentialId,
      workspaceId,
      preferredInstagramUserId,
    });
  }

  // Legacy Instagram Login path (existing encrypted credentials only).
  const requestMe = (fields) =>
    instagramGraphGet({
      accessToken,
      credentialId,
      workspaceId,
      path: "me",
      query: { fields },
    });

  let body;
  try {
    body = await requestMe(ME_FIELDS);
  } catch (err) {
    if (!isUnsupportedFieldError(err)) throw err;
    body = await requestMe(ME_FIELDS_REQUIRED);
  }
  const account = presentInstagramAccount(unwrapMePayload(body));
  assertProfessionalAccount(account);
  return account;
};

/**
 * Server-only discovery helper. V1 Instagram Login → usually one account.
 * Shape is stable for future multi-account selection.
 */
const listAccessibleInstagramAccounts = async (credentialId, authUser) => {
  const { assertWorkspaceAccess } = require("./authorization.service");
  const cred = await loadCredentialRow(credentialId);
  if (!cred || cred.type !== "instagram") {
    throw igError("Instagram credential not found", "NOT_FOUND", 404);
  }
  await assertWorkspaceAccess(authUser, cred.workspaceId);
  const life = reconnectState(cred.secret, cred.config);
  if (life.reconnectRequired) {
    throw igError(
      "Instagram login expired. Reconnect Instagram.",
      "INSTAGRAM_TOKEN_INVALID",
      401
    );
  }
  let account;
  try {
    account = await discoverInstagramAccount({
      credentialId,
      workspaceId: cred.workspaceId,
    });
  } catch (err) {
    // Fall back to persisted config when live discovery fails transiently.
    if (cred.config?.instagramUserId && cred.config?.username) {
      account = {
        id: String(cred.config.instagramUserId),
        username: String(cred.config.username),
        accountType: String(cred.config.accountType || ""),
        profilePictureUrl: cred.config.profilePictureUrl || undefined,
      };
    } else {
      throw err;
    }
  }
  return {
    apiVersion: API_VERSION,
    accounts: [
      {
        id: account.id,
        username: account.username,
        accountType: account.accountType,
        profilePictureUrl: account.profilePictureUrl || undefined,
      },
    ],
  };
};

const missingPermissions = (granted, requested) => {
  const { normalizeGrantedScope } = require("../config/instagramGraph");
  const have = new Set(
    (granted || []).map((scope) => normalizeGrantedScope(scope)).filter(Boolean)
  );
  return (requested || []).filter((scope) => !have.has(String(scope)));
};

module.exports = {
  withInstagramAuthTestHooks,
  loadCredentialRow,
  reconnectState,
  assertUsableSecret,
  markCredentialReconnectRequired,
  INSTAGRAM_ALLOWED_METHODS,
  instagramGraphRequest,
  instagramGraphGet,
  instagramGraphPost,
  discoverInstagramAccount,
  listAccessibleInstagramAccounts,
  presentInstagramAccount,
  resolveInstagramUserId,
  unwrapMePayload,
  missingPermissions,
  stripSecrets,
  mapInstagramError,
  ME_FIELDS,
  ME_FIELDS_REQUIRED,
  ME_FIELDS_OPTIONAL,
  API_VERSION,
  appCredentials,
};
