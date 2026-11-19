/**
 * Instagram M8.12 — disconnect, Insights preflight, publish media sources, pickers.
 * Run: npx --yes tsx scripts/smoke-instagram-m812.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyInstagramCredentialChange,
  applyInstagramMediaChange,
  applyInstagramPublishOperationChange,
  applyInstagramResourceChange,
} from "../src/modules/workflows/instagramDependentCascade";
import {
  credentialHasInsightsPermission,
  insightsPermissionBlockedMessage,
  SCOPE_INSIGHTS,
} from "../src/modules/workflows/instagramPermissions";
import { resolveOutputPresentation } from "../src/modules/workflows/outputPresentation";
import { NODE_PARAMETER_SCHEMAS } from "../src/modules/workflows/nodeParameterSchemas";

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

console.log("\nInstagram M8.12 product UX");

const panel = read(
  "src/components/workflows/params/InstagramCredentialPanel.tsx"
);
const picker = read("src/components/workflows/params/CredentialPicker.tsx");
const cascade = read("src/modules/workflows/instagramDependentCascade.ts");
const permissions = read("src/modules/workflows/instagramPermissions.ts");
const mediaField = read(
  "src/components/workflows/params/InstagramMediaLocatorField.tsx"
);
const commentField = read(
  "src/components/workflows/params/InstagramCommentLocatorField.tsx"
);
const publishField = read(
  "src/components/workflows/params/InstagramPublishMediaField.tsx"
);
const api = read("src/modules/workflows/api.ts");
const schemaSrc = read("src/modules/workflows/nodeParameterSchemas.ts");
const auth = fs.readFileSync(
  path.join(frontendRoot, "..", "backend/services/workflowInstagramAuth.service.js"),
  "utf8"
);
const igSvc = fs.readFileSync(
  path.join(frontendRoot, "..", "backend/services/workflowInstagram.service.js"),
  "utf8"
);
const credSvc = fs.readFileSync(
  path.join(frontendRoot, "..", "backend/modules/workflows/credentials.service.js"),
  "utf8"
);
const metaAdsSchema = NODE_PARAMETER_SCHEMAS.metaAds || [];

check("IG-M812-1 Disconnect selected Instagram credential UX", () => {
  assert.match(panel, /Disconnect from OpsAi/);
  assert.match(panel, /data-instagram-disconnect="true"/);
  assert.match(panel, /workflowCredentialsApi\.remove/);
  assert.match(panel, /getCredentialUsage/);
  assert.match(panel, /window\.confirm/);
  assert.match(picker, /onDisconnected/);
});

check("IG-M812-2 Other credentials survive disconnect (selected-only delete)", () => {
  assert.match(panel, /workflowCredentialsApi\.remove\(removedId\)/);
  assert.doesNotMatch(panel, /list\(.*\)\.forEach/);
  assert.match(credSvc, /listCredentialUsage/);
});

check("IG-M812-3 Node resets after disconnect", () => {
  assert.match(cascade, /applyInstagramCredentialChange/);
  const cleared = applyInstagramCredentialChange(
    {
      credentialId: "cred-a",
      mediaId: "m1",
      commentId: "c1",
      instagramUserId: "178",
      username: "demo",
    },
    ""
  );
  assert.equal(cleared.credentialId, "");
  assert.equal(cleared.mediaId, "");
  assert.equal(cleared.commentId, "");
  assert.equal(cleared.instagramUserId, "");
  assert.equal(cleared.username, "");
});

check("IG-M812-4 Insights missing-permission preflight", () => {
  assert.equal(
    credentialHasInsightsPermission({
      missingPermissions: [SCOPE_INSIGHTS],
      grantedPermissions: ["instagram_basic"],
    }),
    false
  );
  assert.match(insightsPermissionBlockedMessage(), /Insights access is not enabled/);
  assert.match(igSvc, /PERMISSION_NOT_GRANTED/);
  assert.match(permissions, /instagram_manage_insights/);
});

check("IG-M812-5 Insights permission-present path still executes", () => {
  assert.equal(
    credentialHasInsightsPermission({
      grantedPermissions: ["instagram_basic", SCOPE_INSIGHTS],
    }),
    true
  );
  assert.match(igSvc, /assertInsightsPermission/);
});

check("IG-M812-6 Upload media source", () => {
  assert.match(publishField, /Upload file/);
  assert.match(publishField, /stageInstagramPublishMedia/);
  assert.match(api, /stage-media/);
});

check("IG-M812-7 Previous-node media source", () => {
  assert.match(publishField, /From previous node/);
  assert.match(publishField, /\{\{item\.mediaUrl\}\}/);
});

check("IG-M812-8 Direct URL advanced mode", () => {
  assert.match(publishField, /URL \(advanced\)/);
  assert.match(publishField, /HTTPS URL Instagram can fetch/);
});

check("IG-M812-9 Publish type changes invalidate incompatible fields", () => {
  const next = applyInstagramPublishOperationChange(
    {
      resource: "publish",
      operation: "publish_image",
      imageUrl: "https://cdn.example.com/a.jpg",
      videoUrl: "",
    },
    "publish_reel"
  );
  assert.equal(next.operation, "publish_reel");
  assert.equal(next.imageUrl, "");
});

check("IG-M812-10 Media picker loads readable options", () => {
  assert.match(mediaField, /From list/);
  assert.match(mediaField, /listInstagramMediaOptions/);
  assert.match(mediaField, /Select a post/);
  assert.match(schemaSrc, /instagramMediaLocator/);
});

check("IG-M812-11 Comment picker loads readable comments", () => {
  assert.match(commentField, /listInstagramCommentOptions/);
  assert.match(commentField, /Select a comment/);
  assert.match(schemaSrc, /instagramCommentLocator/);
});

check("IG-M812-12 Reply stores internal comment ID", () => {
  assert.match(commentField, /\[param\.name\]: nextId/);
  assert.match(commentField, /comment ID is stored/);
});

check("IG-M812-13 Advanced By ID / Expression still works", () => {
  assert.match(mediaField, /By ID/);
  assert.match(mediaField, /Expression/);
  assert.match(commentField, /By ID/);
  assert.match(commentField, /\{\{item\.id\}\}/);
});

check("IG-M812-14 Credential switch clears stale media/comment selections", () => {
  const next = applyInstagramCredentialChange(
    { credentialId: "a", mediaId: "m1", commentId: "c1" },
    "b"
  );
  assert.equal(next.credentialId, "b");
  assert.equal(next.mediaId, "");
  assert.equal(next.commentId, "");
  const media = applyInstagramMediaChange(
    { mediaId: "m1", commentId: "c1" },
    "m2"
  );
  assert.equal(media.commentId, "");
  const res = applyInstagramResourceChange(
    { resource: "comments", commentId: "c1", mediaId: "m1" },
    "publish"
  );
  assert.equal(res.commentId, "");
});

check("IG-M812-15 Human-readable outputs preserved", () => {
  const item = {
    id: "1",
    username: "eliteeagle.dev",
    _meta: { provider: "instagram", resource: "account", operation: "get_profile" },
  };
  const resolved = resolveOutputPresentation(item);
  assert.equal(resolved?.provider, "instagram");
});

check("IG-M812-16 Raw WorkflowItems unchanged (presentation is unwrap-only)", () => {
  const original = {
    result: {
      id: "1",
      username: "eliteeagle.dev",
      _meta: { provider: "instagram", resource: "account", operation: "get_profile" },
    },
  };
  const resolved = resolveOutputPresentation(original);
  assert.equal(resolved?.original, original);
  assert.equal((original.result as { username: string }).username, "eliteeagle.dev");
});

check("IG-M812-17 Meta Ads unchanged", () => {
  assert.ok(metaAdsSchema.some((p) => p.name === "credentialId"));
  assert.ok(metaAdsSchema.some((p) => p.customRenderer === "metaAdAccount"));
  assert.doesNotMatch(
    read("src/modules/workflows/nodeParameterSchemas.ts").slice(
      read("src/modules/workflows/nodeParameterSchemas.ts").indexOf("metaAds:"),
      read("src/modules/workflows/nodeParameterSchemas.ts").indexOf("metaAds:") + 800
    ),
    /instagramMediaLocator/
  );
});

check("IG-M812-18 Permission error classes differentiated", () => {
  assert.match(auth, /PERMISSION_NOT_GRANTED/);
  assert.match(auth, /APP_ACCESS_NOT_APPROVED/);
  assert.match(auth, /ADVANCED_ACCESS_REQUIRED/);
  assert.match(auth, /ACCOUNT_NOT_ELIGIBLE/);
  assert.match(auth, /GRAPH_PERMISSION_ERROR/);
});

console.log(`\nM8.12 frontend checks: ${passed} passed`);
if (process.exitCode) {
  console.error("M8.12 FAIL");
} else {
  console.log("M8.12 PASS (frontend static + unit)");
}
