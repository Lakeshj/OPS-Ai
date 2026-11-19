/**
 * Instagram M8.10 — backend invalid-pair guard + frontend presentation wiring.
 * No live Meta calls; no secrets.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

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

async function main() {
  console.log("\nInstagram M8.10 backend guard + presentation wiring");

  await check("IG-M810-B1 backend invalid pair guard remains", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowInstagram.service.js"),
      "utf8"
    );
    assert.match(src, /INSTAGRAM_OPERATION_UNSUPPORTED/);
    assert.match(
      src,
      /Unsupported Instagram resource\/operation for this node version/
    );
  });

  await check("IG-M810-B2 Account Get still uses /{instagramUserId}", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowInstagram.service.js"),
      "utf8"
    );
    assert.match(src, /PROFILE_FIELDS_REQUIRED = "id,username"/);
    assert.equal(/PROFILE_FIELDS[^=]*=[^;]*user_id/.test(src), false);
  });

  await check("IG-M810-B3 frontend presentation modules present", () => {
    const root = path.join(__dirname, "../../frontend/src");
    assert.ok(
      fs.existsSync(
        path.join(root, "modules/workflows/instagramOutputPresentation.ts")
      )
    );
    assert.ok(
      fs.existsSync(
        path.join(root, "components/workflows/InstagramOutputPreview.tsx")
      )
    );
    assert.ok(
      fs.existsSync(
        path.join(root, "modules/workflows/dependentParamCascade.ts")
      )
    );
  });

  await check("IG-M810-B4 Meta Ads firewall unchanged", () => {
    const meta = fs.readFileSync(
      path.join(__dirname, "../config/metaGraph.js"),
      "utf8"
    );
    assert.match(meta, /ads_read/);
    const ads = fs.readFileSync(
      path.join(__dirname, "../services/workflowMetaAds.service.js"),
      "utf8"
    );
    assert.match(ads, /Meta write calls are not available/);
  });

  console.log(`\nM8.10 backend results: ${passed} passed`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
