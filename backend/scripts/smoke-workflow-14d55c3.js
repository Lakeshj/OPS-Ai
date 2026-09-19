/**
 * Part 14D.5.5C.3+ — Google provider auth policy isolation.
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
  const sharing = () =>
    readFe("components/workflows/params/CredentialSharingPanel.tsx");
  const docs = () =>
    fs.readFileSync(
      path.join(__dirname, "../../docs/WORKFLOW_GOOGLE_NODES.md"),
      "utf8"
    );

  check("GOOGLEPOLICY-1 Gmail policy = HYBRID_MANAGED_PRIMARY", () => {
    assertX.equal(
      policy().getGoogleNativeAuthPolicy("google_gmail"),
      "HYBRID_MANAGED_PRIMARY"
    );
    assertX.equal(
      policy().defaultAppModeForProduct("google_gmail"),
      "PLATFORM_MANAGED"
    );
    assertX.ok(fePolicy().includes('google_gmail: "HYBRID_MANAGED_PRIMARY"'));
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
  });

  check("GOOGLEPOLICY-4 Sheets policy = HYBRID_CUSTOM_PRIMARY", () => {
    assertX.equal(
      policy().getGoogleNativeAuthPolicy("google_sheets"),
      "HYBRID_CUSTOM_PRIMARY"
    );
  });

  check("GOOGLEPOLICY-5 Gmail CUSTOM_APP ignores platformManagedAvailable=false", () => {
    assertX.equal(
      policy().shouldShowPlatformManagedUnavailableWarning({
        product: "google_gmail",
        platformManagedAvailable: false,
        selectedAppMode: "CUSTOM_APP",
      }),
      false
    );
    assertX.equal(
      policy().shouldShowPlatformManagedUnavailableWarning({
        product: "google_gmail",
        platformManagedAvailable: false,
        selectedAppMode: "PLATFORM_MANAGED",
      }),
      true
    );
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
    assertX.ok(picker().includes("hybridGoogle ? ("));
    assertX.ok(
      !/hybridGoogle \? \([\s\S]*?Google sign-in is not available/.test(
        picker()
      )
    );
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

  check("GOOGLEPOLICY-12 Gmail Manage exposes Managed / Custom / Service Account", () => {
    assertX.ok(modal().includes("Managed OAuth2 (recommended)"));
    assertX.ok(modal().includes("Custom OAuth2"));
    assertX.ok(modal().includes("Service Account"));
    assertX.ok(modal().includes('value="service_account"'));
    assertX.ok(picker().includes("managedOnly={gmailManagedOnly}"));
  });

  check("GOOGLEPOLICY-13 GSC still exposes provider credential modal for CUSTOM_APP setup", () => {
    const e = registry().getSupportedPredefined("google_gsc");
    assertX.equal(e.oauth.nativeAuthPolicy, "HYBRID_CUSTOM_PRIMARY");
    assertX.equal(e.oauth.appModeDefault, "CUSTOM_APP");
    assertX.ok(modal().includes("Setup credential"));
    assertX.ok(modal().includes("Custom OAuth2"));
    assertX.ok(modal().includes("onPointerDownOutside"));
    assertX.ok(modal().includes('className="z-[200]"'));
  });

  check("GOOGLEPOLICY-14 GA4 still exposes provider credential modal", () => {
    const e = registry().getSupportedPredefined("google_ga4");
    assertX.equal(e.oauth.nativeAuthPolicy, "HYBRID_CUSTOM_PRIMARY");
  });

  check("GOOGLEPOLICY-15 Sheets still exposes provider credential modal", () => {
    const e = registry().getSupportedPredefined("google_sheets");
    assertX.equal(e.oauth.nativeAuthPolicy, "HYBRID_CUSTOM_PRIMARY");
  });

  check("GOOGLEPOLICY-16 HTTP Predefined respects provider-specific policy", () => {
    const gmail = registry().publicEntry(
      registry().getSupportedPredefined("google_gmail")
    );
    const gsc = registry().publicEntry(
      registry().getSupportedPredefined("google_gsc")
    );
    assertX.equal(gmail.oauthMode, "predefined_platform_managed");
    assertX.equal(gmail.nativeAuthPolicy, "HYBRID_MANAGED_PRIMARY");
    assertX.equal(gsc.oauthMode, "predefined_custom_app");
    assertX.equal(gsc.nativeAuthPolicy, "HYBRID_CUSTOM_PRIMARY");
  });

  check("GOOGLEPOLICY-17 HTTP Generic OAuth2 unaffected", () => {
    assertX.ok(http().includes("OAuth2ConnectionModal"));
    assertX.ok(!picker().includes("OAuth2ConnectionModal"));
  });

  check("GOOGLEPOLICY-18 Gmail Sharing panel remains available and selectable", () => {
    assertX.ok(modal().includes("CredentialSharingPanel"));
    assertX.ok(sharing().includes("All users and projects"));
    assertX.ok(sharing().includes("Sharing a credential allows people"));
    assertX.ok(sharing().includes('className="z-[200]"'));
  });

  check("GOOGLEPOLICY-docs provider change discipline present", () => {
    assertX.ok(docs().includes("GOOGLEPOLICY"));
    assertX.ok(docs().includes("HYBRID_MANAGED_PRIMARY"));
    assertX.ok(docs().includes("HYBRID_CUSTOM_PRIMARY"));
  });
};

module.exports = { registerPart14D55C3Tests };
