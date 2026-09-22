/**
 * STEP 7 regression: page_performance (DATA) only.
 */
const assert = require("node:assert/strict");
const {
  processUpstreamItems,
  capabilities,
  filters: filterContract,
  output,
} = require("../index");
const {
  pagePerformance,
  CAPABILITY_ID,
  ROW_KIND,
  RANKING_METRICS,
} = require("../capabilities/pagePerformance");

const FIX = require("./fixtures/page-performance-rows.json");

const asItems = (rows) => rows.map((json) => ({ json }));

const runPage = (rows, opts = {}) =>
  processUpstreamItems({
    capabilities: opts.capabilities || ["page_performance"],
    inputItems: asItems(Array.isArray(rows) ? rows : [rows]),
    filters: opts.filters,
    nodeData: opts.nodeData,
  });

const pageItems = (result) =>
  (result.items || []).filter(
    (it) => it.json.capability === "page_performance"
  );

const assertDataShape = (row) => {
  assert.equal(row.capability, "page_performance");
  assert.equal(row.row_kind, "ranked_page");
  assert.equal(row.opportunity_type, null);
  assert.equal(row.score, undefined);
  assert.equal(row.score_breakdown, undefined);
  assert.equal(row.recommendation, undefined);
  assert.equal(row.reason, undefined);
  assert.equal(typeof row.rank, "number");
  assert.ok(row.entity && row.entity.label);
  assert.ok(row.metrics && typeof row.metrics === "object");
  const errs = output.validateDataPageItemShape(row);
  assert.deepEqual(errs, []);
};

const main = () => {
  assert.equal(CAPABILITY_ID, "page_performance");
  assert.equal(ROW_KIND, "ranked_page");
  assert.equal(
    capabilities.CAPABILITY_DEFS.page_performance.implemented,
    true
  );
  assert.equal(
    capabilities.TOOL_LABELS.page_performance,
    "Page Performance"
  );
  assert.ok(RANKING_METRICS.includes("sessions"));

  // ---- A. pagePath + sessions, default rank desc ----
  {
    const result = runPage(FIX.A_sessions_only);
    assert.equal(result.ok, true);
    assert.equal(result.output.count, 3);
    const items = pageItems(result);
    assertDataShape(items[0].json);
    assert.equal(items[0].json.entity.pagePath, "/");
    assert.equal(items[0].json.rank, 1);
    assert.equal(items[0].json.metrics.sessions, 2000);
    assert.equal(items[0].json.sortMetric, "sessions");
    assert.equal(items[0].json.sortDirection, "desc");
    assert.equal(items[1].json.entity.pagePath, "/pricing");
    assert.equal(items[2].json.entity.pagePath, "/blog");
  }

  // ---- B. multi metrics fidelity ----
  {
    const result = runPage(FIX.B_multi_metrics);
    const top = pageItems(result)[0].json;
    assert.equal(top.entity.pagePath, "/docs");
    assert.equal(top.metrics.sessions, 1200);
    assert.equal(top.metrics.totalUsers, 1000);
    assert.equal(top.metrics.screenPageViews, 2400);
    assert.equal(top.metrics.engagementRate, 0.61);
    assert.equal(top.metrics.bounceRate, 0.3);
    assert.equal("score" in top, false);
  }

  // ---- C. landingPage fallback ----
  {
    const result = runPage(FIX.C_landing_fallback);
    assert.equal(result.output.count, 2);
    const top = pageItems(result)[0].json;
    assert.equal(top.entity.landingPage, "/lp/webinar");
    assert.equal(top.entity.label, "/lp/webinar");
    assert.equal("pagePath" in top.entity, false);
  }

  // ---- D. missing page dimension ----
  {
    const result = runPage(FIX.D_missing_page_dim);
    assert.equal(result.output.count, 0);
    assert.ok(
      (result.output.warnings || []).some((w) => w.code === "GA4_DIMS_MISSING")
    );
  }

  // ---- E. missing metrics ----
  {
    const result = runPage(FIX.E_missing_metrics);
    assert.equal(result.output.count, 0);
    assert.ok(
      (result.output.warnings || []).some(
        (w) => w.code === "GA4_METRICS_MISSING"
      )
    );
  }

  // ---- F. eventName: row-level, no cross-sum ----
  {
    const result = runPage(FIX.F_event_name);
    assert.ok(
      (result.output.warnings || []).some(
        (w) => w.code === "GA4_EVENT_CROSS_METRIC_RISK"
      )
    );
    const items = pageItems(result);
    assert.equal(items.length, 3);
    const pricing = items.filter(
      (it) => it.json.entity.pagePath === "/pricing"
    );
    assert.equal(pricing.length, 2);
    const sessSum = pricing.reduce(
      (s, it) => s + it.json.metrics.sessions,
      0
    );
    // Must not collapse into one fabricated 700-session page
    assert.equal(
      items.some((it) => it.json.metrics.sessions === 700),
      false
    );
    assert.equal(sessSum, 700);
    for (const it of pricing) {
      assert.ok([500, 200].includes(it.json.metrics.sessions));
    }
  }

  // ---- G. ranking by screenPageViews ----
  {
    const result = runPage(FIX.G_views_rank, {
      filters: { sortMetric: "screenPageViews", sortDirection: "desc" },
    });
    const labels = pageItems(result).map((it) => it.json.entity.label);
    assert.deepEqual(labels, ["/a", "/c", "/b"]);
  }

  // ---- H. ascending ----
  {
    const result = runPage(FIX.A_sessions_only, {
      filters: { sortMetric: "sessions", sortDirection: "asc" },
    });
    const sessions = pageItems(result).map((it) => it.json.metrics.sessions);
    assert.deepEqual(sessions, [400, 850, 2000]);
  }

  // ---- I. descending (explicit) ----
  {
    const result = runPage(FIX.A_sessions_only, {
      filters: { sortMetric: "sessions", sortDirection: "desc" },
    });
    const sessions = pageItems(result).map((it) => it.json.metrics.sessions);
    assert.deepEqual(sessions, [2000, 850, 400]);
  }

  // ---- J. equal values → label asc tie-break ----
  {
    const result = runPage(FIX.J_equal_sessions);
    const labels = pageItems(result).map((it) => it.json.entity.label);
    assert.deepEqual(labels, ["/aaa-page", "/mmm-page", "/zzz-page"]);
  }

  // ---- K. filter removes rows ----
  {
    const result = runPage(FIX.K_filter_rows, {
      filters: { minSessions: 100, sortMetric: "sessions" },
    });
    const labels = pageItems(result).map((it) => it.json.entity.label);
    assert.equal(labels.includes("/small"), false);
    assert.ok(labels.includes("/big"));
    assert.ok(labels.includes("/mid"));
  }

  // ---- limit ----
  {
    const result = runPage(FIX.A_sessions_only, {
      filters: { limit: 1 },
    });
    assert.equal(result.output.count, 1);
    assert.equal(pageItems(result)[0].json.entity.pagePath, "/");
  }

  // ---- unavailable ranking metric ----
  {
    const result = runPage(FIX.A_sessions_only, {
      filters: { sortMetric: "bounceRate" },
    });
    assert.equal(result.output.count, 0);
    assert.ok(
      (result.output.warnings || []).some(
        (w) => w.code === "GA4_METRIC_UNAVAILABLE"
      )
    );
  }

  // ---- invalid filter ----
  {
    const bad = runPage(FIX.A_sessions_only, {
      filters: { sortDirection: "sideways" },
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.error.code, "GA4_VALIDATION");
  }

  // ---- L. empty upstream ----
  {
    const result = runPage([]);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "GA4_UPSTREAM_REQUIRED");
  }

  // ---- M. malformed ----
  {
    const result = processUpstreamItems({
      capabilities: ["page_performance"],
      inputItems: [
        { json: "bad" },
        { json: { pagePath: "/ok", sessions: 100 } },
        { json: [1, 2] },
      ],
    });
    assert.equal(result.ok, true);
    assert.equal(result.output.count, 1);
    assert.ok(
      (result.output.warnings || []).some((w) => w.code === "GA4_MALFORMED_ROWS")
    );
  }

  // ---- filter isolation ----
  {
    const keys = filterContract.extractFiltersFromNodeData("page_performance", {
      sortMetric: "totalUsers",
      minShare: 0.9,
      maxEngagementRate: 0.1,
      minSessions: 10,
    });
    assert.equal("minShare" in keys, false);
    assert.equal("maxEngagementRate" in keys, false);
    assert.equal(keys.sortMetric, "totalUsers");
  }

  // ---- N. multi-capability identity ----
  {
    const shared = [
      {
        pagePath: "/pricing",
        landingPage: "/pricing",
        sessions: 1200,
        engagementRate: 0.18,
        screenPageViews: 1300,
        bounceRate: 0.7,
      },
      {
        sessionDefaultChannelGroup: "Organic Search",
        sessions: 4000,
      },
      {
        sessionDefaultChannelGroup: "Direct",
        sessions: 1000,
      },
    ];

    const eng = processUpstreamItems({
      capabilities: ["engagement_opportunities", "page_performance"],
      inputItems: asItems(shared),
    });
    for (const it of eng.items) {
      if (it.json.capability === "page_performance") {
        assertDataShape(it.json);
      }
      if (it.json.capability === "engagement_opportunities") {
        assert.equal(it.json.opportunity_type, "low_engagement");
      }
    }

    const land = processUpstreamItems({
      capabilities: ["landing_underperformance", "page_performance"],
      inputItems: asItems(shared),
    });
    assert.ok(
      land.items.some((it) => it.json.capability === "landing_underperformance")
    );
    assert.ok(
      land.items.some((it) => it.json.capability === "page_performance")
    );

    const acq = processUpstreamItems({
      capabilities: ["acquisition_concentration", "page_performance"],
      inputItems: asItems(shared),
    });
    assert.ok(
      acq.items.some(
        (it) => it.json.capability === "acquisition_concentration"
      )
    );
    assert.ok(
      acq.items.some((it) => it.json.capability === "page_performance")
    );

    const all = processUpstreamItems({
      capabilities: [
        "engagement_opportunities",
        "landing_underperformance",
        "acquisition_concentration",
        "page_performance",
      ],
      inputItems: asItems(shared),
    });
    assert.deepEqual(all.output.executed, [
      "engagement_opportunities",
      "landing_underperformance",
      "acquisition_concentration",
      "page_performance",
    ]);
    const page = pageItems(all);
    assert.ok(page.length >= 1);
    for (const it of page) assertDataShape(it.json);
  }

  // ---- Direct defaults ----
  {
    const direct = pagePerformance({
      rows: FIX.A_sessions_only,
      filters: {},
    });
    assert.equal(direct.implemented, true);
    assert.equal(direct.scaffold, false);
    assert.equal(direct.filters.sortMetric, "sessions");
    assert.equal(direct.filters.sortDirection, "desc");
    assert.equal(direct.filters.limit, 50);
    assert.equal(direct.rows[0].rank, 1);
    assert.equal(direct.rows[0].opportunity_type, null);
  }

  console.log("ga4-mcp smoke-page-performance: OK");
};

main();
