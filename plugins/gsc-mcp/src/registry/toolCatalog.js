const { PluginError, ERROR } = require("../errors");
const {
  categorizeTool,
  isWriteTool,
  INTELLIGENCE_IDS,
  ACTION_IDS,
  canonicalizeToolId,
  ESSENTIAL_DATA_IDS,
} = require("./categories");
const {
  enrichCatalogEntry,
  filterCatalogByAudience,
  AUDIENCES,
  labelForToolId,
} = require("../contracts/capabilities");
const { FILTER_INPUT_SCHEMAS } = require("../contracts/intelligenceFilters");

const INTELLIGENCE_LABELS = {
  ctr_opportunities: "CTR opportunities",
  ranking_opportunities: "Ranking opportunities",
  content_decay: "Content decay",
  keyword_cannibalization: "Keyword cannibalization",
  query_gap_analysis: "Query gap analysis",
  page_optimization_suggestions: "Page optimization suggestions",
};

const ACTION_LABELS = {
  prepare_sheet_rows: "Prepare sheet rows",
  prepare_email_digest: "Prepare email digest",
};

const intelligenceToolMeta = () =>
  INTELLIGENCE_IDS.map((id) =>
    enrichCatalogEntry({
      id,
      name: id,
      label: INTELLIGENCE_LABELS[id] || labelForToolId(id),
      description: `OpsAi intelligence: ${INTELLIGENCE_LABELS[id] || id}`,
      inputSchema: FILTER_INPUT_SCHEMAS[id] || {
        type: "object",
        properties: {
          rows: { type: "array" },
          siteUrl: { type: "string" },
        },
      },
      category: "intelligence",
      source: "opsai",
    })
  );

const actionToolMeta = () =>
  ACTION_IDS.map((id) =>
    enrichCatalogEntry({
      id,
      name: id,
      label: ACTION_LABELS[id] || labelForToolId(id),
      description: `OpsAi action handoff: ${ACTION_LABELS[id] || id}`,
      inputSchema: {
        type: "object",
        properties: {
          rows: { type: "array" },
          title: { type: "string" },
          siteUrl: { type: "string" },
        },
      },
      category: "action",
      source: "opsai",
    })
  );

const buildCatalog = (discovered = [], config = {}, options = {}) => {
  const readSet = new Set(config.readAllowlist || ESSENTIAL_DATA_IDS);
  const writeSet = new Set(config.writeAllowlist || []);
  const blocked = new Set(config.blockedTools || ["reauthenticate"]);
  const essentialData = new Set(ESSENTIAL_DATA_IDS);

  const seen = new Set();
  const dataTools = [];

  for (const t of discovered || []) {
    if (!t || !t.name || blocked.has(t.name)) continue;
    if (isWriteTool(t.name)) {
      if (config.allowWriteTools !== true || !writeSet.has(t.name)) continue;
    } else if (readSet.size && !readSet.has(t.name)) {
      continue;
    }

    const id = canonicalizeToolId(t.name);
    if (!essentialData.has(id) && !isWriteTool(t.name)) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    dataTools.push(
      enrichCatalogEntry({
        id,
        name: id,
        label: labelForToolId(id),
        description: t.description || labelForToolId(id),
        inputSchema: t.inputSchema || { type: "object", properties: {} },
        category: "data",
        source: t.source || "external",
        write: isWriteTool(t.name),
        externalName: t.externalName || t.name,
      })
    );
  }

  // Ensure essential data tools exist even if discovery missed aliases.
  for (const id of ESSENTIAL_DATA_IDS) {
    if (seen.has(id)) continue;
    const fromDiscovery = (discovered || []).find(
      (t) => canonicalizeToolId(t.name) === id || t.name === id
    );
    dataTools.push(
      enrichCatalogEntry({
        id,
        name: id,
        label: labelForToolId(id),
        description:
          fromDiscovery?.description ||
          `GSC data capability: ${labelForToolId(id)}`,
        inputSchema:
          fromDiscovery?.inputSchema || { type: "object", properties: {} },
        category: "data",
        source: fromDiscovery ? "external" : "opsai",
        externalName: fromDiscovery?.name || id,
      })
    );
    seen.add(id);
  }

  const full = [...dataTools, ...intelligenceToolMeta(), ...actionToolMeta()];
  const audience = options.audience || AUDIENCES.AGENT;
  return filterCatalogByAudience(full, audience);
};

const assertToolAllowed = (tool, config = {}) => {
  const blocked = new Set(config.blockedTools || ["reauthenticate"]);
  const name = tool.externalName || tool.name;
  if (blocked.has(name) || blocked.has(tool.id)) {
    throw new PluginError(
      `Tool ${tool.id} is blocked in OpsAi Phase 1`,
      ERROR.MCP_TOOL_BLOCKED,
      { tool: tool.id }
    );
  }
  if (tool.write && config.allowWriteTools !== true) {
    throw new PluginError(
      `Write tool ${tool.id} requires allowWriteTools=true`,
      ERROR.MCP_TOOL_BLOCKED,
      { tool: tool.id }
    );
  }
};

const getOpsAiTool = (catalog, id) =>
  (catalog || []).find(
    (t) => t.id === id || t.name === id || t.externalName === id
  );

module.exports = {
  buildCatalog,
  assertToolAllowed,
  getOpsAiTool,
  intelligenceToolMeta,
  actionToolMeta,
  categorizeTool,
};
