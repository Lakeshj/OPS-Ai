/**
 * UX Phase A — pure Node Library search checks (no test framework).
 * Run: npx --yes tsx scripts/smoke-node-search.ts
 */
import assert from "node:assert/strict";
import {
  applyLibraryNodePreset,
  nodeLibraryCatalog,
  resolveEngineType,
} from "../src/modules/workflows/nodeLibrary";
import {
  searchNodes,
} from "../src/modules/workflows/nodeSearch";
import { googleAdsSourceFieldState } from "../src/modules/workflows/googleAdsMcpSource";

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

const adsMcp = () =>
  nodeLibraryCatalog.nodes.find((node) => node.id === "google-ads-mcp-tools");

check("ADS-MCP-NODE-1/2 Google Ads MCP Tools appears in the library", () => {
  const r = searchNodes({ query: "Google Ads MCP Tools", availability: "available" });
  assert.ok(r.some((node) => node.id === "google-ads-mcp-tools"));
  const node = adsMcp();
  assert.equal(node?.name, "Google Ads MCP Tools");
  assert.equal(node?.provider, "Google");
  assert.equal(node?.category, "SEO");
  assert.match(node?.description || "", /Read-only Google Ads tools/);
});

check("ADS-MCP-NODE-3 search GAQL finds Google Ads MCP Tools", () => {
  for (const query of ["GAQL", "Ads MCP", "Google Ads tools", "MCP Google Ads", "Google Ads search"]) {
    const r = searchNodes({ query, availability: "available" });
    assert.ok(r.some((node) => node.id === "google-ads-mcp-tools"), query);
  }
});

check("ADS-MCP-NODE-4/5 adding the card creates googleAdsMcpTool without a provider", () => {
  const node = adsMcp();
  assert.ok(node);
  assert.equal(resolveEngineType(node), "googleAdsMcpTool");
  assert.equal(node.preset, undefined);
  const data = applyLibraryNodePreset(
    {
      label: node.name,
      nodeType: resolveEngineType(node),
      toolId: "",
      params: {},
    },
    node
  );
  assert.equal(data.nodeType, "googleAdsMcpTool");
  assert.equal(data.toolId, "");
  assert.equal("provider" in data, false);
  assert.equal("credentialId" in data, false);
  assert.equal("googleAdsSourceNodeId" in data, false);
});

check("ADS-MCP-V2A-2/3 Google Ads Source appears only when several Google Ads nodes exist", () => {
  const one = googleAdsSourceFieldState(
    [{ id: "ads-1", type: "googleAds", data: { label: "Main" } }],
    ""
  );
  assert.equal(one.showSelector, false);
  assert.equal(one.message, null);
  const many = googleAdsSourceFieldState(
    [
      { id: "ads-a", type: "googleAds", data: { label: "Brand" } },
      { id: "ads-b", type: "googleAds", data: { label: "Retail" } },
    ],
    ""
  );
  assert.equal(many.showSelector, true);
  assert.deepEqual(
    many.sources.map((row) => `${row.label} (${row.id})`),
    ["Brand (ads-a)", "Retail (ads-b)"]
  );
  const none = googleAdsSourceFieldState([], "");
  assert.equal(none.message, "Add and configure a Google Ads node first.");
  const gone = googleAdsSourceFieldState(
    [{ id: "ads-1", type: "googleAds", data: { label: "Main" } }],
    "deleted"
  );
  assert.equal(gone.message, "The selected Google Ads source is no longer in this workflow.");
});

check("ADS-MCP-NODE-17 generic Dynamic MCP card is hidden", () => {
  const generic = nodeLibraryCatalog.nodes.find((node) => node.id === "mcp-dynamic-tool");
  assert.equal(generic?.hidden, true);
  assert.equal(generic?.engineType, "mcpDynamicTool");
  for (const availability of ["available", "all"] as const) {
    const r = searchNodes({ query: "Dynamic MCP Tool", availability });
    assert.equal(r.some((node) => node.id === "mcp-dynamic-tool"), false);
    const listed = searchNodes({ query: "", availability });
    assert.equal(listed.some((node) => node.id === "mcp-dynamic-tool"), false);
  }
});

check("ADS-MCP-NODE-14/18/19 native Ads, GA4 MCP, and GSC MCP cards stay", () => {
  const native = nodeLibraryCatalog.nodes.find((node) => node.id === "google-ads");
  assert.equal(native?.engineType, "googleAds");
  assert.equal(native?.name, "Google Ads");
  const ga4 = nodeLibraryCatalog.nodes.find((node) => node.id === "ga4-mcp-tools");
  assert.equal(ga4?.engineType, "ga4McpTool");
  assert.equal(ga4?.name, "GA4 MCP Tools");
  const gsc = nodeLibraryCatalog.nodes.find((node) => node.id === "gsc-mcp-tools");
  assert.equal(gsc?.engineType, "gscMcpTool");
  assert.equal(gsc?.name, "GSC MCP Tools");
});

check('typo "spredsheet" → Spreadsheet', () => {
  const r = searchNodes({ query: "spredsheet", availability: "available" });
  assert.ok(r.some((n) => /Spreadsheet/i.test(n.name)));
});

console.log(`\n${passed} node-search checks passed`);
