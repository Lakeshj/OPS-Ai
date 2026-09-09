/**
 * Shared Google OAuth popup postMessage policy (CommonJS copy of
 * frontend/src/modules/workflows/googleOAuthMessage.ts). Keep both in lockstep.
 * Tokens never appear in the payload — only type/ok/credentialId or type/ok/error.
 */
const OAUTH_MESSAGE_TYPE = "opsai-google-oauth";

const CREDENTIAL_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SECRET_KEY_RE =
  /^(accessToken|refreshToken|access_token|refresh_token|authorization|clientSecret|client_secret|id_token)$/i;

const normalizeOrigin = (origin) =>
  String(origin || "")
    .trim()
    .replace(/\/$/, "");

const resolveOAuthMessageAllowedOrigins = ({
  editorOrigin,
  callbackOrigin,
} = {}) => {
  const out = [];
  const seen = new Set();
  for (const raw of [callbackOrigin, editorOrigin]) {
    const origin = normalizeOrigin(raw);
    if (!origin || !/^https?:\/\/[^/\s]+$/i.test(origin) || seen.has(origin)) {
      continue;
    }
    seen.add(origin);
    out.push(origin);
  }
  return out;
};

const isAllowedOAuthMessageOrigin = (eventOrigin, allowedOrigins) => {
  const origin = normalizeOrigin(eventOrigin);
  if (!origin) return false;
  return (allowedOrigins || []).map(normalizeOrigin).includes(origin);
};

const sanitizeOauthError = (error) => {
  const raw = typeof error === "string" ? error : "Google connect failed";
  const clipped = raw.slice(0, 200);
  if (/token|bearer|secret|authorization|refresh/i.test(clipped)) {
    return "Google connect failed";
  }
  return clipped || "Google connect failed";
};

const parseGoogleOAuthMessage = (data) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { handled: false, reason: "malformed" };
  }
  const keys = Object.keys(data);
  if (keys.some((k) => SECRET_KEY_RE.test(k))) {
    return { handled: false, reason: "malformed" };
  }
  if (data.type !== OAUTH_MESSAGE_TYPE) {
    return { handled: false, reason: "malformed" };
  }
  if (data.ok === true) {
    const allowed = new Set(["type", "ok", "credentialId"]);
    if (keys.some((k) => !allowed.has(k))) {
      return { handled: false, reason: "malformed" };
    }
    const credentialId = String(data.credentialId || "");
    if (!CREDENTIAL_ID_RE.test(credentialId)) {
      return { handled: false, reason: "malformed" };
    }
    return { handled: true, accepted: true, credentialId };
  }
  if (data.ok === false) {
    const allowed = new Set(["type", "ok", "error"]);
    if (keys.some((k) => !allowed.has(k))) {
      return { handled: false, reason: "malformed" };
    }
    return {
      handled: true,
      accepted: false,
      error: sanitizeOauthError(data.error),
    };
  }
  return { handled: false, reason: "malformed" };
};

const acceptGoogleOAuthPostMessage = (event, options = {}) => {
  const allowedOrigins = options.allowedOrigins || [];
  if (!isAllowedOAuthMessageOrigin(event && event.origin, allowedOrigins)) {
    return { handled: false, reason: "origin" };
  }
  if (
    options.expectedSource !== undefined &&
    options.expectedSource !== null &&
    (!event || event.source !== options.expectedSource)
  ) {
    return { handled: false, reason: "source" };
  }
  return parseGoogleOAuthMessage(event && event.data);
};

module.exports = {
  OAUTH_MESSAGE_TYPE,
  normalizeOrigin,
  resolveOAuthMessageAllowedOrigins,
  parseGoogleOAuthMessage,
  acceptGoogleOAuthPostMessage,
};
