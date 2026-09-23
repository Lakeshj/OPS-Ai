/**
 * Main-flow processor: run OpsAi GA4 capabilities on upstream WorkflowItems.
 * No Google OAuth / property / runReport — data comes from googleAnalytics only.
 *
 * Multi-select: each selected capability executes independently on the SAME rows.
 * Identity (capability / opportunity_type / row_kind) is stamped per item.
 */

const {
  PROCESSOR_CAPABILITY_IDS,
  labelForCapabilityId,
  isProcessorCapability,
  isDataCapability,
} = require("../contracts/capabilities");
const {
  stampItemIdentity,
  opportunityTypeForCapability,
  emptyProcessorEnvelope,
} = require("../contracts/output");
const {
  validateCapabilityFilters,
  extractFiltersFromNodeData,
} = require("../contracts/filters");
const {
  validateUpstreamInput,
  cloneUpstreamRows,
} = require("../contracts/inputValidation");
const { capabilityOptionsForUi } = require("../contracts/nodeSchema");
const {
  runCapability,
  itemsFromCapabilityResult,
} = require("../capabilities");
const { resultToWorkflowItems } = require("./workflowNode");
const { ERROR } = require("../errors");
const {
  MARKER,
  tagIntelligenceItem,
  buildContextFromCapabilityRun,
  extractSourceMeta,
} = require("../contracts/intelligenceContext");

/** Expand one raw capability entry into id strings. */
const expandCapabilityEntry = (entry) => {
  if (entry == null || entry === "") return [];
  if (Array.isArray(entry)) {
    return entry.flatMap((v) => expandCapabilityEntry(v));
  }
  if (typeof entry === "string") {
    const trimmed = entry.trim();
    if (!trimmed) return [];
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
    if (Array.isArray(entry.values)) return expandCapabilityEntry(entry.values);
    if (Array.isArray(entry.capabilities)) {
      return expandCapabilityEntry(entry.capabilities);
    }
  }
  const asString = String(entry).trim();
  return asString ? [asString] : [];
};

/**
 * Normalize multiOptions / legacy capability into unique ids.
 * Explicit empty array stays empty (do not default-select).
 * Omitted fields default to engagement_opportunities for legacy single-cap nodes.
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
  return ["engagement_opportunities"];
};

const processSingleCapability = ({ id, rows, filters, nodeData, inventory }) => {
  if (!isProcessorCapability(id)) {
    return {
      ok: false,
      error: {
        code: ERROR.GA4_UNKNOWN_CAPABILITY,
        message: `Unknown GA4 processing capability: ${id}.`,
      },
      items: [],
      output: { ok: false, capability: id },
    };
  }

  const rawFilters =
    filters && typeof filters === "object" && !Array.isArray(filters)
      ? { ...filters }
      : extractFiltersFromNodeData(id, nodeData || {});

  const validated = validateCapabilityFilters(id, rawFilters);
  if (!validated.ok) {
    return {
      ok: false,
      error: validated.error,
      items: [],
      output: { ok: false, error: validated.error, capability: id },
    };
  }
  const normalizedFilters = validated.filters;

  const isolatedRows = cloneUpstreamRows(rows);
  const result = runCapability(id, {
    rows: isolatedRows,
    filters: normalizedFilters,
    inventory,
  });

  if (!result.ok) {
    return {
      ...result,
      items: [],
      output: { ok: false, error: result.error, capability: id },
    };
  }

  const shaped = resultToWorkflowItems(result);
  const rawItems = itemsFromCapabilityResult(id, result);
  const resolvedMeta = extractSourceMeta({
    rows,
    nodeData,
    sourceMeta: {
      property: nodeData?.propertyId || nodeData?.property,
      period: {
        start: nodeData?.startDate,
        end: nodeData?.endDate,
      },
    },
  });

  const meta = {
    capability: id,
    property: resolvedMeta.property,
    period: resolvedMeta.period,
    filters: { ...normalizedFilters },
  };

  const { context: intelligenceContextBase, section } =
    buildContextFromCapabilityRun({
      capability: id,
      filters: normalizedFilters,
      opportunities: rawItems,
      property: resolvedMeta.property,
      period: resolvedMeta.period,
    });

  const capWarnings = Array.isArray(result.warnings) ? result.warnings : [];
  const intelligenceContext = {
    ...intelligenceContextBase,
    warnings: capWarnings.map((w) =>
      w && typeof w === "object" ? { ...w } : w
    ),
  };

  const stampedItems =
    rawItems.length > 0
      ? rawItems.map((row, index) => ({
          json: tagIntelligenceItem(row, meta),
          pairedItem: { item: index },
        }))
      : [];

  // Empty runs emit a zero-result capability section (not an opportunity row)
  // so AI/downstream can see "executed + count 0 + warnings". Multi-select
  // appends these when one.items is empty (STEP 8E).
  const emptyEnvelopeItems =
    rawItems.length === 0
      ? [
          {
            json: {
              ...section,
              property: resolvedMeta.property,
              period: resolvedMeta.period,
              source: "google_analytics",
              warnings: capWarnings.map((w) =>
                w && typeof w === "object" ? { ...w } : w
              ),
              [MARKER]: true,
            },
            pairedItem: { item: 0 },
          },
        ]
      : [];

  void shaped;

  return {
    ok: true,
    items: stampedItems,
    emptyEnvelopeItems,
    intelligenceContext,
    output: {
      ok: true,
      capability: id,
      label: labelForCapabilityId(id),
      category: isDataCapability(id) ? "data" : "intelligence",
      filters: normalizedFilters,
      property: resolvedMeta.property,
      period: resolvedMeta.period,
      itemsIn: rows.length,
      itemsOut: rawItems.length,
      count: rawItems.length,
      warnings: result.warnings || [],
      scaffold: result.data?.scaffold === true,
      implemented: result.data?.implemented === true,
      intelligenceContext,
    },
  };
};

/**
 * @param {{
 *   capability?: string|string[],
 *   capabilities?: string[],
 *   inputItems?: any[],
 *   filters?: object,
 *   nodeData?: object,
 * }} opts
 */
const processUpstreamItems = ({
  capability,
  capabilities,
  inputItems = [],
  filters,
  nodeData,
} = {}) => {
  const ids = normalizeCapabilities(
    capability ?? nodeData?.capability ?? nodeData?.operation,
    capabilities ?? nodeData?.capabilities
  );

  if (!ids.length) {
    const err = {
      code: ERROR.GA4_CAPABILITY_REQUIRED,
      message:
        "No GA4 MCP capability selected. Select at least one capability and run again.",
    };
    return {
      ok: false,
      error: err,
      items: [],
      output: {
        ...emptyProcessorEnvelope([]),
        ok: false,
        error: err,
      },
    };
  }

  const upstream = validateUpstreamInput(inputItems);
  if (!upstream.ok) {
    return {
      ok: false,
      error: upstream.error,
      items: [],
      output: {
        ...emptyProcessorEnvelope(ids),
        ok: false,
        error: upstream.error,
        warnings: upstream.warnings || [],
      },
    };
  }

  const { rows, inventory, warnings: upstreamWarnings } = upstream;

  if (ids.length === 1) {
    const one = processSingleCapability({
      id: ids[0],
      rows,
      filters,
      nodeData,
      inventory,
    });
    const warnings = [
      ...(upstreamWarnings || []),
      ...(one.output?.warnings || []),
    ];
    const items =
      one.items && one.items.length
        ? one.items
        : one.emptyEnvelopeItems || [];
    return {
      ...one,
      items,
      output: {
        ...one.output,
        capabilities: ids,
        executed: one.ok ? [ids[0]] : [],
        count: one.output?.count ?? 0,
        warnings,
        inventory,
      },
    };
  }

  const perCapability = [];
  const allItems = [];
  const warnings = [...(upstreamWarnings || [])];
  const failures = [];
  const executed = [];
  let paired = 0;

  for (const id of ids) {
    // Never pass shared filters — each capability extracts its own.
    const one = processSingleCapability({
      id,
      rows,
      filters: undefined,
      nodeData,
      inventory,
    });

    if (!one.ok) {
      failures.push({
        capability: id,
        error: one.error || { code: ERROR.GA4_VALIDATION, message: "failed" },
      });
      perCapability.push({
        capability: id,
        count: 0,
        label: labelForCapabilityId(id),
        ok: false,
        error: one.error || null,
      });
      warnings.push({
        code: one.error?.code || "GA4_CAPABILITY_FAILED",
        message: `${labelForCapabilityId(id)}: ${
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
      label: labelForCapabilityId(id),
      ok: true,
      category: one.output?.category,
    });
    if (Array.isArray(one.output?.warnings)) {
      warnings.push(...one.output.warnings);
    }

    const rowItems = Array.isArray(one.items) ? one.items : [];
    if (rowItems.length > 0) {
      for (const item of rowItems) {
        const json = item?.json;
        // Re-stamp with THIS capability id — never inherit another capability's identity.
        const stamped =
          json && typeof json === "object" && !Array.isArray(json)
            ? tagIntelligenceItem(json, {
                capability: id,
                property: json.property,
                period: json.period,
                filters: json.filters,
              })
            : json;
        allItems.push({
          ...item,
          json: stamped,
          pairedItem: { item: paired },
        });
        paired += 1;
      }
    } else if (
      one.ok &&
      Array.isArray(one.emptyEnvelopeItems) &&
      one.emptyEnvelopeItems.length > 0
    ) {
      // Preserve zero-result sections (count:0, results:[], warnings).
      // Do NOT stamp as opportunity rows (no score / opportunity_type / entity).
      for (const item of one.emptyEnvelopeItems) {
        allItems.push({
          ...item,
          pairedItem: { item: paired },
        });
        paired += 1;
      }
    }
  }

  if (executed.length === 0) {
    const first = failures[0];
    return {
      ok: false,
      error: first?.error || {
        code: ERROR.GA4_VALIDATION,
        message: "All selected GA4 capabilities failed",
      },
      items: [],
      output: {
        ok: false,
        capabilities: ids,
        executed: [],
        count: 0,
        failures,
        error: first?.error,
        warnings,
        inventory,
      },
    };
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
      labels: ids.map((capId) => labelForCapabilityId(capId)),
      perCapability,
      itemsIn: rows.length,
      itemsOut: allItems.length,
      count: allItems.length,
      warnings,
      inventory,
      scaffold: true,
    },
  };
};

module.exports = {
  PROCESSOR_CAPABILITY_IDS,
  capabilityOptionsForUi,
  normalizeCapabilities,
  processUpstreamItems,
  processSingleCapability,
};
