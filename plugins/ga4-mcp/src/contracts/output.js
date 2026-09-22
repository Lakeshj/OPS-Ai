/**
 * Output contracts for GA4 MCP Tools (STEP 2).
 *
 * Intelligence envelope:
 * {
 *   capability, opportunity_type, entity, metrics,
 *   reason, recommendation, score, score_breakdown
 * }
 *
 * Page performance DATA envelope:
 * {
 *   capability: "page_performance",
 *   row_kind: "ranked_page",
 *   opportunity_type: null,
 *   rank, entity, metrics, sortMetric, sortDirection, reason
 * }
 *
 * Scoring formulas are documented for Step 4 — not computed here.
 */

const {
  CAPABILITY_IDS,
  isDataCapability,
  getCapabilityDef,
} = require("./capabilities");

const OPPORTUNITY_TYPES = Object.freeze({
  LOW_ENGAGEMENT: "low_engagement",
  LANDING_UNDERPERFORMANCE: "landing_underperformance",
  ACQUISITION_CONCENTRATION: "acquisition_concentration",
  ACQUISITION_CHANNEL: "acquisition_channel",
});

/** Default opportunity_type per capability (page_performance → null). */
const CAPABILITY_OPPORTUNITY_TYPE = Object.freeze({
  engagement_opportunities: OPPORTUNITY_TYPES.LOW_ENGAGEMENT,
  landing_underperformance: OPPORTUNITY_TYPES.LANDING_UNDERPERFORMANCE,
  acquisition_concentration: OPPORTUNITY_TYPES.ACQUISITION_CONCENTRATION,
  page_performance: null,
});

const ROW_KIND = Object.freeze({
  RANKED_PAGE: "ranked_page",
});

const round = (n, digits = 2) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  const p = 10 ** digits;
  return Math.round(x * p) / p;
};

const INTELLIGENCE_ITEM_KEYS = Object.freeze([
  "capability",
  "opportunity_type",
  "entity",
  "metrics",
  "reason",
  "recommendation",
  "score",
  "score_breakdown",
]);

const DATA_PAGE_ITEM_KEYS = Object.freeze([
  "capability",
  "row_kind",
  "opportunity_type",
  "rank",
  "entity",
  "metrics",
  "sortMetric",
  "sortDirection",
  "reason",
]);

/**
 * Processor top-level output envelope (multi-select).
 * { capabilities, executed, count, warnings, ... }
 */
const emptyProcessorEnvelope = (capabilities = []) => ({
  ok: true,
  capabilities: [...capabilities],
  executed: [],
  count: 0,
  warnings: [],
});

const opportunityTypeForCapability = (capability, variant = null) => {
  const id = String(capability || "").trim();
  if (id === CAPABILITY_IDS.ACQUISITION && variant === "acquisition_channel") {
    return OPPORTUNITY_TYPES.ACQUISITION_CHANNEL;
  }
  if (Object.prototype.hasOwnProperty.call(CAPABILITY_OPPORTUNITY_TYPE, id)) {
    return CAPABILITY_OPPORTUNITY_TYPE[id];
  }
  return null;
};

/**
 * Force row identity for a capability run.
 * Prevents cross-capability metadata bleed under multi-select.
 * Never invents opportunity scores for page_performance.
 */
const stampItemIdentity = (row, capability, options = {}) => {
  const id = String(capability || "").trim();
  const base =
    row && typeof row === "object" && !Array.isArray(row) ? { ...row } : {};
  const def = getCapabilityDef(id);

  if (isDataCapability(id) || def?.category === "data") {
    const stamped = {
      ...base,
      capability: id,
      row_kind: ROW_KIND.RANKED_PAGE,
      opportunity_type: null,
    };
    // Explicitly strip invented opportunity scoring on DATA rows
    if ("score" in stamped && options.allowDataScore !== true) {
      delete stamped.score;
    }
    if ("score_breakdown" in stamped && options.allowDataScore !== true) {
      // Keep only rank audit if present; drop opportunity-style breakdowns
      if (
        stamped.score_breakdown &&
        typeof stamped.score_breakdown === "object" &&
        stamped.score_breakdown.rank != null
      ) {
        stamped.score_breakdown = {
          rank: stamped.score_breakdown.rank,
          sortMetric: stamped.score_breakdown.sortMetric,
          sortValue: stamped.score_breakdown.sortValue,
        };
      } else {
        delete stamped.score_breakdown;
      }
    }
    if ("recommendation" in stamped) {
      delete stamped.recommendation;
    }
    if ("reason" in stamped) {
      delete stamped.reason;
    }
    return stamped;
  }

  const expectedType =
    options.opportunity_type || opportunityTypeForCapability(id);
  return {
    ...base,
    capability: id,
    ...(expectedType != null ? { opportunity_type: expectedType } : {}),
  };
};

/** Alias matching GSC naming for adapter familiarity. */
const stampOpportunityIdentity = stampItemIdentity;

const buildScaffoldIntelligenceItem = (capability) => {
  const type = opportunityTypeForCapability(capability);
  return stampItemIdentity(
    {
      entity: { label: "__scaffold__" },
      metrics: {},
      reason:
        "GA4 MCP scaffold placeholder; capability evaluation not implemented (Step 4).",
      recommendation:
        "Await Step 4 implementation. Do not treat this as a real opportunity.",
      score: null,
      score_breakdown: {
        scaffold: true,
        implemented: false,
        note: "Scoring not implemented in Step 3 scaffold.",
      },
    },
    capability,
    { opportunity_type: type }
  );
};

const buildScaffoldDataItem = () =>
  stampItemIdentity(
    {
      rank: null,
      entity: { label: "__scaffold__" },
      metrics: {},
      sortMetric: null,
      sortDirection: null,
      reason:
        "GA4 MCP scaffold placeholder; page ranking not implemented (Step 4).",
    },
    CAPABILITY_IDS.PAGE_PERFORMANCE
  );

/**
 * Lightweight shape checks (scaffold). Full fidelity validation is Step 4+.
 */
const validateIntelligenceItemShape = (row) => {
  const errors = [];
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return ["item must be an object"];
  }
  for (const key of [
    "capability",
    "opportunity_type",
    "entity",
    "metrics",
    "reason",
  ]) {
    if (!(key in row)) errors.push(`missing key: ${key}`);
  }
  if (row.entity == null || typeof row.entity !== "object") {
    errors.push("entity must be an object");
  }
  return errors;
};

const validateDataPageItemShape = (row) => {
  const errors = [];
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return ["item must be an object"];
  }
  if (row.capability !== CAPABILITY_IDS.PAGE_PERFORMANCE) {
    errors.push('capability must be "page_performance"');
  }
  if (row.row_kind !== ROW_KIND.RANKED_PAGE) {
    errors.push('row_kind must be "ranked_page"');
  }
  if (row.opportunity_type != null) {
    errors.push("opportunity_type must be null for page_performance");
  }
  if (row.score != null && Number.isFinite(Number(row.score))) {
    errors.push("page_performance must not invent an opportunity score");
  }
  return errors;
};

module.exports = {
  OPPORTUNITY_TYPES,
  CAPABILITY_OPPORTUNITY_TYPE,
  ROW_KIND,
  INTELLIGENCE_ITEM_KEYS,
  DATA_PAGE_ITEM_KEYS,
  round,
  emptyProcessorEnvelope,
  opportunityTypeForCapability,
  stampItemIdentity,
  stampOpportunityIdentity,
  buildScaffoldIntelligenceItem,
  buildScaffoldDataItem,
  validateIntelligenceItemShape,
  validateDataPageItemShape,
};
