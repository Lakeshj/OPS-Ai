/**
 * Native GA4 → AI grounding regressions (no LLM calls, no GSC/MCP edits).
 */
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");

const registerGa4AiGroundingTests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("GA4 AI grounding (native rows)");

  const grounding = () => require("../services/workflowGa4AiGrounding");

  const pageEventRows = [
    {
      json: {
        eventName: "page_view",
        pagePath: "/home",
        totalUsers: 100,
        sessions: 120,
      },
    },
    {
      json: {
        eventName: "scroll",
        pagePath: "/home",
        totalUsers: 40,
        sessions: 45,
      },
    },
    {
      json: {
        eventName: "page_view",
        pagePath: "/pricing",
        totalUsers: 80,
        sessions: 90,
      },
    },
  ];

  const channelRows = [
    {
      json: {
        sessionDefaultChannelGroup: "Organic Search",
        totalUsers: 500,
        sessions: 700,
      },
    },
    {
      json: {
        sessionDefaultChannelGroup: "Direct",
        totalUsers: 300,
        sessions: 320,
      },
    },
  ];

  const acquisitionQuestion =
    "Which acquisition channels brought the most users and sessions?";

  check("GA4AI-1 acquisition question + pagePath/eventName refuses substitute dims", () => {
    const g = grounding().applyGa4AiGrounding({
      systemPrompt: acquisitionQuestion,
      userPrompt: "{{input}}",
      input: pageEventRows,
      context: {
        steps: {
          ga4: {
            output: {
              startDate: "2026-08-01",
              endDate: "2026-08-31",
              dateRange: "lastCalendarMonth",
              propertyId: "properties/123",
            },
          },
        },
      },
    });
    assertX.equal(g.grounded, true);
    assertX.equal(g.missingRequiredDimension, "sessionDefaultChannelGroup");
    assertX.ok(g.refusalTemplate);
    assertX.match(
      g.refusalTemplate,
      /do not contain an acquisition-channel dimension/i
    );
    assertX.match(g.refusalTemplate, /eventName/);
    assertX.match(g.refusalTemplate, /pagePath/);
    assertX.ok(!/Organic Search|Direct/.test(g.refusalTemplate));
    assertX.match(g.systemPrompt, /Never call pagePath/);
    assertX.match(g.systemPrompt, /Required response \(dimension missing\)/);
    assertX.match(
      g.systemPrompt,
      /Do not attempt to answer using pagePath, eventName/
    );
    assertX.ok(
      !g.ga4Dataset.availableDimensions.includes("sessionDefaultChannelGroup")
    );
  });

  check("GA4AI-2 date-range preservation — calendar month not rewritten as last 30 days", () => {
    const g = grounding().applyGa4AiGrounding({
      systemPrompt: "Summarize traffic.",
      userPrompt: "report",
      input: pageEventRows,
      context: {
        steps: {
          ga4: {
            output: {
              startDate: "2026-08-01",
              endDate: "2026-08-31",
              dateRange: "lastCalendarMonth",
            },
          },
        },
      },
    });
    assertX.equal(g.grounded, true);
    assertX.match(g.systemPrompt, /lastCalendarMonth/);
    assertX.match(g.systemPrompt, /Last Complete Calendar Month/);
    assertX.match(g.systemPrompt, /2026-08-01/);
    assertX.match(g.systemPrompt, /2026-08-31/);
    assertX.match(
      g.systemPrompt,
      /Do NOT convert calendar-month ranges into "last 30 days"/
    );
    assertX.ok(!/Date range: last 30 days/i.test(g.systemPrompt));
  });

  check("GA4AI-3 no cross-event metric summation rule present", () => {
    const g = grounding().applyGa4AiGrounding({
      systemPrompt: "Total users?",
      userPrompt: "sum everything",
      input: pageEventRows,
    });
    assertX.equal(g.grounded, true);
    assertX.match(
      g.systemPrompt,
      /Do not add totalUsers or sessions across unrelated eventName/
    );
    assertX.match(
      g.systemPrompt,
      /inflates totals/
    );
    assertX.match(
      g.systemPrompt,
      /Do not recompute or re-derive those metrics from event-level rows/
    );
  });

  check("GA4AI-4 requested dimension absent → explicit available dims, no fabricate", () => {
    const g = grounding().applyGa4AiGrounding({
      systemPrompt: acquisitionQuestion,
      userPrompt: "",
      input: [
        { json: { pagePath: "/a", sessions: 1, totalUsers: 1 } },
        { json: { pagePath: "/b", sessions: 2, totalUsers: 2 } },
      ],
    });
    assertX.equal(g.grounded, true);
    assertX.deepEqual(g.ga4Dataset.availableDimensions, ["pagePath"]);
    assertX.match(
      g.refusalTemplate,
      /available dimensions are pagePath/i
    );
    assertX.match(
      g.systemPrompt,
      /If the required dimension is absent from the input, say so explicitly/
    );
    assertX.match(g.systemPrompt, /Do NOT fabricate an answer from substitutes/);
  });

  check("GA4AI-5 valid sessionDefaultChannelGroup input allows channel analysis", () => {
    const g = grounding().applyGa4AiGrounding({
      systemPrompt: acquisitionQuestion,
      userPrompt: "analyze",
      input: channelRows,
      context: {
        steps: {
          ga4: {
            output: {
              startDate: "2026-08-01",
              endDate: "2026-08-31",
              dateRange: "lastCalendarMonth",
            },
          },
        },
      },
    });
    assertX.equal(g.grounded, true);
    assertX.equal(g.missingRequiredDimension, null);
    assertX.equal(g.refusalTemplate, null);
    assertX.ok(
      g.ga4Dataset.availableDimensions.includes("sessionDefaultChannelGroup")
    );
    assertX.equal(g.ga4Dataset.hasChannelDim, true);
    assertX.match(
      g.systemPrompt,
      /Acquisition-channel dimensions present: sessionDefaultChannelGroup/
    );
    assertX.ok(!/Required response \(dimension missing\)/.test(g.systemPrompt));
  });

  check("GA4AI-6 non-GA4 rows are not grounded", () => {
    const g = grounding().applyGa4AiGrounding({
      systemPrompt: acquisitionQuestion,
      userPrompt: "",
      input: [{ json: { query: "seo", clicks: 10 } }],
    });
    assertX.equal(g.grounded, false);
  });

  check("GA4AI-7 prompt preview applies GA4 grounding without GSC", () => {
    const {
      resolveEffectiveAiPrompts,
    } = require("../services/workflowAiPromptPreview.util");
    const effective = resolveEffectiveAiPrompts({
      node: {
        type: "ai",
        data: {
          systemPrompt: acquisitionQuestion,
          prompt: "{{input}}",
        },
      },
      context: {
        input: pageEventRows[0].json,
        inputItems: pageEventRows,
        steps: {
          ga4: {
            output: {
              startDate: "2026-08-01",
              endDate: "2026-08-31",
              dateRange: "lastCalendarMonth",
            },
          },
        },
      },
    });
    assertX.equal(effective.ga4Grounded, true);
    assertX.equal(effective.gscGrounded, false);
    assertX.equal(effective.groundingApplied, true);
    assertX.match(effective.systemPrompt, /acquisition-channel dimension/i);
    assertX.match(effective.systemPrompt, /Last Complete Calendar Month/);
  });

  check("GA4AI-8 native GA4 grounding module stays free of GSC plugin imports", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../services/workflowGa4AiGrounding.js"),
      "utf8"
    );
    assertX.ok(!src.includes("plugins/gsc-mcp"));
    assertX.ok(!src.includes("require(\"../../plugins"));
  });

  section("GA4 AI grounding (MCP IntelligenceContext — common architecture)");

  const engagementMcp = [
    {
      json: {
        capability: "engagement_opportunities",
        opportunity_type: "low_engagement",
        entity: { pagePath: "/slow", label: "/slow" },
        metrics: { sessions: 1200, engagementRate: 0.18, bounceRate: 0.72 },
        reason: "High sessions with weak engagement on /slow",
        recommendation: "Improve above-the-fold clarity on /slow",
        score: 32,
        score_breakdown: { traffic: 20, weakness: 12 },
        __ga4Intelligence: true,
        source: "google_analytics",
      },
    },
  ];

  const landingMcp = [
    {
      json: {
        capability: "landing_underperformance",
        opportunity_type: "landing_underperformance",
        entity: { landingPage: "/lp", label: "/lp" },
        metrics: { sessions: 800, bounceRate: 0.81, engagementRate: 0.12 },
        reason: "Landing /lp underperforms on engagement",
        recommendation: "Tighten landing message match on /lp",
        score: 41,
        __ga4Intelligence: true,
        source: "google_analytics",
      },
    },
  ];

  const acquisitionMcp = [
    {
      json: {
        capability: "acquisition_concentration",
        opportunity_type: "acquisition_concentration",
        entity: {
          sessionDefaultChannelGroup: "Organic Search",
          label: "Organic Search",
        },
        metrics: { sessions: 5000, totalUsers: 4200, share: 0.62 },
        reason: "Traffic concentrated in Organic Search",
        recommendation: "Diversify acquisition beyond Organic Search",
        score: 55,
        __ga4Intelligence: true,
        source: "google_analytics",
      },
    },
  ];

  const pagePerfMcp = [
    {
      json: {
        capability: "page_performance",
        row_kind: "ranked_page",
        opportunity_type: null,
        rank: 1,
        entity: { pagePath: "/top", label: "/top" },
        metrics: { sessions: 900, totalUsers: 700 },
        sortMetric: "sessions",
        sortDirection: "desc",
        reason: "Ranked by sessions",
        __ga4Intelligence: true,
        source: "google_analytics",
      },
    },
  ];

  const multiMcp = [
    ...engagementMcp,
    ...landingMcp,
    ...acquisitionMcp,
    ...pagePerfMcp,
  ];

  const mcpGround = () =>
    require("../services/workflowMcpAiGrounding").applyMcpAiGrounding;
  const ga4Intel = () =>
    require("../../plugins/ga4-mcp/src/contracts/intelligenceContext");

  check("GA4AI-MCP-1 structured engagement via common MCP grounding", () => {
    const g = mcpGround()({
      systemPrompt: "Which pages have the biggest engagement opportunities?",
      userPrompt: "{{input}}",
      input: engagementMcp,
    });
    assertX.equal(g.grounded, true);
    assertX.equal(g.source, "ga4");
    assertX.match(g.systemPrompt, /GA4 MCP Tools evidence rules/);
    assertX.match(g.userPrompt, /engagement_opportunities/);
    assertX.match(g.userPrompt, /low_engagement/);
    assertX.match(g.userPrompt, /"score": 32/);
    assertX.match(g.userPrompt, /"sessions": 1200/);
    assertX.match(g.systemPrompt, /Never calculate or replace the MCP score/);
  });

  check("GA4AI-MCP-2 structured landing MCP input", () => {
    const g = ga4Intel().applyAiGrounding({
      systemPrompt: "Show landing issues",
      userPrompt: "summarize",
      input: landingMcp,
    });
    assertX.equal(g.grounded, true);
    assertX.equal(g.source, "ga4");
    assertX.match(g.userPrompt, /landing_underperformance/);
    assertX.match(g.userPrompt, /"score": 41/);
  });

  check("GA4AI-MCP-3 structured acquisition MCP input", () => {
    const g = ga4Intel().applyAiGrounding({
      systemPrompt: "Summarize the acquisition opportunities.",
      userPrompt: "",
      input: acquisitionMcp,
    });
    assertX.equal(g.grounded, true);
    assertX.match(g.userPrompt, /acquisition_concentration/);
    assertX.match(g.userPrompt, /Organic Search/);
    assertX.match(g.systemPrompt, /sessionDefaultChannelGroup/);
  });

  check("GA4AI-MCP-4 page-performance DATA via IntelligenceContext", () => {
    const g = ga4Intel().applyAiGrounding({
      systemPrompt: "List top pages",
      userPrompt: "",
      input: pagePerfMcp,
    });
    assertX.equal(g.grounded, true);
    const section = g.intelligenceContext.capabilities.find(
      (c) => c.capability === "page_performance"
    );
    assertX.ok(section);
    assertX.equal(section.category, "data");
    assertX.equal(section.results[0].row_kind, "ranked_page");
    assertX.equal(section.results[0].opportunity_type, null);
    assertX.match(g.systemPrompt, /page_performance is DATA/);
  });

  check("GA4AI-MCP-5 multi-capability preserves all caps", () => {
    const g = ga4Intel().applyAiGrounding({
      systemPrompt: "Show me the biggest GA4 opportunities.",
      userPrompt: "",
      input: multiMcp,
    });
    assertX.equal(g.grounded, true);
    const caps = g.intelligenceContext.capabilities.map((c) => c.capability);
    for (const cap of [
      "engagement_opportunities",
      "landing_underperformance",
      "acquisition_concentration",
      "page_performance",
    ]) {
      assertX.ok(caps.includes(cap), cap);
      assertX.match(g.userPrompt, new RegExp(cap));
    }
  });

  check("GA4AI-MCP-6 empty MCP IntelligenceContext refuses frameworks", () => {
    const emptyCtx = ga4Intel().buildIntelligenceContext({
      property: "properties/1",
      capabilities: [
        {
          capability: "engagement_opportunities",
          results: [],
          count: 0,
        },
      ],
    });
    const g = ga4Intel().applyAiGrounding({
      systemPrompt: "Analyze GA4",
      userPrompt: "report",
      input: emptyCtx,
    });
    assertX.equal(g.grounded, true);
    assertX.equal(g.empty, true);
    assertX.match(g.systemPrompt, /No structured GA4 MCP opportunity\/data rows/);
    assertX.match(g.systemPrompt, /Do NOT invent frameworks/);
  });

  check("GA4AI-MCP-7 raw GA4 without MCP uses native grounding", () => {
    const g = grounding().applyGa4AiGrounding({
      systemPrompt: acquisitionQuestion,
      userPrompt: "",
      input: pageEventRows,
    });
    assertX.equal(g.grounded, true);
    assertX.equal(g.mode, "ga4_native");
    assertX.ok(!/GA4 MCP Tools evidence rules/.test(g.systemPrompt));
  });

  check("GA4AI-MCP-8 acquisition safety rules present", () => {
    const g = ga4Intel().applyAiGrounding({
      systemPrompt: "channels?",
      userPrompt: "",
      input: engagementMcp,
    });
    assertX.match(
      g.systemPrompt,
      /Never call pagePath, pageTitle, landingPage, or eventName/
    );
  });

  check("GA4AI-MCP-9 score preservation", () => {
    const g = ga4Intel().applyAiGrounding({
      systemPrompt: "scores",
      userPrompt: "",
      input: engagementMcp,
    });
    assertX.match(g.userPrompt, /"score": 32/);
    assertX.match(g.systemPrompt, /If score is 32, report Score: 32/);
    assertX.equal(
      g.intelligenceContext.capabilities[0].results[0].score,
      32
    );
  });

  check("GA4AI-MCP-10 metric preservation", () => {
    const g = ga4Intel().applyAiGrounding({
      systemPrompt: "metrics",
      userPrompt: "",
      input: engagementMcp,
    });
    assertX.match(g.userPrompt, /"sessions": 1200/);
    assertX.match(g.userPrompt, /"engagementRate": 0\.18/);
  });

  check("GA4AI-MCP-11 capability preservation", () => {
    const g = ga4Intel().applyAiGrounding({
      systemPrompt: "caps",
      userPrompt: "",
      input: engagementMcp,
    });
    assertX.equal(
      g.intelligenceContext.capabilities[0].capability,
      "engagement_opportunities"
    );
  });

  check("GA4AI-MCP-12 opportunity_type preservation", () => {
    const g = ga4Intel().applyAiGrounding({
      systemPrompt: "types",
      userPrompt: "",
      input: engagementMcp,
    });
    assertX.equal(
      g.intelligenceContext.capabilities[0].results[0].opportunity_type,
      "low_engagement"
    );
  });

  check("GA4AI-MCP-13 no invented metrics instruction", () => {
    const g = ga4Intel().applyAiGrounding({
      systemPrompt: "x",
      userPrompt: "",
      input: engagementMcp,
    });
    assertX.match(g.systemPrompt, /Never invent metrics/);
    assertX.ok(!/"revenue"/.test(g.userPrompt));
  });

  check("GA4AI-MCP-14 no invented opportunities instruction", () => {
    const g = ga4Intel().applyAiGrounding({
      systemPrompt: "x",
      userPrompt: "",
      input: engagementMcp,
    });
    assertX.match(g.systemPrompt, /Never invent.*opportunities/i);
  });

  check("GA4AI-MCP-15 no Most Critical Pages MCP interpretation", () => {
    const g = ga4Intel().applyAiGrounding({
      systemPrompt: "What does MCP mean here?",
      userPrompt: "",
      input: engagementMcp,
    });
    assertX.match(g.systemPrompt, /Never reinterpret "MCP"/);
    assertX.match(g.systemPrompt, /Most Critical Pages/);
  });

  check("GA4AI-MCP-16 no cross-event summation", () => {
    const g = ga4Intel().applyAiGrounding({
      systemPrompt: "totals",
      userPrompt: "",
      input: engagementMcp,
    });
    assertX.match(
      g.systemPrompt,
      /Never sum page_view \+ user_engagement \+ session_start/
    );
  });

  check("GA4AI-MCP-17 latest runtime MCP preferred over stale trigger input", () => {
    const {
      resolveExpressionInput,
    } = require("../services/workflowNodes.service");
    const resolved = resolveExpressionInput({
      input: { source: "manual" },
      inputItems: engagementMcp,
    });
    const payload = Array.isArray(resolved) ? resolved[0] : resolved;
    assertX.equal(payload.capability, "engagement_opportunities");
    assertX.equal(payload.score, 32);

    const {
      resolveEffectiveAiPrompts,
    } = require("../services/workflowAiPromptPreview.util");
    const effective = resolveEffectiveAiPrompts({
      node: {
        type: "ai",
        data: {
          systemPrompt: "Which pages have the biggest engagement opportunities?",
          prompt: "{{input}}",
        },
      },
      context: {
        input: { source: "manual" },
        inputItems: engagementMcp,
        steps: {},
      },
    });
    assertX.equal(effective.ga4Grounded, true);
    assertX.equal(effective.mcpGroundingSource, "ga4");
    assertX.match(effective.userPrompt, /engagement_opportunities/);
    assertX.match(effective.userPrompt, /"score": 32/);
    assertX.ok(!/"source": "manual"/.test(effective.userPrompt));
    assertX.match(effective.systemPrompt, /Never reinterpret "MCP"/);
  });

  check("GA4AI-MCP-18 common facade does not steal GSC grounding", () => {
    const gscItems = [
      {
        json: {
          __gscIntelligence: true,
          capability: "ctr_opportunities",
          opportunity_type: "ctr_opportunity",
          entity: { query: "seo tools", page: "https://ex.com/seo" },
          metrics: { clicks: 2, impressions: 200, ctr: 0.01, position: 8 },
          reason: "High impressions low CTR",
          recommendation: "Rewrite title",
          score: 70,
          property: "https://ex.com/",
          source: "google_search_console",
        },
      },
    ];
    const g = mcpGround()({
      systemPrompt: "What should I prioritize?",
      userPrompt: "{{input}}",
      input: gscItems,
    });
    assertX.equal(g.grounded, true);
    assertX.equal(g.source, "gsc");
    assertX.match(g.systemPrompt, /GSC MCP evidence rules/);
    assertX.ok(!/GA4 MCP Tools evidence rules/.test(g.systemPrompt));
  });

  section("STEP 9C — MCP source routing (no GSC property for GA4)");

  const {
    applyMcpAiGrounding,
    detectMcpIntelligenceSource,
  } = require("../services/workflowMcpAiGrounding");

  check("9C-1 GA4 only — GA4 grounding, no GSC property required", () => {
    const emptyEnvelope = [
      {
        json: {
          __ga4Intelligence: true,
          __ga4CapabilitySection: true,
          capability: "engagement_opportunities",
          category: "intelligence",
          results: [],
          count: 0,
          filters: {},
          source: "google_analytics",
        },
      },
    ];
    assertX.equal(detectMcpIntelligenceSource(emptyEnvelope), "ga4");
    const g = applyMcpAiGrounding({
      systemPrompt: "Which pages have the biggest engagement opportunities?",
      userPrompt: "{{input}}",
      input: emptyEnvelope,
    });
    assertX.equal(g.grounded, true);
    assertX.equal(g.source, "ga4");
    assertX.ok(!/GSC MCP evidence rules/.test(g.systemPrompt));
    assertX.match(g.systemPrompt, /GA4 MCP Tools evidence rules/);

    const withRows = applyMcpAiGrounding({
      systemPrompt: "Biggest engagement opportunities?",
      userPrompt: "{{input}}",
      input: engagementMcp,
    });
    assertX.equal(withRows.grounded, true);
    assertX.equal(withRows.source, "ga4");
    assertX.match(withRows.userPrompt, /"score": 32/);
  });

  check("9C-2 GSC only — GSC grounding unchanged, GA4 not applied", () => {
    const gscItems = [
      {
        json: {
          __gscIntelligence: true,
          capability: "ctr_opportunities",
          opportunity_type: "ctr_opportunity",
          entity: { query: "seo tools", page: "https://ex.com/seo" },
          metrics: { clicks: 2, impressions: 200, ctr: 0.01, position: 8 },
          reason: "High impressions low CTR",
          recommendation: "Rewrite title",
          score: 70,
          property: "https://ex.com/",
          source: "google_search_console",
        },
      },
    ];
    assertX.equal(detectMcpIntelligenceSource(gscItems), "gsc");
    const g = applyMcpAiGrounding({
      systemPrompt: "What should I prioritize?",
      userPrompt: "{{input}}",
      input: gscItems,
    });
    assertX.equal(g.grounded, true);
    assertX.equal(g.source, "gsc");
    assertX.match(g.systemPrompt, /GSC MCP evidence rules/);
    assertX.ok(!/GA4 MCP Tools evidence rules/.test(g.systemPrompt));
  });

  check("9C-3 Neither — no MCP grounding, no GSC property error", () => {
    assertX.equal(
      detectMcpIntelligenceSource([{ json: { source: "manual", triggered: true } }]),
      null
    );
    const g = applyMcpAiGrounding({
      systemPrompt: "Hello",
      userPrompt: "{{input}}",
      input: [{ json: { hello: "world" } }],
    });
    assertX.equal(g.grounded, false);
    assertX.equal(g.source, null);
    assertX.equal(g.intelligenceContext, null);
  });

  check("9C-4 GA4 MCP + stale manual — latest GA4 wins, no GSC init", () => {
    const {
      resolveEffectiveAiPrompts,
    } = require("../services/workflowAiPromptPreview.util");
    const effective = resolveEffectiveAiPrompts({
      node: {
        type: "ai",
        data: {
          systemPrompt: "Which pages have the biggest engagement opportunities?",
          prompt: "{{input}}",
        },
      },
      context: {
        input: { source: "manual", triggered: true },
        inputItems: engagementMcp,
        steps: {},
      },
    });
    assertX.equal(effective.mcpGroundingSource, "ga4");
    assertX.equal(effective.ga4Grounded, true);
    assertX.equal(effective.gscGrounded, false);
    assertX.match(effective.userPrompt, /engagement_opportunities/);
  });

  check("9C-5 GA4 MCP + event/page data — GA4 grounding + event safety", () => {
    const g = applyMcpAiGrounding({
      systemPrompt: "Summarize engagement opportunities",
      userPrompt: "{{input}}",
      input: engagementMcp,
    });
    assertX.equal(g.source, "ga4");
    assertX.match(g.systemPrompt, /Never sum page_view/);
    assertX.match(g.systemPrompt, /Never call pagePath/);
  });

  check("9C-6 preview and AI Generate share facade routing", () => {
    const {
      resolveEffectiveAiPrompts,
    } = require("../services/workflowAiPromptPreview.util");
    const preview = resolveEffectiveAiPrompts({
      node: {
        type: "ai",
        data: {
          systemPrompt: "Biggest engagement opportunities?",
          prompt: "{{input}}",
        },
      },
      context: {
        input: {},
        inputItems: engagementMcp,
        steps: {},
      },
    });
    assertX.equal(preview.mcpGroundingSource, "ga4");

    // AI Generate test-complete path uses the same applyMcpAiGrounding.
    const gen = applyMcpAiGrounding({
      systemPrompt: "Biggest engagement opportunities?",
      userPrompt: "data",
      input: engagementMcp[0].json,
    });
    assertX.equal(gen.source, "ga4");
    assertX.equal(gen.grounded, true);
  });
};

module.exports = { registerGa4AiGroundingTests };
