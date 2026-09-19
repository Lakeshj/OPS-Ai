/**
 * Part 14D.5 — Google OAuth on existing workflow_credentials (secretBox).
 * Tokens never enter workflow JSON, node parameters, runs, Copilot, or export.
 */

const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const config = require("../config");
const AppError = require("../utils/AppError");
const { pool } = require("../config/database");
const { encryptSecret, decryptSecret } = require("./secretBox.service");
const { assertWorkspaceAccess } = require("./authorization.service");
const {
  allocateUniqueCredentialName,
} = require("./credentialName.util");

const GOOGLE_PRODUCTS = Object.freeze({
  google_gsc: {
    type: "google_gsc",
    label: "Google Search Console",
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  },
  google_ga4: {
    type: "google_ga4",
    label: "Google Analytics",
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  },
  google_gmail: {
    type: "google_gmail",
    label: "Gmail",
    scopes: [
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.compose",
    ],
  },
  google_sheets: {
    type: "google_sheets",
    label: "Google Sheets",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  },
});

/** Author-facing Gmail permission toggles (maps to OAuth scopes). */
const GMAIL_PERMISSION_OPTIONS = Object.freeze([
  {
    id: "modify",
    label: "Read and manage mail",
    description: "List, read, label, and delete messages (required for most Gmail steps)",
    scope: "https://www.googleapis.com/auth/gmail.modify",
    defaultEnabled: true,
  },
  {
    id: "send",
    label: "Send email",
    description: "Send messages on your behalf",
    scope: "https://www.googleapis.com/auth/gmail.send",
    defaultEnabled: true,
  },
  {
    id: "compose",
    label: "Create drafts",
    description: "Create and update drafts",
    scope: "https://www.googleapis.com/auth/gmail.compose",
    defaultEnabled: true,
  },
]);

const GMAIL_SCOPE_BY_ID = Object.freeze(
  Object.fromEntries(GMAIL_PERMISSION_OPTIONS.map((p) => [p.id, p.scope]))
);

const GOOGLE_TYPES = new Set(Object.keys(GOOGLE_PRODUCTS));

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_TIMEOUT_MS = 25000;
const REFRESH_SKEW_MS = 60_000;

/** Explicit OAuth application modes (14D.5.4B). Do not infer ambiguously. */
const OAUTH_APP_MODE = Object.freeze({
  CUSTOM_APP: "CUSTOM_APP",
  PLATFORM_MANAGED: "PLATFORM_MANAGED",
});

const hooks = {
  transport: null,
  now: () => Date.now(),
  credentialResolver: null,
  credentialSaver: null,
  logger: (fields) => {
    try {
      console.info("[google-oauth]", JSON.stringify(redactLog(fields)));
    } catch {
      // ignore
    }
  },
};

/** Bounded one-time nonces from signed OAuth state (TTL = state exp). */
const consumedNonces = new Map();
const MAX_CONSUMED_NONCES = 4000;

const withGoogleOAuthTestHooks = async (overrides, fn) => {
  const prev = { ...hooks };
  Object.assign(hooks, overrides || {});
  try {
    return await fn();
  } finally {
    Object.assign(hooks, prev);
  }
};

const pruneConsumedNonces = (now) => {
  for (const [nonce, exp] of consumedNonces) {
    if (Number(exp) < now) consumedNonces.delete(nonce);
  }
  while (consumedNonces.size > MAX_CONSUMED_NONCES) {
    const first = consumedNonces.keys().next().value;
    if (first == null) break;
    consumedNonces.delete(first);
  }
};

const resetOauthNonceStore = () => consumedNonces.clear();

/** Mark signed-state nonce used. Replay of the same callback state is rejected. */
const consumeOauthNonce = (parsed) => {
  const nonce = String(parsed?.nonce || "");
  if (!/^[a-f0-9]{16}$/.test(nonce)) {
    throw new AppError("Invalid OAuth state", 400, "GOOGLE_OAUTH_STATE");
  }
  const now = hooks.now();
  pruneConsumedNonces(now);
  if (consumedNonces.has(nonce)) {
    throw new AppError(
      "OAuth state already used — start connect again",
      400,
      "GOOGLE_OAUTH_STATE"
    );
  }
  consumedNonces.set(nonce, Number(parsed.exp) || now + 10 * 60 * 1000);
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
    throw new AppError("Invalid OAuth state", 400, "GOOGLE_OAUTH_STATE");
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
    throw new AppError("Invalid OAuth state", 400, "GOOGLE_OAUTH_STATE");
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new AppError("Invalid OAuth state", 400, "GOOGLE_OAUTH_STATE");
  }
  if (parsed.flow && parsed.flow !== "google") {
    throw new AppError("Invalid OAuth state", 400, "GOOGLE_OAUTH_STATE");
  }
  if (!parsed || parsed.exp < hooks.now()) {
    throw new AppError("OAuth state expired — start connect again", 400, "GOOGLE_OAUTH_STATE");
  }
  return parsed;
};

const redactLog = (fields = {}) => {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (/authorization|access[_-]?token|refresh[_-]?token|client[_-]?secret/i.test(k)) {
      out[k] = "[REDACTED]";
      continue;
    }
    if (k === "headers" && v && typeof v === "object") {
      const h = {};
      for (const [hk, hv] of Object.entries(v)) {
        h[hk] = /authorization|token|secret/i.test(hk) ? "[REDACTED]" : hv;
      }
      out[k] = h;
      continue;
    }
    out[k] = v;
  }
  return out;
};

const clientConfig = () => ({
  clientId: String(config.googleOAuth?.clientId || process.env.GOOGLE_OAUTH_CLIENT_ID || "").trim(),
  clientSecret: String(
    config.googleOAuth?.clientSecret || process.env.GOOGLE_OAUTH_CLIENT_SECRET || ""
  ).trim(),
  redirectUri: String(
    config.googleOAuth?.redirectUri ||
      process.env.GOOGLE_OAUTH_REDIRECT_URI ||
      "http://localhost:5013/api/google-oauth/callback"
  ).trim(),
});

const redirectUri = () => clientConfig().redirectUri;

const platformClientConfigured = () => {
  const cfg = clientConfig();
  return Boolean(cfg.clientId && cfg.clientSecret);
};

/**
 * Resolve which OAuth application credentials to use for authorize/refresh.
 * CUSTOM_APP: per-credential Client ID (config) + Client Secret (secret).
 * PLATFORM_MANAGED: optional server GOOGLE_OAUTH_* (legacy / convenience).
 */
const resolveOAuthApp = (secret = {}, cfg = {}) => {
  const modeRaw = String(
    cfg.oauthAppMode || secret.oauthAppMode || ""
  ).trim();
  const hasCustom =
    Boolean(String(cfg.clientId || secret.clientId || "").trim()) &&
    Boolean(String(secret.clientSecret || "").trim());

  let mode = modeRaw;
  if (!mode) {
    // Legacy rows: tokens only → PLATFORM_MANAGED; new rows with client → CUSTOM_APP
    mode = hasCustom
      ? OAUTH_APP_MODE.CUSTOM_APP
      : OAUTH_APP_MODE.PLATFORM_MANAGED;
  }

  if (mode === OAUTH_APP_MODE.CUSTOM_APP) {
    const clientId = String(cfg.clientId || secret.clientId || "").trim();
    const clientSecret = String(secret.clientSecret || "").trim();
    if (!clientId || !clientSecret) {
      throw new AppError(
        "Add Client ID and Client Secret on this Google connection before connecting.",
        400,
        "GOOGLE_OAUTH_APP_REQUIRED"
      );
    }
    return {
      mode: OAUTH_APP_MODE.CUSTOM_APP,
      clientId,
      clientSecret,
      redirectUri: redirectUri(),
    };
  }

  if (mode !== OAUTH_APP_MODE.PLATFORM_MANAGED) {
    throw new AppError(
      "Unknown Google OAuth app mode for this connection",
      400,
      "VALIDATION_ERROR"
    );
  }

  const platform = clientConfig();
  if (!platform.clientId || !platform.clientSecret) {
    if (hooks.transport) {
      return {
        mode: OAUTH_APP_MODE.PLATFORM_MANAGED,
        clientId: "test-client",
        clientSecret: "test-secret",
        redirectUri: platform.redirectUri,
      };
    }
    throw new AppError(
      "Gmail sign-in is not available on this OpsAi instance yet. Please contact your workspace administrator.",
      503,
      "GOOGLE_OAUTH_NOT_CONFIGURED"
    );
  }
  return {
    mode: OAUTH_APP_MODE.PLATFORM_MANAGED,
    clientId: platform.clientId,
    clientSecret: platform.clientSecret,
    redirectUri: platform.redirectUri,
  };
};

/** @deprecated Prefer resolveOAuthApp — kept for PLATFORM_MANAGED-only callers. */
const requireClientConfig = () => {
  const resolved = resolveOAuthApp({}, { oauthAppMode: OAUTH_APP_MODE.PLATFORM_MANAGED });
  return {
    clientId: resolved.clientId,
    clientSecret: resolved.clientSecret,
    redirectUri: resolved.redirectUri,
  };
};

const sanitizeGoogleError = (status, body, options = {}) => {
  const product = String(options.product || options.requiredType || "");
  const code =
    status === 401
      ? "GOOGLE_UNAUTHORIZED"
      : status === 403
        ? "GOOGLE_FORBIDDEN"
        : status === 429
          ? "GOOGLE_QUOTA"
          : status === 400
            ? "GOOGLE_BAD_REQUEST"
            : status >= 500
              ? "GOOGLE_UNAVAILABLE"
              : "GOOGLE_ERROR";
  const bodyText =
    typeof body === "string"
      ? body
      : body != null
        ? JSON.stringify(body)
        : "";
  const gmailApiDisabled =
    product === "google_gmail" &&
    /SERVICE_DISABLED|accessNotConfigured|Gmail API has not been used|API has not been used in project/i.test(
      bodyText
    );
  const forbiddenMessage = gmailApiDisabled
    ? "Gmail API is not enabled on the OpsAi Google Cloud project. Ask an admin to enable Gmail API, add Gmail scopes on the OAuth consent screen, then reconnect and grant permissions."
    : product === "google_gmail"
      ? "Google denied Gmail access. Reconnect and enable the Gmail permissions you need (read/manage, send, drafts). If this keeps failing, enable Gmail API on the OpsAi Google Cloud project."
      : "Google denied access to this resource. Check property permissions.";
  const message =
    status === 401
      ? "Google credential expired or was revoked. Reconnect it in Credentials."
      : status === 403
        ? forbiddenMessage
        : status === 429
          ? "Google API quota exceeded. Try again later."
          : status === 400
            ? "Google rejected the request. Check site URL, property ID, or parameters."
            : status >= 500
              ? "Google API is temporarily unavailable."
              : "Google API request failed.";
  const err = new Error(message);
  err.code = code;
  err.statusCode = status >= 400 && status < 600 ? status : 502;
  err.providerStatus = status;
  return err;
};

const defaultTransport = async (url, { method, headers, body, timeoutMs }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: method || "GET",
      headers: headers || {},
      body: body == null ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      signal: controller.signal,
      redirect: "manual",
    });
    const contentType = res.headers.get("content-type") || "";
    const parsed = contentType.includes("application/json")
      ? await res.json().catch(() => null)
      : await res.text();
    return {
      status: res.status,
      ok: res.ok,
      body: parsed,
      headers: Object.fromEntries(res.headers.entries()),
    };
  } catch (err) {
    if (err && err.name === "AbortError") {
      const e = new Error(`Google request timed out after ${timeoutMs || DEFAULT_TIMEOUT_MS}ms`);
      e.code = "GOOGLE_TIMEOUT";
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

const callTransport = (url, opts) => (hooks.transport || defaultTransport)(url, opts);

const encryptGoogleSecret = (secret) => encryptSecret(secret);
const decryptGoogleSecret = (payload) => decryptSecret(payload);

const loadCredential = async (credentialId, workspaceId) => {
  if (hooks.credentialResolver) {
    return hooks.credentialResolver(credentialId, workspaceId);
  }
  const [rows] = await pool.execute(
    `SELECT * FROM workflow_credentials WHERE id = ?`,
    [credentialId]
  );
  if (!rows.length) {
    throw new Error("Google credential not found — reconnect it in the node settings");
  }
  if (workspaceId && rows[0].workspace_id !== workspaceId) {
    const err = new Error("Credential belongs to a different workspace");
    err.code = "GOOGLE_WORKSPACE_DENIED";
    throw err;
  }
  let configObj = {};
  try {
    configObj = rows[0].config_json
      ? typeof rows[0].config_json === "object"
        ? rows[0].config_json
        : JSON.parse(rows[0].config_json)
      : {};
  } catch {
    configObj = {};
  }
  return {
    id: rows[0].id,
    type: rows[0].type,
    name: rows[0].name,
    workspaceId: rows[0].workspace_id,
    secret: decryptSecret(rows[0].secret_json),
    config: configObj && typeof configObj === "object" ? configObj : {},
  };
};

const saveCredentialSecret = async (credentialId, secret, configObj) => {
  if (hooks.credentialSaver) {
    return hooks.credentialSaver(credentialId, secret, configObj);
  }
  if (configObj !== undefined) {
    await pool.execute(
      `UPDATE workflow_credentials SET secret_json = ?, config_json = ? WHERE id = ?`,
      [encryptSecret(secret), JSON.stringify(configObj || {}), credentialId]
    );
    return;
  }
  await pool.execute(
    `UPDATE workflow_credentials SET secret_json = ? WHERE id = ?`,
    [encryptSecret(secret), credentialId]
  );
};

const expiryMs = (secret) => {
  if (!secret) return 0;
  if (Number.isFinite(Number(secret.expiryMs))) return Number(secret.expiryMs);
  if (secret.expiry) {
    const n = Date.parse(secret.expiry);
    if (Number.isFinite(n)) return n;
  }
  if (Number.isFinite(Number(secret.expires_in))) {
    return hooks.now() + Number(secret.expires_in) * 1000;
  }
  return 0;
};

const refreshAccessToken = async (secret, cfg = {}) => {
  if (!secret?.refreshToken) {
    const err = sanitizeGoogleError(401, null);
    throw err;
  }
  const app = resolveOAuthApp(secret, cfg);
  const body = new URLSearchParams({
    client_id: app.clientId,
    client_secret: app.clientSecret,
    grant_type: "refresh_token",
    refresh_token: secret.refreshToken,
  }).toString();
  const res = await callTransport(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  hooks.logger({
    event: "token_refresh",
    status: res.status,
    ok: res.ok,
    oauthAppMode: app.mode,
  });
  if (!res.ok) {
    const grantErr =
      res.body &&
      typeof res.body === "object" &&
      /invalid_grant|revoked/i.test(String(res.body.error || res.body.error_description || ""));
    if (grantErr || res.status === 400 || res.status === 401) {
      throw sanitizeGoogleError(401, null);
    }
    throw sanitizeGoogleError(res.status, res.body);
  }
  const json = res.body && typeof res.body === "object" ? res.body : {};
  return {
    ...secret,
    accessToken: json.access_token,
    refreshToken: json.refresh_token || secret.refreshToken,
    tokenType: json.token_type || "Bearer",
    expiryMs: hooks.now() + Number(json.expires_in || 3600) * 1000,
    revoked: false,
    oauthAppMode: app.mode,
  };
};

const getValidAccessToken = async (secret, cfg = {}) => {
  if (secret?.revoked) {
    throw sanitizeGoogleError(401, null);
  }
  const exp = expiryMs(secret);
  if (!secret?.accessToken || exp - REFRESH_SKEW_MS <= hooks.now()) {
    return refreshAccessToken(secret, cfg);
  }
  return secret;
};

const googleAuthorizedFetch = async ({
  secret,
  config: credConfig = {},
  url,
  method = "GET",
  headers = {},
  body,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  credentialId = null,
  product = null,
}) => {
  let current = await getValidAccessToken(secret, credConfig);
  const send = async (tok) => {
    const hdrs = {
      Accept: "application/json",
      ...headers,
      Authorization: `Bearer ${tok.accessToken}`,
    };
    if (body != null && !hdrs["Content-Type"] && !hdrs["content-type"]) {
      hdrs["Content-Type"] = "application/json";
    }
    hooks.logger({
      event: "google_fetch",
      method,
      host: (() => {
        try {
          return new URL(url).host;
        } catch {
          return "invalid";
        }
      })(),
      timeoutMs,
    });
    return callTransport(url, {
      method,
      headers: hdrs,
      body:
        body == null || typeof body === "string" ? body : JSON.stringify(body),
      timeoutMs,
    });
  };

  let res = await send(current);
  if (res.status === 401) {
    current = await refreshAccessToken(current, credConfig);
    if (credentialId) {
      await saveCredentialSecret(credentialId, current);
    }
    res = await send(current);
  } else if (credentialId && current !== secret) {
    await saveCredentialSecret(credentialId, current);
  }

  if (!res.ok) {
    throw sanitizeGoogleError(res.status, res.body, { product });
  }
  return { ...res, secret: current };
};

const googleApiRequest = async ({
  credentialId,
  workspaceId,
  requiredType,
  url,
  method,
  headers,
  body,
  timeoutMs,
}) => {
  const cred = await loadCredential(credentialId, workspaceId);
  if (requiredType && cred.type !== requiredType) {
    const err = new Error(
      `This node needs a ${GOOGLE_PRODUCTS[requiredType]?.label || requiredType} credential`
    );
    err.code = "GOOGLE_CREDENTIAL_TYPE";
    throw err;
  }
  if (!GOOGLE_TYPES.has(cred.type)) {
    const err = new Error("Select a Google credential for this node");
    err.code = "GOOGLE_CREDENTIAL_REQUIRED";
    throw err;
  }
  const result = await googleAuthorizedFetch({
    secret: cred.secret,
    config: cred.config || {},
    url,
    method,
    headers,
    body,
    timeoutMs,
    credentialId: cred.id,
    product: requiredType || cred.type,
  });
  return result;
};

const normalizeSelectedGmailPermissions = (raw) => {
  const ids = Array.isArray(raw)
    ? raw.map((v) => String(v || "").trim()).filter(Boolean)
    : String(raw || "")
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
  const allowed = new Set(Object.keys(GMAIL_SCOPE_BY_ID));
  const picked = [...new Set(ids.filter((id) => allowed.has(id)))];
  if (picked.length) return picked;
  return GMAIL_PERMISSION_OPTIONS.filter((p) => p.defaultEnabled).map((p) => p.id);
};

const scopesFromGmailPermissions = (permissionIds) => {
  const ids = normalizeSelectedGmailPermissions(permissionIds);
  return ids.map((id) => GMAIL_SCOPE_BY_ID[id]).filter(Boolean);
};

const scopesForProduct = (product, cfg = {}, selectedScopes) => {
  // GSC/GA4/Sheets: request email so we can label multiple accounts.
  // Gmail already resolves email via users/me/profile — do not add identity
  // scopes here (keeps consent tighter for sensitive Gmail APIs).
  const withOptionalIdentity = (scopes) => {
    if (product === "google_gmail") return [...new Set(scopes.filter(Boolean))];
    return [
      ...new Set([
        ...scopes,
        "openid",
        "https://www.googleapis.com/auth/userinfo.email",
      ].filter(Boolean)),
    ];
  };

  if (Array.isArray(selectedScopes) && selectedScopes.length) {
    const cleaned = selectedScopes
      .map((s) => String(s || "").trim())
      .filter((s) => /^https:\/\/www\.googleapis\.com\/auth\//.test(s));
    if (cleaned.length) return withOptionalIdentity(cleaned);
  }
  if (product === "google_gmail") {
    if (Array.isArray(cfg.gmailPermissions) && cfg.gmailPermissions.length) {
      return withOptionalIdentity(
        scopesFromGmailPermissions(cfg.gmailPermissions)
      );
    }
  }
  const custom = String(cfg.customScopes || "").trim();
  if (custom) {
    return withOptionalIdentity(custom.split(/\s+/).filter(Boolean));
  }
  return withOptionalIdentity([...(GOOGLE_PRODUCTS[product]?.scopes || [])]);
};

const startGoogleOAuth = async (
  { workspaceId, workflowId, product, name, credentialId, gmailPermissions },
  authUser
) => {
  await assertWorkspaceAccess(authUser, workspaceId);
  if (!GOOGLE_PRODUCTS[product]) {
    throw new AppError("Unknown Google product", 400, "VALIDATION_ERROR");
  }

  const boundWorkflowId = String(workflowId || "").trim() || null;

  let app;
  let scopes;
  let credConfig = {};
  let credSecret = {};
  let displayName = String(name || GOOGLE_PRODUCTS[product].label).slice(0, 80);
  let permissionIds =
    product === "google_gmail"
      ? normalizeSelectedGmailPermissions(gmailPermissions)
      : [];

  if (credentialId) {
    const cred = await loadCredential(credentialId, workspaceId);
    if (cred.type !== product) {
      throw new AppError(
        "Credential type does not match this Google product",
        400,
        "VALIDATION_ERROR"
      );
    }
    credConfig = cred.config || {};
    credSecret = cred.secret || {};
    displayName = cred.name || displayName;
    app = resolveOAuthApp(credSecret, credConfig);
    if (product === "google_gmail" && !gmailPermissions) {
      permissionIds = normalizeSelectedGmailPermissions(
        credConfig.gmailPermissions
      );
    }
    scopes = scopesForProduct(
      product,
      {
        ...credConfig,
        ...(product === "google_gmail"
          ? { gmailPermissions: permissionIds }
          : {}),
      },
      undefined
    );
  } else {
    // Legacy: create-on-callback with PLATFORM_MANAGED only
    app = resolveOAuthApp(
      {},
      { oauthAppMode: OAUTH_APP_MODE.PLATFORM_MANAGED }
    );
    scopes = scopesForProduct(
      product,
      product === "google_gmail" ? { gmailPermissions: permissionIds } : {},
      undefined
    );
  }

  if (!scopes.length) {
    throw new AppError(
      "Select at least one Gmail permission before signing in.",
      400,
      "VALIDATION_ERROR"
    );
  }

  const actorUserId = String(authUser?.userId || authUser?.id || "").trim();
  if (!actorUserId) {
    throw new AppError("Not authenticated", 401, "UNAUTHORIZED");
  }

  const state = signState({
    flow: "google",
    workspaceId,
    workflowId: boundWorkflowId,
    userId: actorUserId,
    product,
    name: displayName,
    credentialId: credentialId || null,
    oauthAppMode: app.mode,
    gmailPermissions: product === "google_gmail" ? permissionIds : undefined,
    requestedScopes: scopes,
    exp: hooks.now() + 10 * 60 * 1000,
    nonce: crypto.randomBytes(8).toString("hex"),
  });
  const params = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: app.redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    // Always force the Google account picker (no silent reuse of the last browser session).
    prompt: "select_account consent",
    include_granted_scopes: "false",
    state,
  });
  // Never bind a previous Google identity into the authorize URL.
  params.delete("login_hint");
  params.delete("authuser");

  const authUrl = `${AUTH_URL}?${params.toString()}`;
  // Fresh Gmail connects: route through AccountChooser so "Use another account"
  // is always available (otherwise Google often sticks to authuser=0/1).
  const url =
    product === "google_gmail" && !credentialId
      ? `https://accounts.google.com/AccountChooser?continue=${encodeURIComponent(authUrl)}`
      : authUrl;

  let callbackOrigin = "";
  try {
    callbackOrigin = new URL(app.redirectUri).origin;
  } catch {
    callbackOrigin = "";
  }
  return {
    url,
    state,
    callbackOrigin,
    redirectUri: app.redirectUri,
    oauthAppMode: app.mode,
    scopes,
    gmailPermissions: product === "google_gmail" ? permissionIds : undefined,
  };
};

const finishGoogleOAuth = async (code, state) => {
  const parsed = verifyState(state);
  consumeOauthNonce(parsed);
  if (!GOOGLE_PRODUCTS[parsed.product]) {
    throw new AppError("Unknown Google product", 400, "VALIDATION_ERROR");
  }

  let existing = null;
  if (parsed.credentialId) {
    existing = await loadCredential(parsed.credentialId, parsed.workspaceId);
  }

  const app = existing
    ? resolveOAuthApp(existing.secret || {}, existing.config || {})
    : resolveOAuthApp(
        {},
        {
          oauthAppMode:
            parsed.oauthAppMode || OAUTH_APP_MODE.PLATFORM_MANAGED,
        }
      );

  const body = new URLSearchParams({
    client_id: app.clientId,
    client_secret: app.clientSecret,
    code: String(code || ""),
    grant_type: "authorization_code",
    redirect_uri: app.redirectUri,
  }).toString();
  const res = await callTransport(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  hooks.logger({
    event: "oauth_code_exchange",
    status: res.status,
    ok: res.ok,
    oauthAppMode: app.mode,
  });
  if (!res.ok) {
    throw sanitizeGoogleError(res.status === 401 ? 401 : 400, null);
  }
  const json = res.body && typeof res.body === "object" ? res.body : {};
  const requestedScopes = Array.isArray(parsed.requestedScopes)
    ? parsed.requestedScopes.map((s) => String(s || "").trim()).filter(Boolean)
    : scopesForProduct(
        parsed.product,
        {
          ...(existing?.config || {}),
          ...(parsed.product === "google_gmail"
            ? { gmailPermissions: parsed.gmailPermissions }
            : {}),
        },
        undefined
      );
  const grantedScopes = String(
    json.scope || requestedScopes.join(" ")
  )
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parsed.product === "google_gmail") {
    const missing = requestedScopes.filter((scope) => !grantedScopes.includes(scope));
    if (missing.length) {
      throw new AppError(
        "Google did not grant the selected Gmail permissions. On the consent screen, allow the Gmail access you selected, then try again.",
        400,
        "GOOGLE_OAUTH_SCOPES"
      );
    }
  }
  const tokenSecret = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || existing?.secret?.refreshToken || "",
    tokenType: json.token_type || "Bearer",
    expiryMs: hooks.now() + Number(json.expires_in || 3600) * 1000,
    scopes: grantedScopes.length
      ? grantedScopes
      : String(
          json.scope ||
            scopesForProduct(parsed.product, existing?.config || {}).join(" ")
        ).split(/\s+/),
    revoked: false,
    oauthAppMode: app.mode,
  };
  if (app.mode === OAUTH_APP_MODE.CUSTOM_APP && existing?.secret?.clientSecret) {
    tokenSecret.clientSecret = existing.secret.clientSecret;
  }
  if (!tokenSecret.accessToken) {
    throw new AppError("Google did not return an access token", 502, "GOOGLE_OAUTH_FAILED");
  }

  let accountEmail = existing?.config?.accountEmail || "";
  if (tokenSecret.accessToken) {
    if (parsed.product === "google_gmail") {
      const profile = await callTransport(
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${tokenSecret.accessToken}`,
          },
          timeoutMs: 10000,
        }
      );
      if (!profile?.ok) {
        throw sanitizeGoogleError(profile?.status || 403, profile?.body, {
          product: "google_gmail",
        });
      }
      const email =
        profile?.body && typeof profile.body === "object"
          ? String(profile.body.emailAddress || "").trim()
          : "";
      if (email) accountEmail = email;
    } else if (!accountEmail) {
      try {
        const profile = await callTransport(
          "https://www.googleapis.com/oauth2/v2/userinfo",
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${tokenSecret.accessToken}`,
            },
            timeoutMs: 10000,
          }
        );
        if (profile?.ok && profile.body && typeof profile.body === "object") {
          const email = String(profile.body.email || "").trim();
          if (email) accountEmail = email;
        }
      } catch {
        // Labeling is best-effort for GSC/GA4/Sheets.
      }
    }
  }

  const gmailPermissions =
    parsed.product === "google_gmail"
      ? normalizeSelectedGmailPermissions(parsed.gmailPermissions)
      : undefined;
  const boundWorkflowId = String(parsed.workflowId || "").trim() || null;

  if (existing) {
    const nextConfig = {
      ...(existing.config || {}),
      oauthAppMode: app.mode,
      connected: true,
      ...(accountEmail ? { accountEmail } : {}),
      ...(gmailPermissions ? { gmailPermissions } : {}),
      ...(boundWorkflowId
        ? { workflowId: boundWorkflowId }
        : existing.config?.workflowId
          ? { workflowId: existing.config.workflowId }
          : {}),
    };
    if (app.mode === OAUTH_APP_MODE.CUSTOM_APP && existing.config?.clientId) {
      nextConfig.clientId = existing.config.clientId;
    }
    await saveCredentialSecret(existing.id, tokenSecret, nextConfig);
    if (accountEmail) {
      const nextName = await allocateUniqueCredentialName(
        parsed.workspaceId,
        `${GOOGLE_PRODUCTS[parsed.product].label} (${accountEmail})`,
        { excludeId: existing.id }
      );
      try {
        await pool.execute(
          `UPDATE workflow_credentials SET name = ? WHERE id = ?`,
          [nextName, existing.id]
        );
      } catch {
        // Name refresh is best-effort.
      }
    }
    return {
      credentialId: existing.id,
      workspaceId: parsed.workspaceId,
      product: parsed.product,
    };
  }

  const id = uuidv4();
  const createdBy = String(parsed.userId || "").trim();
  if (!createdBy) {
    throw new AppError(
      "Google connect failed — signed-in user missing from OAuth state. Try Sign in with Google again.",
      400,
      "GOOGLE_OAUTH_STATE"
    );
  }
  const displayName = await allocateUniqueCredentialName(
    parsed.workspaceId,
    accountEmail
      ? `${GOOGLE_PRODUCTS[parsed.product].label} (${accountEmail})`
      : parsed.name || GOOGLE_PRODUCTS[parsed.product].label
  );
  await pool.execute(
    `INSERT INTO workflow_credentials
      (id, workspace_id, name, type, secret_json, config_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      parsed.workspaceId,
      displayName,
      parsed.product,
      encryptSecret(tokenSecret),
      JSON.stringify({
        oauthAppMode: OAUTH_APP_MODE.PLATFORM_MANAGED,
        connected: true,
        ...(accountEmail ? { accountEmail } : {}),
        ...(gmailPermissions ? { gmailPermissions } : {}),
        ...(boundWorkflowId ? { workflowId: boundWorkflowId } : {}),
      }),
      createdBy,
    ]
  );
  return { credentialId: id, workspaceId: parsed.workspaceId, product: parsed.product };
};

const upsertGoogleOAuthCredential = async ({
  id,
  workspaceId,
  name,
  type,
  secret,
  createdBy,
}) => {
  if (!GOOGLE_TYPES.has(type)) {
    throw new Error(`Unsupported Google credential type: ${type}`);
  }
  const credId = id || uuidv4();
  if (hooks.credentialSaver && hooks.credentialResolver) {
    const stored = {
      id: credId,
      workspaceId,
      name,
      type,
      secret,
    };
    await hooks.credentialSaver(credId, secret, stored);
    return stored;
  }
  await pool.execute(
    `INSERT INTO workflow_credentials
      (id, workspace_id, name, type, secret_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE secret_json = VALUES(secret_json), name = VALUES(name)`,
    [credId, workspaceId, name, type, encryptSecret(secret), createdBy || null]
  );
  return { id: credId, workspaceId, name, type };
};

const testGoogleCredential = async (credentialId, authUser) => {
  const [rows] = await pool.execute(
    `SELECT * FROM workflow_credentials WHERE id = ?`,
    [credentialId]
  );
  if (!rows.length) {
    throw new AppError("Credential not found", 404, "NOT_FOUND");
  }
  await assertWorkspaceAccess(authUser, rows[0].workspace_id);
  const type = rows[0].type;
  if (!GOOGLE_TYPES.has(type)) {
    throw new AppError("Not a Google credential", 400, "VALIDATION_ERROR");
  }
  const probes = {
    google_gsc: "https://searchconsole.googleapis.com/webmasters/v3/sites",
    google_ga4:
      "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=1",
    google_gmail: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    google_sheets: null,
  };
  if (!probes[type]) {
    const secret = decryptSecret(rows[0].secret_json);
    let cfg = {};
    try {
      cfg = rows[0].config_json
        ? typeof rows[0].config_json === "object"
          ? rows[0].config_json
          : JSON.parse(rows[0].config_json)
        : {};
    } catch {
      cfg = {};
    }
    await getValidAccessToken(secret, cfg);
    return { ok: true, type };
  }
  await googleApiRequest({
    credentialId,
    workspaceId: rows[0].workspace_id,
    requiredType: type,
    url: probes[type],
    method: "GET",
    timeoutMs: 15000,
  });
  return { ok: true, type };
};

const allowedFrontendOrigins = () =>
  String(config.cors?.origin || process.env.CORS_ORIGIN || "http://localhost:3001")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter((s) => /^https?:\/\/[^/\s]+$/i.test(s));

const sanitizeCallbackError = (err) => {
  const code = err && err.code != null ? String(err.code) : "";
  const raw = err && err.message ? String(err.message) : "OAuth failed";
  if (/GOOGLE_OAUTH_CLIENT|process\.env|CLIENT_SECRET|CLIENT_ID\s*\//i.test(raw)) {
    return "Google sign-in is not available on this OpsAi instance yet. Please contact your workspace administrator.";
  }
  // Preserve actionable Google/Gmail scope messages; scrub only raw token material.
  if (
    /gmail api|gmail scope|access_denied|insufficient.?permission|enable the gmail/i.test(
      raw
    )
  ) {
    return raw.slice(0, 220);
  }
  if (/token|bearer|secret|authorization|refresh/i.test(raw)) {
    return "Google connect failed";
  }
  if (
    code === "GOOGLE_OAUTH_STATE" ||
    code === "GOOGLE_OAUTH_NOT_CONFIGURED" ||
    code === "GOOGLE_OAUTH_APP_REQUIRED" ||
    code === "GOOGLE_OAUTH_FAILED" ||
    code === "GOOGLE_OAUTH_SCOPES" ||
    code === "GOOGLE_FORBIDDEN" ||
    code.startsWith("GOOGLE_")
  ) {
    return raw;
  }
  // Foreign-key / DB identity failures should not leak SQL.
  if (/foreign key|created_by|ER_NO_REFERENCED/i.test(raw)) {
    return "Google connect failed — signed-in user could not be saved. Sign out and back into OpsAi, then try again.";
  }
  return "Google connect failed";
};

const oauthCallbackHtml = ({ ok, credentialId, error }) => {
  const payload = ok
    ? { type: "opsai-google-oauth", ok: true, credentialId }
    : { type: "opsai-google-oauth", ok: false, error: String(error || "OAuth failed") };
  const json = JSON.stringify(payload);
  const origins = JSON.stringify(allowedFrontendOrigins());
  const visible = ok
    ? "Google connected. You can close this window."
    : `Google connect failed: ${payload.error || "OAuth failed"}`;
  // Visible text is in HTML (not only JS) so Helmet CSP cannot leave a blank page.
  return `<!doctype html><html><head><meta charset="utf-8"><title>OpsAi Google OAuth</title></head><body>
<p id="msg">${visible.replace(/</g, "&lt;")}</p>
<script>
(function(){
  var payload = ${json};
  var origins = ${origins};
  var msg = document.getElementById("msg");
  if (window.opener) {
    origins.forEach(function(origin){
      try { window.opener.postMessage(payload, origin); } catch (e) {}
    });
  } else if (msg) {
    msg.innerText = payload.ok
      ? "Google connected. Return to OpsAi and refresh the connection list."
      : ("Google connect failed: " + (payload.error || ""));
  }
  setTimeout(function(){ try { window.close(); } catch (e) {} }, 1200);
})();
</script>
</body></html>`;
};

/** Override Helmet so OAuth popup callback scripts can run and keep opener. */
const applyOAuthPopupResponseHeaders = (res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; base-uri 'none'; form-action 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'none'"
  );
  res.setHeader("Cross-Origin-Opener-Policy", "unsafe-none");
};

module.exports = {
  GOOGLE_PRODUCTS,
  GOOGLE_TYPES,
  GMAIL_PERMISSION_OPTIONS,
  OAUTH_APP_MODE,
  AUTH_URL,
  TOKEN_URL,
  DEFAULT_TIMEOUT_MS,
  withGoogleOAuthTestHooks,
  signState,
  verifyState,
  sanitizeGoogleError,
  redactLog,
  encryptGoogleSecret,
  decryptGoogleSecret,
  refreshAccessToken,
  getValidAccessToken,
  googleAuthorizedFetch,
  googleApiRequest,
  startGoogleOAuth,
  finishGoogleOAuth,
  consumeOauthNonce,
  resetOauthNonceStore,
  sanitizeCallbackError,
  allowedFrontendOrigins,
  normalizeSelectedGmailPermissions,
  scopesFromGmailPermissions,
  scopesForProduct,
  upsertGoogleOAuthCredential,
  testGoogleCredential,
  oauthCallbackHtml,
  applyOAuthPopupResponseHeaders,
  loadCredential,
  saveCredentialSecret,
  resolveOAuthApp,
  redirectUri,
  platformClientConfigured,
  clientConfig,
  requireClientConfig,
};
