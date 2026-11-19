/**
 * Instagram M8.12 backend smoke — disconnect usage, Insights codes, picker/stage helpers.
 * Run: node scripts/smoke-workflow-instagram-m812.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

let passed = 0;
const check = (name, fn) => {
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

console.log("\nInstagram M8.12 backend");

const auth = read("services/workflowInstagramAuth.service.js");
const ig = read("services/workflowInstagram.service.js");
const picker = read("services/workflowInstagramPicker.service.js");
const creds = read("modules/workflows/credentials.service.js");
const routes = read("modules/workflows/workflows.routes.js");
const controller = read("modules/workflows/workflows.controller.js");

check("IG-M812-B1 disconnect usage API wired", () => {
  assert.match(creds, /listCredentialUsage/);
  assert.match(routes, /credentials\/:credentialId\/usage/);
  assert.match(controller, /getCredentialUsage/);
});

check("IG-M812-B2 Insights preflight uses PERMISSION_NOT_GRANTED", () => {
  assert.match(ig, /assertInsightsPermission/);
  assert.match(ig, /PERMISSION_NOT_GRANTED/);
  assert.match(ig, /Insights access is not enabled/);
});

check("IG-M812-B3 Graph permission classes differentiated", () => {
  for (const code of [
    "PERMISSION_NOT_GRANTED",
    "APP_ACCESS_NOT_APPROVED",
    "ADVANCED_ACCESS_REQUIRED",
    "ACCOUNT_NOT_ELIGIBLE",
    "GRAPH_PERMISSION_ERROR",
  ]) {
    assert.match(auth, new RegExp(code));
  }
});

check("IG-M812-B4 media/comment picker + stage routes", () => {
  assert.match(routes, /instagram\/media-options/);
  assert.match(routes, /instagram\/comment-options/);
  assert.match(routes, /instagram\/stage-media/);
  assert.match(picker, /listMediaOptions/);
  assert.match(picker, /listCommentOptions/);
  assert.match(picker, /stagePublishMedia/);
  assert.match(picker, /formatMediaOption/);
  assert.match(picker, /formatCommentOption/);
});

check("IG-M812-B5 formatMedia/comment labels are human-readable", () => {
  const {
    formatMediaOption,
    formatCommentOption,
  } = require("../services/workflowInstagramPicker.service");
  const media = formatMediaOption({
    id: "1789",
    caption: "Love this launch day post from the team",
    media_type: "IMAGE",
    timestamp: "2026-11-18T12:00:00+0000",
    thumbnail_url: "https://cdn.example.com/t.jpg",
  });
  assert.equal(media.mediaId, "1789");
  assert.match(media.label, /IMAGE/);
  assert.match(media.label, /Love this launch/);
  const comment = formatCommentOption({
    commentId: "c1",
    username: "friend",
    text: "Love this post!",
    timestamp: "2026-11-18T12:00:00+0000",
  });
  assert.equal(comment.commentId, "c1");
  assert.match(comment.label, /@friend/);
  assert.match(comment.label, /Love this post/);
});

check("IG-M812-B6 grantedPermissions exposed on credential format", () => {
  assert.match(creds, /grantedPermissions:/);
});

check("IG-M812-B7 Meta Ads routes untouched for Instagram picker", () => {
  assert.match(routes, /meta-oauth\/ad-accounts/);
  assert.match(routes, /meta-ad-account/);
});

console.log(`\nM8.12 backend checks: ${passed} passed`);
if (process.exitCode) {
  console.error("M8.12 FAIL");
} else {
  console.log("M8.12 PASS (backend static + unit)");
}
