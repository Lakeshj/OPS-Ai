/**
 * Landing underperformance — STEP 5 implementation.
 *
 * Identifies entry/landing URLs with meaningful sessions but weak visit payoff.
 * Distinct from engagement_opportunities (general page engagement quality):
 *   - prefers landingPage entity
 *   - higher traffic floor (default minSessions 150)
 *   - payoff signals include views/session + session duration
 *   - score uses sessions/1500 and landing-specific gap centroids
 *
 * Score (deterministic):
 *   volume    = min(1, sessions / 1500)
 *   payoffGap = max(
 *     ER present       ? max(0, 0.45 - engagementRate) : 0,
 *     bounce present   ? max(0, bounceRate - 0.55)     : 0,
 *     vps present      ? max(0, 1.5 - viewsPerSession) / 1.5 : 0,
 *     duration present ? max(0, 40 - averageSessionDuration) / 40 : 0
 *   )
 *   score     = clamp(round(volume * payoffGap * 100, 2), 0, 100)
 *
 * Rows are evaluated independently — never sum sessions/users across eventName.
 */

const { ERROR, buildWarning } = require("../errors");
const {
  FILTER_DEFAULTS,
  validateCapabilityFilters,
} = require("../contracts/filters");
const { inventoryKeys } = require("../contracts/inputValidation");
const { round } = require("../contracts/output");

const CAPABILITY_ID = "landing_underperformance";
const OPPORTUNITY_TYPE = "landing_underperformance";

const SCORE_FORMULA =
  "min(1, sessions/1500) * max(ER_gap, bounce_gap, viewsPerSession_gap, duration_gap) * 100";

const OPTIONAL_METRIC_KEYS = Object.freeze([
  "totalUsers",
  "screenPageViews",
  "userEngagementDuration",
  "engagedSessions",
  "averageSessionDuration",
  "screenPageViewsPerSession",
]);

const hasOwn = (obj, key) =>
  obj != null &&
  typeof obj === "object" &&
  Object.prototype.hasOwnProperty.call(obj, key) &&
  obj[key] != null &&
  obj[key] !== "";

const normalizeRate = (value) => {
  if (value == null || value === "") return null;
  let n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n > 1 && n <= 100) n = n / 100;
  if (n < 0) return null;
  if (n > 1) n = 1;
  return n;
};

const readSessions = (row) => {
  if (!hasOwn(row, "sessions")) return null;
  const n = Number(row.sessions);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
};

const readFinite = (row, key) => {
  if (!hasOwn(row, key)) return null;
  const n = Number(row[key]);
  return Number.isFinite(n) ? n : null;
};

/**
 * Prefer landingPage. Allow pagePath only as explicit proxy for page/landing pulls.
 * @returns {{ entity: object, usedProxy: boolean } | null}
 */
const resolveEntity = (row) => {
  const landingPage = hasOwn(row, "landingPage")
    ? String(row.landingPage).trim()
    : "";
  const pagePath = hasOwn(row, "pagePath")
    ? String(row.pagePath).trim()
    : "";
  const pageTitle = hasOwn(row, "pageTitle")
    ? String(row.pageTitle).trim()
    : "";

  if (landingPage) {
    return {
      usedProxy: false,
      entity: {
        landingPage,
        ...(pagePath ? { pagePath } : {}),
        ...(pageTitle ? { pageTitle } : {}),
        label: landingPage,
      },
    };
  }

  if (pagePath) {
    return {
      usedProxy: true,
      entity: {
        pagePath,
        ...(pageTitle ? { pageTitle } : {}),
        label: pagePath,
      },
    };
  }

  return null;
};

/**
 * Resolve views/session without inventing missing sources:
 * - use screenPageViewsPerSession if present
 * - else screenPageViews / sessions when both present
 */
const resolveViewsPerSession = (row, sessions) => {
  if (hasOwn(row, "screenPageViewsPerSession")) {
    const direct = Number(row.screenPageViewsPerSession);
    if (Number.isFinite(direct) && direct >= 0) return direct;
    return null;
  }
  if (hasOwn(row, "screenPageViews") && sessions != null && sessions > 0) {
    const views = Number(row.screenPageViews);
    if (!Number.isFinite(views) || views < 0) return null;
    return views / sessions;
  }
  return null;
};

const pickPresentMetrics = (
  row,
  sessions,
  engagementRate,
  bounceRate,
  viewsPerSession
) => {
  const metrics = { sessions };
  if (engagementRate != null) metrics.engagementRate = round(engagementRate, 4);
  if (bounceRate != null) metrics.bounceRate = round(bounceRate, 4);
  if (viewsPerSession != null) {
    metrics.viewsPerSession = round(viewsPerSession, 4);
  }
  for (const key of OPTIONAL_METRIC_KEYS) {
    if (!hasOwn(row, key)) continue;
    const n = Number(row[key]);
    if (!Number.isFinite(n)) continue;
    if (key === "screenPageViewsPerSession" && metrics.viewsPerSession != null) {
      // Keep both when native metric was the source; already stored as viewsPerSession
      metrics.screenPageViewsPerSession = round(n, 4);
      continue;
    }
    metrics[key] = n;
  }
  return metrics;
};

const formatSessions = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
const formatPct = (rate) => `${round(Number(rate) * 100, 2)}%`;

const buildReason = (
  label,
  sessions,
  engagementRate,
  bounceRate,
  viewsPerSession,
  averageSessionDuration
) => {
  const parts = [
    `Landing page ${label} received ${formatSessions(sessions)} sessions`,
  ];
  const signals = [];
  if (engagementRate != null) {
    signals.push(`an engagement rate of ${formatPct(engagementRate)}`);
  }
  if (bounceRate != null) {
    signals.push(`a bounce rate of ${formatPct(bounceRate)}`);
  }
  if (viewsPerSession != null) {
    signals.push(`${round(viewsPerSession, 2)} views per session`);
  }
  if (averageSessionDuration != null) {
    signals.push(
      `an average session duration of ${round(averageSessionDuration, 1)}s`
    );
  }
  if (signals.length === 1) {
    parts.push(`with ${signals[0]}`);
  } else if (signals.length === 2) {
    parts.push(`with ${signals[0]} and ${signals[1]}`);
  } else if (signals.length > 2) {
    const last = signals[signals.length - 1];
    parts.push(
      `with ${signals.slice(0, -1).join(", ")}, and ${last}`
    );
  }
  return `${parts.join(" ")}.`;
};

const buildRecommendation = (label) =>
  `Review the landing-page experience and engagement elements for ${label}.`;

const scoreLandingUnderperformance = ({
  sessions,
  engagementRate,
  bounceRate,
  viewsPerSession,
  averageSessionDuration,
}) => {
  const volume = Math.min(1, Number(sessions) / 1500);
  const erGap =
    engagementRate != null ? Math.max(0, 0.45 - engagementRate) : 0;
  const bounceGap =
    bounceRate != null ? Math.max(0, bounceRate - 0.55) : 0;
  const vpsGap =
    viewsPerSession != null
      ? Math.max(0, 1.5 - viewsPerSession) / 1.5
      : 0;
  const durationGap =
    averageSessionDuration != null
      ? Math.max(0, 40 - averageSessionDuration) / 40
      : 0;
  const payoffGap = Math.max(erGap, bounceGap, vpsGap, durationGap);
  const raw = volume * payoffGap * 100;
  const score = Math.min(100, Math.max(0, round(raw, 2)));
  return {
    score,
    score_breakdown: {
      formula: SCORE_FORMULA,
      volume: round(volume, 6),
      payoffGap: round(payoffGap, 6),
      payoffGap_definition:
        "max(ER gap vs 0.45, bounce gap vs 0.55, viewsPerSession gap vs 1.5, duration gap vs 40s)",
      inputs: {
        sessions,
        engagementRate:
          engagementRate != null ? round(engagementRate, 4) : null,
        bounceRate: bounceRate != null ? round(bounceRate, 4) : null,
        viewsPerSession:
          viewsPerSession != null ? round(viewsPerSession, 4) : null,
        averageSessionDuration:
          averageSessionDuration != null
            ? round(averageSessionDuration, 2)
            : null,
        erGap: round(erGap, 6),
        bounceGap: round(bounceGap, 6),
        vpsGap: round(vpsGap, 6),
        durationGap: round(durationGap, 6),
      },
    },
  };
};

const isLandingUnderperforming = (
  {
    engagementRate,
    bounceRate,
    viewsPerSession,
    averageSessionDuration,
  },
  filters
) => {
  const erWeak =
    engagementRate != null &&
    engagementRate <= filters.maxEngagementRate;
  const bounceWeak =
    bounceRate != null && bounceRate >= filters.minBounceRate;
  const vpsWeak =
    viewsPerSession != null &&
    viewsPerSession <= filters.maxViewsPerSession;
  const durationWeak =
    averageSessionDuration != null &&
    averageSessionDuration <= filters.maxAverageSessionDuration;
  return erWeak || bounceWeak || vpsWeak || durationWeak;
};

const hasAnyPerformanceSignal = ({
  engagementRate,
  bounceRate,
  viewsPerSession,
  averageSessionDuration,
}) =>
  engagementRate != null ||
  bounceRate != null ||
  viewsPerSession != null ||
  averageSessionDuration != null;

const compareOpportunities = (a, b) => {
  if (b.score !== a.score) return b.score - a.score;
  const aSessions = Number(a.metrics?.sessions) || 0;
  const bSessions = Number(b.metrics?.sessions) || 0;
  if (bSessions !== aSessions) return bSessions - aSessions;
  return String(a.entity?.label || "").localeCompare(
    String(b.entity?.label || "")
  );
};

const schemaWarnings = (rows, inventory) => {
  const warnings = [];
  const inv =
    inventory && typeof inventory === "object"
      ? inventory
      : inventoryKeys(rows);

  const dims = new Set(inv.availableDimensions || []);
  const metrics = new Set(inv.availableMetrics || []);

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    for (const k of Object.keys(row)) {
      if (k === "pagePath" || k === "landingPage") dims.add(k);
      if (
        [
          "sessions",
          "engagementRate",
          "bounceRate",
          "screenPageViews",
          "screenPageViewsPerSession",
          "averageSessionDuration",
        ].includes(k)
      ) {
        metrics.add(k);
      }
    }
  }

  const availableDimensions = [...dims].sort();
  const availableMetrics = [...metrics].sort();

  if (!dims.has("landingPage") && !dims.has("pagePath")) {
    warnings.push(
      buildWarning({
        code: ERROR.GA4_DIMS_MISSING,
        capability: CAPABILITY_ID,
        message:
          "landing_underperformance requires landingPage (preferred) or pagePath. Neither is present in upstream rows.",
        requiredDimensions: ["landingPage", "pagePath"],
        availableDimensions,
        availableMetrics,
      })
    );
  }

  if (!metrics.has("sessions")) {
    warnings.push(
      buildWarning({
        code: ERROR.GA4_METRICS_MISSING,
        capability: CAPABILITY_ID,
        message:
          "landing_underperformance requires sessions. sessions is not present in upstream rows.",
        requiredMetrics: ["sessions"],
        availableMetrics,
        availableDimensions,
      })
    );
  }

  const hasSignal =
    metrics.has("engagementRate") ||
    metrics.has("bounceRate") ||
    metrics.has("screenPageViews") ||
    metrics.has("screenPageViewsPerSession") ||
    metrics.has("averageSessionDuration");

  if (!hasSignal) {
    warnings.push(
      buildWarning({
        code: ERROR.GA4_METRICS_MISSING,
        capability: CAPABILITY_ID,
        message:
          "landing_underperformance requires a landing-performance signal (engagementRate, bounceRate, screenPageViews / screenPageViewsPerSession, or averageSessionDuration). None are present in upstream rows.",
        requiredMetrics: [
          "engagementRate",
          "bounceRate",
          "screenPageViews",
          "screenPageViewsPerSession",
          "averageSessionDuration",
        ],
        availableMetrics,
        availableDimensions,
      })
    );
  }

  return {
    warnings,
    availableDimensions,
    availableMetrics,
    blocked: warnings.length > 0,
  };
};

const landingUnderperformance = (input = {}) => {
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

  const { warnings: schemaWarns, blocked } = schemaWarnings(
    rows,
    input.inventory
  );
  const warnings = [...schemaWarns];

  if (blocked) {
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

  let usedProxy = false;
  const opportunities = [];

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;

    // Independent row evaluation only — never aggregate across eventName.
    const resolved = resolveEntity(row);
    if (!resolved) continue;
    if (resolved.usedProxy) usedProxy = true;

    const sessions = readSessions(row);
    if (sessions == null) continue;

    const hasEr = hasOwn(row, "engagementRate");
    const hasBounce = hasOwn(row, "bounceRate");
    const engagementRate = hasEr ? normalizeRate(row.engagementRate) : null;
    const bounceRate = hasBounce ? normalizeRate(row.bounceRate) : null;
    if (hasEr && engagementRate == null) continue;
    if (hasBounce && bounceRate == null) continue;

    const viewsPerSession = resolveViewsPerSession(row, sessions);
    const averageSessionDuration = readFinite(row, "averageSessionDuration");
    if (
      averageSessionDuration != null &&
      averageSessionDuration < 0
    ) {
      continue;
    }

    const signals = {
      engagementRate,
      bounceRate,
      viewsPerSession,
      averageSessionDuration,
    };

    if (!hasAnyPerformanceSignal(signals)) continue;
    if (sessions < filters.minSessions) continue;
    if (!isLandingUnderperforming(signals, filters)) continue;

    const { score, score_breakdown } = scoreLandingUnderperformance({
      sessions,
      ...signals,
    });
    if (score < filters.minScore) continue;

    opportunities.push({
      capability: CAPABILITY_ID,
      opportunity_type: OPPORTUNITY_TYPE,
      entity: resolved.entity,
      metrics: pickPresentMetrics(
        row,
        sessions,
        engagementRate,
        bounceRate,
        viewsPerSession
      ),
      reason: buildReason(
        resolved.entity.label,
        sessions,
        engagementRate,
        bounceRate,
        viewsPerSession,
        averageSessionDuration
      ),
      recommendation: buildRecommendation(resolved.entity.label),
      score,
      score_breakdown,
    });
  }

  if (usedProxy) {
    warnings.push(
      buildWarning({
        code: ERROR.GA4_LANDING_PROXY_PAGEPATH,
        capability: CAPABILITY_ID,
        message:
          "landingPage was not present; evaluated using pagePath as a landing/entry proxy. Prefer a GA4 pull that includes landingPage.",
        requiredDimensions: ["landingPage"],
        availableDimensions: ["pagePath"],
      })
    );
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
        message:
          "No landing underperformance opportunities matched the configured filters.",
        filters: { ...filters },
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
    warnings,
    scoreFormula: SCORE_FORMULA,
    filterDefaults: { ...FILTER_DEFAULTS.landing_underperformance },
  };
};

module.exports = {
  landingUnderperformance,
  CAPABILITY_ID,
  OPPORTUNITY_TYPE,
  SCORE_FORMULA,
  scoreLandingUnderperformance,
  resolveEntity,
  resolveViewsPerSession,
  compareOpportunities,
};
