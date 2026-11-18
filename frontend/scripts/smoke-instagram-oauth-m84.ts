/**
 * Instagram M8.4 — sanitized OAuth error mapping (frontend).
 * Run: npx --yes tsx scripts/smoke-instagram-oauth-m84.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeInstagramOAuthError } from "../src/modules/workflows/instagramOAuthError";

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

console.log("\nInstagram M8.4 frontend OAuth errors");

check("IG-M84-FE-1 discovery empty maps to clear message", () => {
  assert.equal(
    sanitizeInstagramOAuthError(
      "No Instagram professional account was shared. Reconnect and select an Instagram asset."
    ),
    "Instagram authorization succeeded, but no Instagram account was available."
  );
});

check("IG-M84-FE-2 authorization failed is not wiped as Google error", () => {
  assert.equal(
    sanitizeInstagramOAuthError("Instagram authorization failed."),
    "Instagram OAuth callback could not be completed."
  );
});

check("IG-M84-FE-3 credential save maps cleanly", () => {
  assert.equal(
    sanitizeInstagramOAuthError("Instagram credential could not be saved."),
    "Instagram credential could not be saved."
  );
});

check("IG-M84-FE-4 secrets stay redacted", () => {
  assert.equal(
    sanitizeInstagramOAuthError("got access_token=ABC123SECRETXYZ"),
    "Instagram OAuth callback could not be completed."
  );
});

check("IG-M84-FE-5 Google sanitize no longer false-positives on authorization", () => {
  const src = read("src/modules/workflows/googleOAuthMessage.ts");
  assert.match(
    src,
    /access_token\|refresh_token\|appsecret_proof\|client_secret\|Bearer/
  );
  // Old broad pattern that wiped "Instagram authorization failed." must be gone.
  assert.equal(
    /token\|bearer\|secret\|authorization\|refresh/i.test(src),
    false
  );
});

check("IG-M84-FE-6 panel + popup use sanitizer", () => {
  const panel = read(
    "src/components/workflows/params/InstagramCredentialPanel.tsx"
  );
  const popup = read("src/modules/workflows/instagramOAuthPopup.ts");
  assert.match(panel, /sanitizeInstagramOAuthError/);
  assert.match(popup, /sanitizeInstagramOAuthError/);
});

console.log(`\nM8.4 frontend results: ${passed} passed`);
