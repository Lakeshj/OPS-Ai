/**
 * Acquisition concentration — STEP 6 implementation.
 *
 * Flags acquisition channels/sources that account for a large share of traffic
 * within a SINGLE GA4 acquisition dimension. Never infers channels from
 * pagePath / pageTitle / landingPage / eventName.
 *
 * Concentration threshold (default): channel share >= minShare (0.35 = 35%).
 * Top volume alone is NOT enough — share must meet the threshold.
 *
 * Score:
 *   share = channelTraffic / totalTraffic  (prefer sessions, else totalUsers)
 *   score = clamp(round(share * 100, 2), 0, 100)
 *
 * Aggregation: only rows sharing the selected acquisition dimension.
 * Never mix sessionDefaultChannelGroup with sessionSourceMedium (etc.).
 * Never sum sessions/users across different eventName rows — if eventName is
 * present in the pull, refuse (GA4_EVENT_CROSS_METRIC_RISK).
 */

const { ERROR, buildWarning } = require("../errors");
const {
  FILTER_DEFAULTS,
  validateCapabilityFilters,
} = require("../contracts/filters");
const { inventoryKeys } = require("../contracts/inputValidation");
const { round } = require("../contracts/output");

const CAPABILITY_ID = "acquisition_concentration";
const OPPORTUNITY_TYPE = "acquisition_concentration";

/** Priority order for selecting a single acquisition dimension scope. */
const ACQUISITION_DIMS = Object.freeze([
  "sessionDefaultChannelGroup",
  "sessionSourceMedium",
  "sessionSource",
  "sessionMedium",
  "firstUserDefaultChannelGroup",
]);

const FORBIDDEN_AS_ACQUISITION = Object.freeze([
  "pagePath",
  "pageTitle",
  "landingPage",
  "pageLocation",
  "eventName",
  "hostName",
]);

const SCORE_FORMULA =
  "(channelTraffic / totalTraffic) * 100  // prefer sessions; else totalUsers";

/** Default concentration threshold: channel must be >= 35% of total traffic. */
const DEFAULT_CONCENTRATION_SHARE = 0.35;

const hasOwn = (obj, key) =>
  obj != null &&
  typeof obj === "object" &&
  Object.prototype.hasOwnProperty.call(obj, key) &&
  obj[key] != null &&
  obj[key] !== "";

const readNonNeg = (row, key) => {
  if (!hasOwn(row, key)) return null;
  const n = Number(row[key]);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
};

const collectAvailableKeys = (rows, inventory) => {
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
      if (ACQUISITION_DIMS.includes(k) || FORBIDDEN_AS_ACQUISITION.includes(k)) {
        dims.add(k);
      }
      if (k === "sessions" || k === "totalUsers" || k === "newUsers") {
        metrics.add(k);
      }
    }
  }

  return {
    availableDimensions: [...dims].sort(),
    availableMetrics: [...metrics].sort(),
    allKeys: [...all].sort(),
  };
};

/**
 * Choose one acquisition dimension by priority among dims present with data.
 */
const selectAcquisitionDimension = (rows) => {
  const present = new Set();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    for (const dim of ACQUISITION_DIMS) {
      if (hasOwn(row, dim) && String(row[dim]).trim()) {
        present.add(dim);
      }
    }
  }
  for (const dim of ACQUISITION_DIMS) {
    if (present.has(dim)) {
      return { selectedDim: dim, presentDims: [...present] };
    }
  }
  return { selectedDim: null, presentDims: [] };
};

/**
 * Aggregate traffic by channel value for ONE dimension only.
 * Prefer sessions; fall back to totalUsers when sessions absent on a row.
 */
const aggregateByDimension = (rows, selectedDim) => {
  const byChannel = new Map();
  let rowsUsed = 0;
  let rowsSkippedOtherDimOnly = 0;

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;

    if (!hasOwn(row, selectedDim) || !String(row[selectedDim]).trim()) {
      // Row may have a different acquisition dim — do not fold into this scope
      const hasOther = ACQUISITION_DIMS.some(
        (d) => d !== selectedDim && hasOwn(row, d) && String(row[d]).trim()
      );
      if (hasOther) rowsSkippedOtherDimOnly += 1;
      continue;
    }

    const channelValue = String(row[selectedDim]).trim();
    const sessions = readNonNeg(row, "sessions");
    const totalUsers = readNonNeg(row, "totalUsers");
    if (sessions == null && totalUsers == null) continue;

    rowsUsed += 1;
    const prev = byChannel.get(channelValue) || {
      sessions: 0,
      totalUsers: 0,
      hasSessions: false,
      hasUsers: false,
    };
    if (sessions != null) {
      prev.sessions += sessions;
      prev.hasSessions = true;
    }
    if (totalUsers != null) {
      prev.totalUsers += totalUsers;
      prev.hasUsers = true;
    }
    byChannel.set(channelValue, prev);
  }

  return { byChannel, rowsUsed, rowsSkippedOtherDimOnly };
};

const totalsFromAggregate = (byChannel) => {
  let totalSessions = 0;
  let totalUsers = 0;
  let anySessions = false;
  let anyUsers = false;
  for (const agg of byChannel.values()) {
    if (agg.hasSessions) {
      totalSessions += agg.sessions;
      anySessions = true;
    }
    if (agg.hasUsers) {
      totalUsers += agg.totalUsers;
      anyUsers = true;
    }
  }
  const preferSessions = anySessions && totalSessions > 0;
  return {
    totalSessions: anySessions ? totalSessions : null,
    totalUsers: anyUsers ? totalUsers : null,
    preferSessions,
    trafficMetric: preferSessions ? "sessions" : "totalUsers",
    totalTraffic: preferSessions ? totalSessions : totalUsers,
  };
};

const formatInt = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
const formatPct = (share) => `${round(Number(share) * 100, 2)}%`;

const buildReason = ({
  label,
  share,
  channelTraffic,
  totalTraffic,
  trafficMetric,
}) =>
  `${label} accounts for ${formatPct(share)} of ${trafficMetric} (${formatInt(
    channelTraffic
  )} of ${formatInt(totalTraffic)}).`;

const buildRecommendation = ({ label, share, trafficMetric }) =>
  `Review acquisition mix because ${label} accounts for ${formatPct(
    share
  )} of ${trafficMetric}.`;

const scoreConcentration = ({ share, channelTraffic, totalTraffic, trafficMetric }) => {
  const score = Math.min(100, Math.max(0, round(share * 100, 2)));
  return {
    score,
    score_breakdown: {
      formula: SCORE_FORMULA,
      concentration_threshold_note:
        "Opportunity only when share >= minShare (default 0.35)",
      inputs: {
        share: round(share, 6),
        channelTraffic,
        totalTraffic,
        trafficMetric,
      },
    },
  };
};

const compareOpportunities = (a, b) => {
  if (b.score !== a.score) return b.score - a.score;
  const aVol =
    Number(a.metrics?.sessions ?? a.metrics?.totalUsers) || 0;
  const bVol =
    Number(b.metrics?.sessions ?? b.metrics?.totalUsers) || 0;
  if (bVol !== aVol) return bVol - aVol;
  return String(a.entity?.label || "").localeCompare(
    String(b.entity?.label || "")
  );
};

const acquisitionConcentration = (input = {}) => {
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
  // minShare is the concentration threshold
  const concentrationThreshold = filters.minShare;

  const keys = collectAvailableKeys(rows, input.inventory);
  const warnings = [];

  // Refuse if eventName present — do not sum users/sessions across events
  if (keys.allKeys.includes("eventName") || keys.availableDimensions.includes("eventName")) {
    warnings.push(
      buildWarning({
        code: ERROR.GA4_EVENT_CROSS_METRIC_RISK,
        capability: CAPABILITY_ID,
        message:
          "acquisition_concentration refuses pulls that include eventName to avoid summing sessions/users across different events. Use a GA4 pull with an acquisition dimension and sessions/totalUsers only (no eventName).",
        requiredDimensions: [...ACQUISITION_DIMS],
        availableDimensions: keys.availableDimensions,
        availableMetrics: keys.availableMetrics,
      })
    );
    return {
      kind: CAPABILITY_ID,
      category: "intelligence",
      opportunities: [],
      count: 0,
      scaffold: false,
      implemented: true,
      itemsIn: rows.length,
      filters: { ...filters },
      warnings,
    };
  }

  const { selectedDim, presentDims } = selectAcquisitionDimension(rows);

  if (!selectedDim) {
    warnings.push(
      buildWarning({
        code: ERROR.GA4_ACQUISITION_DIM_MISSING,
        capability: CAPABILITY_ID,
        message:
          "Acquisition concentration needs a channel/source dimension. Required one of: sessionDefaultChannelGroup, sessionSourceMedium, sessionSource, sessionMedium, firstUserDefaultChannelGroup. pagePath, pageTitle, landingPage, and eventName are not acquisition dimensions.",
        requiredDimensions: [...ACQUISITION_DIMS],
        availableDimensions: keys.availableDimensions,
        availableMetrics: keys.availableMetrics,
        forbiddenAsAcquisition: [...FORBIDDEN_AS_ACQUISITION],
      })
    );
    return {
      kind: CAPABILITY_ID,
      category: "intelligence",
      opportunities: [],
      count: 0,
      scaffold: false,
      implemented: true,
      itemsIn: rows.length,
      filters: { ...filters },
      warnings,
    };
  }

  const hasSessions = keys.availableMetrics.includes("sessions");
  const hasUsers = keys.availableMetrics.includes("totalUsers");
  if (!hasSessions && !hasUsers) {
    // Also scan rows directly
    let found = false;
    for (const row of rows) {
      if (readNonNeg(row, "sessions") != null || readNonNeg(row, "totalUsers") != null) {
        found = true;
        break;
      }
    }
    if (!found) {
      warnings.push(
        buildWarning({
          code: ERROR.GA4_METRICS_MISSING,
          capability: CAPABILITY_ID,
          message:
            "acquisition_concentration requires sessions or totalUsers. Neither is present in upstream rows.",
          requiredMetrics: ["sessions", "totalUsers"],
          availableMetrics: keys.availableMetrics,
          availableDimensions: keys.availableDimensions,
        })
      );
      return {
        kind: CAPABILITY_ID,
        category: "intelligence",
        opportunities: [],
        count: 0,
        scaffold: false,
        implemented: true,
        itemsIn: rows.length,
        filters: { ...filters },
        warnings,
      };
    }
  }

  if (presentDims.length > 1) {
    warnings.push(
      buildWarning({
        code: ERROR.GA4_VALIDATION,
        capability: CAPABILITY_ID,
        message: `Multiple acquisition dimensions present (${presentDims.join(
          ", "
        )}). Calculation is scoped only to ${selectedDim}; incompatible dimensions were not combined.`,
        selectedDimension: selectedDim,
        presentAcquisitionDimensions: presentDims,
        availableDimensions: keys.availableDimensions,
      })
    );
  }

  const { byChannel, rowsUsed, rowsSkippedOtherDimOnly } = aggregateByDimension(
    rows,
    selectedDim
  );

  if (rowsSkippedOtherDimOnly > 0) {
    warnings.push(
      buildWarning({
        code: ERROR.GA4_VALIDATION,
        capability: CAPABILITY_ID,
        message: `${rowsSkippedOtherDimOnly} row(s) used a different acquisition dimension and were excluded from the ${selectedDim} concentration calculation.`,
        selectedDimension: selectedDim,
      })
    );
  }

  if (rowsUsed === 0 || byChannel.size === 0) {
    warnings.push(
      buildWarning({
        code: ERROR.GA4_NO_MATCHES,
        capability: CAPABILITY_ID,
        message: `No usable ${selectedDim} rows with sessions/totalUsers were found.`,
        selectedDimension: selectedDim,
      })
    );
    return {
      kind: CAPABILITY_ID,
      category: "intelligence",
      opportunities: [],
      count: 0,
      scaffold: false,
      implemented: true,
      itemsIn: rows.length,
      filters: { ...filters },
      selectedDimension: selectedDim,
      warnings,
    };
  }

  const totals = totalsFromAggregate(byChannel);
  if (!totals.totalTraffic || totals.totalTraffic <= 0) {
    warnings.push(
      buildWarning({
        code: ERROR.GA4_METRICS_MISSING,
        capability: CAPABILITY_ID,
        message: "Total traffic for the selected acquisition dimension is zero.",
        selectedDimension: selectedDim,
        availableMetrics: keys.availableMetrics,
      })
    );
    return {
      kind: CAPABILITY_ID,
      category: "intelligence",
      opportunities: [],
      count: 0,
      scaffold: false,
      implemented: true,
      itemsIn: rows.length,
      filters: { ...filters },
      selectedDimension: selectedDim,
      warnings,
    };
  }

  const opportunities = [];

  for (const [channelValue, agg] of byChannel.entries()) {
    const channelTraffic = totals.preferSessions
      ? agg.hasSessions
        ? agg.sessions
        : 0
      : agg.hasUsers
        ? agg.totalUsers
        : 0;

    if (channelTraffic <= 0) continue;
    if (channelTraffic < filters.minVolume) continue;

    const share = channelTraffic / totals.totalTraffic;

    // Concentration condition: share must meet threshold (not merely "largest")
    if (share < concentrationThreshold) continue;

    const { score, score_breakdown } = scoreConcentration({
      share,
      channelTraffic,
      totalTraffic: totals.totalTraffic,
      trafficMetric: totals.trafficMetric,
    });

    if (score < filters.minScore) continue;

    const metrics = {};
    if (agg.hasSessions) metrics.sessions = agg.sessions;
    if (agg.hasUsers) metrics.totalUsers = agg.totalUsers;
    if (totals.preferSessions) {
      metrics.shareOfSessions = round(share, 6);
    } else {
      metrics.shareOfUsers = round(share, 6);
    }
    metrics.share = round(share, 6);

    const entity = {
      [selectedDim]: channelValue,
      label: channelValue,
    };

    opportunities.push({
      capability: CAPABILITY_ID,
      opportunity_type: OPPORTUNITY_TYPE,
      entity,
      metrics,
      reason: buildReason({
        label: channelValue,
        share,
        channelTraffic,
        totalTraffic: totals.totalTraffic,
        trafficMetric: totals.trafficMetric,
      }),
      recommendation: buildRecommendation({
        label: channelValue,
        share,
        trafficMetric: totals.trafficMetric,
      }),
      score,
      score_breakdown,
    });
  }

  opportunities.sort(compareOpportunities);
  const limit = filters.limit;
  const limited =
    limit === 0 ? opportunities : opportunities.slice(0, limit);

  if (limited.length === 0) {
    warnings.push(
      buildWarning({
        code: ERROR.GA4_NO_MATCHES,
        capability: CAPABILITY_ID,
        message: `No acquisition concentration opportunities met the threshold (share >= ${concentrationThreshold}, volume >= ${filters.minVolume}) for ${selectedDim}.`,
        selectedDimension: selectedDim,
        filters: { ...filters },
        concentrationThreshold,
      })
    );
  }

  return {
    kind: CAPABILITY_ID,
    category: "intelligence",
    opportunities: limited,
    count: limited.length,
    scaffold: false,
    implemented: true,
    itemsIn: rows.length,
    filters: { ...filters },
    selectedDimension: selectedDim,
    concentrationThreshold,
    warnings,
    scoreFormula: SCORE_FORMULA,
    filterDefaults: { ...FILTER_DEFAULTS.acquisition_concentration },
  };
};

module.exports = {
  acquisitionConcentration,
  CAPABILITY_ID,
  OPPORTUNITY_TYPE,
  SCORE_FORMULA,
  ACQUISITION_DIMS,
  FORBIDDEN_AS_ACQUISITION,
  DEFAULT_CONCENTRATION_SHARE,
  selectAcquisitionDimension,
  aggregateByDimension,
  scoreConcentration,
  compareOpportunities,
};
