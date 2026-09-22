/**
 * Page performance — STEP 7 DATA implementation.
 *
 * Ranks upstream GA4 page/landing rows for Filter → Sort → AI → Sheets/Gmail.
 * Not an opportunity generator: no score, recommendation, or opportunity reason.
 *
 * - Prefer pagePath; else landingPage
 * - Metrics: only fields present on each upstream row
 * - Never aggregate across eventName (row-level ranking when eventName present)
 * - Never invent pages or substitute metrics
 */

const { ERROR, buildWarning } = require("../errors");
const {
  FILTER_DEFAULTS,
  validateCapabilityFilters,
} = require("../contracts/filters");
const { inventoryKeys } = require("../contracts/inputValidation");
const { round } = require("../contracts/output");

const CAPABILITY_ID = "page_performance";
const ROW_KIND = "ranked_page";

const PAGE_DIMS = Object.freeze(["pagePath", "landingPage"]);

const RANKING_METRICS = Object.freeze([
  "sessions",
  "totalUsers",
  "screenPageViews",
  "engagementRate",
  "bounceRate",
  "averageSessionDuration",
  "userEngagementDuration",
  "screenPageViewsPerSession",
]);

const OUTPUT_METRIC_KEYS = Object.freeze([...RANKING_METRICS]);

const SECONDARY_TRAFFIC_METRICS = Object.freeze([
  "sessions",
  "totalUsers",
  "screenPageViews",
]);

const hasOwn = (obj, key) =>
  obj != null &&
  typeof obj === "object" &&
  Object.prototype.hasOwnProperty.call(obj, key) &&
  obj[key] != null &&
  obj[key] !== "";

const readFinite = (row, key) => {
  if (!hasOwn(row, key)) return null;
  const n = Number(row[key]);
  return Number.isFinite(n) ? n : null;
};

/**
 * Prefer pagePath; else landingPage. entityDim can force.
 * Never invent. Never use eventName / channels as entity.
 */
const resolveEntity = (row, entityDim = "auto") => {
  const pagePath = hasOwn(row, "pagePath")
    ? String(row.pagePath).trim()
    : "";
  const landingPage = hasOwn(row, "landingPage")
    ? String(row.landingPage).trim()
    : "";

  const prefer =
    entityDim === "pagePath"
      ? "pagePath"
      : entityDim === "landingPage"
        ? "landingPage"
        : "auto";

  if (prefer === "pagePath") {
    if (!pagePath) return null;
    return {
      pagePath,
      ...(landingPage ? { landingPage } : {}),
      label: pagePath,
    };
  }
  if (prefer === "landingPage") {
    if (!landingPage) return null;
    return {
      landingPage,
      ...(pagePath ? { pagePath } : {}),
      label: landingPage,
    };
  }

  if (pagePath) {
    return {
      pagePath,
      ...(landingPage ? { landingPage } : {}),
      label: pagePath,
    };
  }
  if (landingPage) {
    return {
      landingPage,
      label: landingPage,
    };
  }
  return null;
};

const pickPresentMetrics = (row) => {
  const metrics = {};
  for (const key of OUTPUT_METRIC_KEYS) {
    const n = readFinite(row, key);
    if (n == null) continue;
    // Rates: keep numeric fidelity; normalize percent-looking values for consistency
    if (
      (key === "engagementRate" || key === "bounceRate") &&
      n > 1 &&
      n <= 100
    ) {
      metrics[key] = round(n / 100, 4);
    } else if (key === "engagementRate" || key === "bounceRate") {
      metrics[key] = round(n, 4);
    } else {
      metrics[key] = n;
    }
  }
  return metrics;
};

const metricPresentInPull = (rows, metric) => {
  for (const row of rows) {
    if (readFinite(row, metric) != null) return true;
  }
  return false;
};

const secondaryTrafficValue = (metrics) => {
  for (const key of SECONDARY_TRAFFIC_METRICS) {
    if (metrics[key] != null && Number.isFinite(Number(metrics[key]))) {
      return Number(metrics[key]);
    }
  }
  return 0;
};

const compareRanked = (a, b, sortMetric, sortDirection) => {
  const dir = sortDirection === "asc" ? 1 : -1;
  const av = Number(a.metrics?.[sortMetric]);
  const bv = Number(b.metrics?.[sortMetric]);
  const aOk = Number.isFinite(av);
  const bOk = Number.isFinite(bv);
  if (aOk && bOk && av !== bv) return (av - bv) * dir;
  if (aOk && !bOk) return -1;
  if (!aOk && bOk) return 1;

  const aSec = secondaryTrafficValue(a.metrics);
  const bSec = secondaryTrafficValue(b.metrics);
  if (aSec !== bSec) return bSec - aSec; // secondary always desc (more traffic first)

  return String(a.entity?.label || "").localeCompare(
    String(b.entity?.label || "")
  );
};

const passesMinFilters = (metrics, filters) => {
  if (
    filters.minSessions > 0 &&
    (metrics.sessions == null || metrics.sessions < filters.minSessions)
  ) {
    return false;
  }
  if (
    filters.minTotalUsers > 0 &&
    (metrics.totalUsers == null || metrics.totalUsers < filters.minTotalUsers)
  ) {
    return false;
  }
  if (
    filters.minPageViews > 0 &&
    (metrics.screenPageViews == null ||
      metrics.screenPageViews < filters.minPageViews)
  ) {
    return false;
  }
  if (
    filters.minMetricValue != null &&
    Number.isFinite(Number(filters.minMetricValue))
  ) {
    const v = metrics[filters.sortMetric];
    if (v == null || Number(v) < Number(filters.minMetricValue)) {
      return false;
    }
  }
  return true;
};

const collectKeys = (rows, inventory) => {
  const inv =
    inventory && typeof inventory === "object"
      ? inventory
      : inventoryKeys(rows);
  const dims = new Set(inv.availableDimensions || []);
  const metrics = new Set(inv.availableMetrics || []);
  const all = new Set(inv.allKeys || []);

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    for (const k of Object.keys(row)) {
      all.add(k);
      if (PAGE_DIMS.includes(k) || k === "eventName") dims.add(k);
      if (RANKING_METRICS.includes(k)) metrics.add(k);
    }
  }
  return {
    availableDimensions: [...dims].sort(),
    availableMetrics: [...metrics].sort(),
    allKeys: [...all].sort(),
  };
};

const pagePerformance = (input = {}) => {
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const filterInput =
    input.filters && typeof input.filters === "object" ? input.filters : {};

  const validated = validateCapabilityFilters(CAPABILITY_ID, filterInput);
  if (!validated.ok) {
    const err = new Error(validated.error?.message || "Invalid filters");
    err.code = validated.error?.code || ERROR.GA4_VALIDATION;
    throw err;
  }
  const filters = validated.filters;
  const warnings = [];
  const keys = collectKeys(rows, input.inventory);

  const hasPageDim =
    keys.availableDimensions.includes("pagePath") ||
    keys.availableDimensions.includes("landingPage") ||
    rows.some(
      (r) =>
        (hasOwn(r, "pagePath") && String(r.pagePath).trim()) ||
        (hasOwn(r, "landingPage") && String(r.landingPage).trim())
    );

  if (!hasPageDim) {
    warnings.push(
      buildWarning({
        code: ERROR.GA4_DIMS_MISSING,
        capability: CAPABILITY_ID,
        message:
          "page_performance requires pagePath or landingPage. Neither is present in upstream rows.",
        requiredDimensions: [...PAGE_DIMS],
        availableDimensions: keys.availableDimensions,
        availableMetrics: keys.availableMetrics,
      })
    );
    return emptyResult(rows, filters, warnings);
  }

  const hasAnyMetric = RANKING_METRICS.some((m) => metricPresentInPull(rows, m));
  if (!hasAnyMetric) {
    warnings.push(
      buildWarning({
        code: ERROR.GA4_METRICS_MISSING,
        capability: CAPABILITY_ID,
        message:
          "page_performance requires at least one supported page metric. None are present in upstream rows.",
        requiredMetrics: [...RANKING_METRICS],
        availableMetrics: keys.availableMetrics,
        availableDimensions: keys.availableDimensions,
      })
    );
    return emptyResult(rows, filters, warnings);
  }

  const sortMetric = filters.sortMetric;
  if (!RANKING_METRICS.includes(sortMetric)) {
    warnings.push(
      buildWarning({
        code: ERROR.GA4_VALIDATION,
        capability: CAPABILITY_ID,
        message: `Unsupported ranking metric: ${sortMetric}`,
        requestedMetric: sortMetric,
        availableMetrics: keys.availableMetrics,
      })
    );
    return emptyResult(rows, filters, warnings);
  }

  if (!metricPresentInPull(rows, sortMetric)) {
    warnings.push(
      buildWarning({
        code: ERROR.GA4_METRIC_UNAVAILABLE,
        capability: CAPABILITY_ID,
        message: `Requested ranking metric "${sortMetric}" is not present in upstream rows.`,
        requestedMetric: sortMetric,
        availableMetrics: keys.availableMetrics,
        availableDimensions: keys.availableDimensions,
      })
    );
    return emptyResult(rows, filters, warnings);
  }

  const hasEventName =
    keys.allKeys.includes("eventName") ||
    keys.availableDimensions.includes("eventName") ||
    rows.some((r) => hasOwn(r, "eventName"));

  if (hasEventName) {
    warnings.push(
      buildWarning({
        code: ERROR.GA4_EVENT_CROSS_METRIC_RISK,
        capability: CAPABILITY_ID,
        message:
          "eventName is present. page_performance ranks row-level page×event rows without summing sessions/users/page views across events.",
        availableDimensions: keys.availableDimensions,
        availableMetrics: keys.availableMetrics,
      })
    );
  }

  // Row-level only — never aggregate by page across eventName or mixed grains
  const ranked = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const entity = resolveEntity(row, filters.entityDim);
    if (!entity) continue;
    const metrics = pickPresentMetrics(row);
    if (Object.keys(metrics).length === 0) continue;
    if (metrics[sortMetric] == null) continue;
    if (!passesMinFilters(metrics, filters)) continue;

    ranked.push({
      capability: CAPABILITY_ID,
      row_kind: ROW_KIND,
      opportunity_type: null,
      entity,
      metrics,
      sortMetric,
      sortDirection: filters.sortDirection,
    });
  }

  ranked.sort((a, b) =>
    compareRanked(a, b, sortMetric, filters.sortDirection)
  );

  const limit = filters.limit;
  const limited = limit === 0 ? ranked : ranked.slice(0, limit);

  limited.forEach((item, index) => {
    item.rank = index + 1;
  });

  if (limited.length === 0) {
    warnings.push(
      buildWarning({
        code: ERROR.GA4_NO_MATCHES,
        capability: CAPABILITY_ID,
        message:
          "No page performance rows matched the configured filters / ranking metric.",
        filters: { ...filters },
      })
    );
  }

  return {
    kind: CAPABILITY_ID,
    category: "data",
    row_kind: ROW_KIND,
    rows: limited,
    opportunities: [],
    count: limited.length,
    scaffold: false,
    implemented: true,
    itemsIn: rows.length,
    filters: { ...filters },
    warnings,
    filterDefaults: { ...FILTER_DEFAULTS.page_performance },
  };
};

const emptyResult = (rows, filters, warnings) => ({
  kind: CAPABILITY_ID,
  category: "data",
  row_kind: ROW_KIND,
  rows: [],
  opportunities: [],
  count: 0,
  scaffold: false,
  implemented: true,
  itemsIn: rows.length,
  filters: { ...filters },
  warnings,
});

module.exports = {
  pagePerformance,
  CAPABILITY_ID,
  ROW_KIND,
  RANKING_METRICS,
  PAGE_DIMS,
  resolveEntity,
  compareRanked,
  pickPresentMetrics,
};
