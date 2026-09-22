/**
 * STEP 4 regression: engagement_opportunities only.
 * Run via: npm run test:ga4-mcp (backend) or npm test (plugins/ga4-mcp)
 */
const assert = require("node:assert/strict");
const {
  processUpstreamItems,
  capabilities,
  filters: filterContract,
} = require("../index");
const {
  engagementOpportunities,
  SCORE_FORMULA,
  scoreEngagementOpportunity,
  CAPABILITY_ID,
  OPPORTUNITY_TYPE,
} = require("../capabilities/engagementOpportunities");

const FIX = require("./fixtures/engagement-rows.json");

const asItems = (rows) =>
  rows.map((json) =>
    json && typeof json === "object" && !Array.isArray(json)
      ? { json }
      : { json }
  );

const runEngagement = (rows, opts = {}) =>
  processUpstreamItems({
    capabilities: opts.capabilities || ["engagement_opportunities"],
    inputItems: asItems(rows),
    filters: opts.filters,
    nodeData: opts.nodeData,
  });

const main = () => {
  assert.equal(CAPABILITY_ID, "engagement_opportunities");
  assert.equal(OPPORTUNITY_TYPE, "low_engagement");
  assert.equal(
    capabilities.CAPABILITY_DEFS.engagement_opportunities.implemented,
    true
  );
  assert.equal(
    capabilities.TOOL_LABELS.engagement_opportunities,
    "Engagement Opportunities"
  );

  // ---- A. High traffic + weak engagement → opportunity ----
  {
    const result = runEngagement([FIX.A_high_traffic_weak]);
    assert.equal(result.ok, true);
    assert.equal(result.output.count, 1);
    const row = result.items[0].json;
    assert.equal(row.capability, "engagement_opportunities");
    assert.equal(row.opportunity_type, "low_engagement");
    assert.equal(row.entity.pagePath, "/pricing");
    assert.equal(row.entity.label, "/pricing");
    assert.equal(row.metrics.sessions, 1200);
    assert.equal(row.metrics.engagementRate, 0.18);
    assert.equal(row.metrics.totalUsers, 980);
    assert.equal(row.metrics.screenPageViews, 1500);
    assert.equal("bounceRate" in row.metrics, false);
    assert.match(row.reason, /\/pricing/);
    assert.match(row.reason, /1,200 sessions/);
    assert.match(row.reason, /18%/);
    assert.doesNotMatch(row.reason, /dislike|stale|confused|intent/i);
    assert.match(row.recommendation, /\/pricing/);
    assert.doesNotMatch(row.recommendation, /title\/meta|SEO strategy/i);
    assert.equal(typeof row.score, "number");
    assert.equal(row.score_breakdown.formula, SCORE_FORMULA);
    const expected = scoreEngagementOpportunity({
      sessions: 1200,
      engagementRate: 0.18,
      bounceRate: null,
    });
    assert.equal(row.score, expected.score);
    assert.equal(row.score, 32); // min(1,1.2)*max(0.32,0)*100
  }

  // ---- B. High traffic + healthy → no opportunity ----
  {
    const result = runEngagement([FIX.B_high_traffic_healthy]);
    assert.equal(result.ok, true);
    assert.equal(result.output.count, 0);
    assert.ok(
      (result.output.warnings || []).some((w) => w.code === "GA4_NO_MATCHES")
    );
  }

  // ---- C. Low traffic + weak → filtered out ----
  {
    const result = runEngagement([FIX.C_low_traffic_weak]);
    assert.equal(result.ok, true);
    assert.equal(result.output.count, 0);
  }

  // ---- D. Missing ER, valid bounce → evaluates ----
  {
    const result = runEngagement([FIX.D_bounce_only]);
    assert.equal(result.ok, true);
    assert.equal(result.output.count, 1);
    const row = result.items[0].json;
    assert.equal(row.metrics.bounceRate, 0.72);
    assert.equal("engagementRate" in row.metrics, false);
    assert.match(row.reason, /bounce rate of 72%/);
    // volume=0.8, bounceGap=0.22, score=17.6
    assert.equal(row.score, 17.6);
  }

  // ---- E. Missing both engagement signals → warning ----
  {
    const result = runEngagement([FIX.E_missing_engagement_signals]);
    assert.equal(result.ok, true);
    assert.equal(result.output.count, 0);
    const warn = (result.output.warnings || []).find(
      (w) =>
        w.code === "GA4_METRICS_MISSING" &&
        String(w.message || "").includes("engagementRate or bounceRate")
    );
    assert.ok(warn, "expected missing engagement-signal warning");
    assert.equal(warn.capability, "engagement_opportunities");
    assert.ok(Array.isArray(warn.requiredMetrics));
    assert.ok(Array.isArray(warn.availableMetrics));
    assert.ok(warn.availableMetrics.includes("sessions"));
    assert.equal(warn.availableMetrics.includes("engagementRate"), false);
  }

  // ---- F. Missing sessions → warning ----
  {
    const result = runEngagement([FIX.F_missing_sessions]);
    assert.equal(result.ok, true);
    assert.equal(result.output.count, 0);
    const warn = (result.output.warnings || []).find(
      (w) =>
        w.code === "GA4_METRICS_MISSING" &&
        String(w.message || "").includes("requires sessions")
    );
    assert.ok(warn, "expected missing sessions warning");
    assert.equal(warn.capability, "engagement_opportunities");
  }

  // ---- G. Multiple pages → deterministic ordering (score desc) ----
  {
    const result = runEngagement([
      FIX.G_multi_c,
      FIX.G_multi_a,
      FIX.G_multi_b,
      FIX.B_high_traffic_healthy,
      FIX.C_low_traffic_weak,
    ]);
    assert.equal(result.ok, true);
    assert.ok(result.output.count >= 2);
    const labels = result.items.map((it) => it.json.entity.label);
    const scores = result.items.map((it) => it.json.score);
    for (let i = 1; i < scores.length; i += 1) {
      assert.ok(
        scores[i - 1] >= scores[i],
        `scores not desc: ${scores.join(",")}`
      );
    }
    // Highest should be /blog/old-guide (1400 sess, ER 0.18 → 32)
    assert.equal(labels[0], "/blog/old-guide");
    assert.equal(scores[0], 32);
  }

  // ---- H. Equal scores → tie-break by label asc (sessions equal) ----
  {
    const result = runEngagement([FIX.H_tie_zzz, FIX.H_tie_aaa], {
      filters: { minSessions: 100, maxEngagementRate: 0.4, minScore: 0 },
    });
    assert.equal(result.output.count, 2);
    assert.equal(result.items[0].json.score, result.items[1].json.score);
    assert.equal(result.items[0].json.entity.label, "/aaa-equal");
    assert.equal(result.items[1].json.entity.label, "/zzz-equal");
  }

  // ---- Percent rate normalization (25 → 0.25) ----
  {
    const result = runEngagement([FIX.percent_rates], {
      filters: { minSessions: 100, maxEngagementRate: 0.4 },
    });
    assert.equal(result.output.count, 1);
    assert.equal(result.items[0].json.metrics.engagementRate, 0.25);
    assert.equal(result.items[0].json.metrics.bounceRate, 0.7);
  }

  // ---- Empty upstream ----
  {
    const result = runEngagement([]);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "GA4_UPSTREAM_REQUIRED");
  }

  // ---- Malformed rows (skipped; valid rows still process) ----
  {
    const result = processUpstreamItems({
      capabilities: ["engagement_opportunities"],
      inputItems: [
        { json: "not-an-object" },
        null,
        { json: FIX.A_high_traffic_weak },
        { json: [1, 2, 3] },
      ],
    });
    assert.equal(result.ok, true);
    assert.equal(result.output.count, 1);
    assert.equal(result.items[0].json.entity.pagePath, "/pricing");
    assert.ok(
      (result.output.warnings || []).some((w) => w.code === "GA4_MALFORMED_ROWS")
    );
  }

  // ---- Invalid filters ----
  {
    const bad = runEngagement([FIX.A_high_traffic_weak], {
      filters: { maxEngagementRate: 150 },
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.error.code, "GA4_VALIDATION");
  }

  // ---- Filter application: raising minSessions filters A out ----
  {
    const result = runEngagement([FIX.A_high_traffic_weak], {
      filters: { minSessions: 5000 },
    });
    assert.equal(result.output.count, 0);
  }

  // ---- Filter isolation (capabilitySettings) ----
  {
    const result = processUpstreamItems({
      capabilities: ["engagement_opportunities", "page_performance"],
      inputItems: asItems([FIX.A_high_traffic_weak]),
      nodeData: {
        capabilities: ["engagement_opportunities", "page_performance"],
        // Flat noise that must NOT become engagement minSessions
        minShare: 0.99,
        sortMetric: "totalUsers",
        capabilitySettings: {
          engagement_opportunities: {
            minSessions: 100,
            maxEngagementRate: 0.4,
            limit: 10,
          },
          page_performance: {
            minSessions: 999999,
            limit: 1,
          },
        },
      },
    });
    assert.equal(result.ok, true);
    const eng = result.items.filter(
      (it) => it.json.capability === "engagement_opportunities"
    );
    const page = result.items.filter(
      (it) => it.json.capability === "page_performance"
    );
    assert.equal(eng.length, 1);
    assert.equal(eng[0].json.opportunity_type, "low_engagement");
    // page_performance-specific minSessions must not affect engagement,
    // and must filter page DATA rows independently
    assert.equal(page.length, 0);
    // Engagement perCapability filters isolated
    const engOut = (result.output.perCapability || []).find(
      (p) => p.capability === "engagement_opportunities"
    );
    assert.ok(engOut);
  }

  // Direct unit: extractFiltersFromNodeData must not mix keys
  {
    const engFilters = filterContract.extractFiltersFromNodeData(
      "engagement_opportunities",
      {
        minSessions: 200,
        minShare: 0.9,
        sortMetric: "sessions",
        maxEngagementRate: 0.35,
      }
    );
    assert.deepEqual(Object.keys(engFilters).sort(), [
      "maxEngagementRate",
      "minSessions",
    ]);
    assert.equal("minShare" in engFilters, false);
  }

  // ---- Multi-capability identity (stub + real) ----
  {
    const result = runEngagement([FIX.A_high_traffic_weak, FIX.D_bounce_only], {
      capabilities: [
        "engagement_opportunities",
        "acquisition_concentration",
        "landing_underperformance",
      ],
    });
    assert.equal(result.ok, true);
    for (const it of result.items) {
      const row = it.json;
      assert.ok(row.capability);
      if (row.capability === "engagement_opportunities") {
        assert.equal(row.opportunity_type, "low_engagement");
        assert.notEqual(row.opportunity_type, "landing_underperformance");
      }
      if (row.capability === "landing_underperformance") {
        assert.equal(row.opportunity_type, "landing_underperformance");
      }
      if (row.capability === "acquisition_concentration") {
        assert.equal(row.opportunity_type, "acquisition_concentration");
      }
    }
    assert.deepEqual(result.output.executed, [
      "engagement_opportunities",
      "acquisition_concentration",
      "landing_underperformance",
    ]);
  }

  // ---- Direct capability call with defaults ----
  {
    const direct = engagementOpportunities({
      rows: [FIX.A_high_traffic_weak],
      filters: {},
    });
    assert.equal(direct.implemented, true);
    assert.equal(direct.scaffold, false);
    assert.equal(direct.count, 1);
    assert.equal(direct.filters.minSessions, 100);
    assert.equal(direct.filters.maxEngagementRate, 0.4);
    assert.equal(direct.filters.minBounceRate, 0.6);
  }

  // ---- Dims missing ----
  {
    const result = runEngagement([
      {
        sessionDefaultChannelGroup: "Organic Search",
        sessions: 5000,
        engagementRate: 0.1,
      },
    ]);
    assert.equal(result.output.count, 0);
    assert.ok(
      (result.output.warnings || []).some((w) => w.code === "GA4_DIMS_MISSING")
    );
  }

  console.log("ga4-mcp smoke-engagement-opportunities: OK");
};

main();
