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
    assertX.ok(!/"score_breakdown"/.test(g.userPrompt));
    assertX.ok(!/"__ga4Intelligence"/.test(g.userPrompt));
    assertX.ok(
      !/"traffic": 20/.test(g.userPrompt),
      "score_breakdown internals must not reach AI prompt"
    );
    // {{input}} dump must not be re-embedded as the User request body.
    assertX.ok(!/User request:\s*\[/.test(g.userPrompt));
    assertX.match(
      g.userPrompt,
      /Use the GA4 MCP opportunities\/data above/
    );
  });

  check("GA4AI-MCP-1b compact payload shape for landing opportunities", () => {
    const g = ga4Intel().applyAiGrounding({
      systemPrompt: "Report landing opportunities",
      userPrompt: "list them",
      input: landingMcp,
    });
    assertX.ok(g.compactAiPayload);
    assertX.equal(g.compactAiPayload.source, "google_analytics");
    assertX.equal(g.compactAiPayload.opportunities.length, 1);
    const row = g.compactAiPayload.opportunities[0];
    assertX.equal(row.rank, 1);
    assertX.equal(row.landingPage, "/lp");
    assertX.equal(row.score, 41);
    assertX.equal(row.sessions, 800);
    assertX.ok(!("score_breakdown" in row));
    assertX.ok(!("filters" in row));
    assertX.ok(!("reason" in row), "reason omitted from AI input");
    assertX.ok(!("recommendation" in row), "recommendation omitted from AI input");
    assertX.match(g.userPrompt, /"landingPage": "\/lp"/);
    assertX.match(g.systemPrompt, /OUTPUT CONTRACT/);
    assertX.match(g.systemPrompt, /Do NOT regenerate, paraphrase, or echo MCP reason/);
    assertX.equal(g.landingOutputCompactness, true);
  });

  check("GA4AI-MCP-1c merge restores MCP reason/recommendation beside AI rows", () => {
    const {
      applyAiGrounding,
      mergeAiOpportunitiesWithMcpDetails,
    } = ga4Intel();
    const g = applyAiGrounding({
      systemPrompt: "Report landing opportunities",
      userPrompt: "list them",
      input: landingMcp,
    });
    const aiText = JSON.stringify({
      opportunities: [
        {
          rank: 1,
          landingPage: "/lp",
          sessions: 800,
          engagementRate: 0.12,
          bounceRate: 0.81,
          score: 41,
        },
      ],
    });
    const merged = mergeAiOpportunitiesWithMcpDetails({
      aiText,
      intelligenceContext: g.intelligenceContext,
    });
    assertX.equal(merged.enrichedOpportunities.length, 1);
    assertX.equal(merged.enrichedOpportunities[0].score, 41);
    assertX.equal(
      merged.enrichedOpportunities[0].reason,
      "Landing /lp underperforms on engagement"
    );
    assertX.equal(
      merged.enrichedOpportunities[0].recommendation,
      "Tighten landing message match on /lp"
    );
    assertX.ok(!/"reason"/.test(g.userPrompt));
  });

  check("GA4AI-MCP-1d opportunities coerced to real array (not JSON string)", () => {
    const {
      parseAiResponseJson,
      coerceOpportunitiesArray,
      normalizeAiStructuredJson,
      deriveItems,
    } = require("../services/workflowNodes.service");
    const { normalizeItem } = require("../services/workflowProvenance.service");

    const asStringInside = {
      opportunities: JSON.stringify([
        {
          rank: 1,
          landingPage: "/lp",
          sessions: 19,
          engagementRate: 0.1053,
          bounceRate: 0.8947,
          score: 0.44,
        },
      ]),
    };
    const normalized = normalizeAiStructuredJson(asStringInside);
    assertX.ok(Array.isArray(normalized.opportunities));
    assertX.equal(typeof normalized.opportunities, "object");
    assertX.equal(normalized.opportunities.length, 1);
    assertX.notEqual(typeof normalized.opportunities, "string");

    const fromText = parseAiResponseJson(JSON.stringify(asStringInside));
    assertX.ok(Array.isArray(fromText.opportunities));
    assertX.equal(fromText.opportunities[0].landingPage, "/lp");

    const doubleWrapped = JSON.stringify(JSON.stringify({ opportunities: [{ rank: 1, score: 1 }] }));
    // text body is "\"{...}\"" — extract then unwrap once
    const unwrapped = parseAiResponseJson(JSON.parse(doubleWrapped));
    assertX.ok(Array.isArray(unwrapped.opportunities));

    const llmOutput = {
      text: JSON.stringify({
        opportunities: [
          {
            rank: 1,
            landingPage: "/lp",
            sessions: 19,
            engagementRate: 0.1053,
            bounceRate: 0.8947,
            score: 0.44,
          },
        ],
      }),
      json: fromText,
      opportunities: fromText.opportunities,
      isLlm: true,
      enrichedOpportunities: [
        {
          rank: 1,
          landingPage: "/lp",
          sessions: 19,
          engagementRate: 0.1053,
          bounceRate: 0.8947,
          score: 0.44,
          reason: "Landing /lp underperforms on engagement",
          recommendation: "Tighten landing message match on /lp",
        },
      ],
      mcpOpportunityDetails: [
        {
          rank: 1,
          landingPage: "/lp",
          reason: "Landing /lp underperforms on engagement",
          recommendation: "Tighten landing message match on /lp",
        },
      ],
    };
    const item = normalizeItem(deriveItems(llmOutput)[0], 0);
    assertX.ok(Array.isArray(item.json.opportunities));
    assertX.equal(typeof item.json.opportunities, "object");
    assertX.notEqual(typeof item.json.opportunities, "string");
    assertX.equal(coerceOpportunitiesArray(item.json.opportunities).length, 1);
  });

  check("GA4AI-MCP-1e Result renders human report from json.opportunities + MCP details", async () => {
    const {
      handlers,
      formatGa4LandingIntelligenceReport,
      resolveLandingOpportunitiesForResult,
    } = require("../services/workflowNodes.service");

    const opportunities = Array.from({ length: 50 }, (_, i) => ({
      rank: i + 1,
      landingPage: `/page-${i + 1}`,
      sessions: 10 + i,
      engagementRate: 0.1,
      bounceRate: 0.9,
      score: Number((0.5 - i * 0.01).toFixed(2)),
    }));
    const mcpDetails = opportunities.map((o) => ({
      rank: o.rank,
      landingPage: o.landingPage,
      metrics: {
        sessions: o.sessions,
        engagementRate: o.engagementRate,
        bounceRate: o.bounceRate,
      },
      score: o.score,
      reason: `MCP reason for ${o.landingPage}`,
      recommendation: `MCP rec for ${o.landingPage}`,
    }));
    const enriched = opportunities.map((o, i) => ({
      ...o,
      reason: mcpDetails[i].reason,
      recommendation: mcpDetails[i].recommendation,
    }));

    const llmOut = {
      text: JSON.stringify({ opportunities }),
      json: { opportunities },
      opportunities,
      isLlm: true,
      enrichedOpportunities: enriched,
      mcpOpportunityDetails: mcpDetails,
    };

    assertX.ok(Array.isArray(llmOut.json.opportunities));
    assertX.notEqual(typeof llmOut.json.opportunities, "string");

    const resolved = resolveLandingOpportunitiesForResult(llmOut, llmOut.text);
    assertX.equal(resolved.opportunities.length, 50);
    assertX.match(resolved.report, /GA4 Intelligence Report/);
    assertX.match(resolved.report, /Landing Underperformance Opportunities/);
    assertX.match(resolved.report, /1\. Landing Page: \/page-1/);
    assertX.match(resolved.report, /50\. Landing Page: \/page-50/);
    assertX.match(resolved.report, /MCP Score: 0\.5/);
    assertX.match(resolved.report, /Reason: MCP reason for \/page-1/);
    assertX.match(resolved.report, /Recommendation: MCP rec for \/page-50/);
    assertX.ok(!/^\s*\{/.test(resolved.report.trim()), "not raw JSON");
    assertX.ok(!/"opportunities"\s*:/.test(resolved.report), "not raw JSON key");

    // Stringified opportunities field still parses once
    const fromStringField = resolveLandingOpportunitiesForResult(
      {
        ...llmOut,
        json: { opportunities: JSON.stringify(opportunities) },
        opportunities: undefined,
      },
      "plain prose fallback should not win"
    );
    assertX.equal(fromStringField.opportunities.length, 50);

    const report = await handlers.result(
      { id: "result-1", type: "result", data: { mapFrom: "{{steps.ai-1.text}}" } },
      {
        input: {},
        steps: { "ai-1": llmOut },
        inputItems: [{ json: llmOut }],
      }
    );
    assertX.equal(typeof report.output.result, "string");
    assertX.match(report.output.result, /GA4 Intelligence Report/);
    assertX.match(report.output.result, /50\. Landing Page: \/page-50/);
    assertX.match(report.output.result, /Reason: MCP reason for \/page-1/);
    assertX.equal(report.resolved.landingOpportunities, 50);
    assertX.equal(report.resolved.landingReport, true);

    // Prose AI text without opportunities → unchanged
    const prose = await handlers.result(
      { id: "result-1", type: "result", data: { mapFrom: "{{steps.ai-1.text}}" } },
      {
        input: {},
        steps: {
          "ai-1": { text: "Here is a plain summary.", isLlm: true },
        },
        inputItems: [],
      }
    );
    assertX.equal(prose.output.result, "Here is a plain summary.");

    const sample = formatGa4LandingIntelligenceReport({
      opportunities: opportunities.slice(0, 1),
      mcpDetails: mcpDetails.slice(0, 1),
    });
    assertX.match(sample, /Engagement Rate: 10\.00%/);
    assertX.match(sample, /Bounce Rate: 90\.00%/);
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

  section("STEP 10A — page_performance DATA grounding/reporting");

  check("10A-1 page_performance DATA-only — no false empty statement", () => {
    const manyPages = Array.from({ length: 60 }, (_, i) => ({
      json: {
        capability: "page_performance",
        row_kind: "ranked_page",
        opportunity_type: null,
        rank: i + 1,
        entity: {
          pagePath: i === 0 ? "/" : `/page-${i}/`,
          label: i === 0 ? "/" : `/page-${i}/`,
        },
        metrics: { sessions: 500 - i },
        sortMetric: "sessions",
        sortDirection: "desc",
        reason: "Ranked by sessions",
        __ga4Intelligence: true,
        source: "google_analytics",
      },
    }));
    const g = ga4Intel().applyAiGrounding({
      systemPrompt:
        "Which pages got the most sessions in the last 30 days? Show me the top pages and their sessions.",
      userPrompt: "",
      input: manyPages,
    });
    assertX.equal(g.grounded, true);
    assertX.equal(g.empty, false);
    assertX.equal(g.evidence.hasDataRows, true);
    assertX.equal(g.evidence.hasOpportunityRows, false);
    assertX.equal(g.evidence.hasAnyStructuredMcpRows, true);
    assertX.equal(g.evidence.dataRowCount, 60);
    assertX.match(g.systemPrompt, /Structured GA4 MCP page-performance data was provided/);
    assertX.match(g.systemPrompt, /Do NOT say: "No structured GA4 MCP opportunity\/data rows/);
    assertX.ok(
      !/Respond exactly: "No structured GA4 MCP opportunity\/data rows/.test(
        g.systemPrompt
      )
    );
    assertX.match(g.systemPrompt, /Do NOT invent a Data limitations section/);
    assertX.match(g.userPrompt, /page_performance/);
    assertX.match(g.userPrompt, /"rank": 1/);
    assertX.match(g.systemPrompt, /hasDataRows: true/);
    assertX.ok(
      !/"score_breakdown"/.test(g.userPrompt),
      "compact AI payload must omit score_breakdown"
    );
  });

  check("10A-2 opportunity-only — no claim that DATA rows exist", () => {
    const g = ga4Intel().applyAiGrounding({
      systemPrompt: "Biggest engagement opportunities?",
      userPrompt: "",
      input: engagementMcp,
    });
    assertX.equal(g.evidence.hasOpportunityRows, true);
    assertX.equal(g.evidence.hasDataRows, false);
    assertX.equal(g.evidence.hasAnyStructuredMcpRows, true);
    assertX.match(
      g.systemPrompt,
      /no page_performance DATA rows were provided/i
    );
    assertX.ok(
      !/Structured GA4 MCP page-performance data was provided/.test(
        g.systemPrompt
      )
    );
  });

  check("10A-3 opportunity + page_performance — both preserved", () => {
    const g = ga4Intel().applyAiGrounding({
      systemPrompt: "Show opportunities and top pages",
      userPrompt: "",
      input: [...engagementMcp, ...pagePerfMcp],
    });
    assertX.equal(g.evidence.hasOpportunityRows, true);
    assertX.equal(g.evidence.hasDataRows, true);
    assertX.match(
      g.systemPrompt,
      /Both opportunity and DATA capability rows are present/
    );
    assertX.match(g.userPrompt, /engagement_opportunities/);
    assertX.match(g.userPrompt, /page_performance/);
  });

  check("10A-4 truly empty GA4 MCP — empty behavior remains", () => {
    const emptyCtx = ga4Intel().buildIntelligenceContext({
      property: "properties/1",
      capabilities: [
        {
          capability: "page_performance",
          category: "data",
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
    assertX.equal(g.empty, true);
    assertX.equal(g.evidence.hasAnyStructuredMcpRows, false);
    assertX.equal(g.evidence.hasDataRows, false);
    assertX.match(
      g.systemPrompt,
      /Respond exactly: "No structured GA4 MCP opportunity\/data rows/
    );
  });

  check("10A-5 page_performance + actual warning — no fabricated limitation", () => {
    const ctx = ga4Intel().buildIntelligenceContext({
      property: "properties/1",
      capabilities: [
        {
          capability: "page_performance",
          category: "data",
          results: pagePerfMcp.map((it) => it.json),
          count: 1,
        },
      ],
      warnings: [
        {
          code: "GA4_EVENT_CROSS_METRIC_RISK",
          capability: "page_performance",
          message:
            "eventName is present. page_performance ranks row-level page×event rows without summing sessions/users/page views across events.",
        },
      ],
    });
    const g = ga4Intel().applyAiGrounding({
      systemPrompt: "Top pages by sessions",
      userPrompt: "",
      input: ctx,
    });
    assertX.equal(g.evidence.hasDataRows, true);
    assertX.equal(g.evidence.hasWarnings, true);
    assertX.equal(g.empty, false);
    assertX.match(g.systemPrompt, /GA4_EVENT_CROSS_METRIC_RISK/);
    assertX.match(g.systemPrompt, /MCP warnings \(authoritative/);
    assertX.ok(!/Do NOT invent a Data limitations section/.test(g.systemPrompt));
    assertX.match(
      g.systemPrompt,
      /Structured GA4 MCP page-performance data was provided/
    );
  });

  section("STEP 9D — acquisition handoff + AI warning fidelity");

  check("9D-1 flat channel rows → successful acquisition → AI", () => {
    const {
      processUpstreamItems,
    } = require("../../plugins/ga4-mcp/src/adapters/processUpstream");
    const FIX = require("../../plugins/ga4-mcp/src/testing/fixtures/acquisition-rows.json");
    const inputItems = FIX.VERIFIED_LIVE_CHANNEL_9.map((json) => ({ json }));
    const proc = processUpstreamItems({
      capabilities: ["acquisition_concentration"],
      inputItems,
      nodeData: { propertyId: "properties/1" },
    });
    assertX.equal(proc.ok, true);
    assertX.equal(inputItems.length, 9);
    assertX.equal(proc.items.length, 1);
    assertX.notEqual(proc.items.length, inputItems.length);
    assertX.equal(proc.items[0].json.capability, "acquisition_concentration");
    assertX.equal(
      proc.items[0].json.entity.sessionDefaultChannelGroup,
      "Direct"
    );
    assertX.ok(
      !(proc.output.warnings || []).some(
        (w) => w.code === "GA4_ACQUISITION_DIM_MISSING"
      )
    );

    const g = mcpGround()({
      systemPrompt: "Which acquisition channels are concentrated?",
      userPrompt: "",
      input: proc.items,
    });
    assertX.equal(g.grounded, true);
    assertX.equal(g.source, "ga4");
    assertX.equal(g.empty, false);
    assertX.equal(g.evidence.hasOpportunityRows, true);
    assertX.match(g.userPrompt, /sessionDefaultChannelGroup/);
    assertX.match(g.userPrompt, /Direct/);
    assertX.match(g.systemPrompt, /do NOT claim that dimension is missing/i);
    assertX.match(
      g.systemPrompt,
      /acquisition_concentration opportunities are present/
    );
    assertX.ok(
      !/Respond exactly: "No structured GA4 MCP opportunity\/data rows/.test(
        g.systemPrompt
      )
    );
    // Phrase may appear only as a forbidden invention rule, never as required response
    assertX.ok(
      !/Respond exactly:[\s\S]{0,80}valid acquisition dimension was not provided/i.test(
        g.systemPrompt
      )
    );
  });

  check("9D-2 empty + GA4_NO_MATCHES → not missing dimension", () => {
    const ctx = ga4Intel().buildIntelligenceContext({
      property: "properties/1",
      capabilities: [
        {
          capability: "acquisition_concentration",
          results: [],
          count: 0,
        },
      ],
      warnings: [
        {
          code: "GA4_NO_MATCHES",
          capability: "acquisition_concentration",
          message:
            "No acquisition concentration opportunities met the threshold (share >= 0.35, volume >= 100) for sessionDefaultChannelGroup.",
          selectedDimension: "sessionDefaultChannelGroup",
        },
      ],
    });
    const g = ga4Intel().applyAiGrounding({
      systemPrompt: "Show acquisition concentration",
      userPrompt: "",
      input: ctx,
    });
    assertX.equal(g.empty, true);
    assertX.equal(g.evidence.hasWarnings, true);
    assertX.match(g.systemPrompt, /GA4_NO_MATCHES/);
    assertX.match(
      g.systemPrompt,
      /no qualifying opportunities\/matches/i
    );
    assertX.match(
      g.systemPrompt,
      /Do NOT claim the acquisition dimension was missing/
    );
    assertX.ok(
      !/Respond exactly: "No structured GA4 MCP opportunity\/data rows/.test(
        g.systemPrompt
      )
    );
  });

  check("9D-3 empty + GA4_ACQUISITION_DIM_MISSING → report actual warning", () => {
    const {
      processUpstreamItems,
    } = require("../../plugins/ga4-mcp/src/adapters/processUpstream");
    const proc = processUpstreamItems({
      capabilities: ["acquisition_concentration"],
      inputItems: [
        { json: { pagePath: "/pricing", sessions: 2000, totalUsers: 1800 } },
      ],
      nodeData: {},
    });
    assertX.equal(proc.ok, true);
    assertX.equal(proc.items.length, 1);
    assertX.ok(
      (proc.output.warnings || []).some(
        (w) => w.code === "GA4_ACQUISITION_DIM_MISSING"
      )
    );

    const g = mcpGround()({
      systemPrompt: "Show acquisition concentration",
      userPrompt: "",
      input: proc.items,
    });
    assertX.equal(g.evidence.hasWarnings, true);
    assertX.match(g.systemPrompt, /GA4_ACQUISITION_DIM_MISSING/);
    assertX.match(g.systemPrompt, /truly\s+absent|missing-dimension warning/i);
    assertX.ok(
      !/Respond exactly: "No structured GA4 MCP opportunity\/data rows/.test(
        g.systemPrompt
      )
    );
  });

  check("9D-4 channel success forbids invented missing-dimension refusal", () => {
    const g = ga4Intel().applyAiGrounding({
      systemPrompt: "Which channels have concentration opportunities?",
      userPrompt: "",
      input: acquisitionMcp,
    });
    assertX.equal(g.evidence.hasOpportunityRows, true);
    assertX.match(g.userPrompt, /sessionDefaultChannelGroup|Organic Search/);
    assertX.match(
      g.systemPrompt,
      /Never invent an acquisition dimension/
    );
    assertX.match(
      g.systemPrompt,
      /do NOT claim that dimension is missing/i
    );
    assertX.match(
      g.systemPrompt,
      /Do not treat upstream native GA4 row count as MCP opportunity count/
    );
    assertX.match(g.systemPrompt, /Never recalculate or replace the MCP score/);
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

  section("STEP 8E — zero-result capability sections in AI grounding");

  check("8E-1 landing zero + GA4_NO_MATCHES — no invent opportunities", () => {
    const items = [
      {
        json: {
          __ga4Intelligence: true,
          __ga4CapabilitySection: true,
          capability: "landing_underperformance",
          category: "intelligence",
          results: [],
          count: 0,
          filters: {},
          source: "google_analytics",
          warnings: [
            {
              code: "GA4_NO_MATCHES",
              message:
                "No landing underperformance opportunities matched the configured filters.",
              capability: "landing_underperformance",
            },
          ],
        },
      },
    ];
    const g = applyMcpAiGrounding({
      systemPrompt:
        "Analyze the structured GA4 MCP landing underperformance opportunities.",
      userPrompt: "Which landing pages are underperforming?",
      input: items,
    });
    assertX.equal(g.source, "ga4");
    assertX.equal(g.evidence.hasZeroResultCapabilitySections, true);
    assertX.match(g.systemPrompt, /GA4_NO_MATCHES/);
    assertX.match(g.systemPrompt, /zero qualifying|zeroResult/i);
    assertX.match(g.systemPrompt, /not selected/i);
    assertX.ok(
      !/Respond exactly: "No structured GA4 MCP opportunity\/data rows/.test(
        g.systemPrompt
      )
    );
  });

  check("8E-2 landing zero + unresolved warning preserved", () => {
    const items = [
      {
        json: {
          __ga4Intelligence: true,
          __ga4CapabilitySection: true,
          capability: "landing_underperformance",
          category: "intelligence",
          results: [],
          count: 0,
          filters: {},
          source: "google_analytics",
          warnings: [
            {
              code: "GA4_LANDING_ENTITY_UNRESOLVED",
              message: 'landingPage was unresolved ("(not set)").',
              capability: "landing_underperformance",
            },
            {
              code: "GA4_NO_MATCHES",
              message: "No landing underperformance opportunities matched.",
              capability: "landing_underperformance",
            },
          ],
        },
      },
    ];
    const g = applyMcpAiGrounding({
      systemPrompt:
        "Analyze the structured GA4 MCP landing underperformance opportunities.",
      userPrompt: "Which landing pages are underperforming?",
      input: items,
    });
    assertX.match(g.systemPrompt, /GA4_LANDING_ENTITY_UNRESOLVED/);
    assertX.match(g.userPrompt, /GA4_LANDING_ENTITY_UNRESOLVED|landing_underperformance/);
  });

  check("8E-3 landing zero + page DATA — both acknowledged", () => {
    const items = [
      {
        json: {
          __ga4Intelligence: true,
          __ga4CapabilitySection: true,
          capability: "landing_underperformance",
          category: "intelligence",
          results: [],
          count: 0,
          filters: {},
          source: "google_analytics",
          warnings: [
            {
              code: "GA4_NO_MATCHES",
              message: "No landing underperformance opportunities matched.",
              capability: "landing_underperformance",
            },
          ],
        },
      },
      {
        json: {
          __ga4Intelligence: true,
          capability: "page_performance",
          opportunity_type: null,
          row_kind: "ranked_page",
          rank: 1,
          entity: { pagePath: "/", label: "/" },
          metrics: { sessions: 100 },
          sortMetric: "sessions",
          sortDirection: "desc",
          source: "google_analytics",
        },
      },
    ];
    const g = applyMcpAiGrounding({
      systemPrompt:
        "Analyze the structured GA4 MCP landing underperformance opportunities.",
      userPrompt: "Summarize landing and page performance.",
      input: items,
    });
    assertX.equal(g.empty, false);
    assertX.equal(g.evidence.hasDataRows, true);
    assertX.equal(g.evidence.hasZeroResultCapabilitySections, true);
    assertX.match(g.userPrompt, /landing_underperformance/);
    assertX.match(g.userPrompt, /page_performance/);
    assertX.match(g.systemPrompt, /zero qualifying|zeroResult|unselected/i);
    assertX.ok(
      !/Respond exactly: "No structured GA4 MCP opportunity\/data rows/.test(
        g.systemPrompt
      )
    );
    assertX.ok(!/only page_performance was selected/i.test(g.systemPrompt));
  });

  check("8E-4 all-four zero intel + page DATA — execution summary", () => {
    const items = [
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
          warnings: [
            { code: "GA4_NO_MATCHES", capability: "engagement_opportunities" },
          ],
        },
      },
      {
        json: {
          __ga4Intelligence: true,
          __ga4CapabilitySection: true,
          capability: "landing_underperformance",
          category: "intelligence",
          results: [],
          count: 0,
          filters: {},
          source: "google_analytics",
          warnings: [
            { code: "GA4_NO_MATCHES", capability: "landing_underperformance" },
          ],
        },
      },
      {
        json: {
          __ga4Intelligence: true,
          __ga4CapabilitySection: true,
          capability: "acquisition_concentration",
          category: "intelligence",
          results: [],
          count: 0,
          filters: {},
          source: "google_analytics",
          warnings: [
            {
              code: "GA4_ACQUISITION_DIM_MISSING",
              capability: "acquisition_concentration",
            },
          ],
        },
      },
      {
        json: {
          __ga4Intelligence: true,
          capability: "page_performance",
          opportunity_type: null,
          row_kind: "ranked_page",
          rank: 1,
          entity: { pagePath: "/", label: "/" },
          metrics: { sessions: 50 },
          sortMetric: "sessions",
          sortDirection: "desc",
          source: "google_analytics",
        },
      },
    ];
    const g = applyMcpAiGrounding({
      systemPrompt: "Summarize the GA4 opportunities and page performance data.",
      userPrompt: "What did GA4 MCP find?",
      input: items,
    });
    assertX.equal(g.empty, false);
    assertX.equal(g.evidence.hasDataRows, true);
    assertX.equal(g.evidence.zeroResultCapabilityCount, 3);
    assertX.match(g.userPrompt, /engagement_opportunities/);
    assertX.match(g.userPrompt, /landing_underperformance/);
    assertX.match(g.userPrompt, /acquisition_concentration/);
    assertX.match(g.userPrompt, /page_performance/);
    assertX.match(g.systemPrompt, /Capability execution summary/);
    assertX.match(g.systemPrompt, /GA4_ACQUISITION_DIM_MISSING/);
    assertX.ok(
      !/Respond exactly: "No structured GA4 MCP opportunity\/data rows/.test(
        g.systemPrompt
      )
    );
  });
};

module.exports = { registerGa4AiGroundingTests };
