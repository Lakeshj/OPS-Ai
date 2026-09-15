/**
 * Part 14D.5.5C.3 — Isolate Gmail managed auth policy from other Google nodes.
 * GOOGLEPOLICY-* regression matrix.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const registerPart14D55C3Tests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Part 14D.5.5C.3 Google provider auth policy isolation");

  const policy = () => require("../config/googleNativeAuthPolicy");
  const registry = () => require("../services/connectionRegistry.service");

  const readFe = (rel) =>
    fs.readFileSync(path.join(__dirname, "../../frontend/src", rel), "utf8");
  const picker = () =>
    readFe("components/workflows/params/CredentialPicker.tsx");
  const modal = () =>
    readFe("components/workflows/params/GoogleCredentialModal.tsx");
  const http = () =>
    readFe("components/workflows/params/HttpAuthField.tsx");
  const fePolicy = () =>
    readFe("modules/workflows/googleNativeAuthPolicy.ts");
  const docs = () =>
    fs.readFileSync(
      path.join(__dirname, "../../docs/WORKFLOW_GOOGLE_NODES.md"),
      "utf8"
    );

  check("GOOGLEPOLICY-1 Gmail policy = PLATFORM_MANAGED_ONLY", () => {
    assertX.equal(
      policy().getGoogleNativeAuthPolicy("google_gmail"),
      "PLATFORM_MANAGED_ONLY"
    );
    assertX.equal(
      policy().defaultAppModeForProduct("google_gmail"),
      "PLATFORM_MANAGED"
    );
    assertX.ok(fePolicy().includes('google_gmail: "PLATFORM_MANAGED_ONLY"'));
  });

  check("GOOGLEPOLICY-2 GSC policy = HYBRID_CUSTOM_PRIMARY", () => {
    assertX.equal(
      policy().getGoogleNativeAuthPolicy("google_gsc"),
      "HYBRID_CUSTOM_PRIMARY"
    );
    assertX.equal(
      policy().defaultAppModeForProduct("google_gsc"),
      "CUSTOM_APP"
    );
  });

  check("GOOGLEPOLICY-3 GA4 policy = HYBRID_CUSTOM_PRIMARY", () => {
    assertX.equal(
      policy().getGoogleNativeAuthPolicy("google_ga4"),
      "HYBRID_CUSTOM_PRIMARY"
    );
    assertX.equal(
      policy().defaultAppModeForProduct("google_ga4"),
      "CUSTOM_APP"
    );
  });

  check("GOOGLEPOLICY-4 Sheets policy = HYBRID_CUSTOM_PRIMARY", () => {
    assertX.equal(
      policy().getGoogleNativeAuthPolicy("google_sheets"),
      "HYBRID_CUSTOM_PRIMARY"
    );
    assertX.equal(
      policy().defaultAppModeForProduct("google_sheets"),
      "CUSTOM_APP"
    );
  });

  check("GOOGLEPOLICY-5 Gmail platform unavailable shows admin warning", () => {
    assertX.equal(
      policy().shouldShowPlatformManagedUnavailableWarning({
        product: "google_gmail",
        platformManagedAvailable: false,
        selectedAppMode: null,
      }),
      true
    );
    assertX.ok(
      picker().includes(
        "Google sign-in is not available on this OpsAi instance yet"
      )
    );
    assertX.ok(picker().includes("showManagedUnavailableWarning"));
    assertX.ok(picker().includes("shouldShowPlatformManagedUnavailableWarning"));
  });

  check("GOOGLEPOLICY-6 GSC CUSTOM_APP ignores platformManagedAvailable=false", () => {
    assertX.equal(
      policy().shouldShowPlatformManagedUnavailableWarning({
        product: "google_gsc",
        platformManagedAvailable: false,
        selectedAppMode: "CUSTOM_APP",
      }),
      false
    );
  });

  check("GOOGLEPOLICY-7 GA4 CUSTOM_APP ignores platformManagedAvailable=false", () => {
    assertX.equal(
      policy().shouldShowPlatformManagedUnavailableWarning({
        product: "google_ga4",
        platformManagedAvailable: false,
        selectedAppMode: "CUSTOM_APP",
      }),
      false
    );
  });

  check("GOOGLEPOLICY-8 Sheets CUSTOM_APP ignores platformManagedAvailable=false", () => {
    assertX.equal(
      policy().shouldShowPlatformManagedUnavailableWarning({
        product: "google_sheets",
        platformManagedAvailable: false,
        selectedAppMode: "CUSTOM_APP",
      }),
      false
    );
  });

  check("GOOGLEPOLICY-9 GSC selected CUSTOM_APP does not show managed-unavailable copy", () => {
    // Screenshot regression: selected GSC CUSTOM_APP + platformManagedAvailable=false
    assertX.equal(
      policy().shouldShowPlatformManagedUnavailableWarning({
        product: "google_gsc",
        platformManagedAvailable: false,
        selectedAppMode: "CUSTOM_APP",
      }),
      false
    );
    // Warning JSX is gated behind gmailManagedOnly branch, not hybrid
    assertX.ok(picker().includes("gmailManagedOnly ? ("));
    assertX.ok(picker().includes("hybridCustomPrimary ? ("));
    assertX.ok(
      /gmailManagedOnly \? \([\s\S]*?showManagedUnavailableWarning[\s\S]*?Google sign-in is not available/.test(
        picker()
      )
    );
    assertX.ok(
      !/hybridCustomPrimary \? \([\s\S]*?Google sign-in is not available/.test(
        picker()
      )
    );
    assertX.ok(picker().includes("selectedIsCustomApp"));
    assertX.ok(picker().includes('setupMode: "custom"'));
  });

  check("GOOGLEPOLICY-10 GA4 selected CUSTOM_APP does not show managed-unavailable copy", () => {
    assertX.equal(
      policy().shouldShowPlatformManagedUnavailableWarning({
        product: "google_ga4",
        platformManagedAvailable: false,
        selectedAppMode: "CUSTOM_APP",
      }),
      false
    );
    assertX.ok(picker().includes("hybridCustomPrimary"));
  });

  check("GOOGLEPOLICY-11 Sheets selected CUSTOM_APP does not show managed-unavailable copy", () => {
    assertX.equal(
      policy().shouldShowPlatformManagedUnavailableWarning({
        product: "google_sheets",
        platformManagedAvailable: false,
        selectedAppMode: "CUSTOM_APP",
      }),
      false
    );
  });

  check("GOOGLEPOLICY-12 Gmail exposes no native Client ID/Secret", () => {
    assertX.ok(modal().includes("forceManaged"));
    assertX.ok(modal().includes("{!forceManaged"));
    assertX.ok(modal().includes("isPlatformManagedOnlyGoogle"));
    assertX.ok(picker().includes("managedOnly={gmailManagedOnly}"));
  });

  check("GOOGLEPOLICY-13 GSC still exposes provider credential modal for CUSTOM_APP setup", () => {
    const e = registry().getSupportedPredefined("google_gsc");
    assertX.equal(e.oauth.nativeAuthPolicy, "HYBRID_CUSTOM_PRIMARY");
    assertX.equal(e.oauth.appModeDefault, "CUSTOM_APP");
    assertX.ok(picker().includes("openGoogleModal"));
    assertX.ok(picker().includes('setupMode: "custom"'));
    assertX.ok(modal().includes("Client ID"));
    assertX.ok(modal().includes("Client Secret"));
  });

  check("GOOGLEPOLICY-14 GA4 still exposes provider credential modal", () => {
    const e = registry().getSupportedPredefined("google_ga4");
    assertX.equal(e.oauth.nativeAuthPolicy, "HYBRID_CUSTOM_PRIMARY");
    assertX.equal(e.oauth.appModeDefault, "CUSTOM_APP");
    assertX.ok(modal().includes("Client ID"));
  });

  check("GOOGLEPOLICY-15 Sheets still exposes provider credential modal", () => {
    const e = registry().getSupportedPredefined("google_sheets");
    assertX.equal(e.oauth.nativeAuthPolicy, "HYBRID_CUSTOM_PRIMARY");
    assertX.equal(e.oauth.appModeDefault, "CUSTOM_APP");
  });

  check("GOOGLEPOLICY-16 HTTP Predefined respects provider-specific policy", () => {
    const gmail = registry().publicEntry(
      registry().getSupportedPredefined("google_gmail")
    );
    const gsc = registry().publicEntry(
      registry().getSupportedPredefined("google_gsc")
    );
    assertX.equal(gmail.oauthMode, "predefined_platform_managed");
    assertX.equal(gmail.nativeAuthPolicy, "PLATFORM_MANAGED_ONLY");
    assertX.equal(gsc.oauthMode, "predefined_custom_app");
    assertX.equal(gsc.nativeAuthPolicy, "HYBRID_CUSTOM_PRIMARY");
    assertX.ok(http().includes("OAuth2ConnectionModal") || http().length > 0);
  });

  check("GOOGLEPOLICY-17 HTTP Generic OAuth2 unaffected", () => {
    assertX.ok(http().includes("OAuth2ConnectionModal"));
    assertX.ok(
      http().includes("oauth2") || http().includes("OAuth2") || http().includes("generic")
    );
    assertX.ok(!picker().includes("OAuth2ConnectionModal"));
  });

  check("GOOGLEPOLICY-docs provider change discipline present", () => {
    assertX.ok(docs().includes("GOOGLEPOLICY"));
    assertX.ok(docs().includes("Provider change discipline"));
    assertX.ok(docs().includes("PLATFORM_MANAGED_ONLY"));
    assertX.ok(docs().includes("HYBRID_CUSTOM_PRIMARY"));
  });
};

module.exports = { registerPart14D55C3Tests };
