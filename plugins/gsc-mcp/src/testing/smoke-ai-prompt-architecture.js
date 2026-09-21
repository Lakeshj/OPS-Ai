/**
 * Architecture regression: user Instructions PRIMARY, GSC grounding SECONDARY.
 * Preview/execution must not treat internal rules as replacing user instructions.
 */
const assert = require("node:assert/strict");
const ctx = require("../contracts/intelligenceContext");

const PROPERTY = "https://example.com/";
const PERIOD = { start: "2026-08-01", end: "2026-08-31" };

const sampleContext = ctx.buildIntelligenceContext({
  property: PROPERTY,
  period: PERIOD,
  capabilities: [
    {
      capability: "ctr_opportunities",
      filters: {},
      count: 1,
      results: [
        {
          opportunity_type: "ctr_opportunity",
          capability: "ctr_opportunities",
          entity: { query: "seo tools", page: "https://example.com/a" },
          metrics: { clicks: 0, impressions: 145, ctr: 0, position: 14.6 },
          score: 7,
          reason: "145 impressions, 0 clicks",
          recommendation: "Rewrite title and meta description",
        },
      ],
    },
    {
      capability: "ranking_opportunities",
      filters: {},
      count: 1,
      results: [
        {
          opportunity_type: "ranking_opportunity",
          capability: "ranking_opportunities",
          entity: { query: "seo tools", page: "https://example.com/a" },
          metrics: { clicks: 0, impressions: 145, ctr: 0, position: 14.6 },
          score: 10,
          reason: "Position 14.6 with impressions",
          recommendation: "Strengthen on-page relevance",
        },
      ],
    },
  ],
});

console.log("smoke-ai-prompt-architecture");

const USER =
  "Analyze my GSC data and identify the biggest opportunities to improve CTR and rankings.";

const grounded = ctx.applyAiGrounding({
  systemPrompt: USER,
  userPrompt: "{{input}} resolved data",
  input: sampleContext,
});

assert.equal(grounded.grounded, true);
assert.equal(grounded.groundingApplied, true);
assert.equal(grounded.userInstructions, USER);

// 1–3. User instructions primary; grounding applied; not replaced
const sys = grounded.systemPrompt;
const instrIdx = sys.indexOf("## Instructions");
const rulesIdx = sys.indexOf("## GSC MCP evidence rules");
assert.ok(instrIdx >= 0, "Instructions section present");
assert.ok(rulesIdx > instrIdx, "evidence rules after Instructions");
assert.ok(sys.indexOf(USER) < rulesIdx, "user text before evidence rules");
assert.ok(!sys.includes("## Extra workflow instructions"));

// 4. No forced report totals footer (preferred summary is optional guidance only)
assert.ok(!sys.includes("Total opportunities received"));
assert.ok(!sys.includes("Opportunity types represented"));
assert.ok(!/\nOpportunity:\nType:\n/.test(sys));
assert.ok(sys.includes("EXISTING MCP score"));
assert.ok(sys.includes("Do not invent a new scoring methodology"));
assert.ok(sys.includes("materially expand"));

// 5. MCP types/metrics preserved in user message JSON
assert.ok(grounded.userPrompt.includes("ctr_opportunity"));
assert.ok(grounded.userPrompt.includes("ranking_opportunity"));
assert.ok(grounded.userPrompt.includes("145"));
assert.ok(grounded.userPrompt.includes("14.6"));
assert.ok(grounded.userPrompt.includes("ctr_opportunities"));
assert.ok(grounded.userPrompt.includes("ranking_opportunities"));

// 5b. Unsupported expansions / evaluative language rejected
const badExpansion = [
  "This page shows a lack of engagement despite visibility.",
  "Align better with search intent.",
  "Focus on enhancing content depth for the primary intent.",
  "This can significantly impact both CTR and rankings.",
  "All opportunities are actionable.",
].join("\n");
assert.equal(
  ctx.rejectsUnsupportedSeoExpansion(badExpansion, sampleContext),
  false
);
assert.equal(
  ctx.rejectsUnsupportedOverInterpretation(badExpansion, sampleContext),
  false
);

const groundedOk = [
  "### CTR Opportunities",
  "1. seo tools",
  "   - Evidence: 0 clicks, 145 impressions, 0% CTR, position 14.6",
  "   - Why it is an opportunity: 145 impressions, 0 clicks",
  "   - Recommendation: Rewrite title and meta description",
  "   - MCP Score: 7",
  "### Ranking Opportunities",
  "1. seo tools",
  "   - Evidence: 0 clicks, 145 impressions, 0% CTR, position 14.6",
  "   - Why it is an opportunity: Position 14.6 with impressions",
  "   - Recommendation: Strengthen on-page relevance",
  "   - MCP Score: 10",
  "### Summary",
  "- Opportunities received: 2",
  "- CTR opportunities: 1",
  "- Ranking opportunities: 1",
  "- Highest MCP score: 10",
  "- Entity with highest MCP score: seo tools",
].join("\n");
assert.ok(ctx.rejectsUnsupportedSeoExpansion(groundedOk, sampleContext));
assert.ok(ctx.rejectsUnsupportedOverInterpretation(groundedOk, sampleContext));
assert.ok(ctx.preservesNumericScoreWithoutInventedPriority(groundedOk, sampleContext));

// 5c. Analysis vs content-generation boundary
assert.ok(sys.includes("ANALYSIS vs CONTENT GENERATION"));
assert.ok(sys.includes("Do NOT automatically generate revised titles"));

const analysisAsk =
  "Review the CTR opportunities in my GSC data and tell me which pages need attention, the evidence behind each opportunity, and the recommended action.";
assert.equal(ctx.isExplicitContentGenerationRequest(analysisAsk), false);
assert.equal(
  ctx.isExplicitContentGenerationRequest(
    "Review and test the page title and meta description to improve CTR."
  ),
  false,
  "improve CTR / review title phrasing alone is not generation"
);
assert.equal(
  ctx.isExplicitContentGenerationRequest(
    "Write a new title and meta description for this page."
  ),
  true
);
assert.equal(
  ctx.isExplicitContentGenerationRequest(
    "Identify the CTR opportunity and then write 3 title/meta options."
  ),
  true
);

const unauthorizedGeneration = [
  groundedOk,
  "",
  "Revised title: Schema Markup Guide for GEO in 2026",
  "Meta description: Learn how schema markup boosts generative engine optimization...",
].join("\n");
assert.equal(
  ctx.rejectsUnauthorizedContentGeneration(unauthorizedGeneration, analysisAsk),
  false,
  "analysis request must not generate titles/metas"
);
assert.equal(
  ctx.rejectsUnauthorizedContentGeneration(groundedOk, analysisAsk),
  true,
  "analysis-only output is allowed"
);
assert.equal(
  ctx.rejectsUnauthorizedContentGeneration(
    unauthorizedGeneration,
    "Write a new title and meta description for this page."
  ),
  true,
  "explicit generation request may include generated content"
);
assert.equal(
  ctx.rejectsUnauthorizedContentGeneration(
    `${groundedOk}\n\nTitle option 1: Example Title A\nTitle option 2: Example Title B\nTitle option 3: Example Title C`,
    "Identify the CTR opportunity and then write 3 title/meta options."
  ),
  true,
  "combined request may analyze then generate"
);

// Metrics/recommendation unchanged in grounded analysis output
assert.ok(groundedOk.includes("145 impressions"));
assert.ok(groundedOk.includes("Rewrite title and meta description"));
assert.ok(groundedOk.includes("MCP Score: 7"));
assert.ok(!/Revised title:/i.test(groundedOk));

// 6. Non-GSC input unaffected
const plain = ctx.applyAiGrounding({
  systemPrompt: "Be helpful",
  userPrompt: "Hello",
  input: { message: "hello" },
});
assert.equal(plain.grounded, false);
assert.equal(plain.systemPrompt, "Be helpful");
assert.equal(plain.userPrompt, "Hello");

// Empty system still grounds with default instructions
const emptySys = ctx.applyAiGrounding({
  systemPrompt: "",
  userPrompt: "Go",
  input: sampleContext,
});
assert.equal(emptySys.grounded, true);
assert.ok(emptySys.userInstructions);
assert.ok(emptySys.systemPrompt.includes(emptySys.userInstructions));

console.log("  ok user instructions primary + grounding secondary");
console.log("  ok no forced report template");
console.log("  ok MCP multi-cap identity preserved in user message");
console.log("  ok analysis vs content-generation boundary");
console.log("  ok non-GSC path unchanged");
console.log("smoke-ai-prompt-architecture: all passed");
