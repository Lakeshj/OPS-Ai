/**
 * Canonical native Google provider authentication policies (backend mirror).
 * Keep in sync with frontend/src/modules/workflows/googleNativeAuthPolicy.ts
 *
 * Gmail = HYBRID_MANAGED_PRIMARY. GSC / GA4 / Sheets = HYBRID_CUSTOM_PRIMARY.
 */

const GOOGLE_NATIVE_AUTH_POLICY = Object.freeze({
  google_gmail: "HYBRID_MANAGED_PRIMARY",
  google_gsc: "HYBRID_CUSTOM_PRIMARY",
  google_ga4: "HYBRID_CUSTOM_PRIMARY",
  google_sheets: "HYBRID_CUSTOM_PRIMARY",
});

const getGoogleNativeAuthPolicy = (type) =>
  GOOGLE_NATIVE_AUTH_POLICY[String(type || "")] || null;

const isPlatformManagedOnlyGoogle = (type) =>
  getGoogleNativeAuthPolicy(type) === "PLATFORM_MANAGED_ONLY";

const isHybridManagedPrimaryGoogle = (type) =>
  getGoogleNativeAuthPolicy(type) === "HYBRID_MANAGED_PRIMARY";

const isHybridCustomPrimaryGoogle = (type) =>
  getGoogleNativeAuthPolicy(type) === "HYBRID_CUSTOM_PRIMARY";

const isHybridGoogleCredential = (type) => {
  const policy = getGoogleNativeAuthPolicy(type);
  return (
    policy === "HYBRID_MANAGED_PRIMARY" || policy === "HYBRID_CUSTOM_PRIMARY"
  );
};

const defaultAppModeForProduct = (type) =>
  isPlatformManagedOnlyGoogle(type) || isHybridManagedPrimaryGoogle(type)
    ? "PLATFORM_MANAGED"
    : "CUSTOM_APP";

/**
 * Platform-managed unavailable warning is only relevant when the active path
 * actually uses PLATFORM_MANAGED. CUSTOM_APP connections ignore GOOGLE_OAUTH_*.
 */
const shouldShowPlatformManagedUnavailableWarning = ({
  product,
  platformManagedAvailable,
  selectedAppMode,
}) => {
  if (platformManagedAvailable) return false;
  const policy = getGoogleNativeAuthPolicy(product);
  if (policy === "PLATFORM_MANAGED_ONLY") return true;
  if (
    policy === "HYBRID_CUSTOM_PRIMARY" ||
    policy === "HYBRID_MANAGED_PRIMARY"
  ) {
    return selectedAppMode === "PLATFORM_MANAGED";
  }
  return false;
};

module.exports = {
  GOOGLE_NATIVE_AUTH_POLICY,
  getGoogleNativeAuthPolicy,
  isPlatformManagedOnlyGoogle,
  isHybridManagedPrimaryGoogle,
  isHybridCustomPrimaryGoogle,
  isHybridGoogleCredential,
  defaultAppModeForProduct,
  shouldShowPlatformManagedUnavailableWarning,
};
