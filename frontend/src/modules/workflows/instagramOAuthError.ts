/**
 * Map Instagram OAuth popup / callback errors to sanitized operator-facing copy.
 * Never surface tokens, codes, state, App Secret, or DB driver details.
 */

export function sanitizeInstagramOAuthError(error: unknown): string {
  const raw = typeof error === "string" ? error : "";
  const clipped = raw.slice(0, 240).trim();
  if (!clipped) return "Instagram connect failed";

  if (
    /(access_token|refresh_token|appsecret_proof|client_secret|Bearer\s+[A-Za-z0-9._-]{12,}|authorization code)/i.test(
      clipped
    )
  ) {
    return "Instagram OAuth callback could not be completed.";
  }

  const lower = clipped.toLowerCase();
  if (
    /no instagram|not (been )?available|not shared|discovery|assigned_instagram|professional account was shared/i.test(
      lower
    )
  ) {
    return "Instagram authorization succeeded, but no Instagram account was available.";
  }
  if (/denied|access_denied|user_denied/i.test(lower)) {
    return "Instagram authorization was denied.";
  }
  if (/credential could not be saved|database|er_|sql|encrypt/i.test(lower)) {
    return "Instagram credential could not be saved.";
  }
  if (
    /not configured|configuration mismatch|redirect|login_config|app_not_configured/i.test(
      lower
    )
  ) {
    return "Instagram OAuth configuration mismatch.";
  }
  if (
    /oauth callback could not|authorization failed|exchange|invalid instagram oauth state|expired|already used|nonce/i.test(
      lower
    )
  ) {
    return "Instagram OAuth callback could not be completed.";
  }
  if (/^instagram /i.test(clipped)) {
    return clipped;
  }
  return "Instagram connect failed";
}
