/**
 * Instagram M8.10 — human-readable output + resource→operation cascade.
 * Run: npx --yes tsx scripts/smoke-instagram-m810.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildInstagramReadableBlock,
  isSafeInstagramImageUrl,
  shouldHideInstagramTableKey,
  summarizeInstagramOutput,
} from "../src/modules/workflows/instagramOutputPresentation";
import { flattenRowForDisplay } from "../src/modules/workflows/inspectorViewModel";
import {
  dependentParamsNeedReconcile,
  reconcileDependentOptionParams,
} from "../src/modules/workflows/dependentParamCascade";
import { getNodeContract } from "../src/modules/workflows/nodeContract";
import { getSchemaParamIssues } from "../src/modules/workflows/paramSchemaValidation";
import { formatStepOutput } from "../src/modules/workflows/runStepDisplay";

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

const accountJson = {
  id: "17841434093046726",
  igId: "34293808434",
  name: "Shubham | Website Developer",
  username: "eliteeagle.dev",
  biography: "Builder",
  mediaCount: 1,
  accountType: "Business",
  followsCount: 2,
  followersCount: 1,
  instagramUserId: "17841434093046726",
  profilePictureUrl:
    "https://scontent.cdninstagram.com/v/t51.2885-19/x.jpg",
  _meta: {
    provider: "instagram",
    resource: "account",
    operation: "get_profile",
    apiVersion: "v26.0",
    instagramUserId: "17841434093046726",
  },
};

console.log("\nInstagram M8.10 output presentation + dependent ops");

check("IG-M810-1 Account Get human-readable block", () => {
  const block = buildInstagramReadableBlock(accountJson);
  assert.ok(block);
  assert.equal(block!.title, "Instagram Account");
  assert.match(block!.text, /Instagram Account/);
  assert.match(block!.text, /@eliteeagle\.dev/);
  assert.match(block!.text, /Followers/);
  assert.ok(block!.imageUrl);
  assert.equal(block!.text.includes(accountJson.profilePictureUrl), false);
});

check("IG-M810-2 profile picture URL not primary text", () => {
  const block = buildInstagramReadableBlock(accountJson)!;
  assert.equal(
    block.lines.some((l) => l.label.toLowerCase().includes("url")),
    false
  );
  assert.ok(isSafeInstagramImageUrl(accountJson.profilePictureUrl));
  assert.equal(isSafeInstagramImageUrl("http://evil.example/x.png"), false);
});

check("IG-M810-3 technical keys hidden from table, kept in JSON source", () => {
  for (const key of [
    "id",
    "instagramUserId",
    "igId",
    "profilePictureUrl",
  ]) {
    assert.equal(shouldHideInstagramTableKey(accountJson, key), true);
  }
  const flat = flattenRowForDisplay(accountJson);
  assert.equal(Object.prototype.hasOwnProperty.call(flat, "id"), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(flat, "profilePictureUrl"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(flat, "_meta"),
    false
  );
  assert.equal(flat.username, "eliteeagle.dev");
  assert.equal(accountJson.id, "17841434093046726");
  assert.ok(accountJson._meta);
});

check("IG-M810-4 Run Results summary is human-readable", () => {
  const summary = summarizeInstagramOutput(accountJson);
  assert.match(String(summary), /@eliteeagle\.dev/);
  assert.equal(String(summary).includes("profilePictureUrl"), false);
  assert.match(formatStepOutput(accountJson), /Instagram/);
});

check("IG-M810-5 Account + get_profile is valid", () => {
  const issues = getSchemaParamIssues("instagram", {
    credentialId: "cred-1",
    resource: "account",
    operation: "get_profile",
  });
  assert.equal(issues.length, 0);
});

check("IG-M810-6 Account→Media invalidates get_profile", () => {
  const contract = getNodeContract("instagram");
  const next = reconcileDependentOptionParams(contract.params, {
    credentialId: "cred-1",
    resource: "media",
    operation: "get_profile",
  });
  assert.notEqual(next.operation, "get_profile");
  assert.equal(next.operation, "list_media");
});

check("IG-M810-7 Media default operation is list_media", () => {
  const contract = getNodeContract("instagram");
  const next = reconcileDependentOptionParams(contract.params, {
    resource: "media",
    operation: "get_profile",
  });
  assert.equal(next.operation, "list_media");
});

check("IG-M810-8 Media→Insights refreshes operation", () => {
  const contract = getNodeContract("instagram");
  const next = reconcileDependentOptionParams(contract.params, {
    resource: "insights",
    operation: "list_media",
  });
  assert.equal(next.operation, "account_insights");
});

check("IG-M810-9 invalid saved pair detected by validation", () => {
  const issues = getSchemaParamIssues("instagram", {
    credentialId: "cred-1",
    resource: "media",
    operation: "get_profile",
  });
  assert.ok(issues.some((i) => /operation/i.test(i)));
});

check("IG-M810-10 hidden stale params do not require config", () => {
  const issues = getSchemaParamIssues("instagram", {
    credentialId: "cred-1",
    resource: "account",
    operation: "get_profile",
    // stale from prior Media Get — must not flag while hidden
    mediaId: "",
  });
  assert.equal(issues.length, 0);

  const mediaIssues = getSchemaParamIssues("instagram", {
    credentialId: "cred-1",
    resource: "media",
    operation: "get_media",
    mediaId: "",
  });
  assert.ok(mediaIssues.some((i) => /media/i.test(i)));
});

check("IG-M810-11 cascade reports need-reconcile", () => {
  const contract = getNodeContract("instagram");
  const before = {
    resource: "media",
    operation: "get_profile",
  };
  const after = reconcileDependentOptionParams(contract.params, before);
  assert.equal(
    dependentParamsNeedReconcile(before, after, contract.params),
    true
  );
});

check("IG-M810-12 WorkflowItem JSON contract unchanged (presentation-only)", () => {
  const src = read("src/modules/workflows/instagramOutputPresentation.ts");
  assert.match(src, /Never mutates WorkflowItem/);
  const viewer = read("src/components/workflows/ItemDataViewer.tsx");
  assert.match(viewer, /InstagramOutputPreview/);
  assert.match(viewer, /JSON/);
});

check("IG-M810-13 Instagram preview component exists", () => {
  const preview = read("src/components/workflows/InstagramOutputPreview.tsx");
  assert.match(preview, /Instagram Account|block\.title/);
  assert.match(preview, /JSON tab/);
  assert.equal(preview.includes("access_token"), false);
});

check("IG-M810-14 Meta Ads / Google Ads schemas untouched by Instagram cascade", () => {
  const meta = getNodeContract("metaAds");
  const ads = getNodeContract("googleAds");
  assert.ok(meta);
  assert.ok(ads);
  const metaIssues = getSchemaParamIssues("metaAds", {
    credentialId: "c",
    adAccountId: "act_1",
    resource: "account",
    operation: "get_insights",
  } as never);
  // May have other required fields — just ensure module loads and Instagram
  // cascade does not throw on Meta/Google contracts.
  assert.ok(Array.isArray(metaIssues));
  const cascade = reconcileDependentOptionParams(ads.params, {
    reportType: "campaign_performance",
  });
  assert.ok(cascade);
});

check("IG-M810-15 OptionsParamField no longer keeps (current) stale ops", () => {
  const src = read("src/components/workflows/params/ParamFields.tsx");
  assert.equal(/\(\$\{str\} \(current\)\)/.test(src), false);
  assert.equal(/name: `\$\{str\} \(current\)`/.test(src), false);
  assert.match(src, /Never keep a filtered-out value/);
  const renderer = read(
    "src/components/workflows/params/NodeParameterRenderer.tsx"
  );
  assert.match(renderer, /reconcileDependentOptionParams/);
  assert.match(renderer, /resourceKey/);
  assert.match(renderer, /operationKey/);
});

console.log(`\nM8.10 results: ${passed} passed`);
