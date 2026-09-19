/**
 * Canonical native Google provider authentication policies.
 *
 * Gmail is HYBRID_MANAGED_PRIMARY — Manage offers Managed (recommended) + Custom.
 * GSC / GA4 / Sheets are HYBRID_CUSTOM_PRIMARY — custom OAuth app is primary.
 * Never decide native connection UX from generic "isGoogle" alone.
 */

export type GoogleCredentialProduct =
  | "google_gmail"
  | "google_gsc"
  | "google_ga4"
  | "google_sheets";

export type GoogleNativeAuthPolicy =
  | "PLATFORM_MANAGED_ONLY"
  | "HYBRID_MANAGED_PRIMARY"
  | "HYBRID_CUSTOM_PRIMARY";

export const GOOGLE_NATIVE_AUTH_POLICY: Record<
  GoogleCredentialProduct,
  GoogleNativeAuthPolicy
> = {
  google_gmail: "HYBRID_MANAGED_PRIMARY",
  google_gsc: "HYBRID_CUSTOM_PRIMARY",
  google_ga4: "HYBRID_CUSTOM_PRIMARY",
  google_sheets: "HYBRID_CUSTOM_PRIMARY",
};

export function isGoogleCredentialProduct(
  type: string | null | undefined
): type is GoogleCredentialProduct {
  return (
    type === "google_gmail" ||
    type === "google_gsc" ||
    type === "google_ga4" ||
    type === "google_sheets"
  );
}

export function getGoogleNativeAuthPolicy(
  type: string | null | undefined
): GoogleNativeAuthPolicy | null {
  if (!isGoogleCredentialProduct(type)) return null;
  return GOOGLE_NATIVE_AUTH_POLICY[type];
}

export function isPlatformManagedOnlyGoogle(
  type: string | null | undefined
): boolean {
  return getGoogleNativeAuthPolicy(type) === "PLATFORM_MANAGED_ONLY";
}

export function isHybridManagedPrimaryGoogle(
  type: string | null | undefined
): boolean {
  return getGoogleNativeAuthPolicy(type) === "HYBRID_MANAGED_PRIMARY";
}

export function isHybridCustomPrimaryGoogle(
  type: string | null | undefined
): boolean {
  return getGoogleNativeAuthPolicy(type) === "HYBRID_CUSTOM_PRIMARY";
}

/** Any hybrid Google provider that can use Managed or Custom in the credential modal. */
export function isHybridGoogleCredential(
  type: string | null | undefined
): boolean {
  const policy = getGoogleNativeAuthPolicy(type);
  return (
    policy === "HYBRID_MANAGED_PRIMARY" || policy === "HYBRID_CUSTOM_PRIMARY"
  );
}

/** Default setup mode when opening the credential modal for a provider. */
export function defaultGoogleSetupMode(
  type: string | null | undefined
): "managed" | "custom" {
  if (isPlatformManagedOnlyGoogle(type) || isHybridManagedPrimaryGoogle(type)) {
    return "managed";
  }
  return "custom";
}

/**
 * Platform-managed unavailable warning is only relevant when the active path
 * actually uses PLATFORM_MANAGED. CUSTOM_APP connections ignore GOOGLE_OAUTH_*.
 */
export function shouldShowPlatformManagedUnavailableWarning(args: {
  product?: string | null;
  platformManagedAvailable: boolean;
  selectedAppMode?: string | null;
}): boolean {
  if (args.platformManagedAvailable) return false;
  const policy = getGoogleNativeAuthPolicy(args.product);
  if (policy === "PLATFORM_MANAGED_ONLY") return true;
  if (
    policy === "HYBRID_CUSTOM_PRIMARY" ||
    policy === "HYBRID_MANAGED_PRIMARY"
  ) {
    return args.selectedAppMode === "PLATFORM_MANAGED";
  }
  return false;
}
