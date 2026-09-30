/**
 * Primary vs Compare Against period contract for GSC / GA4.
 *
 * Fetch nodes already tag rows with period "primary" | "comparison".
 * MCP scoring stays on primary rows. Comparison rows are carried beside
 * the intelligence output so AI can compare them without a new node.
 */

const COMPARISON_RULES = [
  "Period comparison rules (use only when comparison data is supplied):",
  "",
  "PRIMARY PERIOD and COMPARISON PERIOD are separate. Do not merge their metrics.",
  "Use the supplied date ranges exactly. Do not assume or recalculate dates.",
  "",
  "Match entities only within the same source and the same dimensions.",
  "GSC: match on query and page when those fields are present.",
  "GA4: match on the dimension that is actually on the row, such as landingPage,",
  "pagePath, or the acquisition channel fields. Never match a GA4 landingPage",
  "to a GSC query, or match unrelated dimensions because the strings look similar.",
  "",
  "For a metric present on both the primary entity and its comparison entity:",
  "absolute change = primary - comparison.",
  "percentage change = ((primary - comparison) / comparison) × 100",
  "only when the comparison value is a non-zero number.",
  "If the comparison value is 0, report the absolute change and state that",
  "percentage change cannot be calculated from zero.",
  "If an entity has no comparison row, say comparison data is unavailable",
  "for that entity. Do not invent a zero.",
  "Do not invent missing metrics.",
  "",
  "An MCP score is authoritative. Do not recalculate or modify it.",
  "Compare MCP scores only when both sides already include a score.",
  "Do not create a new comparison score.",
  "",
  "Do not invent causes. Report the numeric change only, unless the input",
  "explicitly states a cause.",
  "For a general summary, include the primary period, the comparison period,",
  "important metric changes, entity-level changes the data supports, and",
  "missing comparison data.",
].join("\n");

const payloadOf = (row) => {
  if (row && typeof row === "object" && !Array.isArray(row) && row.json && typeof row.json === "object") {
    return row.json;
  }
  return row;
};

const isComparisonRow = (row) => {
  const payload = payloadOf(row);
  return Boolean(payload && typeof payload === "object" && payload.period === "comparison");
};

const partitionPeriodRows = (rows = []) => {
  const scoringRows = [];
  const comparisonRows = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (isComparisonRow(row)) comparisonRows.push(row);
    else scoringRows.push(row);
  }
  return { scoringRows, comparisonRows };
};

const rangeFromRows = (rows) => {
  for (const row of rows || []) {
    const payload = payloadOf(row);
    if (!payload || typeof payload !== "object") continue;
    if (payload.rangeStartDate || payload.rangeEndDate) {
      return {
        startDate: payload.rangeStartDate || null,
        endDate: payload.rangeEndDate || null,
      };
    }
  }
  return null;
};

const buildComparisonDataset = ({
  primaryRows = [],
  comparisonRows = [],
  source,
  property = null,
} = {}) => ({
  enabled: comparisonRows.length > 0,
  source: source || null,
  property: property || null,
  primaryRange: rangeFromRows(primaryRows),
  comparisonRange: rangeFromRows(comparisonRows),
  primaryRows: primaryRows.map(payloadOf),
  comparisonRows: comparisonRows.map(payloadOf),
});

const comparisonCarrierItem = (dataset, source) => {
  const primaryRange = dataset.primaryRange || {};
  const period = {
    start: primaryRange.startDate || null,
    end: primaryRange.endDate || null,
  };
  if (source === "google_search_console") {
    return {
      json: {
        __gscIntelligence: true,
        kind: "gsc_intelligence_context",
        source: "google_search_console",
        capabilities: [],
        property: dataset.property || null,
        period,
        comparisonDataset: dataset,
      },
    };
  }
  return {
    json: {
      __ga4Intelligence: true,
      kind: "ga4_intelligence_context",
      source: "google_analytics",
      capabilities: [],
      property: dataset.property || null,
      period,
      comparisonDataset: dataset,
    },
  };
};

const attachComparisonDataset = (
  result,
  { primaryRows = [], comparisonRows = [], source, property = null } = {}
) => {
  if (!result || result.ok === false || !comparisonRows.length) return result;
  const dataset = buildComparisonDataset({
    primaryRows,
    comparisonRows,
    source,
    property,
  });
  const items = Array.isArray(result.items) ? [...result.items] : [];
  items.push(comparisonCarrierItem(dataset, source));
  return {
    ...result,
    items,
    output: {
      ...(result.output || {}),
      comparisonDataset: dataset,
      comparisonRowCount: comparisonRows.length,
      itemsOut: items.length,
      count: items.length,
    },
  };
};

const collectPayloads = (input) => {
  if (input == null) return [];
  const list = Array.isArray(input) ? input : [input];
  return list.map(payloadOf).filter((row) => row && typeof row === "object" && !Array.isArray(row));
};

const extractComparisonDataset = (input) => {
  for (const payload of collectPayloads(input)) {
    if (
      payload.comparisonDataset &&
      typeof payload.comparisonDataset === "object" &&
      payload.comparisonDataset.enabled
    ) {
      return payload.comparisonDataset;
    }
  }
  const rows = collectPayloads(input).filter((row) => row.period === "primary" || row.period === "comparison");
  const comparisonRows = rows.filter((row) => row.period === "comparison");
  if (!comparisonRows.length) return null;
  const source =
    comparisonRows.some((row) => row.query != null || row.page != null) &&
    comparisonRows.every((row) => row.landingPage == null && row.pagePath == null)
      ? "google_search_console"
      : comparisonRows.some(
            (row) =>
              row.landingPage != null ||
              row.pagePath != null ||
              row.sessions != null ||
              row.sessionDefaultChannelGroup != null
          )
        ? "google_analytics"
        : null;
  return buildComparisonDataset({
    primaryRows: rows.filter((row) => row.period === "primary"),
    comparisonRows,
    source,
  });
};

const comparisonRulesForInput = (input) => {
  const dataset = extractComparisonDataset(input);
  if (!dataset) return null;
  return COMPARISON_RULES;
};

const metricChange = (primary, comparison) => {
  const primaryMissing = primary == null || primary === "" || !Number.isFinite(Number(primary));
  const comparisonMissing =
    comparison == null || comparison === "" || !Number.isFinite(Number(comparison));
  if (primaryMissing || comparisonMissing) {
    return {
      absolute: null,
      percentage: null,
      percentageAvailable: false,
      reason: "missing",
    };
  }
  const primaryNum = Number(primary);
  const comparisonNum = Number(comparison);
  const absolute = primaryNum - comparisonNum;
  if (comparisonNum === 0) {
    return {
      absolute,
      percentage: null,
      percentageAvailable: false,
      reason: "comparison_zero",
    };
  }
  return {
    absolute,
    percentage: (absolute / comparisonNum) * 100,
    percentageAvailable: true,
    reason: null,
  };
};

const GA4_ENTITY_FIELDS = Object.freeze([
  "landingPage",
  "pagePath",
  "pageTitle",
  "sessionDefaultChannelGroup",
  "sessionSourceMedium",
  "sessionSource",
  "sessionMedium",
  "firstUserDefaultChannelGroup",
]);

const GSC_ENTITY_FIELDS = Object.freeze(["query", "page"]);

const entityIdentity = (row, source) => {
  const payload = payloadOf(row);
  if (!payload || typeof payload !== "object") return null;
  const fields = source === "google_search_console" ? GSC_ENTITY_FIELDS : GA4_ENTITY_FIELDS;
  const parts = [];
  for (const field of fields) {
    if (payload[field] != null && payload[field] !== "") {
      parts.push(`${field}=${payload[field]}`);
    }
  }
  return parts.length ? parts.join("|") : null;
};

const unmatchedPrimaryEntities = (primaryRows, comparisonRows, source) => {
  const comparisonIds = new Set(
    (comparisonRows || []).map((row) => entityIdentity(row, source)).filter(Boolean)
  );
  return (primaryRows || []).filter((row) => {
    const id = entityIdentity(row, source);
    return id && !comparisonIds.has(id);
  });
};

module.exports = {
  COMPARISON_RULES,
  partitionPeriodRows,
  buildComparisonDataset,
  comparisonCarrierItem,
  attachComparisonDataset,
  extractComparisonDataset,
  comparisonRulesForInput,
  metricChange,
  entityIdentity,
  unmatchedPrimaryEntities,
};
