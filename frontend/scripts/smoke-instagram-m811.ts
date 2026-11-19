/**
 * Instagram M8.11 — shared presentation resolver across Result + Run Results.
 * Run: npx --yes tsx scripts/smoke-instagram-m811.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveOutputPresentation } from "../src/modules/workflows/outputPresentation";
import { buildInstagramReadableBlock } from "../src/modules/workflows/instagramOutputPresentation";
import { formatStepOutput } from "../src/modules/workflows/runStepDisplay";
import { prettyJson } from "../src/modules/workflows/inspectorViewModel";

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

const igItem = {
  id: "17841434093046726",
  igId: "34293808434",
  name: "Shubham | Website Developer",
  username: "eliteeagle.dev",
  biography: "Web Development & Ongoing Support",
  mediaCount: 1,
  accountType: "Business",
  followsCount: 2,
  followersCount: 1,
  instagramUserId: "17841434093046726",
  profilePictureUrl: "https://scontent.cdninstagram.com/v/t51.2885-19/x.jpg",
  _meta: {
    provider: "instagram",
    resource: "account",
    operation: "get_profile",
    apiVersion: "v26.0",
  },
};

console.log("\nInstagram M8.11 shared presentation resolver");

check("IG-M811-1 direct Instagram item resolves", () => {
  const resolved = resolveOutputPresentation(igItem);
  assert.equal(resolved?.provider, "instagram");
  assert.equal(resolved?.shape, "root");
  assert.equal(resolved?.items[0].username, "eliteeagle.dev");
});

check("IG-M811-2 { result: instagramItem } resolves", () => {
  const wrapped = { result: igItem };
  const resolved = resolveOutputPresentation(wrapped);
  assert.equal(resolved?.provider, "instagram");
  assert.equal(resolved?.shape, "result");
  assert.equal(resolved?.original, wrapped);
  assert.equal(resolved?.items[0].username, "eliteeagle.dev");
});

check("IG-M811-3 [instagramItem] resolves", () => {
  const resolved = resolveOutputPresentation([igItem]);
  assert.equal(resolved?.provider, "instagram");
  assert.equal(resolved?.shape, "array");
});

check("IG-M811-4 { result: [instagramItem] } resolves", () => {
  const wrapped = { result: [igItem] };
  const resolved = resolveOutputPresentation(wrapped);
  assert.equal(resolved?.provider, "instagram");
  assert.equal(resolved?.shape, "result_array");
});

check("IG-M811-5 deep unrelated nest does not hijack", () => {
  const deep = {
    payload: {
      nested: {
        deeper: igItem,
      },
    },
  };
  assert.equal(resolveOutputPresentation(deep), null);

  const almost = {
    result: {
      nested: igItem,
    },
  };
  assert.equal(resolveOutputPresentation(almost), null);
});

check("IG-M811-6 account card has polished layout fields", () => {
  const block = buildInstagramReadableBlock(igItem)!;
  assert.equal(block.layout, "account");
  assert.equal(block.headerName, "Shubham | Website Developer");
  assert.equal(block.headerUsername, "@eliteeagle.dev");
  assert.equal(block.headerAccountType, "Business");
  assert.ok(block.stats?.some((s) => s.label === "Followers"));
  assert.equal(block.biography?.includes("Web Development"), true);
  assert.equal(block.text.includes("profilePictureUrl"), false);
  assert.equal(block.text.includes("17841434093046726"), false);
});

check("IG-M811-7 Result wrapper summary is human-readable", () => {
  const text = formatStepOutput({ result: igItem });
  assert.match(text, /@eliteeagle\.dev|Instagram/);
  assert.equal(text.trim().startsWith("{"), false);
});

check("IG-M811-8 raw JSON of Result wrapper preserved", () => {
  const wrapped = { result: igItem };
  const resolved = resolveOutputPresentation(wrapped)!;
  assert.deepEqual(resolved.original, wrapped);
  const raw = prettyJson(resolved.original);
  assert.match(raw, /"result"/);
  assert.match(raw, /eliteeagle\.dev/);
  assert.match(raw, /_meta/);
});

check("IG-M811-9 WorkflowItem { json: { result } } resolves", () => {
  const item = { json: { result: igItem } };
  const resolved = resolveOutputPresentation(item);
  assert.equal(resolved?.provider, "instagram");
  assert.equal(resolved?.shape, "result");
});

check("IG-M811-10 technical ids stay on source object", () => {
  const resolved = resolveOutputPresentation({ result: igItem })!;
  assert.equal(resolved.items[0].id, "17841434093046726");
  assert.equal(resolved.items[0].igId, "34293808434");
  assert.ok(resolved.items[0]._meta);
});

check("IG-M811-11 generic Result remains null presentation", () => {
  assert.equal(
    resolveOutputPresentation({ result: { message: "hello world" } }),
    null
  );
  assert.equal(resolveOutputPresentation({ ok: true, count: 3 }), null);
});

check("IG-M811-12 non-Instagram outputs keep formatStepOutput", () => {
  const text = formatStepOutput({ result: { message: "Done" } });
  assert.equal(text, "Done");
});

check("IG-M811-13 shared resolver wired in viewers", () => {
  const viewer = read("src/components/workflows/ItemDataViewer.tsx");
  assert.match(viewer, /resolveOutputPresentation/);
  assert.match(viewer, /InstagramOutputPreview/);
  const results = read("src/components/workflows/WorkflowResultsSidebar.tsx");
  assert.match(results, /resolveOutputPresentation/);
  assert.match(results, /InstagramOutputPreview/);
  assert.match(results, /JSON \/ Raw data/);
  assert.match(results, /finalRawJson/);
});

check("IG-M811-14 Copy uses original payload path", () => {
  const results = read("src/components/workflows/WorkflowResultsSidebar.tsx");
  assert.match(results, /value=\{finalRawJson \?\? finalResultText\}/);
});

check("IG-M811-15 single presentation module is the source of truth", () => {
  const resolver = read("src/modules/workflows/outputPresentation.ts");
  assert.match(resolver, /resolveOutputPresentation/);
  assert.match(resolver, /WRAPPER_KEYS/);
  assert.equal(resolver.includes("eliteeagle"), false);
  const preview = read("src/components/workflows/InstagramOutputPreview.tsx");
  assert.match(preview, /resolveOutputPresentation|buildInstagramReadableBlock/);
  assert.match(preview, /AccountCard|headerName/);
});

console.log(`\nM8.11 results: ${passed} passed`);
