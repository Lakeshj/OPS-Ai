/** Decode JWT payload without verifying signature (client-side expiry checks only). */
export const decodeJwtPayload = (
  token: string
): Record<string, unknown> | null => {
  try {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const json = atob(padded);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
};

/** Returns true when token is missing, malformed, or past `exp`. */
export const isAccessTokenExpired = (token: string | null | undefined) => {
  if (!token) return true;
  const payload = decodeJwtPayload(token);
  const exp = payload?.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return true;
  // Small clock skew allowance (30s)
  return Date.now() >= exp * 1000 - 30_000;
};
