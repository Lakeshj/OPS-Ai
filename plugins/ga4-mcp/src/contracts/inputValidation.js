/**
 * Upstream input validation contract for GA4 MCP Tools.
 *
 * Prepares structured errors/warnings for:
 * - missing / empty upstream rows
 * - malformed rows
 * - unavailable dimensions / metrics (keys inventory only for Step 3)
 *
 * Does NOT implement capability-specific missing-dimension intelligence yet.
 */

const { ERROR, buildWarning } = require("../errors");

/** Known GA4 dimension keys relevant to V1 capabilities. */
const KNOWN_DIMENSION_KEYS = Object.freeze([
  "pagePath",
  "landingPage",
  "pageTitle",
  "hostName",
  "pageLocation",
  "deviceCategory",
  "country",
  "date",
  "eventName",
  "sessionDefaultChannelGroup",
  "sessionSource",
  "sessionMedium",
  "sessionSourceMedium",
  "firstUserDefaultChannelGroup",
  "sessionCampaignName",
  "firstUserSource",
  "firstUserMedium",
]);

/** Known GA4 metric keys relevant to V1 capabilities. */
const KNOWN_METRIC_KEYS = Object.freeze([
  "sessions",
  "totalUsers",
  "newUsers",
  "engagementRate",
  "bounceRate",
  "screenPageViews",
  "screenPageViewsPerSession",
  "userEngagementDuration",
  "engagedSessions",
  "averageSessionDuration",
]);

const itemPayload = (item) => {
  if (item == null) return null;
  if (typeof item !== "object" || Array.isArray(item)) return item;
  if ("json" in item) {
    const payload = item.json;
    if (
      payload &&
      typeof payload === "object" &&
      !Array.isArray(payload)
    ) {
      return payload;
    }
    // Explicit non-object json (string/array/primitive) is malformed
    return null;
  }
  const { pairedItem, binary, json, ...rest } = item;
  if (Object.keys(rest).length > 0) return rest;
  return item;
};

const rowsFromInputItems = (inputItems = []) => {
  const raw = Array.isArray(inputItems) ? inputItems : [];
  const rows = [];
  const malformed = [];
  raw.forEach((item, index) => {
    const payload = itemPayload(item);
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      rows.push(payload);
    } else {
      malformed.push({ index, reason: "row is not a plain object" });
    }
  });
  return { rows, malformed, inputCount: raw.length };
};

const cloneUpstreamRows = (rows = []) =>
  (Array.isArray(rows) ? rows : []).map((row) =>
    row && typeof row === "object" && !Array.isArray(row) ? { ...row } : row
  );

/**
 * Inventory keys present on upstream rows (union).
 */
const inventoryKeys = (rows = []) => {
  const keys = new Set();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    for (const k of Object.keys(row)) keys.add(k);
  }
  const all = [...keys].sort();
  const availableDimensions = all.filter((k) =>
    KNOWN_DIMENSION_KEYS.includes(k)
  );
  const availableMetrics = all.filter((k) => KNOWN_METRIC_KEYS.includes(k));
  return {
    allKeys: all,
    availableDimensions,
    availableMetrics,
  };
};

/**
 * Validate upstream for processor entry.
 * @returns {{
 *   ok: boolean,
 *   rows: object[],
 *   inventory: object,
 *   warnings: object[],
 *   error?: object
 * }}
 */
const validateUpstreamInput = (inputItems = []) => {
  const warnings = [];

  if (inputItems == null) {
    return {
      ok: false,
      rows: [],
      inventory: inventoryKeys([]),
      warnings,
      error: {
        code: ERROR.GA4_UPSTREAM_REQUIRED,
        message:
          "GA4 MCP Tools needs analytics rows from a previous googleAnalytics node. Connect googleAnalytics → GA4 MCP Tools.",
      },
    };
  }

  const { rows, malformed, inputCount } = rowsFromInputItems(inputItems);

  if (inputCount === 0 || rows.length === 0) {
    return {
      ok: false,
      rows: [],
      inventory: inventoryKeys([]),
      warnings,
      error: {
        code: ERROR.GA4_UPSTREAM_REQUIRED,
        message:
          "GA4 MCP Tools received no usable upstream rows. Connect googleAnalytics → GA4 MCP Tools and ensure the report returned items.",
      },
    };
  }

  if (malformed.length) {
    warnings.push(
      buildWarning({
        code: ERROR.GA4_MALFORMED_ROWS,
        message: `${malformed.length} upstream item(s) were not plain objects and were skipped.`,
        malformedCount: malformed.length,
        sample: malformed.slice(0, 3),
      })
    );
  }

  const inventory = inventoryKeys(rows);

  // Inventory-only stubs for Step 4 capability checks (do not refuse yet).
  if (
    inventory.availableDimensions.length === 0 &&
    inventory.availableMetrics.length === 0
  ) {
    warnings.push(
      buildWarning({
        code: ERROR.GA4_VALIDATION,
        message:
          "Upstream rows have no recognized GA4 dimension/metric keys. Capability evaluation (Step 4) may return dimension/metric warnings.",
        availableDimensions: inventory.availableDimensions,
        availableMetrics: inventory.availableMetrics,
        allKeys: inventory.allKeys.slice(0, 40),
      })
    );
  }

  return {
    ok: true,
    rows,
    inventory,
    warnings,
  };
};

/**
 * Placeholder helper for Step 4: build a missing-dimensions warning.
 * Not invoked by scaffold evaluation yet.
 */
const missingDimensionsWarning = ({
  capability,
  requiredDimensions = [],
  availableDimensions = [],
  code = ERROR.GA4_DIMS_MISSING,
  message,
} = {}) =>
  buildWarning({
    code,
    capability,
    message:
      message ||
      `Required dimension(s) missing for ${capability || "capability"}.`,
    requiredDimensions,
    availableDimensions,
  });

const missingMetricsWarning = ({
  capability,
  requiredMetrics = [],
  availableMetrics = [],
  code = ERROR.GA4_METRICS_MISSING,
  message,
} = {}) =>
  buildWarning({
    code,
    capability,
    message:
      message ||
      `Required metric(s) missing for ${capability || "capability"}.`,
    requiredMetrics,
    availableMetrics,
  });

module.exports = {
  KNOWN_DIMENSION_KEYS,
  KNOWN_METRIC_KEYS,
  itemPayload,
  rowsFromInputItems,
  cloneUpstreamRows,
  inventoryKeys,
  validateUpstreamInput,
  missingDimensionsWarning,
  missingMetricsWarning,
};
