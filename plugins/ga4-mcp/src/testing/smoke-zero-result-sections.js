/**
 * STEP 8E — Preserve zero-result capability sections in multi-select.
 */
const assert = require("assert");
const { processUpstreamItems } = require("../adapters/processUpstream");
const {
  applyAiGrounding,
  tryBuildFromWorkflowItems,
  summarizeStructuredEvidence,
  MARKER,
} = require("../contracts/intelligenceContext");

const SECTION = "__ga4CapabilitySection";

const highEngagementLandingRows = () => {
  const rows = [];
  for (let i = 0; i < 12; i += 1) {
    rows.push({
      json: {
        landingPage: `/ok-${i}/`,
        sessions: 200 + i,
        totalUsers: 180,
        engagementRate: 0.7,
        bounceRate: 0.2,
        screenPageViews: 400,
      },
    });
  }
  // Unresolved entities (skipped) — contribute GA4_LANDING_ENTITY_UNRESOLVED
  rows.push({
    json: {
      landingPage: "(not set)",
      sessions: 300,
      totalUsers: 250,
      engagementRate: 0.1,
      bounceRate: 0.9,
      screenPageViews: 310,
    },
  });
  rows.push({
    json: {
      landingPage: "(not set)",
      sessions: 280,
      totalUsers: 240,
      engagementRate: 0.12,
      bounceRate: 0.88,
      screenPageViews: 300,
    },
  });
  return rows;
};

const isSection = (item) => {
  const j = item?.json || item;
  return j && j[SECTION] === true;
};

const isPageData = (item) => {
  const j = item?.json || item;
  return (
    j &&
    j.capability === "page_performance" &&
    j.row_kind === "ranked_page" &&
    !j[SECTION]
  );
};

const assertZeroSection = (item, capabilityId) => {
  const j = item.json;
  assert.equal(j[SECTION], true);
  assert.equal(j[MARKER], true);
  assert.equal(j.capability, capabilityId);
  assert.equal(j.category, "intelligence");
  assert.equal(j.count, 0);
  assert.ok(Array.isArray(j.results));
  assert.equal(j.results.length, 0);
  assert.equal(j.opportunity_type, undefined);
  assert.equal(j.score, undefined);
  assert.equal(j.entity, undefined);
  assert.equal(j.metrics, undefined);
  assert.equal(j.reason, undefined);
  assert.equal(j.recommendation, undefined);
};

function run() {
  // ---- 1. Landing-only, zero results ----
  {
    const result = processUpstreamItems({
      capabilities: ["landing_underperformance"],
      inputItems: highEngagementLandingRows(),
      nodeData: {
        capabilities: ["landing_underperformance"],
        capabilitySettings: {
          // Force no matches on remaining resolved rows
          landing_underperformance: {
            minSessions: 10000,
          },
        },
      },
    });
    assert.equal(result.ok, true);
    assert.ok(result.items.length > 0);
    const section = result.items.find(isSection);
    assert.ok(section, "expected zero-result section item");
    assertZeroSection(section, "landing_underperformance");
    const codes = (result.output.warnings || []).map((w) => w.code);
    assert.ok(
      codes.includes("GA4_NO_MATCHES"),
      `expected GA4_NO_MATCHES, got ${codes.join(",")}`
    );
    assert.ok(
      codes.includes("GA4_LANDING_ENTITY_UNRESOLVED"),
      `expected GA4_LANDING_ENTITY_UNRESOLVED, got ${codes.join(",")}`
    );
  }

  // ---- 2. Landing-only with qualifying opps (unchanged) ----
  {
    const result = processUpstreamItems({
      capabilities: ["landing_underperformance"],
      inputItems: [
        {
          json: {
            landingPage: "/weak/",
            sessions: 200,
            totalUsers: 180,
            engagementRate: 0.1,
            bounceRate: 0.9,
            screenPageViews: 210,
          },
        },
      ],
      nodeData: { capabilities: ["landing_underperformance"] },
    });
    assert.equal(result.ok, true);
    const opps = result.items.filter(
      (i) =>
        i.json?.capability === "landing_underperformance" &&
        i.json?.[SECTION] !== true
    );
    assert.ok(opps.length >= 1);
    assert.equal(opps[0].json.opportunity_type, "landing_underperformance");
    assert.ok(typeof opps[0].json.score === "number");
  }

  // ---- 3. All four: 3 zero sections + page DATA ----
  {
    const pageRows = [];
    for (let i = 0; i < 60; i += 1) {
      pageRows.push({
        json: {
          landingPage: `/p-${i}/`,
          sessions: 100 + i,
          totalUsers: 80 + i,
          engagementRate: 0.65,
          bounceRate: 0.25,
          screenPageViews: 150 + i,
        },
      });
    }
    const result = processUpstreamItems({
      capabilities: [
        "engagement_opportunities",
        "landing_underperformance",
        "acquisition_concentration",
        "page_performance",
      ],
      inputItems: pageRows,
      nodeData: {
        capabilities: [
          "engagement_opportunities",
          "landing_underperformance",
          "acquisition_concentration",
          "page_performance",
        ],
        capabilitySettings: {
          engagement_opportunities: { minSessions: 100000 },
          landing_underperformance: { minSessions: 100000 },
        },
      },
    });
    assert.equal(result.ok, true);
    const sections = result.items.filter(isSection);
    const pages = result.items.filter(isPageData);
    assert.equal(sections.length, 3, `expected 3 zero sections, got ${sections.length}`);
    assert.equal(pages.length, 50, `expected 50 page rows, got ${pages.length}`);
    assert.equal(result.items.length, 53);
    for (const s of sections) {
      assertZeroSection(s, s.json.capability);
      assert.ok(
        [
          "engagement_opportunities",
          "landing_underperformance",
          "acquisition_concentration",
        ].includes(s.json.capability)
      );
    }
    const warnCodes = (result.output.warnings || []).map((w) => w.code);
    assert.ok(warnCodes.includes("GA4_ACQUISITION_DIM_MISSING"));
    assert.ok(warnCodes.includes("GA4_NO_MATCHES"));
  }

  // ---- 4–6. AI context: landing 0 + page DATA ----
  {
    const pageRows = [];
    for (let i = 0; i < 5; i += 1) {
      pageRows.push({
        json: {
          landingPage: `/x-${i}/`,
          sessions: 120,
          totalUsers: 100,
          engagementRate: 0.8,
          bounceRate: 0.1,
          screenPageViews: 200,
        },
      });
    }
    const result = processUpstreamItems({
      capabilities: ["landing_underperformance", "page_performance"],
      inputItems: pageRows,
      nodeData: {
        capabilities: ["landing_underperformance", "page_performance"],
        capabilitySettings: {
          landing_underperformance: { minSessions: 100000 },
        },
      },
    });
    const built = tryBuildFromWorkflowItems(result.items);
    assert.equal(built.ok, true);
    const evidence = summarizeStructuredEvidence(built.context);
    assert.equal(evidence.hasDataRows, true);
    assert.equal(evidence.hasOpportunityRows, false);
    assert.equal(evidence.hasZeroResultCapabilitySections, true);
    const land = (evidence.capabilities || []).find(
      (c) => c.capability === "landing_underperformance"
    );
    assert.ok(land);
    assert.equal(land.count, 0);
    assert.equal(land.zeroResult, true);
    assert.equal(land.executed, true);
    const page = (evidence.capabilities || []).find(
      (c) => c.capability === "page_performance"
    );
    assert.ok(page);
    assert.ok(page.resultCount > 0);

    const g = applyAiGrounding({
      systemPrompt:
        "Analyze the structured GA4 MCP landing underperformance opportunities.",
      userPrompt: "Which landing pages are underperforming?",
      input: result.items,
    });
    assert.equal(g.grounded, true);
    assert.equal(g.empty, false);
    assert.equal(g.evidence.hasDataRows, true);
    assert.equal(g.evidence.hasZeroResultCapabilitySections, true);
    assert.ok(
      /landing_underperformance/.test(g.userPrompt) ||
        /landing_underperformance/.test(g.systemPrompt)
    );
    assert.ok(/page_performance/.test(g.userPrompt));
    assert.ok(!/"score_breakdown"/.test(g.userPrompt));
    assert.ok(/zeroResult/.test(g.systemPrompt) || /count=0/.test(g.systemPrompt) || /zero qualifying/.test(g.systemPrompt));
    assert.ok(!/Respond exactly: "No structured GA4 MCP opportunity\/data rows/.test(g.systemPrompt));
    assert.ok(/Do NOT say they were unselected|do not claim those capabilities were unselected|Do NOT claim the capability was not selected/i.test(g.systemPrompt));
  }

  // ---- Empty upstream still hard-fails ----
  {
    const result = processUpstreamItems({
      capabilities: ["landing_underperformance", "page_performance"],
      inputItems: [],
      nodeData: {
        capabilities: ["landing_underperformance", "page_performance"],
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "GA4_UPSTREAM_REQUIRED");
  }

  console.log("ga4-mcp smoke-zero-result-sections: OK");
}

run();
