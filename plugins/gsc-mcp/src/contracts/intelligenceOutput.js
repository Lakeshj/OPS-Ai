/**
 * Shared output contract for OpsAi GSC intelligence tools.
 *
 * Every opportunity row:
 * {
 *   opportunity_type, // ctr_opportunity | ranking_opportunity | content_decay | keyword_conflict
 *   entity,           // { query?, page?, label }
 *   metrics,          // normalized GSC metrics (+ deltas when available)
 *   reason,           // why this is an opportunity (data-specific)
 *   recommendation,   // concrete next action (not generic)
 *   score,            // transparent numeric priority
 *   score_breakdown   // formula inputs for auditability
 * }
 */

const OPPORTUNITY_TYPES = Object.freeze({
  CTR: "ctr_opportunity",
  RANKING: "ranking_opportunity",
  CONTENT_DECAY: "content_decay",
  KEYWORD_CONFLICT: "keyword_conflict",
});

const REQUIRED_TOP_KEYS = Object.freeze(["opportunities", "count", "kind"]);

const REQUIRED_ROW_KEYS = Object.freeze([
  "opportunity_type",
  "entity",
  "metrics",
  "reason",
  "recommendation",
  "score",
]);

const GENERIC_PHRASES = Object.freeze([
  /page-level signals suggest/i,
  /soft engagement signal/i,
  /within striking distance/i,
  /review freshness/i,
  /on-page optimization upside/i,
  /improve title\/meta$/i,
]);

const round = (n, digits = 2) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  const p = 10 ** digits;
  return Math.round(x * p) / p;
};

const fmtPct = (ctr) => `${round(Number(ctr || 0) * 100, 2)}%`;

const fmtPos = (position) => round(position, 1);

const buildEntity = (row = {}) => {
  const query = String(row.query || "").trim() || null;
  const page = String(row.page || "").trim() || null;
  const label = query || page || "unknown";
  return { query, page, label };
};

const buildMetrics = (row = {}, extra = {}) => ({
  clicks: Number(row.clicks || 0),
  impressions: Number(row.impressions || 0),
  ctr: round(row.ctr != null ? row.ctr : 0, 4),
  position: round(row.position || 0, 1),
  ...extra,
});

const buildOpportunity = ({
  opportunity_type,
  entity,
  metrics,
  reason,
  recommendation,
  score,
  score_breakdown,
}) => ({
  opportunity_type,
  entity,
  metrics,
  reason: String(reason || "").trim(),
  recommendation: String(recommendation || "").trim(),
  score: Number(score) || 0,
  ...(score_breakdown && typeof score_breakdown === "object"
    ? { score_breakdown }
    : {}),
});

const looksGeneric = (text) =>
  GENERIC_PHRASES.some((re) => re.test(String(text || "")));

const validateOpportunityRow = (row, index) => {
  const errors = [];
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return [`opportunities[${index}] must be an object`];
  }
  for (const key of REQUIRED_ROW_KEYS) {
    if (!(key in row)) errors.push(`opportunities[${index}].${key} is required`);
  }
  if (
    row.opportunity_type &&
    !Object.values(OPPORTUNITY_TYPES).includes(row.opportunity_type)
  ) {
    errors.push(
      `opportunities[${index}].opportunity_type invalid: ${row.opportunity_type}`
    );
  }
  if (row.entity == null || typeof row.entity !== "object") {
    errors.push(`opportunities[${index}].entity must be an object`);
  } else if (!row.entity.label) {
    errors.push(`opportunities[${index}].entity.label is required`);
  }
  if (row.metrics == null || typeof row.metrics !== "object") {
    errors.push(`opportunities[${index}].metrics must be an object`);
  }
  if (typeof row.reason !== "string" || !row.reason.trim()) {
    errors.push(`opportunities[${index}].reason must be a non-empty string`);
  } else if (looksGeneric(row.reason)) {
    errors.push(`opportunities[${index}].reason looks generic`);
  }
  if (typeof row.recommendation !== "string" || !row.recommendation.trim()) {
    errors.push(
      `opportunities[${index}].recommendation must be a non-empty string`
    );
  } else if (looksGeneric(row.recommendation)) {
    errors.push(`opportunities[${index}].recommendation looks generic`);
  }
  if (typeof row.score !== "number" || Number.isNaN(row.score)) {
    errors.push(`opportunities[${index}].score must be a number`);
  }
  return errors;
};

const validateIntelligenceOutput = (data, expectedKind) => {
  const errors = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, errors: ["output must be an object"] };
  }
  for (const key of REQUIRED_TOP_KEYS) {
    if (!(key in data)) errors.push(`missing top-level key: ${key}`);
  }
  if (expectedKind && data.kind !== expectedKind) {
    errors.push(`kind must be "${expectedKind}", got "${data.kind}"`);
  }
  if (!Array.isArray(data.opportunities)) {
    errors.push("opportunities must be an array");
  } else {
    data.opportunities.forEach((row, i) => {
      errors.push(...validateOpportunityRow(row, i));
    });
  }
  if (
    typeof data.count !== "number" ||
    data.count !== (data.opportunities || []).length
  ) {
    errors.push("count must equal opportunities.length");
  }
  return { ok: errors.length === 0, errors };
};

const wrapIntelligence = (kind, opportunities) => {
  const list = Array.isArray(opportunities) ? opportunities : [];
  return {
    kind,
    opportunities: list,
    count: list.length,
  };
};

/** Transparent CTR score: missed clicks vs a 5% benchmark, weighted by position band. */
const scoreCtrOpportunity = ({ impressions, clicks, ctr, position }) => {
  const benchmarkCtr = 0.05;
  const missedClicks = Math.max(0, impressions * benchmarkCtr - clicks);
  const positionWeight = position >= 4 && position <= 10 ? 1.4 : 1;
  const score = Math.round(missedClicks * positionWeight);
  return {
    score,
    score_breakdown: {
      formula: "missedClicks * positionWeight",
      benchmark_ctr: benchmarkCtr,
      missed_clicks: round(missedClicks, 2),
      position_weight: positionWeight,
      inputs: {
        impressions,
        clicks,
        ctr: round(ctr, 4),
        position: fmtPos(position),
      },
    },
  };
};

/** Transparent ranking score: impressions / position (higher = more upside to climb). */
const scoreRankingOpportunity = ({ impressions, position }) => {
  const score = Math.round(impressions / Math.max(position, 1));
  return {
    score,
    score_breakdown: {
      formula: "impressions / position",
      inputs: { impressions, position: fmtPos(position) },
    },
  };
};

/** Transparent decay score: absolute click drop + 10 * position worsening. */
const scoreContentDecay = ({
  clickDrop = 0,
  positionDelta = 0,
  clickDropPercent = 0,
}) => {
  const click_drop_score = Math.max(0, Number(clickDrop) || 0);
  const position_drop_score = Math.max(0, Number(positionDelta) || 0) * 10;
  const score = Math.round(click_drop_score + position_drop_score);
  return {
    score,
    score_breakdown: {
      formula: "click_drop_score + position_drop_score",
      click_drop_score: round(click_drop_score, 2),
      position_drop_score: round(position_drop_score, 2),
      click_drop_percent: round(clickDropPercent, 1),
      inputs: {
        clickDrop: round(clickDrop, 2),
        positionDelta: round(positionDelta, 2),
      },
    },
  };
};

/** Transparent conflict score: competing pages * total impressions. */
const scoreKeywordConflict = ({ pageCount, impressions }) => {
  const score = Math.round(pageCount * impressions);
  return {
    score,
    score_breakdown: {
      formula: "pageCount * impressions",
      inputs: { pageCount, impressions },
    },
  };
};

module.exports = {
  OPPORTUNITY_TYPES,
  REQUIRED_TOP_KEYS,
  REQUIRED_ROW_KEYS,
  round,
  fmtPct,
  fmtPos,
  buildEntity,
  buildMetrics,
  buildOpportunity,
  validateIntelligenceOutput,
  wrapIntelligence,
  scoreCtrOpportunity,
  scoreRankingOpportunity,
  scoreContentDecay,
  scoreKeywordConflict,
};
