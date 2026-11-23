/**
 * Instagram M8.14 — Media List pagination human summary + schema.
 * Run: npx --yes tsx scripts/smoke-instagram-m814.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolveOutputPresentation } from "../src/modules/workflows/outputPresentation";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.join(__dirname, "..");
const backendRoot = path.join(frontendRoot, "..", "backend");
const requireFromBackend = createRequire(
  path.join(backendRoot, "services/workflowInstagram.service.js")
);
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

console.log("\nInstagram M8.14 Media pagination UX");

check("IG-M814-F1 human summary shows N media items", () => {
  const items = Array.from({ length: 25 }, (_, i) => ({
    id: `m${i}`,
    mediaId: `m${i}`,
    mediaType: "IMAGE",
    caption: `Post ${i}`,
    _meta: {
      provider: "instagram",
      resource: "media",
      operation: "list_media",
      truncated: true,
      paging: { hasNext: true, cursors: { after: "ABC" } },
    },
  }));
  const resolved = resolveOutputPresentation(items);
  assert.ok(resolved);
  assert.match(resolved!.summaryText || "", /25 media items/);
  assert.match(resolved!.summaryText || "", /more available/);
  assert.equal(resolved!.blocks.length, 25);
  assert.match(resolved!.blocks[0].title, /Instagram Media/);
});

check("IG-M814-F2 exact page without more omits more available", () => {
  const items = Array.from({ length: 3 }, (_, i) => ({
    id: `m${i}`,
    mediaId: `m${i}`,
    mediaType: "IMAGE",
    _meta: {
      provider: "instagram",
      resource: "media",
      operation: "list_media",
      paging: { hasNext: false },
    },
  }));
  const resolved = resolveOutputPresentation(items);
  assert.match(resolved!.summaryText || "", /3 media items/);
  assert.doesNotMatch(resolved!.summaryText || "", /more available/);
});

check("IG-M814-F3 media renderer layout unchanged", () => {
  const presentation = read(
    "src/modules/workflows/instagramOutputPresentation.ts"
  );
  assert.match(presentation, /function formatMediaBlock/);
  assert.match(presentation, /layout: "media"/);
  assert.match(presentation, /Instagram Media/);
  const preview = read("src/components/workflows/InstagramOutputPreview.tsx");
  assert.match(preview, /InstagramOutputPreview/);
  assert.match(preview, /buildInstagramReadableBlock/);
});

check("IG-M814-F4 schema limit 25 + after cursor", () => {
  const schema = read("src/modules/workflows/nodeParameterSchemas.ts");
  const mediaSlice = schema.slice(
    schema.indexOf('instagram: ['),
    schema.indexOf("insightsPermissionNotice")
  );
  assert.match(mediaSlice, /default: 25/);
  assert.match(mediaSlice, /max: 100/);
  assert.match(mediaSlice, /name: "after"/);
  assert.match(mediaSlice, /returnAll/);
});

check("IG-M814-F5 backend default limit 25", () => {
  const ig = requireFromBackend("./workflowInstagram.service.js");
  assert.equal(ig.DEFAULT_LIMIT, 25);
  const limits = ig.rowLimits({ returnAll: false });
  assert.equal(limits.maxRows, 25);
  assert.equal(limits.returnAll, false);
});

check("IG-M814-F6 picker default bound", () => {
  const pickerSrc = fs.readFileSync(
    path.join(backendRoot, "services/workflowInstagramPicker.service.js"),
    "utf8"
  );
  assert.match(pickerSrc, /PICKER_MEDIA_LIMIT = 25/);
  assert.match(pickerSrc, /returnAll: false/);
});

console.log(`\nM8.14 frontend checks: ${passed} passed`);
if (process.exitCode) console.error("M8.14 FAIL");
else console.log("M8.14 PASS");
