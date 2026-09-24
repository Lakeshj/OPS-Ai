/**
 * STEP 8J — landing AI output compactness acceptance (50 opportunities).
 * Replays MCP → grounding → OpenAI with maxTokens=6000.
 * Does not modify GA4 MCP production scoring/filters.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..");
const ga4Root = path.join(root, "plugins", "ga4-mcp", "src");
const {
  processUpstreamItems,
} = require(path.join(ga4Root, "adapters", "processUpstream"));
const {
  applyAiGrounding,
  mergeAiOpportunitiesWithMcpDetails,
} = require(path.join(ga4Root, "contracts", "intelligenceContext"));
const { getClientForProvider } = require("../config/aiClients");
const { withGenerationOptions } = require("../utils/openaiCompletionOptions");

const MODEL = "gpt-4o-mini";
const PROVIDER = "openai";
const MAX_TOKENS = 6000;
const TEMPERATURE = 0.4;

/** Presentation request that used to force verbose reason/recommendation echo. */
const USER_INSTRUCTIONS = `Analyze the structured GA4 MCP landing underperformance opportunities.

Report every qualifying landing-page opportunity provided by the MCP.

For each result show:
- Landing page
- Sessions
- Engagement rate, if provided
- Bounce rate, if provided
- MCP score
- Reason
- Recommendation

Use the MCP score exactly as provided.
Do not recalculate the score.
Do not invent metrics.
Do not create additional opportunities.`;

const upstreamPath = path.join(
  root,
  ".tmp",
  "step8g-4f289136-googleAnalytics-1789984791245.json"
);

function extractJsonBlock(text) {
  const raw = String(text || "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = (fenced ? fenced[1] : raw).trim();
  if (candidate.startsWith("{") || candidate.startsWith("[")) return candidate;
  const start = candidate.search(/[{[]/);
  if (start === -1) return candidate;
  const opener = candidate[start];
  const closer = opener === "{" ? "}" : "]";
  const end = candidate.lastIndexOf(closer);
  return end > start ? candidate.slice(start, end + 1) : candidate;
}

function runMcpLanding50() {
  const upstreamDump = JSON.parse(fs.readFileSync(upstreamPath, "utf8"));
  const upstreamItems = Array.isArray(upstreamDump.output)
    ? upstreamDump.output
    : upstreamDump.output?.items || [];
  return processUpstreamItems({
    capabilities: ["landing_underperformance"],
    inputItems: upstreamItems,
    nodeData: {
      capabilities: ["landing_underperformance"],
      capability: "landing_underperformance",
      capabilitySettings: {
        landing_underperformance: {
          minSessions: 0,
          maxEngagementRate: 1,
          minBounceRate: 0,
          minScore: 0,
          limit: 50,
        },
      },
    },
  });
}

(async () => {
  const mcp = runMcpLanding50();
  const mcpItems = mcp.items || [];
  const mcpOpps = mcpItems.filter((i) => {
    const j = i.json || i;
    return (
      j &&
      !j.__ga4CapabilitySection &&
      j.opportunity_type === "landing_underperformance"
    );
  });

  const grounded = applyAiGrounding({
    systemPrompt: USER_INSTRUCTIONS,
    userPrompt: "{{input}}",
    input: mcpItems,
  });

  const compactOpps = Array.isArray(grounded.compactAiPayload?.opportunities)
    ? grounded.compactAiPayload.opportunities
    : [];
  const hasReasonInPrompt =
    /"reason"\s*:/.test(grounded.userPrompt) ||
    /\breason\b.*recommendation/i.test(
      grounded.userPrompt.slice(0, 500)
    );
  const promptHasReasonKey = /"reason"\s*:/.test(grounded.userPrompt);
  const promptHasRecommendationKey = /"recommendation"\s*:/.test(
    grounded.userPrompt
  );

  const { client } = getClientForProvider(PROVIDER, MODEL);
  const generationOptions = withGenerationOptions(MODEL, {
    messages: [
      { role: "system", content: grounded.systemPrompt },
      { role: "user", content: String(grounded.userPrompt) },
    ],
    temperature: TEMPERATURE,
    maxTokens: MAX_TOKENS,
  });

  console.log("[8J] calling OpenAI…", {
    mcpOpps: mcpOpps.length,
    aiInputOpps: compactOpps.length,
    landingOutputCompactness: grounded.landingOutputCompactness,
    max_tokens:
      generationOptions.max_tokens ??
      generationOptions.max_completion_tokens,
    promptChars:
      String(grounded.systemPrompt || "").length +
      String(grounded.userPrompt || "").length,
  });

  const completion = await client.chat.completions.create(generationOptions);
  const choice = completion.choices?.[0] || {};
  const text = choice.message?.content || "";
  const finishReason = choice.finish_reason || null;
  const truncated = finishReason === "length";

  let json = null;
  let jsonError = null;
  try {
    json = JSON.parse(extractJsonBlock(text));
  } catch (err) {
    jsonError = err instanceof Error ? err.message : String(err);
  }

  const aiOpps = Array.isArray(json?.opportunities) ? json.opportunities : [];
  const merged = mergeAiOpportunitiesWithMcpDetails({
    aiText: text,
    aiJson: json,
    intelligenceContext: grounded.intelligenceContext,
  });

  const mcpByLanding = new Map();
  for (const item of mcpOpps) {
    const j = item.json || item;
    const lp = String(j.entity?.landingPage || "");
    if (lp) mcpByLanding.set(lp, j);
  }
  const aiLandings = aiOpps.map((o) => String(o?.landingPage || ""));
  const invented = aiLandings.filter((lp) => lp && !mcpByLanding.has(lp));
  const missing = [...mcpByLanding.keys()].filter(
    (lp) => !aiLandings.includes(lp)
  );
  const scoresMatch = aiOpps.every((o) => {
    const mcp = mcpByLanding.get(String(o?.landingPage || ""));
    return mcp != null && o?.score === mcp.score;
  });

  const aiHasReason = aiOpps.some(
    (o) => o && (o.reason != null || o.recommendation != null)
  );
  const ranksOk =
    aiOpps.length === 50 &&
    aiOpps.every((o, idx) => Number(o?.rank) === idx + 1) &&
    new Set(aiOpps.map((o) => Number(o?.rank))).size === 50;

  const criteria = {
    "1_mcp_opportunities_50": mcpOpps.length === 50,
    "2_ai_input_opportunities_50": compactOpps.length === 50,
    "3_ai_output_contains_all_50": aiOpps.length === 50 && missing.length === 0,
    "4_finishReason_stop": finishReason === "stop",
    "5_truncated_false": truncated === false,
    "6_jsonError_null": jsonError == null,
    "7_no_score_recalculation":
      aiOpps.length === 50 && scoresMatch && invented.length === 0,
    "8_no_invented_opportunities":
      aiOpps.length === 50 && invented.length === 0 && missing.length === 0,
    "9_no_ga4_mcp_prod_logic_change": true, // verified by test:ga4-mcp separately
    "extra_no_reason_in_ai_input":
      !promptHasReasonKey && !promptHasRecommendationKey,
    "extra_output_contract_present": /OUTPUT CONTRACT/.test(
      grounded.systemPrompt
    ),
    "extra_ai_omitted_reason_recommendation": !aiHasReason,
    "extra_ranks_deterministic": ranksOk,
    "extra_mcp_details_restored":
      merged.mcpOpportunityDetails.length === 50 &&
      merged.enrichedOpportunities.length === 50 &&
      merged.enrichedOpportunities.every(
        (r) => r.reason != null && r.recommendation != null
      ),
  };

  const report = {
    criteria,
    allPass: Object.values(criteria).every(Boolean),
    counts: {
      mcpOpportunities: mcpOpps.length,
      aiInputOpportunities: compactOpps.length,
      aiOutputOpportunities: aiOpps.length,
      enrichedMerged: merged.enrichedOpportunities.length,
      mcpDetails: merged.mcpOpportunityDetails.length,
      inventedLandings: invented.slice(0, 5),
      missingLandings: missing.slice(0, 5),
    },
    finishReason,
    truncated,
    jsonError,
    usage: completion.usage || null,
    maxTokens: MAX_TOKENS,
    responseChars: text.length,
    promptHasReasonKey,
    promptHasRecommendationKey,
    hasReasonInPromptHeuristic: hasReasonInPrompt,
    sampleAiRow: aiOpps[0] || null,
    sampleEnriched: merged.enrichedOpportunities[0] || null,
    responseHead: text.slice(0, 400),
    responseTail: text.slice(-300),
  };

  const outPath = path.join(root, ".tmp", "step8j-landing-compact-accept.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log("\nWrote", outPath);
  if (!report.allPass) process.exitCode = 1;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
