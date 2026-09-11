/**
 * Generic OAuth2 connection flow for HTTP Request.
 * Separate from Google-managed OAuth (does not use GOOGLE_OAUTH_CLIENT_*).
 * State is signed, expiring, user/workspace/credential bound, single-use.
 */

const crypto = require("crypto");
const config = require("../config");
const AppError = require("../utils/AppError");
const { assertWorkspaceAccess } = require("./authorization.service");
const { parseAllowedHosts } = require("./connectionDomainPolicy.service");

const DEFAULT_TIMEOUT_MS = 25000;
const REFRESH_SKEW_MS = 60_000;
const OAUTH2_MESSAGE_TYPE = "opsai-oauth2";

const hooks = {
  transport: null,
  now: () => Date.now(),
  logger: (fields) => {
    try {
      const safe = { ...fields };
      for (const k of Object.keys(safe)) {
        if (/token|secret|authorization|code/i.test(k)) safe[k] = "[REDACTED]";
      }
      console.info("[oauth2]", JSON.stringify(safe));
    } catch {
      // ignore
    }
  },
};

const consumedNonces = new Map();
const MAX_CONSUMED_NONCES = 4000;

const withOAuth2TestHooks = async (overrides, fn) => {
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

const resetOAuth2NonceStore = () => consumedNonces.clear();

const consumeNonce = (parsed) => {
  const nonce = String(parsed?.nonce || "");
  if (!/^[a-f0-9]{16}$/.test(nonce)) {
    throw new AppError("Invalid OAuth state", 400, "OAUTH2_STATE");
  }
  const now = hooks.now();
  pruneConsumedNonces(now);
  if (consumedNonces.has(nonce)) {
    throw new AppError("OAuth state already used — start connect again", 400, "OAUTH2_STATE");
  }
  consumedNonces.set(nonce, Number(parsed.exp) || now + 10 * 60 * 1000);
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
  if (dot < 8) throw new AppError("Invalid OAuth state", 400, "OAUTH2_STATE");
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = crypto.createHmac("sha256", stateSecret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new AppError("Invalid OAuth state", 400, "OAUTH2_STATE");
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new AppError("Invalid OAuth state", 400, "OAUTH2_STATE");
  }
  if (!parsed || parsed.flow !== "oauth2") {
    throw new AppError("Invalid OAuth state", 400, "OAUTH2_STATE");
  }
  if (parsed.exp < hooks.now()) {
    throw new AppError("OAuth state expired — start connect again", 400, "OAUTH2_STATE");
  }
  return parsed;
};

const redirectUri = () =>
  String(
    config.oauth2?.redirectUri ||
      process.env.OAUTH2_REDIRECT_URI ||
      "http://localhost:5013/api/oauth2/callback"
  ).trim();

const sanitizeOAuth2Error = (err) => {
  const raw = err instanceof Error ? err.message : String(err || "OAuth failed");
  const code = err && err.code ? String(err.code) : "";
  if (code === "OAUTH2_STATE" || code === "OAUTH2_FAILED") {
    return raw.slice(0, 200);
  }
  if (/token|secret|authorization|bearer|refresh/i.test(raw)) {
    return "Could not complete OAuth2 connect";
  }
  return raw.slice(0, 200) || "Could not complete OAuth2 connect";
};

const allowedFrontendOrigins = () =>
  String(config.cors?.origin || process.env.CORS_ORIGIN || "http://localhost:3001")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);

const oauth2CallbackHtml = ({ ok, credentialId, error }) => {
  const payload = ok
    ? { type: OAUTH2_MESSAGE_TYPE, ok: true, credentialId }
    : { type: OAUTH2_MESSAGE_TYPE, ok: false, error: String(error || "OAuth failed") };
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
  document.body.innerText = payload.ok ? "Account connected. You can close this window." : ("Connect failed: " + (payload.error || ""));
  setTimeout(function(){ window.close(); }, 400);
})();
</script></body></html>`;
};

const parseConfig = (raw) => {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const validateOAuth2Config = (configIn, { requireSecret } = {}) => {
  const errors = [];
  const grantType = String(configIn.grantType || "authorizationCode").trim();
  if (grantType !== "authorizationCode") {
    errors.push("Only Authorization Code grant is supported");
  }
  if (!String(configIn.authorizationUrl || "").trim()) {
    errors.push("Authorization URL is required");
  }
  if (!String(configIn.accessTokenUrl || "").trim()) {
    errors.push("Access Token URL is required");
  }
  if (!String(configIn.clientId || "").trim()) {
    errors.push("Client ID is required");
  }
  if (requireSecret && !String(configIn.clientSecret || "").trim()) {
    errors.push("Client Secret is required");
  }
  const domains = parseAllowedHosts(configIn.allowedDomains);
  if (!domains.length) {
    errors.push("Allowed HTTP Request Domains is required");
  }
  const tokenExpiredStatus = Number(configIn.tokenExpiredStatusCode ?? 401);
  return {
    errors,
    config: {
      grantType: "authorizationCode",
      authorizationUrl: String(configIn.authorizationUrl || "").trim(),
      accessTokenUrl: String(configIn.accessTokenUrl || "").trim(),
      clientId: String(configIn.clientId || "").trim(),
      scope: String(configIn.scope || "").trim(),
      authUriQuery: String(configIn.authUriQuery || "").trim(),
      clientAuth: String(configIn.clientAuth || "body") === "header" ? "header" : "body",
      ignoreSsl: Boolean(configIn.ignoreSsl),
      tokenExpiredStatusCode: Number.isFinite(tokenExpiredStatus)
        ? tokenExpiredStatus
        : 401,
      allowedDomains: domains,
      connected: Boolean(configIn.connected),
    },
  };
};

const editorSafeConfig = (configRow) => {
  const cfg = parseConfig(configRow);
  return {
    grantType: cfg.grantType || "authorizationCode",
    authorizationUrl: cfg.authorizationUrl || "",
    accessTokenUrl: cfg.accessTokenUrl || "",
    clientId: cfg.clientId || "",
    scope: cfg.scope || "",
    authUriQuery: cfg.authUriQuery || "",
    clientAuth: cfg.clientAuth || "body",
    ignoreSsl: Boolean(cfg.ignoreSsl),
    tokenExpiredStatusCode: Number(cfg.tokenExpiredStatusCode) || 401,
    allowedDomains: Array.isArray(cfg.allowedDomains) ? cfg.allowedDomains : [],
    connected: Boolean(cfg.connected),
    redirectUri: redirectUri(),
  };
};

const callTransport = async (url, opts) => {
  if (hooks.transport) return hooks.transport(url, opts);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    const contentType = res.headers.get("content-type") || "";
    const body = contentType.includes("application/json")
      ? await res.json().catch(() => null)
      : await res.text();
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
};

const appendQuery = (url, extra) => {
  const u = new URL(url);
  const extraParams = new URLSearchParams(String(extra || "").replace(/^\?/, ""));
  extraParams.forEach((v, k) => {
    if (k) u.searchParams.set(k, v);
  });
  return u.toString();
};

const startOAuth2 = async ({ credentialId, workspaceId }, authUser) => {
  await assertWorkspaceAccess(authUser, workspaceId);
  const credentialsService = require("../modules/workflows/credentials.service");
  const row = await credentialsService.getForWorkspace(credentialId, workspaceId);
  if (!row || row.type !== "oauth2") {
    throw new AppError("OAuth2 connection not found", 404, "NOT_FOUND");
  }
  const cfg = parseConfig(row.config);
  if (!cfg.authorizationUrl || !cfg.clientId) {
    throw new AppError("OAuth2 connection is incomplete", 400, "VALIDATION_ERROR");
  }
  const userId = authUser.id || authUser.userId;
  const state = signState({
    flow: "oauth2",
    workspaceId,
    userId,
    credentialId,
    exp: hooks.now() + 10 * 60 * 1000,
    nonce: crypto.randomBytes(8).toString("hex"),
  });
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    state,
    access_type: "offline",
    prompt: "select_account consent",
  });
  if (cfg.scope) params.set("scope", cfg.scope);
  let authUrl = `${cfg.authorizationUrl}${cfg.authorizationUrl.includes("?") ? "&" : "?"}${params.toString()}`;
  if (cfg.authUriQuery) authUrl = appendQuery(authUrl, cfg.authUriQuery);
  let callbackOrigin = "";
  try {
    callbackOrigin = new URL(redirectUri()).origin;
  } catch {
    callbackOrigin = "";
  }
  return { url: authUrl, callbackOrigin, redirectUri: redirectUri() };
};

const finishOAuth2 = async (code, state) => {
  const parsed = verifyState(state);
  consumeNonce(parsed);
  const credentialsService = require("../modules/workflows/credentials.service");
  const row = await credentialsService.getForWorkspace(
    parsed.credentialId,
    parsed.workspaceId
  );
  if (!row || row.type !== "oauth2") {
    throw new AppError("OAuth2 connection not found", 404, "NOT_FOUND");
  }
  const cfg = parseConfig(row.config);
  const secret = row.secret || {};
  const tokenUrl = cfg.accessTokenUrl;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: String(code || ""),
    redirect_uri: redirectUri(),
  });
  const headers = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  if (cfg.clientAuth === "header") {
    headers.Authorization = `Basic ${Buffer.from(`${cfg.clientId}:${secret.clientSecret || ""}`).toString("base64")}`;
  } else {
    body.set("client_id", cfg.clientId);
    body.set("client_secret", secret.clientSecret || "");
  }
  hooks.logger({ event: "oauth2_code_exchange", host: (() => {
    try { return new URL(tokenUrl).host; } catch { return "invalid"; }
  })() });
  const res = await callTransport(tokenUrl, {
    method: "POST",
    headers,
    body: body.toString(),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  if (!res.ok) {
    throw new AppError("Could not complete OAuth2 connect", 400, "OAUTH2_FAILED");
  }
  const json = res.body && typeof res.body === "object" ? res.body : {};
  if (!json.access_token) {
    throw new AppError("Could not complete OAuth2 connect", 502, "OAUTH2_FAILED");
  }
  const nextSecret = {
    clientSecret: secret.clientSecret || "",
    accessToken: json.access_token,
    refreshToken: json.refresh_token || secret.refreshToken || "",
    tokenType: json.token_type || "Bearer",
    expiryMs: hooks.now() + Number(json.expires_in || 3600) * 1000,
  };
  await credentialsService.saveSecretAndConfig(parsed.credentialId, nextSecret, {
    ...cfg,
    connected: true,
  });
  return { credentialId: parsed.credentialId, workspaceId: parsed.workspaceId };
};

const getValidAccessToken = async (secret, cfg) => {
  if (cfg?.ignoreSsl) {
    throw new Error("Insecure TLS skip is not enabled for this connection");
  }
  const expiry = Number(secret.expiryMs || 0);
  if (secret.accessToken && expiry - REFRESH_SKEW_MS > hooks.now()) {
    return secret;
  }
  if (!secret.refreshToken || !cfg?.accessTokenUrl) {
    throw new Error("OAuth2 connection needs to be reconnected");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: secret.refreshToken,
  });
  const headers = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  if (cfg.clientAuth === "header") {
    headers.Authorization = `Basic ${Buffer.from(`${cfg.clientId}:${secret.clientSecret || ""}`).toString("base64")}`;
  } else {
    body.set("client_id", cfg.clientId || "");
    body.set("client_secret", secret.clientSecret || "");
  }
  const res = await callTransport(cfg.accessTokenUrl, {
    method: "POST",
    headers,
    body: body.toString(),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  if (!res.ok) {
    throw new Error("OAuth2 connection needs to be reconnected");
  }
  const json = res.body && typeof res.body === "object" ? res.body : {};
  if (!json.access_token) {
    throw new Error("OAuth2 connection needs to be reconnected");
  }
  return {
    ...secret,
    accessToken: json.access_token,
    refreshToken: json.refresh_token || secret.refreshToken,
    expiryMs: hooks.now() + Number(json.expires_in || 3600) * 1000,
  };
};

module.exports = {
  OAUTH2_MESSAGE_TYPE,
  redirectUri,
  validateOAuth2Config,
  editorSafeConfig,
  parseConfig,
  startOAuth2,
  finishOAuth2,
  getValidAccessToken,
  oauth2CallbackHtml,
  sanitizeOAuth2Error,
  withOAuth2TestHooks,
  resetOAuth2NonceStore,
  signState,
  verifyState,
};
