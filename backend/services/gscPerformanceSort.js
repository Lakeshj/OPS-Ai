/**
 * Canonical GSC Search Analytics row ordering.
 *
 * Hierarchical / priority sort — not a weighted score:
 *   1. ctr DESC
 *   2. impressions DESC
 *   3. clicks DESC
 *   4. position ASC (lower is better)
 *   5. dimension text ASC (query / page / country / device / searchAppearance)
 *
 * Date/time-series rows stay chronological (date ASC).
 * Call after normalize, before Top N / WorkflowItems.
 */

const PERFORMANCE_DIMENSIONS = Object.freeze([
  "query",
  "page",
  "country",
  "device",
  "searchAppearance",
]);

const DATE_DIMENSION = "date";

const METRIC_KEYS = Object.freeze(["ctr", "impressions", "clicks", "position"]);

const rowPayload = (row) => {
  if (row && typeof row === "object" && !Array.isArray(row) && row.json && typeof row.json === "object") {
    return row.json;
  }
  return row && typeof row === "object" && !Array.isArray(row) ? row : null;
};

const toSortNumber = (value) => {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
};

const compareNumericDesc = (left, right) => {
  const a = toSortNumber(left);
  const b = toSortNumber(right);
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (a > b) return -1;
  if (a < b) return 1;
  return 0;
};

const compareNumericAsc = (left, right) => {
  const a = toSortNumber(left);
  const b = toSortNumber(right);
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
};

const compareTextAsc = (left, right) => {
  const a = left == null ? "" : String(left);
  const b = right == null ? "" : String(right);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
};

const resolveGscDimensionKey = (rows = [], override) => {
  if (override && String(override).trim()) return String(override).trim();
  const sample = (Array.isArray(rows) ? rows : []).map(rowPayload).find(Boolean) || {};
  for (const key of PERFORMANCE_DIMENSIONS) {
    if (sample[key] != null && String(sample[key]).trim() !== "") return key;
  }
  if (sample[DATE_DIMENSION] != null && String(sample[DATE_DIMENSION]).trim() !== "") {
    return DATE_DIMENSION;
  }
  return "query";
};

const looksLikeGscPerformanceRow = (row) => {
  const payload = rowPayload(row);
  if (!payload) return false;
  if (payload.opportunity_type != null || payload.capability != null) return false;
  const hasMetric = METRIC_KEYS.some((key) => Object.prototype.hasOwnProperty.call(payload, key));
  if (!hasMetric) return false;
  return [...PERFORMANCE_DIMENSIONS, DATE_DIMENSION].some(
    (key) => payload[key] != null && String(payload[key]).trim() !== ""
  );
};

const looksLikeGscPerformanceRows = (rows) =>
  Array.isArray(rows) && rows.length > 0 && rows.every(looksLikeGscPerformanceRow);

const compareGscPerformanceRows = (leftRow, rightRow, dimensionKey = "query") => {
  const left = rowPayload(leftRow) || {};
  const right = rowPayload(rightRow) || {};
  if (dimensionKey === DATE_DIMENSION) {
    return compareTextAsc(left.date, right.date);
  }
  const ctr = compareNumericDesc(left.ctr, right.ctr);
  if (ctr) return ctr;
  const impressions = compareNumericDesc(left.impressions, right.impressions);
  if (impressions) return impressions;
  const clicks = compareNumericDesc(left.clicks, right.clicks);
  if (clicks) return clicks;
  const position = compareNumericAsc(left.position, right.position);
  if (position) return position;
  return compareTextAsc(left[dimensionKey], right[dimensionKey]);
};

/**
 * Sort a copy of rows. Does not mutate metric values on the original objects.
 * Optional limit is applied AFTER sorting.
 */
const sortGscPerformanceRows = (rows, options = {}) => {
  if (!Array.isArray(rows)) return [];
  if (rows.length < 2) return rows.slice();
  const dimensionKey = resolveGscDimensionKey(rows, options.dimensionKey);
  const sorted = rows.slice().sort((a, b) => compareGscPerformanceRows(a, b, dimensionKey));
  const limit = Number(options.limit);
  if (Number.isFinite(limit) && limit > 0) {
    return sorted.slice(0, Math.floor(limit));
  }
  return sorted;
};

const shouldSortGscMcpResult = (result, rows) => {
  const tool = String(result?.toolId || "");
  if (
    tool === "inspect_url_enhanced" ||
    tool === "inspect_url" ||
    tool === "list_properties" ||
    tool === "list_sites" ||
    tool === "get_capabilities" ||
    tool === "get_performance_overview" ||
    tool === "get_performance_summary" ||
    tool === "compare_search_periods" ||
    tool === "compare_periods"
  ) {
    return false;
  }
  if (tool === "get_search_analytics") return looksLikeGscPerformanceRows(rows);
  if (!tool) return looksLikeGscPerformanceRows(rows);
  return false;
};

module.exports = {
  PERFORMANCE_DIMENSIONS,
  DATE_DIMENSION,
  toSortNumber,
  compareGscPerformanceRows,
  resolveGscDimensionKey,
  looksLikeGscPerformanceRow,
  looksLikeGscPerformanceRows,
  sortGscPerformanceRows,
  shouldSortGscMcpResult,
};
