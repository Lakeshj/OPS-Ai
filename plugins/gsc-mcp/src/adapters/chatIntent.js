const INTENT_HINTS = [
  {
    id: "list_properties",
    patterns: [/list (gsc )?propert/i, /which sites/i, /search console sites/i],
    toolId: "list_properties",
  },
  {
    id: "top_queries",
    patterns: [/top quer/i, /search analytics/i, /what queries/i],
    toolId: "get_search_analytics",
  },
  {
    id: "performance",
    patterns: [/performance overview/i, /traffic summary/i, /overall (seo )?performance/i],
    toolId: "get_performance_overview",
  },
  {
    id: "compare",
    patterns: [/compare (last |periods|months)/i, /month over month/i, /wow|mom/i],
    toolId: "compare_search_periods",
  },
  {
    id: "inspect",
    patterns: [/index(ing)? (status|issue)/i, /inspect url/i, /crawl status/i],
    toolId: "inspect_url_enhanced",
  },
  {
    id: "ctr",
    patterns: [/ctr opportunity/i, /low ctr/i],
    toolId: "ctr_opportunities",
  },
  {
    id: "ranking",
    patterns: [/ranking opportunit/i, /improve ranking/i, /position opportunit/i],
    toolId: "ranking_opportunities",
  },
  {
    id: "decay",
    patterns: [/content decay/i, /losing traffic/i, /declining pages/i],
    toolId: "content_decay",
  },
  {
    id: "cannibalization",
    patterns: [/cannibal/i, /same query.*multiple (page|url)/i],
    toolId: "keyword_cannibalization",
  },
  {
    id: "query_gap",
    patterns: [/query gap/i, /impression.?click gap/i, /demand not captur/i],
    toolId: "query_gap_analysis",
  },
  {
    id: "page_opt",
    patterns: [/page optim/i, /on-?page suggestion/i, /optimize (the )?page/i],
    toolId: "page_optimization_suggestions",
  },
];

const suggestToolsForIntent = (text = "") => {
  const q = String(text || "");
  const hits = [];
  for (const hint of INTENT_HINTS) {
    if (hint.patterns.some((re) => re.test(q))) {
      hits.push({ toolId: hint.toolId, reason: hint.id });
    }
  }
  return hits;
};

const systemPromptHints = () =>
  [
    "For Google Search Console questions, prefer gsc_* MCP tools via the Assistant.",
    "On the workflow canvas, fetch analytics with googleSearchConsole, then process rows with GSC MCP Tools.",
    "Call get_capabilities or list_properties before assuming a siteUrl on live MCP calls.",
    "Always pass siteUrl when required by the tool schema.",
    "Use intelligence tools (ctr_opportunities, ranking_opportunities, content_decay, keyword_cannibalization, query_gap_analysis, page_optimization_suggestions) after fetching analytics rows.",
  ].join(" ");

module.exports = {
  INTENT_HINTS,
  suggestToolsForIntent,
  systemPromptHints,
};
