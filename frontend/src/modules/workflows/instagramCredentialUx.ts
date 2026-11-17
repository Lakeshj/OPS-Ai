/**
 * Instagram credential UX helpers — OAuth connect vs credential selection.
 * Visual/config only; does not change Graph runtime or MCP contracts.
 */

export type InstagramConnectIntent =
  | "connect_new"
  | "connect_other"
  | "reconnect"
  | "select_existing";

/** Dropdown is selection-only once at least one credential exists. */
export function shouldShowInstagramCredentialDropdown(
  credentialCount: number
): boolean {
  return credentialCount > 0;
}

/** First-time empty state: Connect Instagram, no dropdown gate. */
export function isInstagramFirstConnectState(credentialCount: number): boolean {
  return credentialCount === 0;
}

/**
 * Connect / Connect other always start a new OAuth credential.
 * Reconnect alone may pass an existing credentialId.
 */
export function instagramOAuthStartCredentialId(args: {
  intent: InstagramConnectIntent;
  existingCredentialId?: string | null;
}): string | undefined {
  if (args.intent === "reconnect") {
    const id = String(args.existingCredentialId || "").trim();
    return id || undefined;
  }
  // connect_new / connect_other / select_existing never send credentialId for OAuth create
  return undefined;
}

export function formatInstagramPlatformConfigError(
  missingConfigKeys?: string[] | null
): string {
  const keys = (missingConfigKeys || [])
    .map((k) => String(k || "").trim())
    .filter(Boolean);
  const base = "Instagram OAuth is not configured on this server.";
  if (keys.length === 0) return base;
  return `${base} Missing: ${keys.join(", ")}`;
}

export function isInstagramPlatformConfigError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = String((err as { code?: string }).code || "");
  if (code === "INSTAGRAM_APP_NOT_CONFIGURED") return true;
  const message = String((err as { message?: string }).message || "");
  return (
    /INSTAGRAM_APP_NOT_CONFIGURED/i.test(message) ||
    /not configured on this OpsAi server/i.test(message) ||
    /OAuth is not configured on this server/i.test(message) ||
    /app credentials are not configured/i.test(message)
  );
}
