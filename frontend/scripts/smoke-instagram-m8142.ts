/**
 * Instagram M8.14.2 — Media List UI show-more + bounded presentation.
 * Run: npx --yes tsx scripts/smoke-instagram-m8142.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
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

const listItem = (i: number) => ({
  id: `1789${String(i).padStart(12, "0")}`,
  mediaId: `1789${String(i).padStart(12, "0")}`,
  mediaType: "IMAGE",
  mediaProductType: "FEED",
  caption: `Caption ${i}`,
  timestamp: "2026-03-15T12:00:00+0000",
  likeCount: i,
  commentsCount: 0,
  permalink: `https://www.instagram.com/p/x${i}/`,
  _meta: {
    provider: "instagram",
    resource: "media",
    operation: "list_media",
    truncated: true,
    paging: { hasNext: true, cursors: { after: "NEXT" } },
  },
});

console.log("\nInstagram M8.14.2 Media List scrolling + defaults");

check("IG-M8142-F1 human title is 25 not full history", () => {
  const items = Array.from({ length: 25 }, (_, i) => listItem(i));
  const resolved = resolveOutputPresentation(items)!;
  assert.equal(resolved.blocks.length, 1);
  assert.match(resolved.summaryText, /25 media items/);
  assert.match(resolved.summaryText, /more available/);
  assert.doesNotMatch(resolved.summaryText, /433/);
});

check("IG-M8142-F2 preview initially collapses after 10 rows", () => {
  const preview = read("src/components/workflows/InstagramOutputPreview.tsx");
  assert.match(preview, /MEDIA_LIST_PREVIEW_ROWS = 10/);
  assert.match(preview, /Show \$\{hiddenCount\} more/);
  assert.match(preview, /Show less/);
  assert.match(preview, /data-instagram-media-list-toggle/);
});

check("IG-M8142-F3 <=10 rows has no show-more control logic requirement", () => {
  const items = Array.from({ length: 8 }, (_, i) => listItem(i));
  const resolved = resolveOutputPresentation(items)!;
  assert.equal(resolved.blocks[0].mediaRows?.length, 8);
  assert.match(resolved.summaryText, /8 media items/);
});

check("IG-M8142-F4 backend normalize missing → 25/false", () => {
  const ig = requireFromBackend("./workflowInstagram.service.js");
  const n = ig.normalizeListMediaExecutionParams({
    resource: "media",
    operation: "list_media",
  });
  assert.equal(n.limit, 25);
  assert.equal(n.returnAll, false);
});

check("IG-M8142-F5 media_list still one block for 25", () => {
  const items = Array.from({ length: 25 }, (_, i) => listItem(i));
  const resolved = resolveOutputPresentation(items)!;
  assert.equal(resolved.blocks[0].layout, "media_list");
  assert.equal(resolved.blocks[0].mediaRows?.length, 25);
  assert.doesNotMatch(resolved.blocks[0].text, /Instagram Media 1/);
});

console.log(`\nM8.14.2 frontend checks: ${passed} passed`);
if (process.exitCode) console.error("M8.14.2 FAIL");
else console.log("M8.14.2 PASS");
