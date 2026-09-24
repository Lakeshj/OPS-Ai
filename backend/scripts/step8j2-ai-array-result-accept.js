/**
 * STEP 8J-2 — AI opportunities as real array + Result human report.
 * Replays MCP → grounding → OpenAI (maxTokens=6000) → Result.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..");
const ga4Root = path.join(root, "plugins", "ga4-mcp", "src");
const {
  processUpstreamItems,
} = require(path.join(ga4Root, "adapters", "processUpstream"));
const { applyAiGrounding } = require(path.join(
  ga4Root,
  "contracts",
  "intelligenceContext"
));
const { getClientForProvider } = require("../config/aiClients");
const { withGenerationOptions } = require("../utils/openaiCompletionOptions");
const {
  handlers,
  parseAiResponseJson,
  coerceOpportunitiesArray,
  deriveItems,
} = require("../services/workflowNodes.service");
const { normalizeItem } = require("../services/workflowProvenance.service");

const MODEL = "gpt-4o-mini";
const PROVIDER = "openai";
const MAX_TOKENS = 6000;
const TEMPERATURE = 0.4;

const USER_INSTRUCTIONS = `Analyze the structured GA4 MCP landing underperformance opportunities.
Report every qualifying landing-page opportunity provided by the MCP.`;

const upstreamPath = path.join(
  root,
  ".tmp",
  "step8g-4f289136-googleAnalytics-1789984791245.json"
);

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

  const { client } = getClientForProvider(PROVIDER, MODEL);
  const generationOptions = withGenerationOptions(MODEL, {
    messages: [
      { role: "system", content: grounded.systemPrompt },
      { role: "user", content: String(grounded.userPrompt) },
    ],
    temperature: TEMPERATURE,
    maxTokens: MAX_TOKENS,
  });

  console.log("[8J-2] calling OpenAI…", {
    mcpOpps: mcpOpps.length,
    max_tokens:
      generationOptions.max_tokens ?? generationOptions.max_completion_tokens,
  });

  const completion = await client.chat.completions.create(generationOptions);
  const choice = completion.choices?.[0] || {};
  const text = choice.message?.content || "";
  const finishReason = choice.finish_reason || null;
  const truncated = finishReason === "length";

  let json = null;
  let jsonError = null;
  try {
    json = parseAiResponseJson(text);
  } catch (err) {
    jsonError = err instanceof Error ? err.message : String(err);
  }

  const opportunities = coerceOpportunitiesArray(json?.opportunities);
  const {
    mergeAiOpportunitiesWithMcpDetails,
  } = require(path.join(ga4Root, "contracts", "intelligenceContext"));
  const merged = mergeAiOpportunitiesWithMcpDetails({
    aiText: text,
    aiJson: json,
    intelligenceContext: grounded.intelligenceContext,
  });

  const llmOut = {
    text,
    json: opportunities
      ? { ...json, opportunities }
      : json,
    opportunities: opportunities || undefined,
    isLlm: true,
    finishReason,
    truncated,
    jsonError,
    enrichedOpportunities: merged.enrichedOpportunities,
    mcpOpportunityDetails: merged.mcpOpportunityDetails,
  };

  const item = normalizeItem(deriveItems(llmOut)[0], 0);
  const itemOpps = item.json?.opportunities;

  const resultNode = await handlers.result(
    {
      id: "result-1",
      type: "result",
      data: { mapFrom: "{{steps.ai-1.text}}" },
    },
    {
      input: {},
      steps: { "ai-1": llmOut },
      inputItems: [item],
    }
  );
  const report = String(resultNode.output?.result || "");

  const criteria = {
    "1_ai_output_50": Array.isArray(opportunities) && opportunities.length === 50,
    "2_typeof_object": typeof opportunities === "object",
    "3_Array_isArray_true": Array.isArray(opportunities) === true,
    "4_not_string": typeof opportunities !== "string",
    "5_item_json_array": Array.isArray(itemOpps) && typeof itemOpps !== "string",
    "6_result_renders_50":
      /50\.\s+Landing Page:/.test(report) &&
      (report.match(/\d+\.\s+Landing Page:/g) || []).length === 50,
    "7_result_not_raw_json":
      !/^\s*\{/.test(report.trim()) && !/"opportunities"\s*:/.test(report),
    "8_mcp_reason_preserved":
      /Reason:/.test(report) &&
      merged.enrichedOpportunities.every((r) => r.reason != null) &&
      report.includes(merged.enrichedOpportunities[0].reason),
    "9_finishReason_stop": finishReason === "stop",
    "10_truncated_false": truncated === false,
  };

  const reportOut = {
    criteria,
    allPass: Object.values(criteria).every(Boolean),
    counts: {
      mcpOpportunities: mcpOpps.length,
      aiOpportunities: opportunities?.length ?? 0,
      enriched: merged.enrichedOpportunities.length,
    },
    finishReason,
    truncated,
    jsonError,
    usage: completion.usage || null,
    sampleAiOpportunity: opportunities?.[0] || null,
    sampleItemOpportunityType: typeof itemOpps,
    sampleItemIsArray: Array.isArray(itemOpps),
    resultHead: report.slice(0, 500),
    resultTail: report.slice(-400),
  };

  const outPath = path.join(root, ".tmp", "step8j2-ai-array-result-accept.json");
  fs.writeFileSync(outPath, JSON.stringify(reportOut, null, 2));
  console.log(JSON.stringify(reportOut, null, 2));
  console.log("\nWrote", outPath);
  if (!reportOut.allPass) process.exitCode = 1;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
