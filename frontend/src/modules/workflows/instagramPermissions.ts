/**
 * Instagram permission UX helpers (M8.12).
 * Connection success ≠ Insights access.
 */

export const SCOPE_INSIGHTS = "instagram_manage_insights";

export function credentialHasInsightsPermission(credential: {
  grantedPermissions?: string[] | null;
  missingPermissions?: string[] | null;
} | null | undefined): boolean | "unknown" {
  if (!credential) return "unknown";
  const granted = Array.isArray(credential.grantedPermissions)
    ? credential.grantedPermissions.map(String)
    : null;
  const missing = Array.isArray(credential.missingPermissions)
    ? credential.missingPermissions.map(String)
    : null;
  if (granted && granted.length) {
    return granted.includes(SCOPE_INSIGHTS);
  }
  if (missing && missing.includes(SCOPE_INSIGHTS)) {
    return false;
  }
  return "unknown";
}

export function insightsPermissionBlockedMessage(): string {
  return "Insights access is not enabled for this Instagram connection. Reconnect Instagram and grant Insights access.";
}
