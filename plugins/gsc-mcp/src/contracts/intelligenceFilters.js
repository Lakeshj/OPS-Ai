/**
 * Configurable filter schemas for GSC MCP intelligence capabilities.
 * Internal field ids stay stable; UI labels live in the frontend schema.
 *
 * Output opportunity schema is unchanged — filters only affect which rows qualify.
 */

const FILTER_DEFAULTS = Object.freeze({
  ctr_opportunities: Object.freeze({
    minImpressions: 50,
    maxPosition: 20,
    minScore: 0,
    limit: 50,
    // Internal defaults (not all exposed in UI)
    maxCtr: 0.03,
    minPosition: 4,
  }),
  ranking_opportunities: Object.freeze({
    minImpressions: 30,
    minPosition: 5,
    maxPosition: 20,
    limit: 50,
  }),
  content_decay: Object.freeze({
    // Always prior vs current — snapshot is not a valid decay mode
    comparisonPeriod: "prior_period",
    minPreviousImpressions: 50,
    minCurrentImpressions: 20,
    minClickDropPercent: 20,
    minPositionWorsening: 1,
    limit: 50,
    // Legacy alias accepted in validateIntelligenceFilters
    dropPercentage: 20,
  }),
  keyword_cannibalization: Object.freeze({
    minPages: 2,
    minImpressions: 0,
    limit: 50,
  }),
});

const COMPARISON_PERIODS = Object.freeze(["prior_period"]);

const toFiniteNumber = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const toPositiveInt = (value, fallback) => {
  const n = Math.round(toFiniteNumber(value, fallback));
  return n >= 0 ? n : fallback;
};

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/**
 * Normalize + validate filters for a capability.
 * @returns {{ ok: true, filters: object } | { ok: false, error: { code, message } }}
 */
const validateIntelligenceFilters = (capability, raw = {}) => {
  const id = String(capability || "");
  const defaults = FILTER_DEFAULTS[id];
  if (!defaults) {
    return { ok: true, filters: { ...(raw && typeof raw === "object" ? raw : {}) } };
  }

  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};

  if (id === "ctr_opportunities") {
    const minImpressions = toPositiveInt(
      src.minImpressions,
      defaults.minImpressions
    );
    const maxPosition = toFiniteNumber(src.maxPosition, defaults.maxPosition);
    const minScore = toFiniteNumber(src.minScore, defaults.minScore);
    const limit = toPositiveInt(src.limit, defaults.limit);
    const maxCtr = toFiniteNumber(src.maxCtr, defaults.maxCtr);
    const minPosition = toFiniteNumber(src.minPosition, defaults.minPosition);

    if (minImpressions < 0) {
      return invalid("minImpressions must be >= 0");
    }
    if (maxPosition < 1 || maxPosition > 100) {
      return invalid("maxPosition must be between 1 and 100");
    }
    if (minScore < 0) {
      return invalid("minScore must be >= 0");
    }
    if (limit < 0 || limit > 5000) {
      return invalid("limit must be between 0 and 5000 (0 = unlimited)");
    }
    if (minPosition > maxPosition) {
      return invalid("minPosition cannot exceed maxPosition");
    }

    return {
      ok: true,
      filters: {
        minImpressions,
        maxPosition: clamp(maxPosition, 1, 100),
        minScore,
        limit,
        maxCtr: clamp(maxCtr, 0, 1),
        minPosition: clamp(minPosition, 1, 100),
      },
    };
  }

  if (id === "ranking_opportunities") {
    const minImpressions = toPositiveInt(
      src.minImpressions,
      defaults.minImpressions
    );
    const minPosition = toFiniteNumber(src.minPosition, defaults.minPosition);
    const maxPosition = toFiniteNumber(src.maxPosition, defaults.maxPosition);
    const limit = toPositiveInt(src.limit, defaults.limit);

    if (minImpressions < 0) return invalid("minImpressions must be >= 0");
    if (minPosition < 1 || maxPosition > 100) {
      return invalid("position range must be within 1–100");
    }
    if (minPosition > maxPosition) {
      return invalid("minPosition cannot exceed maxPosition");
    }
    if (limit < 0 || limit > 5000) {
      return invalid("limit must be between 0 and 5000 (0 = unlimited)");
    }

    return {
      ok: true,
      filters: {
        minImpressions,
        minPosition: clamp(minPosition, 1, 100),
        maxPosition: clamp(maxPosition, 1, 100),
        limit,
      },
    };
  }

  if (id === "content_decay") {
    const comparisonPeriodRaw = String(
      src.comparisonPeriod != null ? src.comparisonPeriod : defaults.comparisonPeriod
    ).trim();
    if (comparisonPeriodRaw === "snapshot") {
      return invalid(
        "Content Decay requires current-period and previous-period GSC data. A single snapshot cannot establish decay."
      );
    }
    const comparisonPeriod = "prior_period";

    const minPreviousImpressions = toPositiveInt(
      src.minPreviousImpressions ?? src.minImpressions,
      defaults.minPreviousImpressions
    );
    const minCurrentImpressions = toPositiveInt(
      src.minCurrentImpressions,
      defaults.minCurrentImpressions
    );
    const minClickDropPercent = toFiniteNumber(
      src.minClickDropPercent ?? src.dropPercentage,
      defaults.minClickDropPercent
    );
    const minPositionWorsening = toFiniteNumber(
      src.minPositionWorsening,
      defaults.minPositionWorsening
    );
    const limit = toPositiveInt(src.limit, defaults.limit);

    if (minPreviousImpressions < 0) {
      return invalid("minPreviousImpressions must be >= 0");
    }
    if (minCurrentImpressions < 0) {
      return invalid("minCurrentImpressions must be >= 0");
    }
    if (minClickDropPercent < 0 || minClickDropPercent > 100) {
      return invalid("minClickDropPercent must be between 0 and 100");
    }
    if (minPositionWorsening < 0 || minPositionWorsening > 100) {
      return invalid("minPositionWorsening must be between 0 and 100");
    }
    if (limit < 0 || limit > 5000) {
      return invalid("limit must be between 0 and 5000 (0 = unlimited)");
    }

    return {
      ok: true,
      filters: {
        comparisonPeriod,
        minPreviousImpressions,
        minCurrentImpressions,
        minClickDropPercent,
        minPositionWorsening,
        // legacy alias
        dropPercentage: minClickDropPercent,
        limit,
      },
    };
  }

  if (id === "keyword_cannibalization") {
    const minPages = toPositiveInt(src.minPages, defaults.minPages);
    const minImpressions = toPositiveInt(
      src.minImpressions,
      defaults.minImpressions
    );
    const limit = toPositiveInt(src.limit, defaults.limit);

    if (minPages < 2) {
      return invalid("minPages must be >= 2");
    }
    if (minImpressions < 0) return invalid("minImpressions must be >= 0");
    if (limit < 0 || limit > 5000) {
      return invalid("limit must be between 0 and 5000 (0 = unlimited)");
    }

    return {
      ok: true,
      filters: { minPages, minImpressions, limit },
    };
  }

  return { ok: true, filters: { ...defaults } };
};

const invalid = (message) => ({
  ok: false,
  error: { code: "MCP_VALIDATION", message },
});

/** Apply limit after sort; 0 / null means unlimited. */
const applyLimit = (list, limit) => {
  const rows = Array.isArray(list) ? list : [];
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return rows;
  return rows.slice(0, Math.floor(n));
};

/**
 * Pick filter fields from a flat node.data object for a capability.
 */
const extractFiltersFromNodeData = (capability, data = {}) => {
  const id = String(capability || "");
  const src = data && typeof data === "object" ? data : {};
  if (id === "ctr_opportunities") {
    return {
      minImpressions: src.minImpressions,
      maxPosition: src.maxPosition,
      minScore: src.minScore,
      limit: src.limit,
      maxCtr: src.maxCtr,
      minPosition: src.minPosition,
    };
  }
  if (id === "ranking_opportunities") {
    return {
      minImpressions: src.rankingMinImpressions ?? src.minImpressions,
      minPosition: src.minPosition,
      maxPosition: src.rankingMaxPosition ?? src.maxPosition,
      limit: src.rankingLimit ?? src.limit,
    };
  }
  if (id === "content_decay") {
    return {
      comparisonPeriod: src.comparisonPeriod,
      dropPercentage: src.dropPercentage ?? src.minClickDropPercent,
      minClickDropPercent: src.minClickDropPercent ?? src.dropPercentage,
      minPreviousImpressions:
        src.minPreviousImpressions ?? src.minImpressions,
      minCurrentImpressions: src.minCurrentImpressions,
      minPositionWorsening: src.minPositionWorsening,
      limit: src.decayLimit ?? src.limit,
    };
  }
  if (id === "keyword_cannibalization") {
    return {
      minPages: src.minPages,
      minImpressions: src.cannibalMinImpressions ?? src.minImpressions,
      limit: src.cannibalLimit ?? src.limit,
    };
  }
  return {};
};

/** JSON-schema-ish descriptors for registry / Assistant discovery. */
const FILTER_INPUT_SCHEMAS = Object.freeze({
  ctr_opportunities: {
    type: "object",
    properties: {
      rows: { type: "array" },
      minImpressions: { type: "number", default: 50 },
      maxPosition: { type: "number", default: 20 },
      minScore: { type: "number", default: 0 },
      limit: { type: "number", default: 50 },
    },
  },
  ranking_opportunities: {
    type: "object",
    properties: {
      rows: { type: "array" },
      minImpressions: { type: "number", default: 30 },
      minPosition: { type: "number", default: 5 },
      maxPosition: { type: "number", default: 20 },
      limit: { type: "number", default: 50 },
    },
  },
  content_decay: {
    type: "object",
    properties: {
      rows: { type: "array", description: "Current-period GSC rows" },
      currentRows: { type: "array", description: "Alias for current-period rows" },
      previousRows: {
        type: "array",
        description: "Previous-period GSC rows (required)",
      },
      minPreviousImpressions: { type: "number", default: 50 },
      minCurrentImpressions: { type: "number", default: 20 },
      minClickDropPercent: { type: "number", default: 20 },
      minPositionWorsening: { type: "number", default: 1 },
      limit: { type: "number", default: 50 },
    },
    required: ["previousRows"],
  },
  keyword_cannibalization: {
    type: "object",
    properties: {
      rows: { type: "array" },
      minPages: { type: "number", default: 2 },
      minImpressions: { type: "number", default: 0 },
      limit: { type: "number", default: 50 },
    },
  },
});

module.exports = {
  FILTER_DEFAULTS,
  FILTER_INPUT_SCHEMAS,
  COMPARISON_PERIODS,
  validateIntelligenceFilters,
  applyLimit,
  extractFiltersFromNodeData,
};
