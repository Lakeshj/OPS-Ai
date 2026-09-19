/**
 * Capability registry — single contract for AI Assistant,
 * GSC MCP Tools processor, and future Filter / Sort / Analysis nodes.
 *
 * Audiences:
 * - assistant: discovery + execute (includes get_capabilities)
 * - agent: executable Agent tools (+ get_capabilities for discovery)
 * - workflow_future: capabilities future canvas processors may call
 *   (excludes get_capabilities — not a normal workflow op)
 *
 * Internal ids stay stable; UI labels are presentation-only (TOOL_LABELS).
 */

const AUDIENCES = Object.freeze({
  ASSISTANT: "assistant",
  AGENT: "agent",
  WORKFLOW_FUTURE: "workflow_future",
});

const TOOL_LABELS = Object.freeze({
  get_capabilities: "Capabilities",
  list_properties: "List properties",
  get_performance_overview: "Performance overview",
  get_search_analytics: "Search analytics",
  compare_search_periods: "Compare periods",
  inspect_url_enhanced: "Inspect URL",
  ctr_opportunities: "CTR opportunities",
  ranking_opportunities: "Ranking opportunities",
  content_decay: "Content decay",
  keyword_cannibalization: "Keyword cannibalization",
  query_gap_analysis: "Query gap analysis",
  page_optimization_suggestions: "Page optimization suggestions",
  prepare_sheet_rows: "Prepare sheet rows",
  prepare_email_digest: "Prepare email digest",
});

const ESSENTIAL_DATA_IDS = Object.freeze([
  "get_capabilities",
  "list_properties",
  "get_performance_overview",
  "get_search_analytics",
  "compare_search_periods",
  "inspect_url_enhanced",
]);

const ESSENTIAL_INTELLIGENCE_IDS = Object.freeze([
  "ctr_opportunities",
  "ranking_opportunities",
  "content_decay",
  "keyword_cannibalization",
  "query_gap_analysis",
  "page_optimization_suggestions",
]);

const ESSENTIAL_ACTION_IDS = Object.freeze([
  "prepare_sheet_rows",
  "prepare_email_digest",
]);

const DISCOVERY_ONLY_IDS = Object.freeze(new Set(["get_capabilities"]));

const audiencesForTool = (toolId) => {
  const id = String(toolId || "");
  if (DISCOVERY_ONLY_IDS.has(id)) {
    return [AUDIENCES.ASSISTANT, AUDIENCES.AGENT];
  }
  return [
    AUDIENCES.ASSISTANT,
    AUDIENCES.AGENT,
    AUDIENCES.WORKFLOW_FUTURE,
  ];
};

const labelForToolId = (toolId) =>
  TOOL_LABELS[toolId] || String(toolId || "").replace(/_/g, " ");

const filterCatalogByAudience = (catalog = [], audience = AUDIENCES.AGENT) => {
  const aud = String(audience || AUDIENCES.AGENT);
  return (catalog || []).filter((t) => {
    const audiences = t.audiences || audiencesForTool(t.id);
    return audiences.includes(aud);
  });
};

const enrichCatalogEntry = (tool) => {
  const id = tool.id || tool.name;
  return {
    ...tool,
    id,
    name: tool.name || id,
    label: tool.label || labelForToolId(id),
    audiences: tool.audiences || audiencesForTool(id),
    discoveryOnly: DISCOVERY_ONLY_IDS.has(id),
  };
};

module.exports = {
  AUDIENCES,
  TOOL_LABELS,
  ESSENTIAL_DATA_IDS,
  ESSENTIAL_INTELLIGENCE_IDS,
  ESSENTIAL_ACTION_IDS,
  DISCOVERY_ONLY_IDS,
  audiencesForTool,
  labelForToolId,
  filterCatalogByAudience,
  enrichCatalogEntry,
};
