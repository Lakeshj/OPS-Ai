/**
 * Engagement opportunities — STEP 4 implementation.
 *
 * Identifies pages with meaningful traffic and weak engagement using ONLY
 * metrics present on each upstream GA4 row. Rows are evaluated independently
 * (no aggregation across pages).
 *
 * Score (deterministic):
 *   volume     = min(1, sessions / 1000)
 *   qualityGap = max(
 *     engagementRate present ? max(0, 0.5 - engagementRate) : 0,
 *     bounceRate present     ? max(0, bounceRate - 0.5)     : 0
 *   )
 *   score      = round(volume * qualityGap * 100, 2)  // clamp [0, 100]
 */

const { ERROR, buildWarning } = require("../errors");
const {
  FILTER_DEFAULTS,
  validateCapabilityFilters,
} = require("../contracts/filters");
const { inventoryKeys } = require("../contracts/inputValidation");
const { round } = require("../contracts/output");

const CAPABILITY_ID = "engagement_opportunities";
const OPPORTUNITY_TYPE = "low_engagement";

const SCORE_FORMULA =
  "min(1, sessions/1000) * max(max(0, 0.5-engagementRate), max(0, bounceRate-0.5)) * 100";

/** Optional metrics copied into output only when present on the upstream row. */
const OPTIONAL_METRIC_KEYS = Object.freeze([
  "totalUsers",
  "screenPageViews",
  "userEngagementDuration",
  "engagedSessions",
  "averageSessionDuration",
]);

const hasOwn = (obj, key) =>
  obj != null &&
  typeof obj === "object" &&
  Object.prototype.hasOwnProperty.call(obj, key) &&
  obj[key] != null &&
  obj[key] !== "";

/**
 * Normalize GA4 rate fields. Values in (1, 100] are treated as percents once.
 * Does not invent rates — returns null when missing/invalid.
 */
const normalizeRate = (value) => {
  if (value == null || value === "") return null;
  let n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n > 1 && n <= 100) n = n / 100;
  if (n < 0) return null;
  // Clamp absurd values above 1 after percent normalization
  if (n > 1) n = 1;
  return n;
};

const readSessions = (row) => {
  if (!hasOwn(row, "sessions")) return null;
  const n = Number(row.sessions);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
};

const resolveEntity = (row) => {
  const pagePath = hasOwn(row, "pagePath")
    ? String(row.pagePath).trim()
    : "";
  const landingPage = hasOwn(row, "landingPage")
    ? String(row.landingPage).trim()
    : "";
  if (pagePath) {
    return {
      pagePath,
      ...(landingPage ? { landingPage } : {}),
      ...(hasOwn(row, "pageTitle")
        ? { pageTitle: String(row.pageTitle).trim() }
        : {}),
      label: pagePath,
    };
  }
  if (landingPage) {
    return {
      landingPage,
      ...(hasOwn(row, "pageTitle")
        ? { pageTitle: String(row.pageTitle).trim() }
        : {}),
      label: landingPage,
    };
  }
  return null;
};

const pickPresentMetrics = (row, sessions, engagementRate, bounceRate) => {
  const metrics = { sessions };
  if (engagementRate != null) metrics.engagementRate = round(engagementRate, 4);
  if (bounceRate != null) metrics.bounceRate = round(bounceRate, 4);
  for (const key of OPTIONAL_METRIC_KEYS) {
    if (!hasOwn(row, key)) continue;
    const n = Number(row[key]);
    if (!Number.isFinite(n)) continue;
    metrics[key] = key.includes("Rate") ? round(n, 4) : n;
  }
  return metrics;
};

const formatSessions = (n) => {
  const x = Math.round(Number(n) || 0);
  return x.toLocaleString("en-US");
};

const formatPct = (rate) => `${round(Number(rate) * 100, 2)}%`;

const buildReason = (label, sessions, engagementRate, bounceRate) => {
  const parts = [
    `Page ${label} received ${formatSessions(sessions)} sessions`,
  ];
  const signals = [];
  if (engagementRate != null) {
    signals.push(`an engagement rate of ${formatPct(engagementRate)}`);
  }
  if (bounceRate != null) {
    signals.push(`a bounce rate of ${formatPct(bounceRate)}`);
  }
  if (signals.length === 1) {
    parts.push(`with ${signals[0]}`);
  } else if (signals.length === 2) {
    parts.push(`with ${signals[0]} and ${signals[1]}`);
  }
  return `${parts.join(" ")}.`;
};

const buildRecommendation = (label) =>
  `Review the page experience and engagement elements for ${label}.`;

/**
 * Deterministic engagement score from available metrics only.
 */
const scoreEngagementOpportunity = ({
  sessions,
  engagementRate,
  bounceRate,
}) => {
  const volume = Math.min(1, Number(sessions) / 1000);
  const erGap =
    engagementRate != null ? Math.max(0, 0.5 - engagementRate) : 0;
  const bounceGap =
    bounceRate != null ? Math.max(0, bounceRate - 0.5) : 0;
  const qualityGap = Math.max(erGap, bounceGap);
  const raw = volume * qualityGap * 100;
  const score = Math.min(100, Math.max(0, round(raw, 2)));
  return {
    score,
    score_breakdown: {
      formula: SCORE_FORMULA,
      volume: round(volume, 6),
      qualityGap: round(qualityGap, 6),
      qualityGap_definition:
        "max(max(0, 0.5-engagementRate) if ER present, max(0, bounceRate-0.5) if bounce present)",
      inputs: {
        sessions,
        engagementRate:
          engagementRate != null ? round(engagementRate, 4) : null,
        bounceRate: bounceRate != null ? round(bounceRate, 4) : null,
        erGap: round(erGap, 6),
        bounceGap: round(bounceGap, 6),
      },
    },
  };
};

const isWeakEngagement = (
  engagementRate,
  bounceRate,
  { maxEngagementRate, minBounceRate }
) => {
  const erWeak =
    engagementRate != null && engagementRate <= maxEngagementRate;
  const bounceWeak = bounceRate != null && bounceRate >= minBounceRate;
  return erWeak || bounceWeak;
};

const compareOpportunities = (a, b) => {
  if (b.score !== a.score) return b.score - a.score;
  const aSessions = Number(a.metrics?.sessions) || 0;
  const bSessions = Number(b.metrics?.sessions) || 0;
  if (bSessions !== aSessions) return bSessions - aSessions;
  const aLabel = String(a.entity?.label || "");
  const bLabel = String(b.entity?.label || "");
  return aLabel.localeCompare(bLabel);
};

/**
 * Schema-level required-field check (do not guess).
 */
const schemaWarnings = (rows, inventory) => {
  const warnings = [];
  const inv =
    inventory && typeof inventory === "object"
      ? inventory
      : inventoryKeys(rows);

  const dims = new Set(inv.availableDimensions || []);
  const metrics = new Set(inv.availableMetrics || []);
  // Also scan raw keys in case inventory was empty/partial
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    for (const k of Object.keys(row)) {
      if (k === "pagePath" || k === "landingPage") dims.add(k);
      if (
        k === "sessions" ||
        k === "engagementRate" ||
        k === "bounceRate"
      ) {
        metrics.add(k);
      }
    }
  }

  const availableDimensions = [...dims].sort();
  const availableMetrics = [...metrics].sort();

  if (!dims.has("pagePath") && !dims.has("landingPage")) {
    warnings.push(
      buildWarning({
        code: ERROR.GA4_DIMS_MISSING,
        capability: CAPABILITY_ID,
        message:
          "engagement_opportunities requires pagePath or landingPage. Neither is present in upstream rows.",
        requiredDimensions: ["pagePath", "landingPage"],
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
          "engagement_opportunities requires sessions. sessions is not present in upstream rows.",
        requiredMetrics: ["sessions"],
        availableMetrics,
        availableDimensions,
      })
    );
  }

  if (!metrics.has("engagementRate") && !metrics.has("bounceRate")) {
    warnings.push(
      buildWarning({
        code: ERROR.GA4_METRICS_MISSING,
        capability: CAPABILITY_ID,
        message:
          "engagement_opportunities requires engagementRate or bounceRate. Neither is present in upstream rows.",
        requiredMetrics: ["engagementRate", "bounceRate"],
        availableMetrics,
        availableDimensions,
      })
    );
  }

  return { warnings, availableDimensions, availableMetrics, blocked: warnings.length > 0 };
};

const engagementOpportunities = (input = {}) => {
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

  const opportunities = [];

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;

    const entity = resolveEntity(row);
    if (!entity) continue;

    const sessions = readSessions(row);
    if (sessions == null) continue;

    const hasEr = hasOwn(row, "engagementRate");
    const hasBounce = hasOwn(row, "bounceRate");
    if (!hasEr && !hasBounce) continue;

    const engagementRate = hasEr ? normalizeRate(row.engagementRate) : null;
    const bounceRate = hasBounce ? normalizeRate(row.bounceRate) : null;
    // Present but non-numeric → skip row (do not invent)
    if (hasEr && engagementRate == null) continue;
    if (hasBounce && bounceRate == null) continue;
    if (engagementRate == null && bounceRate == null) continue;

    if (sessions < filters.minSessions) continue;

    if (
      !isWeakEngagement(engagementRate, bounceRate, {
        maxEngagementRate: filters.maxEngagementRate,
        minBounceRate: filters.minBounceRate,
      })
    ) {
      continue;
    }

    const { score, score_breakdown } = scoreEngagementOpportunity({
      sessions,
      engagementRate,
      bounceRate,
    });

    if (score < filters.minScore) continue;

    opportunities.push({
      capability: CAPABILITY_ID,
      opportunity_type: OPPORTUNITY_TYPE,
      entity,
      metrics: pickPresentMetrics(
        row,
        sessions,
        engagementRate,
        bounceRate
      ),
      reason: buildReason(
        entity.label,
        sessions,
        engagementRate,
        bounceRate
      ),
      recommendation: buildRecommendation(entity.label),
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
        message:
          "No engagement opportunities matched the configured filters.",
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
    filterDefaults: { ...FILTER_DEFAULTS.engagement_opportunities },
  };
};

module.exports = {
  engagementOpportunities,
  CAPABILITY_ID,
  OPPORTUNITY_TYPE,
  SCORE_FORMULA,
  scoreEngagementOpportunity,
  normalizeRate,
  resolveEntity,
  compareOpportunities,
};
