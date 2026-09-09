/**
 * Editor-side Google OAuth popup postMessage policy.
 * Tokens never appear in the payload — only type/ok/credentialId or type/ok/error.
 */

export const OAUTH_MESSAGE_TYPE = "opsai-google-oauth";

const CREDENTIAL_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SECRET_KEY_RE =
  /^(accessToken|refreshToken|access_token|refresh_token|authorization|clientSecret|client_secret|id_token)$/i;

export type GoogleOAuthPostMessageEvent = {
  origin?: string;
  source?: unknown;
  data?: unknown;
};

export type GoogleOAuthMessageOptions = {
  allowedOrigins: string[];
  expectedSource?: unknown;
};

export type GoogleOAuthMessageResult =
  | { handled: false; reason: "origin" | "source" | "malformed" }
  | { handled: true; accepted: true; credentialId: string }
  | { handled: true; accepted: false; error: string };

export const normalizeOrigin = (origin: string | undefined | null): string =>
  String(origin || "")
    .trim()
    .replace(/\/$/, "");

/** Sender origins we accept: OAuth callback host plus the editor origin (same-site prod). */
export const resolveOAuthMessageAllowedOrigins = ({
  editorOrigin,
  callbackOrigin,
}: {
  editorOrigin?: string | null;
  callbackOrigin?: string | null;
}): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
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

const isAllowedOAuthMessageOrigin = (
  eventOrigin: string | undefined,
  allowedOrigins: string[]
): boolean => {
  const origin = normalizeOrigin(eventOrigin);
  if (!origin) return false;
  return (allowedOrigins || []).map(normalizeOrigin).includes(origin);
};

const sanitizeOauthError = (error: unknown): string => {
  const raw = typeof error === "string" ? error : "Google connect failed";
  const clipped = raw.slice(0, 200);
  if (/token|bearer|secret|authorization|refresh/i.test(clipped)) {
    return "Google connect failed";
  }
  return clipped || "Google connect failed";
};

export const parseGoogleOAuthMessage = (
  data: unknown
): GoogleOAuthMessageResult => {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { handled: false, reason: "malformed" };
  }
  const rec = data as Record<string, unknown>;
  const keys = Object.keys(rec);
  if (keys.some((k) => SECRET_KEY_RE.test(k))) {
    return { handled: false, reason: "malformed" };
  }
  if (rec.type !== OAUTH_MESSAGE_TYPE) {
    return { handled: false, reason: "malformed" };
  }
  if (rec.ok === true) {
    const allowed = new Set(["type", "ok", "credentialId"]);
    if (keys.some((k) => !allowed.has(k))) {
      return { handled: false, reason: "malformed" };
    }
    const credentialId = String(rec.credentialId || "");
    if (!CREDENTIAL_ID_RE.test(credentialId)) {
      return { handled: false, reason: "malformed" };
    }
    return { handled: true, accepted: true, credentialId };
  }
  if (rec.ok === false) {
    const allowed = new Set(["type", "ok", "error"]);
    if (keys.some((k) => !allowed.has(k))) {
      return { handled: false, reason: "malformed" };
    }
    return {
      handled: true,
      accepted: false,
      error: sanitizeOauthError(rec.error),
    };
  }
  return { handled: false, reason: "malformed" };
};

export const acceptGoogleOAuthPostMessage = (
  event: GoogleOAuthPostMessageEvent | null | undefined,
  options: GoogleOAuthMessageOptions
): GoogleOAuthMessageResult => {
  const allowedOrigins = options?.allowedOrigins || [];
  if (!isAllowedOAuthMessageOrigin(event?.origin, allowedOrigins)) {
    return { handled: false, reason: "origin" };
  }
  if (
    options.expectedSource !== undefined &&
    options.expectedSource !== null &&
    event?.source !== options.expectedSource
  ) {
    return { handled: false, reason: "source" };
  }
  return parseGoogleOAuthMessage(event?.data);
};
