/**
 * M10.3.14 Part A — Shared Google OAuth attempt polling + COOP-safe popup wiring.
 * Offline only. No live Google tokens.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let passed = 0;
const check = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
};

(async () => {
  console.log("\nM10.3.14 Shared Google OAuth repair");

  const oauth = () => require("../services/googleOAuth.service");

  await check("M10314-O1 Shared start returns attemptId for Sheets and Ads", async () => {
    const prevId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const prevSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    process.env.GOOGLE_OAUTH_CLIENT_ID = "opsai-test-google-client";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "opsai-test-google-secret";
    oauth().resetOauthAttemptStore();
    try {
      for (const product of [
        "google_sheets",
        "google_ads",
        "google_gsc",
        "google_ga4",
        "google_gmail",
      ]) {
        const started = await oauth().startGoogleOAuth(
          { workspaceId: "ws-oauth", product, name: product },
          { userId: "user-oauth", role: "Admin" }
        );
        assert.ok(started.attemptId);
        assert.match(started.url, /accounts\.google\.com/);
        const status = oauth().getGoogleOAuthAttemptStatus({
          attemptId: started.attemptId,
          workspaceId: "ws-oauth",
          userId: "user-oauth",
        });
        assert.equal(status.status, "pending");
        assert.equal(status.product, product);
      }
    } finally {
      process.env.GOOGLE_OAUTH_CLIENT_ID = prevId;
      process.env.GOOGLE_OAUTH_CLIENT_SECRET = prevSecret;
    }
  });

  await check("M10314-O2 Missing attempt is unknown, not a leak", () => {
    oauth().resetOauthAttemptStore();
    const unknown = oauth().getGoogleOAuthAttemptStatus({
      attemptId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      workspaceId: "ws-oauth",
      userId: "user-oauth",
    });
    assert.equal(unknown.status, "unknown");
  });

  await check("M10314-O3 Routes: callback public, status authenticated, probe reachable", () => {
    const routes = fs.readFileSync(
      path.join(__dirname, "../routes/index.js"),
      "utf8"
    );
    assert.match(routes, /router\.get\("\/api\/google-oauth\/callback"/);
    const wr = fs.readFileSync(
      path.join(__dirname, "../modules/workflows/workflows.routes.js"),
      "utf8"
    );
    assert.match(wr, /google-oauth\/status/);
    const ctrl = fs.readFileSync(
      path.join(__dirname, "../modules/workflows/workflows.controller.js"),
      "utf8"
    );
    assert.match(ctrl, /oauth_callback_received/);
    assert.match(ctrl, /callback is reachable/);
  });

  await check("M10314-O4 Popup polls attempt status and does not throw on COOP closed", () => {
    const popup = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/modules/workflows/googleOAuthPopup.ts"
      ),
      "utf8"
    );
    assert.match(popup, /getGoogleOAuthStatus/);
    assert.match(popup, /safePopupClosed/);
    assert.match(popup, /OAUTH_POPUP_TIMEOUT_MS/);
    const nextCfg = fs.readFileSync(
      path.join(__dirname, "../../frontend/next.config.ts"),
      "utf8"
    );
    assert.match(nextCfg, /same-origin-allow-popups/);
  });

  await check("M10314-O5 Refresh does not treat 5xx as revocation", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/googleOAuth.service.js"),
      "utf8"
    );
    assert.match(src, /google_token_refresh_started/);
    assert.match(src, /GOOGLE_OAUTH_INCOMPLETE/);
    assert.match(src, /invalid_client/);
    assert.match(src, /GOOGLE_OAUTH_CLIENT_REJECTED/);
  });

  await check("M10314-O6 Spreadsheet URL with /edit and gid parses", () => {
    const { parseSpreadsheetRef } = require("../services/resourceLocator");
    const parsed = parseSpreadsheetRef(
      "https://docs.google.com/spreadsheets/d/AbC-123_xyz/edit?gid=0#gid=0"
    );
    assert.equal(parsed.spreadsheetId, "AbC-123_xyz");
    assert.equal(parsed.fromUrl, true);
  });

  await check("M10314-O7 Isolation: product scopes unchanged", () => {
    const { GOOGLE_PRODUCTS } = oauth();
    assert.ok(GOOGLE_PRODUCTS.google_gsc.scopes.join(" ").includes("webmasters"));
    assert.ok(GOOGLE_PRODUCTS.google_ga4.scopes.join(" ").includes("analytics"));
    assert.ok(GOOGLE_PRODUCTS.google_gmail.scopes.join(" ").includes("gmail"));
    assert.deepEqual(GOOGLE_PRODUCTS.google_sheets.scopes, [
      "https://www.googleapis.com/auth/spreadsheets",
    ]);
    assert.ok(GOOGLE_PRODUCTS.google_ads.scopes.join(" ").includes("adwords"));
  });

  console.log(`\nM10.3.14 OAuth checks passed: ${passed}`);
  console.log(process.exitCode ? "M10.3.14 OAuth FAIL" : "M10.3.14 OAuth PASS (offline)");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
