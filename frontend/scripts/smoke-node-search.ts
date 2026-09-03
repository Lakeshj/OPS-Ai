/**
 * UX Phase A — pure Node Library search checks (no test framework).
 * Run: npx --yes tsx scripts/smoke-node-search.ts
 */
import assert from "node:assert/strict";
import {
  searchNodes,
} from "../src/modules/workflows/nodeSearch";

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

console.log("\nNode Library search (UX Phase A)");

check('query "http" → HTTP Request ranks first', () => {
  const r = searchNodes({ query: "http", availability: "available" });
  assert.ok(r.length > 0);
  assert.match(r[0].name, /HTTP Request/i);
});

check('query "api" → HTTP Request from alias', () => {
  const r = searchNodes({ query: "api", availability: "available" });
  assert.ok(r.some((n) => /HTTP Request/i.test(n.name)));
  assert.match(r[0].name, /HTTP Request/i);
});

check('query "excel" → Spreadsheet', () => {
  const r = searchNodes({ query: "excel", availability: "available" });
  assert.ok(r.some((n) => /Spreadsheet/i.test(n.name)));
});

check('query "mail" → Email', () => {
  const r = searchNodes({ query: "mail", availability: "all" });
  assert.ok(r.some((n) => /Email/i.test(n.name)));
});

check('query "loop" → Loop Over Items', () => {
  const r = searchNodes({ query: "loop", availability: "available" });
  assert.ok(r.length > 0);
  assert.match(r[0].name, /Loop Over Items/i);
});

check("exact node name ranks above related", () => {
  const r = searchNodes({ query: "Wait", availability: "available" });
  assert.match(r[0].name, /^Wait$/i);
});

check("Available mode excludes Soon", () => {
  const r = searchNodes({ query: "", availability: "available" });
  assert.ok(r.every((n) => n.available));
  assert.ok(r.length > 5);
});

check("All includes Soon", () => {
  const r = searchNodes({ query: "", availability: "all" });
  assert.ok(r.some((n) => !n.available));
});

check("Available outranks equally relevant Soon", () => {
  const r = searchNodes({ query: "mail", availability: "all" });
  const firstAvailable = r.find((n) => n.available);
  const firstSoon = r.find((n) => !n.available);
  assert.ok(firstAvailable);
  if (firstSoon) {
    assert.ok(
      r.indexOf(firstAvailable!) < r.indexOf(firstSoon),
      "available mail should rank before soon mail"
    );
  }
});

check("category filter + query compose", () => {
  const r = searchNodes({
    query: "loop",
    category: "Logic",
    availability: "available",
  });
  assert.ok(r.every((n) => n.category === "Logic"));
  assert.ok(r.some((n) => /Loop/i.test(n.name)));
});

check("empty query returns deterministic catalog order", () => {
  const a = searchNodes({ query: "", availability: "available" });
  const b = searchNodes({ query: "", availability: "available" });
  assert.deepEqual(
    a.map((n) => n.id),
    b.map((n) => n.id)
  );
});

check("unknown query returns empty", () => {
  const r = searchNodes({
    query: "zzzxxyyqqq-not-a-node",
    availability: "all",
  });
  assert.equal(r.length, 0);
});

check('typo "spredsheet" → Spreadsheet', () => {
  const r = searchNodes({ query: "spredsheet", availability: "available" });
  assert.ok(r.some((n) => /Spreadsheet/i.test(n.name)));
});

console.log(`\n${passed} node-search checks passed`);
