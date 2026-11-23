/**
 * Instagram M8.14.1 — Media List compact presentation (one list, not N cards).
 * Run: npx --yes tsx scripts/smoke-instagram-m8141.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildInstagramMediaListCollection,
  buildInstagramReadableBlock,
} from "../src/modules/workflows/instagramOutputPresentation";
import { resolveOutputPresentation } from "../src/modules/workflows/outputPresentation";

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

const listItem = (i: number, overrides: Record<string, unknown> = {}) => ({
  id: `1789${String(i).padStart(12, "0")}`,
  mediaId: `1789${String(i).padStart(12, "0")}`,
  mediaType: i % 2 === 0 ? "IMAGE" : "VIDEO",
  mediaProductType: "FEED",
  caption: `Caption for post number ${i} with enough text to stay readable in the compact list row.`,
  timestamp: "2026-03-15T12:00:00+0000",
  likeCount: 10 + i,
  commentsCount: i,
  permalink: `https://www.instagram.com/p/abc${i}/`,
  thumbnailUrl: "https://scontent.cdninstagram.com/v/t51.thumb/x.jpg",
  username: "brand_ig",
  _meta: {
    provider: "instagram",
    resource: "media",
    operation: "list_media",
    truncated: true,
    paging: { hasNext: true, cursors: { after: "CURSOR_NEXT" } },
  },
  ...overrides,
});

console.log("\nInstagram M8.14.1 Media List presentation");

check("IG-M8141-1 list_media 25 items → one list presentation", () => {
  const items = Array.from({ length: 25 }, (_, i) => listItem(i));
  const resolved = resolveOutputPresentation(items);
  assert.ok(resolved);
  assert.equal(resolved!.blocks.length, 1);
  assert.equal(resolved!.blocks[0].layout, "media_list");
  assert.equal(resolved!.blocks[0].mediaRows?.length, 25);
  assert.equal(resolved!.items.length, 25);
});

check("IG-M8141-2 count shown as 25", () => {
  const items = Array.from({ length: 25 }, (_, i) => listItem(i));
  const resolved = resolveOutputPresentation(items)!;
  assert.match(resolved.summaryText, /25 media items/);
  assert.match(resolved.blocks[0].title, /25 media items/);
  assert.equal(
    resolved.blocks[0].lines.find((l) => l.label === "Count")?.value,
    "25"
  );
});

check("IG-M8141-3 more available when hasNext=true", () => {
  const items = Array.from({ length: 25 }, (_, i) => listItem(i));
  const resolved = resolveOutputPresentation(items)!;
  assert.match(resolved.summaryText, /more available/);
  assert.match(resolved.blocks[0].title, /more available/);
  assert.equal(resolved.blocks[0].hasMore, true);
});

check("IG-M8141-4 no Instagram Media 1 / Media 2 full-card stream", () => {
  const items = Array.from({ length: 25 }, (_, i) => listItem(i));
  const resolved = resolveOutputPresentation(items)!;
  assert.equal(resolved.blocks.length, 1);
  assert.doesNotMatch(resolved.summaryText, /Instagram Media 1/);
  assert.doesNotMatch(resolved.blocks[0].text, /Instagram Media 1/);
  assert.doesNotMatch(resolved.blocks[0].text, /Instagram Media 2/);
  for (const block of resolved.blocks) {
    assert.notEqual(block.layout, "media");
  }
  const collection = buildInstagramMediaListCollection(items)!;
  assert.equal(collection.layout, "media_list");
  assert.doesNotMatch(collection.text, /Media type\n/);
  assert.doesNotMatch(collection.text, /Username\n/);
});

check("IG-M8141-5 get_media still uses detailed single-media card", () => {
  const item = {
    id: "17890000000000001",
    mediaId: "17890000000000001",
    mediaType: "IMAGE",
    mediaProductType: "FEED",
    caption: "Full caption for get_media detail card",
    timestamp: "2026-03-15T12:00:00+0000",
    permalink: "https://www.instagram.com/p/xyz/",
    username: "brand_ig",
    _meta: {
      provider: "instagram",
      resource: "media",
      operation: "get_media",
    },
  };
  const resolved = resolveOutputPresentation(item)!;
  assert.equal(resolved.blocks.length, 1);
  assert.equal(resolved.blocks[0].layout, "media");
  assert.match(resolved.blocks[0].title, /^Instagram Media$/);
  assert.ok(
    resolved.blocks[0].lines.some(
      (l) => l.label === "Caption" && l.value.includes("Full caption")
    )
  );
  const block = buildInstagramReadableBlock(item);
  assert.equal(block?.layout, "media");
});

check("IG-M8141-6 compact copy text is a readable list", () => {
  const items = [listItem(0), listItem(1)];
  const resolved = resolveOutputPresentation(items)!;
  assert.match(resolved.blocks[0].text, /2 media items/);
  assert.match(resolved.blocks[0].text, /likes/);
  assert.match(resolved.blocks[0].text, /instagram\.com/);
  assert.doesNotMatch(resolved.blocks[0].text, /Instagram Media 1/);
});

check("IG-M8141-7 preview renders media_list layout", () => {
  const preview = read("src/components/workflows/InstagramOutputPreview.tsx");
  assert.match(preview, /media_list/);
  assert.match(preview, /MediaListCard/);
  assert.match(preview, /data-instagram-media-list/);
  assert.match(preview, /MediaListRowView/);
});

check("IG-M8141-8 no more available when hasNext false", () => {
  const items = [
    listItem(0, {
      _meta: {
        provider: "instagram",
        resource: "media",
        operation: "list_media",
        paging: { hasNext: false },
      },
    }),
  ];
  const resolved = resolveOutputPresentation(items)!;
  assert.match(resolved.summaryText, /1 media items/);
  assert.doesNotMatch(resolved.summaryText, /more available/);
  assert.equal(resolved.blocks[0].hasMore, false);
});

console.log(`\nM8.14.1 checks: ${passed} passed`);
if (process.exitCode) console.error("M8.14.1 FAIL");
else console.log("M8.14.1 PASS");
