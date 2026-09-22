/**
 * Step 3 scaffold smoke — proves plugin loads, contracts, multi-select,
 * upstream entry, no Google API, envelope + identity rules.
 *
 * Run: node src/testing/smoke-scaffold.js
 *   or: npm test (from plugins/ga4-mcp)
 *   or: npm run test:ga4-mcp (from backend)
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pluginRoot = path.join(__dirname, "..", "..");
const srcRoot = path.join(pluginRoot, "src");

const {
  createPlugin,
  manifest,
  PROCESSOR_CAPABILITY_IDS,
  normalizeCapabilities,
  processUpstreamItems,
  FORBIDDEN_MODULES,
  FORBIDDEN_SOURCE_PATTERNS,
  capabilities,
  output,
  nodeSchema,
} = require("../index");

const fixtureRows = require("./fixtures/ga4-rows.json");

const asItems = (rows) => rows.map((json) => ({ json }));

const walkJsFiles = (dir, acc = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "testing") continue;
      walkJsFiles(full, acc);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      acc.push(full);
    }
  }
  return acc;
};

const main = () => {
  // 1. Plugin loads
  const plugin = createPlugin();
  assert.equal(plugin.manifest.id, "ga4-mcp");
  assert.equal(manifest.engineNodeType, "ga4McpTool");
  assert.equal(plugin.config.allowGoogleApi, false);
  assert.equal(plugin.config.allowOAuth, false);
  assert.equal(plugin.config.allowExternalMcp, false);
  assert.equal(typeof plugin.processUpstreamItems, "function");
  assert.equal(typeof plugin.close, "function");

  // 2. Node contract exists
  const contract = plugin.nodeContract();
  assert.equal(contract.type, "ga4McpTool");
  assert.equal(contract.authOnNode, false);
  assert.deepEqual(contract.credentialTypes, []);
  assert.equal(contract.rules.noGoogleApi, true);
  assert.equal(contract.rules.multiSelectIndependent, true);
  assert.equal(contract.rules.pagePerformanceIsData, true);
  const capsParam = contract.parameters.find((p) => p.name === "capabilities");
  assert.ok(capsParam);
  assert.equal(capsParam.type, "multiOptions");
  assert.equal(nodeSchema.NODE_TYPE, "ga4McpTool");

  // 3. All four capability IDs registered
  assert.deepEqual(
    [...PROCESSOR_CAPABILITY_IDS],
    [
      "engagement_opportunities",
      "landing_underperformance",
      "acquisition_concentration",
      "page_performance",
    ]
  );
  for (const id of PROCESSOR_CAPABILITY_IDS) {
    assert.ok(capabilities.CAPABILITY_DEFS[id], `missing def: ${id}`);
  }
  assert.equal(
    capabilities.CAPABILITY_DEFS.engagement_opportunities.implemented,
    true
  );
  assert.equal(
    capabilities.CAPABILITY_DEFS.landing_underperformance.implemented,
    true
  );
  assert.equal(
    capabilities.CAPABILITY_DEFS.acquisition_concentration.implemented,
    true
  );
  assert.equal(
    capabilities.CAPABILITY_DEFS.page_performance.implemented,
    true
  );

  // 4. Multi-select configuration accepted
  assert.deepEqual(
    normalizeCapabilities(
      undefined,
      [
        "engagement_opportunities",
        "acquisition_concentration",
        "page_performance",
      ]
    ),
    [
      "engagement_opportunities",
      "acquisition_concentration",
      "page_performance",
    ]
  );
  assert.deepEqual(normalizeCapabilities([], undefined), []);
  assert.deepEqual(normalizeCapabilities(undefined, undefined), [
    "engagement_opportunities",
  ]);

  // 5. Upstream rows can enter the processor
  const multi = processUpstreamItems({
    capabilities: [
      "engagement_opportunities",
      "acquisition_concentration",
      "page_performance",
    ],
    inputItems: asItems(fixtureRows),
  });
  assert.equal(multi.ok, true, multi.error?.message);
  assert.ok(multi.output.itemsIn >= 1);
  assert.ok(Array.isArray(multi.items));
  assert.ok(multi.items.length >= 3);

  // Empty upstream fails cleanly
  const empty = processUpstreamItems({
    capabilities: ["engagement_opportunities"],
    inputItems: [],
  });
  assert.equal(empty.ok, false);
  assert.equal(empty.error.code, "GA4_UPSTREAM_REQUIRED");

  // 6. No Google API / auth call in plugin source
  assert.equal(plugin.client, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(plugin, "client"), false);
  const jsFiles = walkJsFiles(srcRoot);
  assert.ok(jsFiles.length > 5, "expected plugin source files");
  for (const file of jsFiles) {
    const text = fs.readFileSync(file, "utf8");
    for (const mod of FORBIDDEN_MODULES) {
      assert.equal(
        text.includes(`require("${mod}")`) ||
          text.includes(`require('${mod}')`),
        false,
        `${file} must not require ${mod}`
      );
    }
    for (const re of FORBIDDEN_SOURCE_PATTERNS) {
      // allowlist.js defines patterns as source text — skip self-match on literals
      if (file.endsWith(`${path.sep}allowlist.js`)) continue;
      assert.equal(
        re.test(text),
        false,
        `${file} matched forbidden pattern ${re}`
      );
    }
  }

  // 7. Output envelope shape is valid
  assert.ok(Array.isArray(multi.output.capabilities));
  assert.ok(Array.isArray(multi.output.executed));
  assert.equal(typeof multi.output.count, "number");
  assert.ok(Array.isArray(multi.output.warnings));
  assert.deepEqual(multi.output.capabilities, [
    "engagement_opportunities",
    "acquisition_concentration",
    "page_performance",
  ]);
  assert.deepEqual(multi.output.executed, [
    "engagement_opportunities",
    "acquisition_concentration",
    "page_performance",
  ]);
  assert.equal(multi.output.count, multi.items.length);

  // 8. Capability identity preserved (no overwrite across multi-select)
  const byCap = {};
  for (const it of multi.items) {
    const row = it.json;
    assert.ok(row.capability, "every item must have capability");
    byCap[row.capability] = (byCap[row.capability] || 0) + 1;

    if (row.capability === "engagement_opportunities") {
      assert.equal(row.opportunity_type, "low_engagement");
      assert.notEqual(row.opportunity_type, "landing_underperformance");
    }
    if (row.capability === "acquisition_concentration") {
      assert.equal(row.opportunity_type, "acquisition_concentration");
    }
    if (row.capability === "landing_underperformance") {
      assert.equal(row.opportunity_type, "landing_underperformance");
    }
  }
  assert.ok(
    (byCap.engagement_opportunities || 0) >= 1,
    "expected at least one engagement opportunity from fixture rows"
  );
  assert.equal(byCap.acquisition_concentration, 1);
  assert.ok(
    (byCap.page_performance || 0) >= 1,
    "expected at least one page_performance DATA row"
  );

  // Stamp helper must force identity
  const stamped = output.stampItemIdentity(
    {
      capability: "acquisition_concentration",
      opportunity_type: "acquisition_concentration",
    },
    "engagement_opportunities"
  );
  assert.equal(stamped.capability, "engagement_opportunities");
  assert.equal(stamped.opportunity_type, "low_engagement");

  // 9. page_performance is marked as DATA
  const pageItem = multi.items.find(
    (it) => it.json.capability === "page_performance"
  );
  assert.ok(pageItem, "expected page_performance item");
  assert.equal(pageItem.json.row_kind, "ranked_page");
  assert.equal(pageItem.json.opportunity_type, null);
  assert.equal(pageItem.json.score, undefined);
  assert.equal(pageItem.json.recommendation, undefined);
  assert.equal(pageItem.json.reason, undefined);
  assert.equal(typeof pageItem.json.rank, "number");
  assert.equal(
    capabilities.CAPABILITY_DEFS.page_performance.category,
    "data"
  );
  assert.equal(
    capabilities.CAPABILITY_DEFS.page_performance.inventsScore,
    false
  );
  const dataErrors = output.validateDataPageItemShape(pageItem.json);
  assert.deepEqual(dataErrors, []);

  // All four together still preserve identity
  const allFour = processUpstreamItems({
    capabilities: [...PROCESSOR_CAPABILITY_IDS],
    inputItems: asItems(fixtureRows),
  });
  assert.equal(allFour.ok, true);
  assert.equal(allFour.output.executed.length, 4);
  const types = new Set(
    allFour.items
      .filter((it) => it.json.capability !== "page_performance")
      .map((it) => it.json.opportunity_type)
  );
  assert.ok(types.has("low_engagement"));
  assert.ok(types.has("landing_underperformance"));
  assert.ok(types.has("acquisition_concentration"));

  console.log("ga4-mcp smoke-scaffold: OK");
  console.log(
    JSON.stringify(
      {
        capabilities: multi.output.capabilities,
        executed: multi.output.executed,
        count: multi.output.count,
        warningCodes: (multi.output.warnings || []).map((w) => w.code),
      },
      null,
      2
    )
  );
};

main();
