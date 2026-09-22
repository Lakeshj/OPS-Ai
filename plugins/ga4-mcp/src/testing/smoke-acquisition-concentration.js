/**
 * STEP 6 regression: acquisition_concentration only.
 */
const assert = require("node:assert/strict");
const {
  processUpstreamItems,
  capabilities,
  filters: filterContract,
} = require("../index");
const {
  acquisitionConcentration,
  SCORE_FORMULA,
  ACQUISITION_DIMS,
  CAPABILITY_ID,
  OPPORTUNITY_TYPE,
  DEFAULT_CONCENTRATION_SHARE,
} = require("../capabilities/acquisitionConcentration");

const FIX = require("./fixtures/acquisition-rows.json");

const asItems = (rows) => rows.map((json) => ({ json }));

const runAcq = (rows, opts = {}) =>
  processUpstreamItems({
    capabilities: opts.capabilities || ["acquisition_concentration"],
    inputItems: asItems(Array.isArray(rows) ? rows : [rows]),
    filters: opts.filters,
    nodeData: opts.nodeData,
  });

const labelsOf = (result) =>
  (result.items || [])
    .filter(
      (it) =>
        it.json?.capability === "acquisition_concentration" &&
        it.json?.entity?.label &&
        !it.json?.__ga4CapabilitySection
    )
    .map((it) => it.json.entity.label);

const main = () => {
  assert.equal(CAPABILITY_ID, "acquisition_concentration");
  assert.equal(OPPORTUNITY_TYPE, "acquisition_concentration");
  assert.equal(DEFAULT_CONCENTRATION_SHARE, 0.35);
  assert.equal(
    capabilities.CAPABILITY_DEFS.acquisition_concentration.implemented,
    true
  );
  assert.equal(
    capabilities.TOOL_LABELS.acquisition_concentration,
    "Acquisition Concentration"
  );

  // ---- A. sessionDefaultChannelGroup high concentration ----
  {
    const result = runAcq(FIX.A_channel_group);
    assert.equal(result.ok, true);
    assert.equal(result.output.count, 1);
    const row = result.items[0].json;
    assert.equal(row.capability, "acquisition_concentration");
    assert.equal(row.opportunity_type, "acquisition_concentration");
    assert.equal(row.entity.sessionDefaultChannelGroup, "Organic Search");
    assert.equal(row.entity.label, "Organic Search");
    assert.equal("pagePath" in row.entity, false);
    // 3100 / 5000 = 0.62
    assert.equal(row.metrics.sessions, 3100);
    assert.equal(row.metrics.shareOfSessions, 0.62);
    assert.equal(row.score, 62);
    assert.equal(row.score_breakdown.formula, SCORE_FORMULA);
    assert.match(row.reason, /Organic Search accounts for 62%/);
    assert.match(row.reason, /3,100 of 5,000/);
    assert.match(row.recommendation, /acquisition mix/);
    assert.doesNotMatch(row.recommendation, /SEO content|title\/meta/i);
  }

  // ---- B. sessionSourceMedium ----
  {
    const result = runAcq(FIX.B_source_medium);
    assert.equal(result.output.count, 1);
    const row = result.items[0].json;
    assert.equal(row.entity.sessionSourceMedium, "google / organic");
    // 2800 / 4000 = 0.7
    assert.equal(row.score, 70);
  }

  // ---- C. sessionSource ----
  {
    const result = runAcq(FIX.C_source_only);
    assert.equal(result.output.count, 1);
    assert.equal(result.items[0].json.entity.sessionSource, "google");
  }

  // ---- D. sessionMedium ----
  {
    const result = runAcq(FIX.D_medium_only);
    assert.equal(result.output.count, 1);
    assert.equal(result.items[0].json.entity.sessionMedium, "organic");
  }

  // ---- E. firstUserDefaultChannelGroup (users) ----
  {
    const result = runAcq(FIX.E_first_user_channel);
    assert.equal(result.output.count, 1);
    const row = result.items[0].json;
    assert.equal(
      row.entity.firstUserDefaultChannelGroup,
      "Organic Search"
    );
    assert.ok(row.metrics.shareOfUsers != null);
    assert.equal("shareOfSessions" in row.metrics, false);
    // 4000 / 5800 ≈ 68.97%
    assert.equal(row.score, 68.97);
  }

  // ---- F. CRITICAL: pagePath + eventName → refuse, no inferred channels ----
  {
    const result = runAcq(FIX.F_pagepath_eventname);
    assert.equal(result.ok, true);
    assert.equal(result.output.count, 0);
    const warn = (result.output.warnings || []).find(
      (w) => w.code === "GA4_EVENT_CROSS_METRIC_RISK"
    );
    assert.ok(warn);
    assert.equal(warn.capability, "acquisition_concentration");
    assert.ok(Array.isArray(warn.requiredDimensions));
    const labels = labelsOf(result).join(" ").toLowerCase();
    assert.equal(labels.includes("organic"), false);
    assert.equal(labels.includes("direct"), false);
    assert.equal(labels.includes("paid"), false);
    assert.equal(labels.includes("social"), false);
    for (const it of result.items) {
      // Empty-section envelope is OK (IntelligenceContext parity with GSC).
      if (it.json?.__ga4CapabilitySection || it.json?.__ga4Intelligence) {
        assert.equal(it.json.count, 0);
        continue;
      }
      assert.fail("unexpected acquisition opportunity item");
    }
    assert.equal(result.output.count, 0);
  }

  // ---- G. eventName only → refuse ----
  {
    const result = runAcq(FIX.G_eventname_only);
    assert.equal(result.output.count, 0);
    assert.ok(
      (result.output.warnings || []).some(
        (w) => w.code === "GA4_EVENT_CROSS_METRIC_RISK"
      )
    );
  }

  // ---- pagePath only → missing acquisition dim ----
  {
    const result = runAcq(FIX.pagepath_only);
    assert.equal(result.output.count, 0);
    const warn = (result.output.warnings || []).find(
      (w) => w.code === "GA4_ACQUISITION_DIM_MISSING"
    );
    assert.ok(warn);
    assert.deepEqual(warn.requiredDimensions, [...ACQUISITION_DIMS]);
    assert.ok(warn.availableDimensions.includes("pagePath"));
    assert.equal(labelsOf(result).length, 0);
  }

  // ---- H. mixed dims → do not combine; scope to priority dim ----
  {
    const result = runAcq(FIX.H_mixed_dims);
    assert.equal(result.ok, true);
    // Selected: sessionDefaultChannelGroup → Organic 4000 / 5000 = 80%
    assert.equal(result.output.count, 1);
    const row = result.items[0].json;
    assert.equal(row.entity.sessionDefaultChannelGroup, "Organic Search");
    assert.equal(row.score, 80);
    assert.equal("sessionSourceMedium" in row.entity, false);
    assert.ok(
      (result.output.warnings || []).some((w) =>
        String(w.message || "").includes("scoped only to sessionDefaultChannelGroup")
      )
    );
    // Must not invent google / organic as channel-group entity
    assert.equal(
      result.items.some(
        (it) => it.json.entity?.sessionSourceMedium === "google / organic"
      ),
      false
    );
  }

  // ---- I. low concentration → no opportunity ----
  {
    const result = runAcq(FIX.I_low_concentration);
    assert.equal(result.output.count, 0);
    assert.ok(
      (result.output.warnings || []).some((w) => w.code === "GA4_NO_MATCHES")
    );
  }

  // ---- J. high concentration (same as A) ----
  {
    const result = runAcq(FIX.J_high_concentration);
    assert.equal(result.output.count, 1);
    assert.equal(result.items[0].json.entity.label, "Organic Search");
    assert.equal(result.items[0].json.score, 62);
  }

  // ---- K. empty upstream ----
  {
    const result = runAcq([]);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "GA4_UPSTREAM_REQUIRED");
  }

  // ---- L. malformed rows ----
  {
    const result = processUpstreamItems({
      capabilities: ["acquisition_concentration"],
      inputItems: [
        { json: "bad" },
        { json: FIX.L_malformed_valid },
        { json: [1, 2] },
      ],
    });
    assert.equal(result.ok, true);
    // Single channel 100% share with only one valid row
    assert.equal(result.output.count, 1);
    assert.equal(result.items[0].json.entity.label, "Organic Search");
    assert.ok(
      (result.output.warnings || []).some((w) => w.code === "GA4_MALFORMED_ROWS")
    );
  }

  // ---- M. deterministic ordering by score ----
  {
    const result = runAcq(FIX.M_ordering, {
      filters: { minShare: 0.2, minVolume: 100 },
    });
    assert.ok(result.output.count >= 2);
    const scores = result.items.map((it) => it.json.score);
    for (let i = 1; i < scores.length; i += 1) {
      assert.ok(scores[i - 1] >= scores[i]);
    }
    assert.equal(result.items[0].json.entity.label, "Organic Search");
  }

  // ---- N. equal shares → label asc ----
  {
    const result = runAcq(FIX.N_equal_shares, {
      filters: { minShare: 0.4, minVolume: 100 },
    });
    assert.equal(result.output.count, 2);
    assert.equal(result.items[0].json.score, result.items[1].json.score);
    assert.equal(result.items[0].json.entity.label, "Alpha Channel");
    assert.equal(result.items[1].json.entity.label, "Zebra Channel");
  }

  // ---- Top channel below threshold is NOT an opportunity ----
  {
    const result = runAcq(
      [
        { sessionDefaultChannelGroup: "Organic Search", sessions: 340 },
        { sessionDefaultChannelGroup: "Direct", sessions: 330 },
        { sessionDefaultChannelGroup: "Paid Search", sessions: 330 },
      ],
      { filters: { minShare: 0.35, minVolume: 100 } }
    );
    // Organic is largest (~34%) but below 35%
    assert.equal(result.output.count, 0);
  }

  // ---- Invalid filters ----
  {
    const bad = runAcq(FIX.A_channel_group, {
      filters: { minShare: 150 },
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.error.code, "GA4_VALIDATION");
  }

  // ---- Filter isolation ----
  {
    const keys = filterContract.extractFiltersFromNodeData(
      "acquisition_concentration",
      {
        minShare: 0.5,
        minSessions: 999,
        maxEngagementRate: 0.1,
        minVolume: 200,
      }
    );
    assert.equal("minSessions" in keys, false);
    assert.equal("maxEngagementRate" in keys, false);
    assert.equal(keys.minShare, 0.5);
    assert.equal(keys.minVolume, 200);

    const result = processUpstreamItems({
      capabilities: [
        "acquisition_concentration",
        "engagement_opportunities",
      ],
      inputItems: asItems(FIX.A_channel_group),
      nodeData: {
        capabilitySettings: {
          acquisition_concentration: {
            minShare: 0.5,
            minVolume: 100,
          },
          engagement_opportunities: {
            minSessions: 999999,
          },
        },
      },
    });
    const acq = result.items.filter(
      (it) => it.json.capability === "acquisition_concentration"
    );
    const eng = result.items.filter(
      (it) => it.json.capability === "engagement_opportunities"
    );
    assert.equal(acq.length, 1); // 62% >= 50%
    assert.equal(eng.length, 0);
    assert.equal(acq[0].json.opportunity_type, "acquisition_concentration");
  }

  // ---- Multi-select identity: engagement + acquisition ----
  {
    const result = processUpstreamItems({
      capabilities: [
        "engagement_opportunities",
        "acquisition_concentration",
      ],
      inputItems: asItems([
        ...FIX.A_channel_group,
        {
          pagePath: "/pricing",
          sessions: 1200,
          engagementRate: 0.18,
        },
      ]),
    });
    for (const it of result.items) {
      if (it.json.capability === "acquisition_concentration") {
        assert.equal(it.json.opportunity_type, "acquisition_concentration");
        assert.ok(it.json.entity.sessionDefaultChannelGroup);
      }
      if (it.json.capability === "engagement_opportunities") {
        assert.equal(it.json.opportunity_type, "low_engagement");
      }
    }
  }

  // ---- landing + acquisition ----
  {
    const result = processUpstreamItems({
      capabilities: [
        "landing_underperformance",
        "acquisition_concentration",
      ],
      inputItems: asItems([
        ...FIX.A_channel_group,
        {
          landingPage: "/lp/webinar",
          sessions: 2200,
          engagementRate: 0.19,
          screenPageViews: 2400,
        },
      ]),
    });
    assert.ok(
      result.items.some(
        (it) => it.json.capability === "landing_underperformance"
      )
    );
    assert.ok(
      result.items.some(
        (it) => it.json.capability === "acquisition_concentration"
      )
    );
  }

  // ---- all three implemented ----
  {
    const result = processUpstreamItems({
      capabilities: [
        "engagement_opportunities",
        "landing_underperformance",
        "acquisition_concentration",
      ],
      inputItems: asItems([
        ...FIX.A_channel_group,
        {
          pagePath: "/pricing",
          landingPage: "/pricing",
          sessions: 1200,
          engagementRate: 0.18,
          screenPageViews: 1300,
        },
      ]),
    });
    assert.deepEqual(result.output.executed, [
      "engagement_opportunities",
      "landing_underperformance",
      "acquisition_concentration",
    ]);
    const types = new Set(result.items.map((it) => it.json.opportunity_type));
    assert.ok(types.has("low_engagement"));
    assert.ok(types.has("landing_underperformance"));
    assert.ok(types.has("acquisition_concentration"));
  }

  // ---- Direct defaults ----
  {
    const direct = acquisitionConcentration({
      rows: FIX.A_channel_group,
      filters: {},
    });
    assert.equal(direct.implemented, true);
    assert.equal(direct.scaffold, false);
    assert.equal(direct.filters.minShare, 0.35);
    assert.equal(direct.filters.minConcentrationShare, 0.35);
    assert.equal(direct.filters.minVolume, 100);
    assert.equal(direct.selectedDimension, "sessionDefaultChannelGroup");
    assert.equal(direct.concentrationThreshold, 0.35);
  }

  console.log("ga4-mcp smoke-acquisition-concentration: OK");
};

main();
