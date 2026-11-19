/**
 * Instagram M8.11 — shared presentation wiring (frontend files present).
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

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

console.log("\nInstagram M8.11 presentation wiring");

check("IG-M811-B1 shared resolver module exists", () => {
  const p = path.join(
    __dirname,
    "../../frontend/src/modules/workflows/outputPresentation.ts"
  );
  const src = fs.readFileSync(p, "utf8");
  assert.match(src, /resolveOutputPresentation/);
  assert.match(src, /Never mutates/);
});

check("IG-M811-B2 Result + Run Results consume resolver", () => {
  const viewer = fs.readFileSync(
    path.join(
      __dirname,
      "../../frontend/src/components/workflows/ItemDataViewer.tsx"
    ),
    "utf8"
  );
  const results = fs.readFileSync(
    path.join(
      __dirname,
      "../../frontend/src/components/workflows/WorkflowResultsSidebar.tsx"
    ),
    "utf8"
  );
  assert.match(viewer, /resolveOutputPresentation/);
  assert.match(results, /resolveOutputPresentation/);
  assert.match(results, /InstagramOutputPreview/);
});

check("IG-M811-B3 Instagram execution contract unchanged", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../services/workflowInstagram.service.js"),
    "utf8"
  );
  assert.match(src, /provider: "instagram"/);
  assert.match(src, /PROFILE_FIELDS_REQUIRED = "id,username"/);
});

check("IG-M811-B4 Meta Ads unchanged", () => {
  const meta = fs.readFileSync(
    path.join(__dirname, "../config/metaGraph.js"),
    "utf8"
  );
  assert.match(meta, /ads_read/);
});

console.log(`\nM8.11 backend results: ${passed} passed`);
