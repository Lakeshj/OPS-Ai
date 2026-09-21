/**
 * Main-flow processor: run OpsAi GSC capabilities on upstream WorkflowItems.
 * No Google OAuth / property selection — data comes from previous nodes (e.g. googleSearchConsole).
 *
 * Emits capability-preserving IntelligenceContext (and tagged opportunity items)
 * so Merge / AI can reason without flattening away source metadata.
 *
 * Supports one or many capabilities (multi-select on the canvas node).
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
  combineIntelligenceInputs,
  MARKER,
} = require("../contracts/intelligenceContext");
const {
  stampOpportunityIdentity,
  opportunityTypeForCapability,
} = require("../contracts/intelligenceOutput");
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

/** Shallow-clone each row so capability runs cannot mutate shared upstream data. */
const cloneUpstreamRows = (rows = []) =>
  (Array.isArray(rows) ? rows : []).map((row) =>
    row && typeof row === "object" && !Array.isArray(row) ? { ...row } : row
  );

/** Expand one raw capability entry into id strings (handles JSON / comma lists). */
const expandCapabilityEntry = (entry) => {
  if (entry == null || entry === "") return [];
  if (Array.isArray(entry)) {
    return entry.flatMap((v) => expandCapabilityEntry(v));
  }
  if (typeof entry === "string") {
    const trimmed = entry.trim();
    if (!trimmed) return [];
    // JSON-encoded array accidentally stored as a string
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return expandCapabilityEntry(parsed);
      } catch {
        /* fall through */
      }
    }
    if (trimmed.includes(",") && !PROCESSOR_CAPABILITY_IDS.includes(trimmed)) {
      return trimmed
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
    }
    return [trimmed];
  }
  if (typeof entry === "object") {
    // Rare: { values: [...] } or similar
    if (Array.isArray(entry.values)) return expandCapabilityEntry(entry.values);
    if (Array.isArray(entry.capabilities)) {
      return expandCapabilityEntry(entry.capabilities);
    }
  }
  const asString = String(entry).trim();
  return asString ? [asString] : [];
};

/**
 * Normalize legacy string / multiOptions array / capabilities[] into unique ids.
 * Never collapses to the first selected capability.
 *
 * Explicit empty array (user cleared all checkboxes) stays empty — do NOT
 * default back to ctr_opportunities (that caused "nothing selected" → still CTR).
 * Only default when the field is entirely omitted (legacy single-cap nodes).
 */
const normalizeCapabilities = (capability, capabilities) => {
  const explicitEmpty =
    (Array.isArray(capabilities) && capabilities.length === 0) ||
    (Array.isArray(capability) &&
      capability.length === 0 &&
      capabilities === undefined);

  const raw = [
    ...expandCapabilityEntry(capabilities),
    ...expandCapabilityEntry(capability),
  ];

  const seen = new Set();
  const ids = [];
  for (const id of raw) {
    const cleaned = String(id || "").trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    ids.push(cleaned);
  }
  if (ids.length) return ids;
  if (explicitEmpty) return [];
  return ["ctr_opportunities"];
};

const normalizeOpportunityList = (opportunities, capabilityId) =>
  (Array.isArray(opportunities) ? opportunities : []).map((row) =>
    stampOpportunityIdentity(row, capabilityId)
  );

const processSingleCapability = ({
  id,
  rows,
  title,
  filters,
  previousRows,
  nodeData,
  resolvedMeta,
}) => {
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

  // Always extract filters for THIS capability. Never reuse another capability's
  // filter object (shared `filters` would stamp the wrong identity downstream).
  const rawFilters =
    filters && typeof filters === "object" && !Array.isArray(filters)
      ? { ...filters }
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
    normalizedFilters = { ...validated.filters };
  }

  if (ESSENTIAL_INTELLIGENCE_IDS.includes(id) && !resolvedMeta.property) {
    const err = {
      code: "MCP_PROPERTY_REQUIRED",
      message:
        "IntelligenceContext requires a Google Search Console property (site URL). Ensure the upstream GSC node ran with a site selected, or set property/siteUrl on this node.",
    };
    return { ok: false, error: err, items: [], output: { ok: false, error: err } };
  }

  // Fresh row copies for this capability only
  const isolatedRows = cloneUpstreamRows(rows);
  const payload = {
    rows: isolatedRows,
    title: title || labelForToolId(id),
    ...normalizedFilters,
  };
  if (Array.isArray(previousRows) && previousRows.length) {
    payload.previousRows = cloneUpstreamRows(previousRows);
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
  const rawOpportunities = Array.isArray(result.data?.opportunities)
    ? result.data.opportunities
    : ESSENTIAL_INTELLIGENCE_IDS.includes(id)
      ? []
      : (shaped.items || []).map((it) => itemPayload(it));

  // Stamp identity BEFORE context build / item tagging so ranking never inherits CTR.
  const opportunities = normalizeOpportunityList(rawOpportunities, id);

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

    // Fresh meta object every time — never reuse prior capability metadata.
    const meta = {
      capability: id,
      opportunity_type: opportunityTypeForCapability(id),
      property: resolvedMeta.property,
      period: resolvedMeta.period ? { ...resolvedMeta.period } : null,
      filters: { ...normalizedFilters },
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

  const actionItems = (shaped.items || []).map((it, index) => {
    const row = itemPayload(it) || {};
    return {
      json: {
        ...stampOpportunityIdentity(row, id),
        ...(resolvedMeta.property
          ? {
              [MARKER]: true,
              capability: id,
              property: resolvedMeta.property,
              period: resolvedMeta.period,
              source: "google_search_console",
            }
          : { capability: id }),
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

/**
 * @param {{
 *   capability?: string|string[],
 *   capabilities?: string[],
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
  capabilities,
  inputItems = [],
  title,
  filters,
  previousRows,
  nodeData,
  context,
  sourceMeta,
} = {}) => {
  const ids = normalizeCapabilities(
    // Prefer explicit capabilities[] when present (multi-select canonical field).
    capability ?? nodeData?.capability ?? nodeData?.operation,
    capabilities ?? nodeData?.capabilities
  );

  if (!ids.length) {
    const err = {
      code: "MCP_CAPABILITY_REQUIRED",
      message:
        "No GSC MCP capability selected. Select at least one capability and run again.",
    };
    return {
      ok: false,
      error: err,
      items: [],
      output: {
        ok: false,
        error: err,
        capabilities: [],
        executed: [],
        count: 0,
      },
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

  const resolvedMeta = extractSourceMeta({
    rows,
    steps: context?.steps || {},
    nodeData: nodeData || {},
    sourceMeta: sourceMeta || {},
  });

  if (ids.length === 1) {
    return processSingleCapability({
      id: ids[0],
      rows,
      title,
      // Single-cap may still accept explicit filters override
      filters,
      previousRows,
      nodeData,
      resolvedMeta,
    });
  }

  const perCapability = [];
  const allItems = [];
  const intelContexts = [];
  const warnings = [];
  const failures = [];
  const executed = [];
  let paired = 0;

  for (const id of ids) {
    // Multi-cap: never pass shared filters — each capability extracts its own.
    // Always execute every selected id; one failure must not discard others.
    const one = processSingleCapability({
      id,
      rows,
      title: undefined,
      filters: undefined,
      previousRows,
      nodeData,
      resolvedMeta,
    });

    if (!one.ok) {
      failures.push({
        capability: id,
        error: one.error || { code: "MCP_TOOL_FAILED", message: "failed" },
      });
      perCapability.push({
        capability: id,
        count: 0,
        label: labelForToolId(id),
        ok: false,
        error: one.error || null,
      });
      warnings.push({
        code: one.error?.code || "MCP_CAPABILITY_FAILED",
        message: `${labelForToolId(id)}: ${
          one.error?.message || "capability failed"
        }`,
        capability: id,
      });
      continue;
    }

    executed.push(id);
    perCapability.push({
      capability: id,
      count: one.output?.count ?? one.items?.length ?? 0,
      label: labelForToolId(id),
      ok: true,
    });
    if (Array.isArray(one.output?.warnings)) {
      warnings.push(...one.output.warnings);
    }
    if (one.intelligenceContext) {
      intelContexts.push(JSON.parse(JSON.stringify(one.intelligenceContext)));
    }
    for (const item of one.items || []) {
      const json = item?.json;
      const stamped =
        json &&
        typeof json === "object" &&
        !Array.isArray(json) &&
        json.opportunity_type
          ? { ...json, ...stampOpportunityIdentity(json, id) }
          : json && typeof json === "object" && json.capability
            ? { ...json, capability: id }
            : json;
      allItems.push({
        ...item,
        json: stamped,
        pairedItem: { item: paired },
      });
      paired += 1;
    }
  }

  // All selected capabilities failed — surface the first error.
  if (executed.length === 0) {
    const first = failures[0];
    return {
      ok: false,
      error: first?.error || {
        code: "MCP_TOOL_FAILED",
        message: "All selected GSC capabilities failed",
      },
      items: [],
      output: {
        ok: false,
        capabilities: ids,
        executed: [],
        failures,
        error: first?.error,
      },
    };
  }

  let intelligenceContext = null;
  if (intelContexts.length === 1) {
    intelligenceContext = intelContexts[0];
  } else if (intelContexts.length > 1) {
    intelligenceContext = combineIntelligenceInputs(intelContexts, {
      property: resolvedMeta.property,
      period: resolvedMeta.period,
    });
    const validated = validateIntelligenceContext(intelligenceContext, {
      requireProperty: true,
    });
    if (!validated.ok) {
      warnings.push({
        code: validated.error?.code || "MCP_INTEL_CONTEXT_INVALID",
        message:
          validated.error?.message ||
          "Combined IntelligenceContext validation failed",
      });
      intelligenceContext = null;
    }
  }

  return {
    ok: true,
    items: allItems,
    output: {
      ok: true,
      capabilities: ids,
      executed,
      failures: failures.length ? failures : undefined,
      capability: ids[0],
      labels: ids.map((capId) => labelForToolId(capId)),
      perCapability,
      property: resolvedMeta.property,
      period: resolvedMeta.period,
      itemsIn: rows.length,
      itemsOut: allItems.length,
      count: allItems.length,
      intelligenceContext: intelligenceContext || undefined,
      warnings,
    },
    intelligenceContext: intelligenceContext || undefined,
    resolved: {
      capabilities: ids,
      executed,
      property: resolvedMeta.property,
      period: resolvedMeta.period,
    },
  };
};

module.exports = {
  PROCESSOR_CAPABILITY_IDS,
  capabilityOptionsForUi,
  rowsFromInputItems,
  cloneUpstreamRows,
  normalizeCapabilities,
  processUpstreamItems,
};
