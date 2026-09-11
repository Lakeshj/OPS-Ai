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
      "Add Client ID and Client Secret on this Google connection before connecting.",
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

const sanitizeGoogleError = (status, body) => {
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
  const message =
    status === 401
      ? "Google credential expired or was revoked. Reconnect it in Credentials."
      : status === 403
        ? "Google denied access to this resource. Check property permissions."
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
  void body;
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
    throw sanitizeGoogleError(res.status, res.body);
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
  });
  return result;
};

const scopesForProduct = (product, cfg = {}) => {
  const custom = String(cfg.customScopes || "").trim();
  if (custom) {
    return custom.split(/\s+/).filter(Boolean);
  }
  return [...(GOOGLE_PRODUCTS[product]?.scopes || [])];
};

const startGoogleOAuth = async (
  { workspaceId, product, name, credentialId },
  authUser
) => {
  await assertWorkspaceAccess(authUser, workspaceId);
  if (!GOOGLE_PRODUCTS[product]) {
    throw new AppError("Unknown Google product", 400, "VALIDATION_ERROR");
  }

  let app;
  let scopes;
  let credConfig = {};
  let credSecret = {};
  let displayName = String(name || GOOGLE_PRODUCTS[product].label).slice(0, 80);

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
    scopes = scopesForProduct(product, credConfig);
  } else {
    // Legacy: create-on-callback with PLATFORM_MANAGED only
    app = resolveOAuthApp(
      {},
      { oauthAppMode: OAUTH_APP_MODE.PLATFORM_MANAGED }
    );
    scopes = scopesForProduct(product, {});
  }

  const state = signState({
    flow: "google",
    workspaceId,
    userId: authUser.id,
    product,
    name: displayName,
    credentialId: credentialId || null,
    oauthAppMode: app.mode,
    exp: hooks.now() + 10 * 60 * 1000,
    nonce: crypto.randomBytes(8).toString("hex"),
  });
  const params = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: app.redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "select_account consent",
    include_granted_scopes: "false",
    state,
  });
  let callbackOrigin = "";
  try {
    callbackOrigin = new URL(app.redirectUri).origin;
  } catch {
    callbackOrigin = "";
  }
  return {
    url: `${AUTH_URL}?${params.toString()}`,
    state,
    callbackOrigin,
    redirectUri: app.redirectUri,
    oauthAppMode: app.mode,
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
  const tokenSecret = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || existing?.secret?.refreshToken || "",
    tokenType: json.token_type || "Bearer",
    expiryMs: hooks.now() + Number(json.expires_in || 3600) * 1000,
    scopes: String(
      json.scope || scopesForProduct(parsed.product, existing?.config || {}).join(" ")
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

  if (existing) {
    const nextConfig = {
      ...(existing.config || {}),
      oauthAppMode: app.mode,
      connected: true,
    };
    if (app.mode === OAUTH_APP_MODE.CUSTOM_APP && existing.config?.clientId) {
      nextConfig.clientId = existing.config.clientId;
    }
    await saveCredentialSecret(existing.id, tokenSecret, nextConfig);
    return {
      credentialId: existing.id,
      workspaceId: parsed.workspaceId,
      product: parsed.product,
    };
  }

  const id = uuidv4();
  await pool.execute(
    `INSERT INTO workflow_credentials
      (id, workspace_id, name, type, secret_json, config_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      parsed.workspaceId,
      parsed.name || GOOGLE_PRODUCTS[parsed.product].label,
      parsed.product,
      encryptSecret(tokenSecret),
      JSON.stringify({
        oauthAppMode: OAUTH_APP_MODE.PLATFORM_MANAGED,
        connected: true,
      }),
      parsed.userId,
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
    return "Add Client ID and Client Secret on this Google connection before connecting.";
  }
  if (/token|bearer|secret|authorization|refresh/i.test(raw)) {
    return "Google connect failed";
  }
  if (
    code === "GOOGLE_OAUTH_STATE" ||
    code === "GOOGLE_OAUTH_NOT_CONFIGURED" ||
    code === "GOOGLE_OAUTH_APP_REQUIRED" ||
    code === "GOOGLE_OAUTH_FAILED" ||
    code.startsWith("GOOGLE_")
  ) {
    return raw;
  }
  return "Google connect failed";
};

const oauthCallbackHtml = ({ ok, credentialId, error }) => {
  const payload = ok
    ? { type: "opsai-google-oauth", ok: true, credentialId }
    : { type: "opsai-google-oauth", ok: false, error: String(error || "OAuth failed") };
  const json = JSON.stringify(payload);
  const origins = JSON.stringify(allowedFrontendOrigins());
  return `<!doctype html><html><body><script>
(function(){
  var payload = ${json};
  var origins = ${origins};
  if (window.opener) {
    origins.forEach(function(origin){
      try { window.opener.postMessage(payload, origin); } catch (e) {}
    });
  }
  document.body.innerText = payload.ok ? "Google connected. You can close this window." : ("Google connect failed: " + (payload.error || ""));
  setTimeout(function(){ window.close(); }, 400);
})();
</script></body></html>`;
};

module.exports = {
  GOOGLE_PRODUCTS,
  GOOGLE_TYPES,
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
  upsertGoogleOAuthCredential,
  testGoogleCredential,
  oauthCallbackHtml,
  loadCredential,
  saveCredentialSecret,
  resolveOAuthApp,
  redirectUri,
  platformClientConfigured,
  clientConfig,
  requireClientConfig,
};
