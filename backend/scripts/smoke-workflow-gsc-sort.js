/**
 * GSC Search Analytics canonical ordering.
 * Metric-first hierarchical sort — not API clicks/query order.
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const QA_FIXTURE = Object.freeze([
  {
    query: "aerospace seo consultants",
    ctr: 0,
    clicks: 0,
    position: 54,
    impressions: 1,
  },
  {
    query: "affordable seo for hvac",
    ctr: 0,
    clicks: 0,
    position: 50.5,
    impressions: 2,
  },
  {
    query: "affordable seo for hvac contractors",
    ctr: 0,
    clicks: 0,
    position: 37.5,
    impressions: 4,
  },
  {
    query: "ai google penalty recovery agent",
    ctr: 0,
    clicks: 0,
    position: 48.1,
    impressions: 30,
  },
  {
    query: "airline seo",
    ctr: 0,
    clicks: 0,
    position: 30,
    impressions: 1,
  },
  {
    query: "airlines seo",
    ctr: 0,
    clicks: 0,
    position: 33.8,
    impressions: 5,
  },
]);

const QA_EXPECTED = Object.freeze([
  "ai google penalty recovery agent",
  "airlines seo",
  "affordable seo for hvac contractors",
  "affordable seo for hvac",
  "airline seo",
  "aerospace seo consultants",
]);

const registerGscSortTests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("GSC result ordering (metric-first)");

  const sortMod = () => require("../services/gscPerformanceSort");
  const nodes = () => require("../services/workflowNodes.service");
  const oauth = () => require("../services/googleOAuth.service");
  const expr = () => require("../services/workflowNodes.service");
  const mcp = () => require("../../plugins/gsc-mcp/src/adapters/workflowNode");

  const read = (rel) => fs.readFileSync(path.join(__dirname, rel), "utf8");

  const queriesOf = (rows) =>
    rows.map((row) => (row.json && row.json.query != null ? row.json.query : row.query));

  const mockCred = () => ({
    id: "c1",
    type: "google_gsc",
    workspaceId: "ws-1",
    name: "gsc",
    secret: {
      accessToken: "tok-live",
      refreshToken: "ref-live",
      expiryMs: Date.now() + 3600_000,
    },
  });

  const execGsc = async (apiRows, data = {}) => {
    const store = new Map();
    store.set("c1", mockCred());
    return oauth().withGoogleOAuthTestHooks(
      {
        transport: async () => ({
          status: 200,
          ok: true,
          body: { rows: apiRows },
        }),
        now: () => Date.now(),
        credentialResolver: (id) => store.get(id),
      },
      async () =>
        nodes().executeNode(
          {
            id: "gsc",
            type: "googleSearchConsole",
            data: {
              label: "GSC",
              credentialId: "c1",
              siteUrl: "https://example.com/",
              ...data,
            },
          },
          { input: {}, steps: {}, workspaceId: "ws-1", workflowId: "wf-1" }
        )
    );
  };

  const apiFromFixture = (rows) =>
    rows.map((row) => ({
      keys: [row.query || row.page || row.country || row.device || row.searchAppearance || row.date],
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
    }));

  check("GSC-SORT-1 CTR sorts DESC", () => {
    const sorted = sortMod().sortGscPerformanceRows([
      { query: "low", ctr: 0.1, impressions: 1, clicks: 1, position: 5 },
      { query: "high", ctr: 0.9, impressions: 1, clicks: 1, position: 5 },
    ]);
    assertX.deepEqual(queriesOf(sorted), ["high", "low"]);
  });

  check("GSC-SORT-2 Higher CTR always beats lower CTR regardless of impressions", () => {
    const sorted = sortMod().sortGscPerformanceRows([
      { query: "low impressions high ctr", ctr: 0.5, impressions: 5, clicks: 1, position: 20 },
      { query: "huge impressions lower ctr", ctr: 0.4, impressions: 10000, clicks: 500, position: 1 },
    ]);
    assertX.equal(sorted[0].query, "low impressions high ctr");
  });

  check("GSC-SORT-3 Equal CTR → impressions DESC", () => {
    const sorted = sortMod().sortGscPerformanceRows(QA_FIXTURE.slice());
    assertX.deepEqual(queriesOf(sorted), QA_EXPECTED.slice());
  });

  check("GSC-SORT-4 Equal CTR + impressions → clicks DESC", () => {
    const sorted = sortMod().sortGscPerformanceRows([
      { query: "a", ctr: 0.2, impressions: 100, clicks: 2, position: 1 },
      { query: "b", ctr: 0.2, impressions: 100, clicks: 7, position: 50 },
    ]);
    assertX.deepEqual(queriesOf(sorted), ["b", "a"]);
  });

  check("GSC-SORT-5 Equal CTR + impressions + clicks → position ASC", () => {
    const sorted = sortMod().sortGscPerformanceRows([
      { query: "aerospace seo consultants", ctr: 0, impressions: 1, clicks: 0, position: 54 },
      { query: "airline seo", ctr: 0, impressions: 1, clicks: 0, position: 30 },
    ]);
    assertX.deepEqual(queriesOf(sorted), ["airline seo", "aerospace seo consultants"]);
  });

  check("GSC-SORT-6 Fully equal metrics → dimension/query ASC final tie-breaker", () => {
    const sorted = sortMod().sortGscPerformanceRows([
      { query: "zeta", ctr: 0.1, impressions: 10, clicks: 1, position: 4 },
      { query: "alpha", ctr: 0.1, impressions: 10, clicks: 1, position: 4 },
    ]);
    assertX.deepEqual(queriesOf(sorted), ["alpha", "zeta"]);
  });

  check("GSC-SORT-7 Position 1.9 ranks above position 12 when earlier metrics are tied", () => {
    const sorted = sortMod().sortGscPerformanceRows([
      { query: "later", ctr: 0.1, impressions: 10, clicks: 1, position: 12 },
      { query: "earlier", ctr: 0.1, impressions: 10, clicks: 1, position: 1.9 },
    ]);
    assertX.deepEqual(queriesOf(sorted), ["earlier", "later"]);
  });

  check("GSC-SORT-8 High impressions must not override higher CTR", () => {
    const sorted = sortMod().sortGscPerformanceRows([
      { query: "A", ctr: 0.5, impressions: 10, clicks: 1, position: 20 },
      { query: "B", ctr: 0.4, impressions: 1000, clicks: 1, position: 2 },
      { query: "C", ctr: 0.4, impressions: 5000, clicks: 1, position: 2 },
      { query: "D", ctr: 0.2, impressions: 9000, clicks: 1, position: 1 },
    ]);
    assertX.deepEqual(queriesOf(sorted), ["A", "C", "B", "D"]);
  });

  check("GSC-SORT-9 Better position must not override higher clicks when earlier metrics are tied", () => {
    const sorted = sortMod().sortGscPerformanceRows([
      { query: "a", ctr: 0.2, impressions: 100, clicks: 2, position: 1 },
      { query: "b", ctr: 0.2, impressions: 100, clicks: 7, position: 50 },
    ]);
    assertX.equal(sorted[0].query, "b");
  });

  check("GSC-SORT-10 Numeric-looking strings compare numerically", () => {
    const sorted = sortMod().sortGscPerformanceRows([
      { query: "twenty", ctr: "0", impressions: "20", clicks: "0", position: "10" },
      { query: "hundred", ctr: "0", impressions: "100", clicks: "0", position: "10" },
    ]);
    assertX.deepEqual(queriesOf(sorted), ["hundred", "twenty"]);
  });

  check("GSC-SORT-11 Missing numeric values handled deterministically", () => {
    const sorted = sortMod().sortGscPerformanceRows([
      { query: "missing", ctr: 0, impressions: 10, clicks: 0, position: null },
      { query: "present", ctr: 0, impressions: 10, clicks: 0, position: 8 },
    ]);
    assertX.deepEqual(queriesOf(sorted), ["present", "missing"]);
    assertX.equal(sorted[0].position, 8);
    assertX.equal(sorted[1].position, null);
  });

  check("GSC-SORT-12 Sorting does not mutate any metric values", () => {
    const original = QA_FIXTURE.map((row) => ({ ...row }));
    const snapshot = JSON.parse(JSON.stringify(original));
    const sorted = sortMod().sortGscPerformanceRows(original);
    assertX.deepEqual(original, snapshot);
    assertX.equal(sorted[0].ctr, 0);
    assertX.equal(sorted[0].impressions, 30);
    const precise = [{ query: "x", ctr: 0.16666666666666666, impressions: 12, clicks: 2, position: 1.91 }];
    const after = sortMod().sortGscPerformanceRows(precise);
    assertX.equal(after[0].ctr, 0.16666666666666666);
  });

  check("GSC-SORT-13 WorkflowItem order equals canonical sorted order", async () => {
    const result = await execGsc(apiFromFixture(QA_FIXTURE));
    assertX.deepEqual(
      result.items.map((item) => item.json.query),
      QA_EXPECTED.slice()
    );
  });

  check("GSC-SORT-14 $first receives the highest-priority row", async () => {
    const result = await execGsc(apiFromFixture(QA_FIXTURE));
    const value = expr().resolveExpression("{{steps.gsc.$first.query}}", {
      items: { gsc: result.items },
      steps: {},
      graph: { nodes: [{ id: "gsc" }, { id: "next" }], edges: [{ source: "gsc", target: "next" }] },
      currentNodeId: "next",
      currentItemIndex: 0,
    });
    assertX.equal(value, "ai google penalty recovery agent");
  });

  check("GSC-SORT-15 OpsAi-side Top N/limit occurs after sorting", () => {
    const limited = sortMod().sortGscPerformanceRows(QA_FIXTURE.slice(), { limit: 3 });
    assertX.deepEqual(queriesOf(limited), QA_EXPECTED.slice(0, 3));
    assertX.equal(limited.includes(QA_FIXTURE[0]), false);
  });

  check("GSC-SORT-16 native GSC uses canonical comparator", async () => {
    const result = await execGsc(apiFromFixture(QA_FIXTURE), { operation: "getQueries" });
    assertX.deepEqual(
      result.items.map((item) => item.json.query),
      QA_EXPECTED.slice()
    );
    const src = read("../services/workflowGoogleNodes.service.js");
    assertX.match(src, /sortGscPerformanceRows/);
    assertX.equal(/orderBy/.test(src.slice(src.indexOf("const gscQuery"), src.indexOf("const parseList"))), false);
  });

  check("GSC-SORT-17 equivalent GSC MCP Search Analytics output uses same comparator", () => {
    const shaped = mcp().resultToWorkflowItems({
      ok: true,
      toolId: "get_search_analytics",
      data: { rows: apiFromFixture(QA_FIXTURE) },
    });
    assertX.deepEqual(
      shaped.items.map((item) => item.json.query),
      QA_EXPECTED.slice()
    );
    const native = sortMod().sortGscPerformanceRows(QA_FIXTURE.slice());
    assertX.deepEqual(
      shaped.items.map((item) => item.json.query),
      native.map((row) => row.query)
    );
  });

  check("GSC-SORT-18 Top Pages uses same metric priority with page as final tie-breaker", async () => {
    const pages = [
      { page: "/zeta", ctr: 0, impressions: 2, clicks: 0, position: 10 },
      { page: "/alpha", ctr: 0, impressions: 30, clicks: 0, position: 10 },
      { page: "/mid", ctr: 0, impressions: 2, clicks: 0, position: 10 },
    ];
    const result = await execGsc(
      pages.map((row) => ({
        keys: [row.page],
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
      })),
      { operation: "getPages" }
    );
    assertX.deepEqual(
      result.items.map((item) => item.json.page),
      ["/alpha", "/mid", "/zeta"]
    );
    assertX.equal(result.items[0].json.query, undefined);
  });

  check("GSC-SORT-19 date/time-series report remains chronological", () => {
    const sorted = sortMod().sortGscPerformanceRows(
      [
        { date: "2026-10-03", ctr: 0.9, impressions: 9, clicks: 9, position: 1 },
        { date: "2026-10-01", ctr: 0.1, impressions: 1, clicks: 1, position: 9 },
        { date: "2026-10-02", ctr: 0.5, impressions: 5, clicks: 5, position: 5 },
      ],
      { dimensionKey: "date" }
    );
    assertX.deepEqual(
      sorted.map((row) => row.date),
      ["2026-10-01", "2026-10-02", "2026-10-03"]
    );
    const schema = read("../../frontend/src/modules/workflows/nodeParameterSchemas.ts");
    const gscBlock = schema.slice(
      schema.indexOf("googleSearchConsole: ["),
      schema.indexOf("gscMcp: [")
    );
    assertX.match(gscBlock, /getQueries/);
    assertX.match(gscBlock, /getPages/);
    assertX.equal(/value:\s*"date"/.test(gscBlock), false);
    assertX.equal(gscBlock.includes("Get Dates"), false);
  });

  check("GSC-SORT-20 URL inspection tools unaffected", () => {
    const inspection = {
      inspectionUrl: "https://example.com/page",
      indexStatus: "Submitted and indexed",
      lastCrawl: "2026-09-01T00:00:00Z",
    };
    const shaped = mcp().resultToWorkflowItems({
      ok: true,
      toolId: "inspect_url_enhanced",
      data: inspection,
    });
    assertX.equal(shaped.items.length, 1);
    assertX.equal(shaped.items[0].json.inspectionUrl, inspection.inspectionUrl);
    assertX.equal(shaped.items[0].json.indexStatus, inspection.indexStatus);
    assertX.equal(sortMod().shouldSortGscMcpResult({ toolId: "inspect_url_enhanced" }, [inspection]), false);
  });

  check("GSC-SORT-21 pinned data mechanism unchanged", () => {
    const occ = read("../../frontend/src/modules/workflows/occurrenceView.ts");
    assertX.match(occ, /pinnedItems/);
    assertX.match(occ, /stepItems\[nodeId\] = pinnedNode!\.data!\.pinnedItems/);
    assertX.equal(occ.includes("sortGscPerformanceRows"), false);
    const google = read("../services/workflowGoogleNodes.service.js");
    assertX.equal(google.includes("pinnedItems"), false);
  });

  check("GSC-SORT-22 frontend default Table preserves canonical WorkflowItem order", () => {
    const src = read("../../frontend/src/modules/workflows/inspectorViewModel.ts");
    const tableFn = src.slice(src.indexOf("export function buildDisplayTable"), src.indexOf("function truncateText"));
    assertX.match(tableFn, /canonical\.map/);
    assertX.equal(tableFn.includes(".sort("), false);
  });

  check("GSC-SORT-23 JSON view preserves same row/item order", () => {
    const src = read("../../frontend/src/modules/workflows/inspectorViewModel.ts");
    const jsonFn = src.slice(
      src.indexOf("export function canonicalJsonForView"),
      src.indexOf("export function inferSchemaKind")
    );
    assertX.match(jsonFn, /canonical\.map\(\(item\) => item\.json/);
    assertX.equal(jsonFn.includes(".sort("), false);
    assertX.equal(/sortBy|orderBy/.test(read("../../frontend/src/modules/workflows/nodeParameterSchemas.ts").slice(
      read("../../frontend/src/modules/workflows/nodeParameterSchemas.ts").indexOf("googleSearchConsole: ["),
      read("../../frontend/src/modules/workflows/nodeParameterSchemas.ts").indexOf("gscMcp: [")
    )), false);
  });
};

module.exports = { registerGscSortTests };

if (require.main === module) {
  const assertX = assert;
  let passed = 0;
  const queue = [];
  const check = (name, fn) => {
    queue.push(async () => {
      try {
        await fn();
        passed += 1;
        console.log(`  ok  ${name}`);
      } catch (err) {
        console.error(`FAIL  ${name}\n      ${err.message}`);
        process.exitCode = 1;
      }
    });
  };
  registerGscSortTests({
    check,
    section: (name) => queue.push(async () => console.log(`\n${name}`)),
    assert: assertX,
  });
  (async () => {
    for (const task of queue) await task();
    console.log(`\n${passed} checks passed`);
    process.exit(process.exitCode || 0);
  })();
}
