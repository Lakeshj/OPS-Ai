/**
 * Main-flow processor: run OpsAi GSC capabilities on upstream WorkflowItems.
 * No Google OAuth / property selection — data comes from previous nodes (e.g. googleSearchConsole).
 *
 * Emits capability-preserving IntelligenceContext (and tagged opportunity items)
 * so Merge / AI can reason without flattening away source metadata.
 */
const {
  ESSENTIAL_INTELLIGENCE_IDS,
  ESSENTIAL_ACTION_IDS,
  labelForToolId,
} = require("../contracts/capabilities");
const {
  validateIntelligenceFilters,
  extractFiltersFromNodeData,
} = require("../contracts/intelligenceFilters");
const {
  extractSourceMeta,
  buildContextFromCapabilityRun,
  validateIntelligenceContext,
  tagOpportunityItem,
  MARKER,
} = require("../contracts/intelligenceContext");
const { runIntelligence } = require("../intelligence");
const { runAction } = require("../actions");
const { resultToWorkflowItems } = require("./workflowNode");

const PROCESSOR_CAPABILITY_IDS = Object.freeze([
  ...ESSENTIAL_INTELLIGENCE_IDS,
  ...ESSENTIAL_ACTION_IDS,
]);

const capabilityOptionsForUi = () =>
  PROCESSOR_CAPABILITY_IDS.map((id) => ({
    name: labelForToolId(id),
    value: id,
  }));

const itemPayload = (item) => {
  if (item == null) return null;
  if (typeof item !== "object" || Array.isArray(item)) return item;
  if (item.json && typeof item.json === "object" && !Array.isArray(item.json)) {
    return item.json;
  }
  const { pairedItem, binary, json, ...rest } = item;
  if (Object.keys(rest).length > 0) return rest;
  return item;
};

const rowsFromInputItems = (inputItems = []) =>
  (Array.isArray(inputItems) ? inputItems : [])
    .map(itemPayload)
    .filter((row) => row && typeof row === "object" && !Array.isArray(row));

/**
 * @param {{
 *   capability?: string,
 *   inputItems?: any[],
 *   title?: string,
 *   filters?: object,
 *   previousRows?: any[],
 *   nodeData?: object,
 *   context?: object,
 *   sourceMeta?: object,
 * }} opts
 */
const processUpstreamItems = ({
  capability = "ctr_opportunities",
  inputItems = [],
  title,
  filters,
  previousRows,
  nodeData,
  context,
  sourceMeta,
} = {}) => {
  const id = String(capability || "ctr_opportunities").trim();
  if (!PROCESSOR_CAPABILITY_IDS.includes(id)) {
    return {
      ok: false,
      error: {
        code: "MCP_VALIDATION",
        message: `Unknown GSC processing capability: ${id}. Use intelligence/action capabilities on upstream GSC rows.`,
      },
      items: [],
      output: { ok: false },
    };
  }

  const rows = rowsFromInputItems(inputItems);
  if (!rows.length) {
    const err = {
      code: "MCP_UPSTREAM_REQUIRED",
      message:
        "GSC MCP Tools needs analytics rows from a previous Google Search Console node. Connect GSC → GSC MCP Tools.",
    };
    return { ok: false, error: err, items: [], output: { ok: false, error: err } };
  }

  const rawFilters =
    filters && typeof filters === "object"
      ? filters
      : extractFiltersFromNodeData(id, nodeData || {});

  let normalizedFilters = {};
  if (ESSENTIAL_INTELLIGENCE_IDS.includes(id)) {
    const validated = validateIntelligenceFilters(id, rawFilters);
    if (!validated.ok) {
      return {
        ok: false,
        error: validated.error,
        items: [],
        output: { ok: false, error: validated.error },
      };
    }
    normalizedFilters = validated.filters;
  }

  const resolvedMeta = extractSourceMeta({
    rows,
    steps: context?.steps || {},
    nodeData: nodeData || {},
    sourceMeta: sourceMeta || {},
  });

  if (ESSENTIAL_INTELLIGENCE_IDS.includes(id) && !resolvedMeta.property) {
    const err = {
      code: "MCP_PROPERTY_REQUIRED",
      message:
        "IntelligenceContext requires a Google Search Console property (site URL). Ensure the upstream GSC node ran with a site selected, or set property/siteUrl on this node.",
    };
    return { ok: false, error: err, items: [], output: { ok: false, error: err } };
  }

  const payload = {
    rows,
    title: title || labelForToolId(id),
    ...normalizedFilters,
  };
  if (Array.isArray(previousRows) && previousRows.length) {
    payload.previousRows = previousRows;
  }

  const result = ESSENTIAL_INTELLIGENCE_IDS.includes(id)
    ? runIntelligence(id, payload)
    : runAction(id, payload);

  if (!result.ok) {
    return {
      ...result,
      items: [],
      output: { ok: false, error: result.error, capability: id },
    };
  }

  const shaped = resultToWorkflowItems(result);
  const opportunities = Array.isArray(result.data?.opportunities)
    ? result.data.opportunities
    : ESSENTIAL_INTELLIGENCE_IDS.includes(id)
      ? []
      : (shaped.items || []).map((it) => itemPayload(it));

  if (ESSENTIAL_INTELLIGENCE_IDS.includes(id)) {
    const { context: intelligenceContext, section } =
      buildContextFromCapabilityRun({
        capability: id,
        filters: normalizedFilters,
        opportunities,
        property: resolvedMeta.property,
        period: resolvedMeta.period,
      });

    const validated = validateIntelligenceContext(intelligenceContext, {
      requireProperty: true,
    });
    if (!validated.ok) {
      return {
        ok: false,
        error: validated.error,
        items: [],
        output: { ok: false, error: validated.error },
      };
    }

    const meta = {
      capability: id,
      property: resolvedMeta.property,
      period: resolvedMeta.period,
      filters: normalizedFilters,
    };

    const taggedItems =
      opportunities.length > 0
        ? opportunities.map((row, index) => ({
            json: tagOpportunityItem(row, meta),
            pairedItem: { item: index },
          }))
        : [
            {
              json: {
                ...section,
                property: resolvedMeta.property,
                period: resolvedMeta.period,
                source: "google_search_console",
                [MARKER]: true,
              },
              pairedItem: { item: 0 },
            },
          ];

    // Always expose the full IntelligenceContext as a stable contract item
    // when there is at most one opportunity (or empty) — AI can also rebuild
    // from tagged items / Merge. Attach on output for all cases.
    const contextItem = {
      json: intelligenceContext,
      pairedItem: { item: 0 },
    };

    return {
      ok: true,
      items: opportunities.length === 0 ? [contextItem] : taggedItems,
      output: {
        ok: true,
        capability: id,
        label: labelForToolId(id),
        filters: normalizedFilters,
        property: resolvedMeta.property,
        period: resolvedMeta.period,
        itemsIn: rows.length,
        itemsOut: opportunities.length,
        count: opportunities.length,
        intelligenceContext,
        warnings: result.warnings || [],
      },
      intelligenceContext,
      resolved: {
        capability: id,
        property: resolvedMeta.property,
        period: resolvedMeta.period,
        filters: normalizedFilters,
      },
    };
  }

  // Action capabilities: keep prior item shaping; stamp source meta when present.
  const actionItems = (shaped.items || []).map((it, index) => {
    const row = itemPayload(it) || {};
    return {
      json: {
        ...row,
        ...(resolvedMeta.property
          ? {
              [MARKER]: true,
              capability: id,
              property: resolvedMeta.property,
              period: resolvedMeta.period,
              source: "google_search_console",
            }
          : {}),
      },
      pairedItem: it.pairedItem || { item: index },
    };
  });

  return {
    ok: true,
    items: actionItems,
    output: {
      ...shaped.output,
      capability: id,
      label: labelForToolId(id),
      filters: normalizedFilters,
      property: resolvedMeta.property,
      period: resolvedMeta.period,
      itemsIn: rows.length,
      itemsOut: actionItems.length,
    },
  };
};

module.exports = {
  PROCESSOR_CAPABILITY_IDS,
  capabilityOptionsForUi,
  rowsFromInputItems,
  processUpstreamItems,
};
