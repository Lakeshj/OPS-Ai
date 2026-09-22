/**
 * STEP 5 regression: landing_underperformance only.
 * Also proves distinction from engagement_opportunities.
 */
const assert = require("node:assert/strict");
const {
  processUpstreamItems,
  capabilities,
  filters: filterContract,
} = require("../index");
const {
  landingUnderperformance,
  SCORE_FORMULA,
  scoreLandingUnderperformance,
  CAPABILITY_ID,
  OPPORTUNITY_TYPE,
} = require("../capabilities/landingUnderperformance");
const {
  SCORE_FORMULA: ENGAGEMENT_FORMULA,
} = require("../capabilities/engagementOpportunities");

const FIX = require("./fixtures/landing-rows.json");

const asItems = (rows) => rows.map((json) => ({ json }));

const runLanding = (rows, opts = {}) =>
  processUpstreamItems({
    capabilities: opts.capabilities || ["landing_underperformance"],
    inputItems: asItems(rows),
    filters: opts.filters,
    nodeData: opts.nodeData,
  });

const main = () => {
  assert.equal(CAPABILITY_ID, "landing_underperformance");
  assert.equal(OPPORTUNITY_TYPE, "landing_underperformance");
  assert.equal(
    capabilities.CAPABILITY_DEFS.landing_underperformance.implemented,
    true
  );
  assert.equal(
    capabilities.TOOL_LABELS.landing_underperformance,
    "Landing Underperformance"
  );
  assert.notEqual(SCORE_FORMULA, ENGAGEMENT_FORMULA);

  // ---- A. High landing sessions + weak engagement → opportunity ----
  {
    const result = runLanding([FIX.A_high_sessions_weak]);
    assert.equal(result.ok, true);
    assert.equal(result.output.count, 1);
    const row = result.items[0].json;
    assert.equal(row.capability, "landing_underperformance");
    assert.equal(row.opportunity_type, "landing_underperformance");
    assert.equal(row.entity.landingPage, "/pricing");
    assert.equal(row.entity.label, "/pricing");
    assert.equal(row.metrics.sessions, 850);
    assert.equal(row.metrics.engagementRate, 0.21);
    assert.equal(row.metrics.totalUsers, 720);
    assert.ok(row.metrics.viewsPerSession != null);
    assert.match(row.reason, /Landing page \/pricing/);
    assert.match(row.reason, /850 sessions/);
    assert.match(row.reason, /21%/);
    assert.doesNotMatch(row.reason, /dislike|confused|stale|intent/i);
    assert.match(row.recommendation, /landing-page experience/);
    assert.match(row.recommendation, /\/pricing/);
    assert.equal(row.score_breakdown.formula, SCORE_FORMULA);
    const expected = scoreLandingUnderperformance({
      sessions: 850,
      engagementRate: 0.21,
      bounceRate: null,
      viewsPerSession: 910 / 850,
      averageSessionDuration: null,
    });
    assert.equal(row.score, expected.score);
  }

  // ---- B. Healthy → no opportunity ----
  {
    const result = runLanding([FIX.B_high_sessions_healthy]);
    assert.equal(result.ok, true);
    assert.equal(result.output.count, 0);
    assert.ok(
      (result.output.warnings || []).some((w) => w.code === "GA4_NO_MATCHES")
    );
  }

  // ---- C. Low sessions → filtered ----
  {
    const result = runLanding([FIX.C_low_sessions]);
    assert.equal(result.ok, true);
    assert.equal(result.output.count, 0);
  }

  // ---- D. engagementRate signal ----
  {
    const result = runLanding([FIX.D_engagement_rate]);
    assert.equal(result.output.count, 1);
    const row = result.items[0].json;
    assert.equal(row.metrics.engagementRate, 0.19);
    const expected = scoreLandingUnderperformance({
      sessions: 2200,
      engagementRate: 0.19,
      bounceRate: null,
      viewsPerSession: 2400 / 2200,
      averageSessionDuration: null,
    });
    assert.equal(row.score, expected.score);
    assert.equal(row.score, 27.27);
  }

  // ---- E. bounceRate signal ----
  {
    const result = runLanding([FIX.E_bounce_rate]);
    assert.equal(result.output.count, 1);
    const row = result.items[0].json;
    assert.equal(row.metrics.bounceRate, 0.74);
    assert.equal("engagementRate" in row.metrics, false);
    assert.match(row.reason, /bounce rate of 74%/);
  }

  // ---- F. Missing performance signal → warning ----
  {
    const result = runLanding([FIX.F_missing_signal]);
    assert.equal(result.output.count, 0);
    const warn = (result.output.warnings || []).find(
      (w) =>
        w.code === "GA4_METRICS_MISSING" &&
        String(w.message || "").includes("landing-performance signal")
    );
    assert.ok(warn);
    assert.equal(warn.capability, "landing_underperformance");
    assert.ok(Array.isArray(warn.requiredMetrics));
    assert.ok(Array.isArray(warn.availableMetrics));
  }

  // ---- G. Missing landingPage but valid pagePath (proxy) ----
  {
    const result = runLanding([FIX.G_pagepath_proxy]);
    assert.equal(result.output.count, 1);
    const row = result.items[0].json;
    assert.equal(row.entity.pagePath, "/home-proxy");
    assert.equal(row.entity.landingPage, undefined);
    assert.equal(row.entity.label, "/home-proxy");
    assert.ok(
      (result.output.warnings || []).some(
        (w) => w.code === "GA4_LANDING_PROXY_PAGEPATH"
      )
    );
  }

  // ---- H. Multiple landings → score desc ordering ----
  {
    const result = runLanding([
      FIX.H_multi_c,
      FIX.H_multi_b,
      FIX.H_multi_a,
      FIX.B_high_sessions_healthy,
      FIX.C_low_sessions,
    ]);
    assert.ok(result.output.count >= 2);
    const scores = result.items.map((it) => it.json.score);
    for (let i = 1; i < scores.length; i += 1) {
      assert.ok(scores[i - 1] >= scores[i]);
    }
    assert.equal(result.items[0].json.entity.landingPage, "/lp/demo");
    assert.ok(result.items[0].json.score > result.items[1].json.score);
  }

  // ---- I. Equal scores → label asc tie-break ----
  {
    const result = runLanding([FIX.I_tie_zzz, FIX.I_tie_aaa]);
    assert.equal(result.output.count, 2);
    assert.equal(result.items[0].json.score, result.items[1].json.score);
    assert.equal(result.items[0].json.entity.label, "/aaa-land");
    assert.equal(result.items[1].json.entity.label, "/zzz-land");
  }

  // ---- Empty upstream ----
  {
    const result = runLanding([]);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "GA4_UPSTREAM_REQUIRED");
  }

  // ---- Missing landing dimension ----
  {
    const result = runLanding([
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

  // ---- Missing sessions ----
  {
    const result = runLanding([
      {
        landingPage: "/x",
        engagementRate: 0.1,
      },
    ]);
    assert.equal(result.output.count, 0);
    assert.ok(
      (result.output.warnings || []).some(
        (w) =>
          w.code === "GA4_METRICS_MISSING" &&
          String(w.message || "").includes("requires sessions")
      )
    );
  }

  // ---- Malformed rows ----
  {
    const result = processUpstreamItems({
      capabilities: ["landing_underperformance"],
      inputItems: [
        { json: "bad" },
        { json: FIX.A_high_sessions_weak },
        { json: [1, 2] },
      ],
    });
    assert.equal(result.ok, true);
    assert.equal(result.output.count, 1);
    assert.ok(
      (result.output.warnings || []).some((w) => w.code === "GA4_MALFORMED_ROWS")
    );
  }

  // ---- Invalid filters ----
  {
    const bad = runLanding([FIX.A_high_sessions_weak], {
      filters: { maxViewsPerSession: -1 },
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.error.code, "GA4_VALIDATION");
  }

  // ---- Filter isolation ----
  {
    const engKeys = filterContract.extractFiltersFromNodeData(
      "landing_underperformance",
      {
        minSessions: 200,
        minShare: 0.9,
        maxEngagementRate: 0.3,
        maxViewsPerSession: 1.1,
        minBounceRate: 0.7,
      }
    );
    assert.equal("minShare" in engKeys, false);
    assert.equal(engKeys.minSessions, 200);
    assert.equal(engKeys.minBounceRate, 0.7);

    const result = processUpstreamItems({
      capabilities: [
        "landing_underperformance",
        "engagement_opportunities",
      ],
      inputItems: asItems([FIX.A_high_sessions_weak]),
      nodeData: {
        capabilitySettings: {
          landing_underperformance: {
            minSessions: 150,
            maxEngagementRate: 0.35,
            limit: 5,
          },
          engagement_opportunities: {
            minSessions: 999999,
            limit: 5,
          },
        },
      },
    });
    assert.equal(result.ok, true);
    const landing = result.items.filter(
      (it) => it.json.capability === "landing_underperformance"
    );
    const engagement = result.items.filter(
      (it) => it.json.capability === "engagement_opportunities"
    );
    assert.equal(landing.length, 1);
    assert.equal(engagement.length, 0); // engagement minSessions isolation
    assert.equal(landing[0].json.opportunity_type, "landing_underperformance");
  }

  // ---- Multi-capability identity ----
  {
    const result = runLanding([FIX.D_engagement_rate, FIX.E_bounce_rate], {
      capabilities: [
        "landing_underperformance",
        "engagement_opportunities",
        "page_performance",
      ],
    });
    assert.equal(result.ok, true);
    for (const it of result.items) {
      const row = it.json;
      if (row.capability === "landing_underperformance") {
        assert.equal(row.opportunity_type, "landing_underperformance");
      }
      if (row.capability === "engagement_opportunities") {
        assert.equal(row.opportunity_type, "low_engagement");
      }
      if (row.capability === "page_performance") {
        assert.equal(row.opportunity_type, null);
        assert.equal(row.row_kind, "ranked_page");
      }
    }
  }

  // ---- IMPORTANT: contracts differ — not identical outputs ----
  {
    // Mid traffic: engagement qualifies (minSessions 100), landing does not (150)
    const mid = processUpstreamItems({
      capabilities: [
        "engagement_opportunities",
        "landing_underperformance",
      ],
      inputItems: asItems([FIX.diff_mid_traffic]),
    });
    const midEng = mid.items.filter(
      (it) => it.json.capability === "engagement_opportunities"
    );
    const midLand = mid.items.filter(
      (it) => it.json.capability === "landing_underperformance"
    );
    assert.equal(midEng.length, 1);
    assert.equal(midLand.length, 0);
    assert.equal(midEng[0].json.opportunity_type, "low_engagement");

    // Borderline ER 0.38: engagement max 0.40 qualifies; landing max 0.35 does not
    const border = processUpstreamItems({
      capabilities: [
        "engagement_opportunities",
        "landing_underperformance",
      ],
      inputItems: asItems([FIX.diff_borderline_er]),
    });
    const bEng = border.items.filter(
      (it) => it.json.capability === "engagement_opportunities"
    );
    const bLand = border.items.filter(
      (it) => it.json.capability === "landing_underperformance"
    );
    assert.equal(bEng.length, 1);
    assert.equal(bLand.length, 0);

    // Same weak landing row: both can fire, but identity + score formulas differ
    const both = processUpstreamItems({
      capabilities: [
        "engagement_opportunities",
        "landing_underperformance",
      ],
      inputItems: asItems([FIX.D_engagement_rate]),
    });
    const bothEng = both.items.find(
      (it) => it.json.capability === "engagement_opportunities"
    );
    const bothLand = both.items.find(
      (it) => it.json.capability === "landing_underperformance"
    );
    assert.ok(bothEng);
    assert.ok(bothLand);
    assert.equal(bothEng.json.opportunity_type, "low_engagement");
    assert.equal(bothLand.json.opportunity_type, "landing_underperformance");
    assert.notEqual(bothEng.json.score, bothLand.json.score);
    assert.notEqual(
      bothEng.json.score_breakdown.formula,
      bothLand.json.score_breakdown.formula
    );
    assert.match(bothLand.json.reason, /^Landing page /);
    assert.match(bothEng.json.reason, /^Page /);
    assert.match(bothLand.json.recommendation, /landing-page/);
    assert.doesNotMatch(bothEng.json.recommendation, /landing-page/);
    // Landing prefers landingPage on entity
    assert.equal(bothLand.json.entity.landingPage, "/lp/webinar");
  }

  // ---- Zero landing + valid engagement ----
  {
    const result = processUpstreamItems({
      capabilities: [
        "engagement_opportunities",
        "landing_underperformance",
      ],
      inputItems: asItems([FIX.diff_mid_traffic]),
    });
    assert.ok(
      result.items.some((it) => it.json.capability === "engagement_opportunities")
    );
    assert.equal(
      result.items.filter(
        (it) => it.json.capability === "landing_underperformance"
      ).length,
      0
    );
  }

  // ---- Direct defaults ----
  {
    const direct = landingUnderperformance({
      rows: [FIX.A_high_sessions_weak],
      filters: {},
    });
    assert.equal(direct.implemented, true);
    assert.equal(direct.scaffold, false);
    assert.equal(direct.filters.minSessions, 150);
    assert.equal(direct.filters.maxEngagementRate, 0.35);
    assert.equal(direct.filters.minBounceRate, 0.65);
    assert.equal(direct.filters.maxViewsPerSession, 1.2);
    assert.equal(direct.filters.maxAverageSessionDuration, 25);
  }

  // ---- eventName rows evaluated independently (no cross-sum) ----
  {
    const result = runLanding([
      {
        landingPage: "/a",
        eventName: "page_view",
        sessions: 400,
        engagementRate: 0.1,
      },
      {
        landingPage: "/a",
        eventName: "click",
        sessions: 400,
        engagementRate: 0.1,
      },
    ]);
    // Each row independently fails minSessions 150? 400 >= 150 so both can qualify
    // Must NOT become one row with 800 sessions
    assert.equal(result.output.count, 2);
    for (const it of result.items) {
      assert.equal(it.json.metrics.sessions, 400);
      assert.notEqual(it.json.metrics.sessions, 800);
    }
  }

  console.log("ga4-mcp smoke-landing-underperformance: OK");
};

main();
