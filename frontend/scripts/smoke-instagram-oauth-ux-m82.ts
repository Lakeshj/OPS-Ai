/**
 * Instagram M8.2 — OAuth / credential UX stabilization.
 * Run: npx --yes tsx scripts/smoke-instagram-oauth-ux-m82.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatInstagramPlatformConfigError,
  instagramOAuthStartCredentialId,
  isInstagramFirstConnectState,
  isInstagramPlatformConfigError,
  shouldShowInstagramCredentialDropdown,
} from "../src/modules/workflows/instagramCredentialUx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.join(__dirname, "..");
const read = (rel: string) =>
  fs.readFileSync(path.join(frontendRoot, rel), "utf8");

let passed = 0;
const check = (name: string, fn: () => void) => {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
};

console.log("\nInstagram M8.2 OAuth / credential UX");

const picker = read("src/components/workflows/params/CredentialPicker.tsx");
const panel = read(
  "src/components/workflows/params/InstagramCredentialPanel.tsx"
);
const popup = read("src/modules/workflows/instagramOAuthPopup.ts");

check("IG-OAUTH-UX-1 0 credentials: Connect Instagram exists", () => {
  assert.equal(isInstagramFirstConnectState(0), true);
  assert.equal(shouldShowInstagramCredentialDropdown(0), false);
  assert.match(panel, /Connect Instagram/);
  assert.match(picker, /instagramFirstConnect/);
  assert.match(picker, /forceNew=\{instagramFirstConnect \|\| !selected\}/);
});

check("IG-OAUTH-UX-2 0 credentials: Connect invokes OAuth start without credentialId", () => {
  assert.equal(
    instagramOAuthStartCredentialId({ intent: "connect_new" }),
    undefined
  );
  assert.match(panel, /startInstagramOAuthPopup/);
  assert.match(panel, /instagramOAuthStartCredentialId/);
  assert.match(popup, /workflowCredentialsApi\.startInstagramOAuth/);
  // Must not gate Connect on existing credentialId
  assert.equal(/if\s*\(\s*!credentialId\s*\)\s*return/.test(panel), false);
  assert.equal(
    /if\s*\(\s*!credential\?\.id\s*\)\s*return/.test(panel),
    false
  );
});

check("IG-OAUTH-UX-3 0 credentials: dropdown is not the connection mechanism", () => {
  assert.equal(shouldShowInstagramCredentialDropdown(0), false);
  assert.match(picker, /data-instagram-credential-dropdown="hidden"/);
  assert.match(
    picker,
    /No Instagram account connected yet\. Use Connect Instagram/
  );
});

check("IG-OAUTH-UX-4 existing credential: dropdown selects without starting OAuth", () => {
  assert.equal(shouldShowInstagramCredentialDropdown(1), true);
  assert.equal(shouldShowInstagramCredentialDropdown(2), true);
  assert.match(picker, /selection-only/);
  assert.match(picker, /Selection-only: never starts OAuth/);
  // Dropdown onChange only calls onChange — not startInstagramOAuthPopup
  const selectBlock = picker.slice(
    picker.indexOf("data-instagram-credential-dropdown="),
    picker.indexOf("googleOnly && googleProduct && showGoogleNativeConnect")
  );
  assert.match(selectBlock, /onChange\(v === "none" \? "" : v\)/);
  assert.equal(/startInstagramOAuthPopup/.test(selectBlock), false);
});

check("IG-OAUTH-UX-5 Connect other account starts OAuth directly", () => {
  assert.equal(
    instagramOAuthStartCredentialId({ intent: "connect_other" }),
    undefined
  );
  assert.match(picker, /connectOtherInstagramAccount/);
  assert.match(picker, /data-instagram-connect-other="true"/);
  const otherFn = picker.slice(
    picker.indexOf("const connectOtherInstagramAccount"),
    picker.indexOf("return (")
  );
  assert.match(otherFn, /startInstagramOAuthPopup/);
  assert.equal(/credentialId:/.test(otherFn), false);
});

check("IG-OAUTH-UX-6 Connect other does not open/select dropdown first", () => {
  const otherFn = picker.slice(
    picker.indexOf("const connectOtherInstagramAccount"),
    picker.indexOf("return (")
  );
  assert.match(otherFn, /startInstagramOAuthPopup/);
  assert.equal(/setAdding\(true\)/.test(otherFn), false);
  assert.equal(/SelectItem/.test(otherFn), false);
  const otherBtn = picker.slice(
    picker.indexOf("data-instagram-connect-other"),
    picker.indexOf("data-instagram-connect-other") + 450
  );
  assert.match(otherBtn, /connectOtherInstagramAccount/);
  assert.equal(/setAdding\(true\)/.test(otherBtn), false);
  assert.equal(/openCredentialPicker/.test(picker), false);
});

check("IG-OAUTH-UX-7 OAuth callback success refreshes and selects new credential", () => {
  assert.match(panel, /onConnected\(result\.credentialId\)/);
  assert.match(picker, /onConnected=\{\(id\) => \{\s*reload\(\);\s*onChange\(id\);/);
  const otherFn = picker.slice(
    picker.indexOf("const connectOtherInstagramAccount"),
    picker.indexOf("return (")
  );
  assert.match(otherFn, /reload\(\)/);
  assert.match(otherFn, /onChange\(result\.credentialId\)/);
});

check("IG-OAUTH-UX-8 missing Instagram app config: visible sanitized error", () => {
  const msg = formatInstagramPlatformConfigError([
    "INSTAGRAM_APP_ID",
    "INSTAGRAM_APP_SECRET",
  ]);
  assert.match(msg, /Instagram OAuth is not configured on this server/);
  assert.match(msg, /INSTAGRAM_APP_ID/);
  assert.match(msg, /INSTAGRAM_APP_SECRET/);
  assert.equal(/secret-value/i.test(msg), false);
  assert.ok(
    isInstagramPlatformConfigError({
      code: "INSTAGRAM_APP_NOT_CONFIGURED",
      message: "Instagram integration is not configured on this OpsAi server.",
    })
  );
  assert.match(panel, /data-instagram-oauth-config-error="true"/);
  assert.match(panel, /Missing: \$\{missingConfigKeys\.join/);
  // Button must remain clickable when platform blocked (no silent disabled no-op)
  assert.equal(/disabled=\{connecting \|\| !workspaceId \|\| platformBlocked\}/.test(panel), false);
  assert.match(panel, /disabled=\{connecting \|\| !workspaceId\}/);
  assert.equal(/App Secret/.test(panel), false);
  assert.equal(/access_token/i.test(panel), false);
});

check("IG-OAUTH-UX-9 OAuth cancel/error preserves existing selected credential", () => {
  const otherFn = picker.slice(
    picker.indexOf("const connectOtherInstagramAccount"),
    picker.indexOf("return (")
  );
  assert.match(otherFn, /previousId/);
  assert.match(otherFn, /Preserve the previously selected credential/);
  assert.match(otherFn, /if \(previousId && value !== previousId\) onChange\(previousId\)/);
});

check("IG-OAUTH-UX-10 Reconnect remains distinct from Connect other account", () => {
  assert.match(panel, /Reconnect Instagram/);
  assert.match(panel, /data-instagram-connect-intent/);
  assert.match(panel, /showReconnect/);
  assert.equal(
    instagramOAuthStartCredentialId({
      intent: "reconnect",
      existingCredentialId: "cred-a",
    }),
    "cred-a"
  );
  assert.equal(
    instagramOAuthStartCredentialId({
      intent: "connect_other",
      existingCredentialId: "cred-a",
    }),
    undefined
  );
  // Connect other never passes credentialId
  const otherFn = picker.slice(
    picker.indexOf("const connectOtherInstagramAccount"),
    picker.indexOf("return (")
  );
  assert.match(otherFn, /Never pass credentialId/);
});

check("IG-OAUTH-UX-11 multi-account second OAuth is additive", () => {
  // Connect other omits credentialId → server creates new row (proven in M7.1)
  assert.equal(
    instagramOAuthStartCredentialId({ intent: "connect_other" }),
    undefined
  );
  assert.match(picker, /additive new credential only/);
  const m71 = fs.readFileSync(
    path.join(frontendRoot, "../backend/scripts/smoke-workflow-instagram-m71.js"),
    "utf8"
  );
  assert.match(m71, /new OAuth connection does not overwrite existing credential/);
});

check("IG-OAUTH-UX-12 switching credentials updates config without OAuth", () => {
  assert.match(picker, /Selection-only: never starts OAuth/);
  assert.match(
    picker,
    /Select an already-connected Instagram account/
  );
  // Node schema still binds credentialId only — no WorkflowItem rewrite on select
  const schemas = read("src/modules/workflows/nodeParameterSchemas.ts");
  const igBlock = schemas.slice(
    schemas.indexOf('instagram: ['),
    schemas.indexOf('instagram: [') + 400
  );
  assert.match(igBlock, /credentialId/);
  assert.match(igBlock, /credentialTypes: \["instagram"\]/);
});

console.log(`\n${passed} IG-OAUTH-UX checks passed`);
process.exit(process.exitCode || 0);
