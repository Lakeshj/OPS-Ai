/**
 * Filter schemas for GA4 MCP capabilities (STEP 2 defaults).
 * engagement_opportunities has full validation (STEP 4).
 * Other capabilities keep merge-with-defaults until implemented.
 */

const { ERROR } = require("../errors");

const FILTER_DEFAULTS = Object.freeze({
  engagement_opportunities: Object.freeze({
    minSessions: 100,
    maxEngagementRate: 0.4,
    minBounceRate: 0.6,
    minScore: 0,
    limit: 50,
  }),
  landing_underperformance: Object.freeze({
    minSessions: 150,
    maxEngagementRate: 0.35,
    minBounceRate: 0.65,
    maxViewsPerSession: 1.2,
    maxAverageSessionDuration: 25,
    minScore: 0,
    limit: 50,
  }),
  acquisition_concentration: Object.freeze({
    minShare: 0.35,
    /** Alias / explicit concentration threshold (same default as minShare). */
    minConcentrationShare: 0.35,
    minVolume: 100,
    minScore: 0,
    limit: 20,
  }),
  page_performance: Object.freeze({
    sortMetric: "sessions",
    sortDirection: "desc",
    entityDim: "auto",
    minSessions: 0,
    minTotalUsers: 0,
    minPageViews: 0,
    minMetricValue: null,
    limit: 50,
  }),
});

/** Known filter keys per capability — used for isolation from flat nodeData. */
const FILTER_KEYS_BY_CAPABILITY = Object.freeze({
  engagement_opportunities: Object.freeze([
    "minSessions",
    "maxEngagementRate",
    "minBounceRate",
    "minScore",
    "limit",
  ]),
  landing_underperformance: Object.freeze([
    "minSessions",
    "maxEngagementRate",
    "minBounceRate",
    "maxViewsPerSession",
    "maxAverageSessionDuration",
    "minScore",
    "limit",
  ]),
  acquisition_concentration: Object.freeze([
    "minShare",
    "minConcentrationShare",
    "minVolume",
    "minScore",
    "limit",
  ]),
  page_performance: Object.freeze([
    "sortMetric",
    "sortDirection",
    "entityDim",
    "minSessions",
    "minTotalUsers",
    "minPageViews",
    "minMetricValue",
    "limit",
  ]),
});

const isMissingFilterValue = (value) => {
  if (value == null) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  return false;
};

const cleanFilterBag = (bag = {}) => {
  const out = {};
  for (const [key, value] of Object.entries(bag || {})) {
    if (isMissingFilterValue(value)) continue;
    out[key] = value;
  }
  return out;
};

const toFiniteNumber = (value, fallback) => {
  if (isMissingFilterValue(value)) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const toPositiveInt = (value, fallback) => {
  if (isMissingFilterValue(value)) return fallback;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return n >= 0 ? n : fallback;
};

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/**
 * Rates are 0–1. Values in (1, 100] are treated as percents once.
 */
const normalizeRateFilter = (value, fallback) => {
  let n = toFiniteNumber(value, fallback);
  if (n > 1 && n <= 100) n = n / 100;
  return n;
};

const invalid = (message) => ({
  ok: false,
  error: { code: ERROR.GA4_VALIDATION, message },
});

const pickCapabilityFilterKeys = (capabilityId, bag = {}) => {
  const keys = FILTER_KEYS_BY_CAPABILITY[capabilityId];
  if (!keys) return { ...(bag || {}) };
  const out = {};
  for (const key of keys) {
    if (bag[key] !== undefined) out[key] = bag[key];
  }
  return out;
};

/**
 * Validate + normalize filters for a capability.
 * @returns {{ ok: true, filters: object } | { ok: false, error: { code, message } }}
 */
const validateCapabilityFilters = (capability, raw = {}) => {
  const id = String(capability || "").trim();
  const defaults = FILTER_DEFAULTS[id] || {};
  const cleaned = cleanFilterBag(
    pickCapabilityFilterKeys(id, raw && typeof raw === "object" ? raw : {})
  );

  if (id === "engagement_opportunities") {
    const minSessions = toPositiveInt(
      cleaned.minSessions,
      defaults.minSessions
    );
    const maxEngagementRate = normalizeRateFilter(
      cleaned.maxEngagementRate,
      defaults.maxEngagementRate
    );
    const minBounceRate = normalizeRateFilter(
      cleaned.minBounceRate,
      defaults.minBounceRate
    );
    const minScore = toFiniteNumber(cleaned.minScore, defaults.minScore);
    const limit = toPositiveInt(cleaned.limit, defaults.limit);

    if (minSessions < 0) {
      return invalid("minSessions must be >= 0");
    }
    if (maxEngagementRate < 0 || maxEngagementRate > 1) {
      return invalid("maxEngagementRate must be between 0 and 1 (or 0–100%)");
    }
    if (minBounceRate < 0 || minBounceRate > 1) {
      return invalid("minBounceRate must be between 0 and 1 (or 0–100%)");
    }
    if (minScore < 0) {
      return invalid("minScore must be >= 0");
    }
    if (limit < 0 || limit > 5000) {
      return invalid("limit must be between 0 and 5000 (0 = unlimited)");
    }

    return {
      ok: true,
      filters: {
        minSessions,
        maxEngagementRate: clamp(maxEngagementRate, 0, 1),
        minBounceRate: clamp(minBounceRate, 0, 1),
        minScore,
        limit,
      },
    };
  }

  if (id === "landing_underperformance") {
    const minSessions = toPositiveInt(
      cleaned.minSessions,
      defaults.minSessions
    );
    const maxEngagementRate = normalizeRateFilter(
      cleaned.maxEngagementRate,
      defaults.maxEngagementRate
    );
    const minBounceRate = normalizeRateFilter(
      cleaned.minBounceRate,
      defaults.minBounceRate
    );
    const maxViewsPerSession = toFiniteNumber(
      cleaned.maxViewsPerSession,
      defaults.maxViewsPerSession
    );
    const maxAverageSessionDuration = toFiniteNumber(
      cleaned.maxAverageSessionDuration,
      defaults.maxAverageSessionDuration
    );
    const minScore = toFiniteNumber(cleaned.minScore, defaults.minScore);
    const limit = toPositiveInt(cleaned.limit, defaults.limit);

    if (minSessions < 0) {
      return invalid("minSessions must be >= 0");
    }
    if (maxEngagementRate < 0 || maxEngagementRate > 1) {
      return invalid("maxEngagementRate must be between 0 and 1 (or 0–100%)");
    }
    if (minBounceRate < 0 || minBounceRate > 1) {
      return invalid("minBounceRate must be between 0 and 1 (or 0–100%)");
    }
    if (maxViewsPerSession < 0 || maxViewsPerSession > 100) {
      return invalid("maxViewsPerSession must be between 0 and 100");
    }
    if (maxAverageSessionDuration < 0 || maxAverageSessionDuration > 86400) {
      return invalid(
        "maxAverageSessionDuration must be between 0 and 86400 seconds"
      );
    }
    if (minScore < 0) {
      return invalid("minScore must be >= 0");
    }
    if (limit < 0 || limit > 5000) {
      return invalid("limit must be between 0 and 5000 (0 = unlimited)");
    }

    return {
      ok: true,
      filters: {
        minSessions,
        maxEngagementRate: clamp(maxEngagementRate, 0, 1),
        minBounceRate: clamp(minBounceRate, 0, 1),
        maxViewsPerSession,
        maxAverageSessionDuration,
        minScore,
        limit,
      },
    };
  }

  if (id === "acquisition_concentration") {
    // Concentration threshold: minShare, with minConcentrationShare as alias
    const shareRaw =
      cleaned.minShare !== undefined
        ? cleaned.minShare
        : cleaned.minConcentrationShare;
    const minShare = normalizeRateFilter(shareRaw, defaults.minShare);
    const minConcentrationShare = normalizeRateFilter(
      cleaned.minConcentrationShare !== undefined
        ? cleaned.minConcentrationShare
        : shareRaw,
      defaults.minConcentrationShare
    );
    // Effective threshold is the stricter (higher) of the two when both set
    const effectiveShare = Math.max(minShare, minConcentrationShare);
    const minVolume = toPositiveInt(cleaned.minVolume, defaults.minVolume);
    const minScore = toFiniteNumber(cleaned.minScore, defaults.minScore);
    const limit = toPositiveInt(cleaned.limit, defaults.limit);

    if (effectiveShare < 0 || effectiveShare > 1) {
      return invalid(
        "minShare / minConcentrationShare must be between 0 and 1 (or 0–100%)"
      );
    }
    if (minVolume < 0) {
      return invalid("minVolume must be >= 0");
    }
    if (minScore < 0) {
      return invalid("minScore must be >= 0");
    }
    if (limit < 0 || limit > 5000) {
      return invalid("limit must be between 0 and 5000 (0 = unlimited)");
    }

    return {
      ok: true,
      filters: {
        minShare: clamp(effectiveShare, 0, 1),
        minConcentrationShare: clamp(effectiveShare, 0, 1),
        minVolume,
        minScore,
        limit,
      },
    };
  }

  if (id === "page_performance") {
    const PAGE_SORT_METRICS = [
      "sessions",
      "totalUsers",
      "screenPageViews",
      "engagementRate",
      "bounceRate",
      "averageSessionDuration",
      "userEngagementDuration",
      "screenPageViewsPerSession",
    ];
    const sortMetric = String(
      cleaned.sortMetric != null ? cleaned.sortMetric : defaults.sortMetric
    ).trim();
    const sortDirectionRaw = String(
      cleaned.sortDirection != null
        ? cleaned.sortDirection
        : defaults.sortDirection
    )
      .trim()
      .toLowerCase();
    const entityDimRaw = String(
      cleaned.entityDim != null ? cleaned.entityDim : defaults.entityDim
    )
      .trim()
      .toLowerCase();
    const minSessions = toPositiveInt(
      cleaned.minSessions,
      defaults.minSessions
    );
    const minTotalUsers = toPositiveInt(
      cleaned.minTotalUsers,
      defaults.minTotalUsers
    );
    const minPageViews = toPositiveInt(
      cleaned.minPageViews,
      defaults.minPageViews
    );
    const minMetricValue =
      cleaned.minMetricValue === undefined || cleaned.minMetricValue === null
        ? null
        : toFiniteNumber(cleaned.minMetricValue, NaN);
    const limit = toPositiveInt(cleaned.limit, defaults.limit);

    if (!PAGE_SORT_METRICS.includes(sortMetric)) {
      return invalid(
        `sortMetric must be one of: ${PAGE_SORT_METRICS.join(", ")}`
      );
    }
    if (sortDirectionRaw !== "desc" && sortDirectionRaw !== "asc") {
      return invalid('sortDirection must be "desc" or "asc"');
    }
    if (
      entityDimRaw !== "auto" &&
      entityDimRaw !== "pagepath" &&
      entityDimRaw !== "landingpage"
    ) {
      return invalid('entityDim must be "auto", "pagePath", or "landingPage"');
    }
    const entityDim =
      entityDimRaw === "pagepath"
        ? "pagePath"
        : entityDimRaw === "landingpage"
          ? "landingPage"
          : "auto";
    if (minSessions < 0) return invalid("minSessions must be >= 0");
    if (minTotalUsers < 0) return invalid("minTotalUsers must be >= 0");
    if (minPageViews < 0) return invalid("minPageViews must be >= 0");
    if (
      minMetricValue != null &&
      (!Number.isFinite(minMetricValue) || Number.isNaN(minMetricValue))
    ) {
      return invalid("minMetricValue must be a finite number when set");
    }
    if (limit < 0 || limit > 5000) {
      return invalid("limit must be between 0 and 5000 (0 = unlimited)");
    }

    return {
      ok: true,
      filters: {
        sortMetric,
        sortDirection: sortDirectionRaw,
        entityDim,
        minSessions,
        minTotalUsers,
        minPageViews,
        minMetricValue,
        limit,
      },
    };
  }

  // Unknown capability: merge defaults only.
  const filters = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (!(key in cleaned)) continue;
    const defVal = defaults[key];
    if (typeof defVal === "number") {
      filters[key] =
        Number.isInteger(defVal) && !String(defVal).includes(".")
          ? toPositiveInt(cleaned[key], defVal)
          : toFiniteNumber(cleaned[key], defVal);
    } else {
      filters[key] = cleaned[key];
    }
  }
  return { ok: true, filters };
};

/**
 * Extract per-capability filter bag from nodeData.
 *
 * Precedence (filter isolation):
 * A) No capabilitySettings → legacy flat fallback (pick this capability's keys).
 * B) capabilitySettings[id] is an object → use ONLY that nested bag.
 * C) capabilitySettings exists but [id] missing → {} (defaults via validate);
 *    do NOT read flat nodeData (prevents multi-cap shared-name leakage).
 */
const extractFiltersFromNodeData = (capabilityId, nodeData = {}) => {
  const id = String(capabilityId || "").trim();
  const data = nodeData && typeof nodeData === "object" ? nodeData : {};
  const hasSettingsBag =
    Object.prototype.hasOwnProperty.call(data, "capabilitySettings") &&
    data.capabilitySettings != null &&
    typeof data.capabilitySettings === "object" &&
    !Array.isArray(data.capabilitySettings);

  // CASE A — legacy flat configuration
  if (!hasSettingsBag) {
    return pickCapabilityFilterKeys(id, data);
  }

  const settings = data.capabilitySettings[id];
  // CASE B — nested bag for this capability
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    return pickCapabilityFilterKeys(id, settings);
  }

  // CASE C — settings bag present but this capability has no entry
  return {};
};

module.exports = {
  FILTER_DEFAULTS,
  FILTER_KEYS_BY_CAPABILITY,
  isMissingFilterValue,
  cleanFilterBag,
  toFiniteNumber,
  toPositiveInt,
  clamp,
  normalizeRateFilter,
  validateCapabilityFilters,
  extractFiltersFromNodeData,
  pickCapabilityFilterKeys,
};
