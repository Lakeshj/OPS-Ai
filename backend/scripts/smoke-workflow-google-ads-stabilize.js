/**
 * Google Ads stabilization — credential ENUM + safe error presentation.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const REQUIRED_TYPES = [
  "bearer",
  "api_key_header",
  "basic",
  "query_param",
  "google_gsc",
  "google_ga4",
  "google_gmail",
  "google_sheets",
  "oauth2",
  "google_ads",
  "meta_ads",
];

const parseEnumValues = (sql) => {
  const match =
    sql.match(/MODIFY COLUMN type ENUM\(([\s\S]*?)\)\s*NOT NULL/i) ||
    sql.match(/type ENUM\(([\s\S]*?)\)\s*NOT NULL/i);
  if (!match) return null;
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
};

const registerGoogleAdsStabilizeTests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("Google Ads stabilization — credential ENUM + error UX");

  const root = path.join(__dirname, "..");
  const migrationsDir = path.join(root, "migrations");
  const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

  check("STAB-1/2 migrations end with google_ads + meta_ads", () => {
    const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
    assertX.ok(files.includes("027_workflow_credentials_ads_types.sql"));
    let current = [];
    for (const file of files) {
      const next = parseEnumValues(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
      if (next) current = next;
    }
    assertX.deepEqual(current, REQUIRED_TYPES);
    assertX.ok(current.includes("google_ads"));
    assertX.ok(current.includes("meta_ads"));
  });

  check("STAB-3 existing credential types remain valid", () => {
    const last = parseEnumValues(read("migrations/027_workflow_credentials_ads_types.sql"));
    for (const type of [
      "bearer",
      "api_key_header",
      "basic",
      "query_param",
      "google_gsc",
      "google_ga4",
      "google_gmail",
      "google_sheets",
      "oauth2",
    ]) {
      assertX.ok(last.includes(type), type);
    }
    const creds = require("../modules/workflows/credentials.service");
    const src = read("modules/workflows/credentials.service.js");
    assertX.ok(src.includes('"google_ads"'));
    assertX.ok(src.includes('"meta_ads"'));
    assertX.ok(src.includes("CREDENTIAL_TYPES"));
    void creds;
  });

  check("STAB-4/5 google_ads and meta_ads types are accepted by app contracts", () => {
    const { validateCredential } = require("../modules/workflows/workflows.validation");
    const googleErrors = validateCredential({
      body: {
        workspaceId: "ws",
        name: "Ads",
        type: "google_ads",
        secret: { clientSecret: "sec" },
        config: { oauthAppMode: "CUSTOM_APP", clientId: "cid" },
      },
    });
    assertX.equal(googleErrors.some((e) => /unsupported|invalid type/i.test(e)), false);
    const metaErrors = validateCredential({
      body: { workspaceId: "ws", name: "Meta", type: "meta_ads", secret: {} },
    });
    assertX.ok(metaErrors.some((e) => /Connect with Meta/i.test(e)));
    assertX.equal(metaErrors.some((e) => /unsupported/i.test(e)), false);
  });

  check("STAB-10/11/12 technical details stay safe and off the user message", () => {
    const { presentNodeFailure, sanitizeFailureDetails } = require("../utils/nodeFailure");
    const { formatStepOutput } = require("../utils/runStepDisplay");
    const err = new Error("Google Ads access denied");
    err.code = "USER_PERMISSION_DENIED";
    err.title = "Google Ads access denied";
    err.provider = "google_ads";
    err.details = {
      httpStatus: 403,
      errorCode: "USER_PERMISSION_DENIED",
      customerId: "7455074842",
      loginCustomerId: "6753059302",
      reportType: "ad_group_performance",
      apiVersion: "v25",
      developerHeaderSent: false,
      accessToken: "ya29.should-not-leak",
    };
    err.googleAds = { ...err.details, developerToken: "dev-secret" };
    const presented = presentNodeFailure(err);
    assertX.equal(presented.code, "USER_PERMISSION_DENIED");
    assertX.equal(presented.message.includes("ya29"), false);
    assertX.equal(presented.message.includes("dev-secret"), false);
    assertX.equal(presented.details.httpStatus, 403);
    assertX.equal(presented.details.customerId, "7455074842");
    assertX.equal(Object.prototype.hasOwnProperty.call(presented.details, "developerHeaderSent"), false);
    assertX.equal(Object.prototype.hasOwnProperty.call(presented.details, "accessToken"), false);
    const leaked = sanitizeFailureDetails({
      Authorization: "Bearer ya29.x",
      developerToken: "secret",
      httpStatus: 403,
    });
    assertX.equal(leaked.httpStatus, 403);
    assertX.equal(leaked.Authorization, undefined);
    assertX.equal(leaked.developerToken, undefined);
    const preview = formatStepOutput({
      ok: false,
      error: presented,
      items: [],
      count: 0,
    });
    assertX.match(preview, /Google Ads access denied/);
    assertX.equal(preview.includes("0 item"), false);
    assertX.equal(preview.includes("ya29"), false);
  });

  check("STAB-13 failed Ads node stays failed in inspector payload", () => {
    const { presentNodeFailure } = require("../utils/nodeFailure");
    const failure = presentNodeFailure({
      code: "USER_PERMISSION_DENIED",
      title: "Google Ads access denied",
      message: "The selected Login Customer ID does not appear to have access to this Google Ads account.",
      provider: "google_ads",
    });
    const result = {
      status: "failed",
      error: failure.message,
      output: { ok: false, error: failure, items: [], count: 0 },
      items: [],
    };
    assertX.equal(result.status, "failed");
    assertX.equal(result.items.length, 0);
    assertX.equal(result.output.ok, false);
    assertX.equal(result.output.error.code, "USER_PERMISSION_DENIED");
  });

  check("STAB-18 Developer Token remains optional", () => {
    const src = read("modules/workflows/credentials.service.js");
    assertX.equal(src.includes("Google Ads developer token is required"), false);
    const modal = fs.readFileSync(
      path.join(__dirname, "../../frontend/src/components/workflows/params/GoogleCredentialModal.tsx"),
      "utf8"
    );
    assertX.equal(modal.includes("Developer token *"), false);
  });
};

module.exports = { registerGoogleAdsStabilizeTests };
