const { ctrOpportunities } = require("./ctrOpportunities");
const { rankingOpportunities } = require("./rankingOpportunities");
const { contentDecay } = require("./contentDecay");
const { keywordCannibalization } = require("./cannibalization");
const { queryGapAnalysis } = require("./queryGapAnalysis");
const { pageOptimizationSuggestions } = require("./pageOptimizationSuggestions");
const { normalizeResult } = require("../errors");
const { ESSENTIAL_INTELLIGENCE_IDS } = require("../contracts/capabilities");

const runSafe = (toolId, fn, input) => {
  try {
    return normalizeResult(toolId, { data: fn(input) });
  } catch (err) {
    return normalizeResult(toolId, {
      ok: false,
      error: {
        code: err.code || "MCP_VALIDATION",
        message: err.message || `Intelligence tool failed: ${toolId}`,
      },
    });
  }
};

const runIntelligence = (toolId, input = {}) => {
  switch (toolId) {
    case "ctr_opportunities":
      return runSafe(toolId, ctrOpportunities, input);
    case "ranking_opportunities":
      return runSafe(toolId, rankingOpportunities, input);
    case "content_decay":
      return runSafe(toolId, contentDecay, input);
    case "keyword_cannibalization":
      return runSafe(toolId, keywordCannibalization, input);
    case "query_gap_analysis":
      return runSafe(toolId, queryGapAnalysis, input);
    case "page_optimization_suggestions":
      return runSafe(toolId, pageOptimizationSuggestions, input);
    default:
      return normalizeResult(toolId, {
        ok: false,
        error: {
          code: "MCP_VALIDATION",
          message: `Unknown intelligence tool: ${toolId}`,
        },
      });
  }
};

module.exports = {
  runIntelligence,
  INTELLIGENCE_TOOL_IDS: ESSENTIAL_INTELLIGENCE_IDS,
};
