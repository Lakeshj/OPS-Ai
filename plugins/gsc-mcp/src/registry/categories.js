const {
  ESSENTIAL_DATA_IDS,
  ESSENTIAL_INTELLIGENCE_IDS,
  ESSENTIAL_ACTION_IDS,
} = require("../contracts/capabilities");

/** Alias map: external MCP names → OpsAi essential ids */
const DATA_ALIASES = new Set([
  ...ESSENTIAL_DATA_IDS,
  "list_sites",
  "get_performance_summary",
  "compare_periods",
  "inspect_url",
]);

const WRITE_TOOLS = new Set([
  "manage_sitemaps",
  "submit_sitemap",
  "delete_sitemap",
]);

const INTELLIGENCE_IDS = [...ESSENTIAL_INTELLIGENCE_IDS];

const ACTION_IDS = [...ESSENTIAL_ACTION_IDS];

const EXTERNAL_TO_OPS_AI = Object.freeze({
  list_sites: "list_properties",
  get_performance_summary: "get_performance_overview",
  compare_periods: "compare_search_periods",
  inspect_url: "inspect_url_enhanced",
});

const categorizeTool = (name) => {
  const n = String(name || "");
  const canonical = EXTERNAL_TO_OPS_AI[n] || n;
  if (INTELLIGENCE_IDS.includes(canonical)) return "intelligence";
  if (ACTION_IDS.includes(canonical)) return "action";
  return "data";
};

const isWriteTool = (name) => WRITE_TOOLS.has(String(name || ""));

const canonicalizeToolId = (name) => {
  const n = String(name || "");
  return EXTERNAL_TO_OPS_AI[n] || n;
};

module.exports = {
  DATA_ALIASES,
  WRITE_TOOLS,
  INTELLIGENCE_IDS,
  ACTION_IDS,
  EXTERNAL_TO_OPS_AI,
  ESSENTIAL_DATA_IDS,
  categorizeTool,
  isWriteTool,
  canonicalizeToolId,
};
