const { normalizeRow } = require("./ctrOpportunities");
const {
  OPPORTUNITY_TYPES,
  wrapIntelligence,
  buildEntity,
  buildOpportunity,
  scoreContentDecay,
  fmtPos,
  round,
} = require("../contracts/intelligenceOutput");
const {
  validateIntelligenceFilters,
  applyLimit,
} = require("../contracts/intelligenceFilters");

const entityKey = (r) => {
  const n = normalizeRow(r);
  return n.query || n.page || "";
};

const validationError = (message) => {
  const err = new Error(message);
  err.code = "MCP_VALIDATION";
  throw err;
};

/**
 * Content decay — prior period vs current period only.
 * A single snapshot cannot establish decay.
 */
const contentDecay = (input = {}) => {
  const currentRaw = Array.isArray(input.currentRows)
    ? input.currentRows
    : Array.isArray(input.rows)
      ? input.rows
      : [];
  const previousRaw = Array.isArray(input.previousRows)
    ? input.previousRows
    : [];

  if (String(input.comparisonPeriod || "").trim() === "snapshot") {
    validationError(
      "Content Decay requires current-period and previous-period GSC data. A single snapshot cannot establish decay."
    );
  }

  const validated = validateIntelligenceFilters("content_decay", input);
  if (!validated.ok) {
    const err = new Error(validated.error.message);
    err.code = validated.error.code;
    throw err;
  }

  if (!currentRaw.length) {
    validationError(
      "Content Decay requires current-period and previous-period GSC data. A single snapshot cannot establish decay."
    );
  }
  if (!previousRaw.length) {
    validationError(
      "Content Decay requires current-period and previous-period GSC data. A single snapshot cannot establish decay."
    );
  }

  const {
    minPreviousImpressions,
    minCurrentImpressions,
    minClickDropPercent,
    minPositionWorsening,
    limit,
  } = validated.filters;

  const prevMap = new Map();
  for (const row of previousRaw) {
    const key = entityKey(row);
    if (!key) continue;
    prevMap.set(key, normalizeRow(row));
  }

  const out = currentRaw
    .map(normalizeRow)
    .map((cur) => {
      const key = cur.query || cur.page;
      if (!key) return null;
      const prev = prevMap.get(key);
      if (!prev) return null;

      const current_clicks = cur.clicks;
      const previous_clicks = prev.clicks;
      const click_change = current_clicks - previous_clicks;
      const click_change_percent =
        previous_clicks > 0
          ? round((click_change / previous_clicks) * 100, 1)
          : click_change < 0
            ? -100
            : 0;

      const current_impressions = cur.impressions;
      const previous_impressions = prev.impressions;
      const impression_change = current_impressions - previous_impressions;
      const impression_change_percent =
        previous_impressions > 0
          ? round((impression_change / previous_impressions) * 100, 1)
          : 0;

      const current_ctr = cur.ctr;
      const previous_ctr = prev.ctr;
      const ctr_change = round(current_ctr - previous_ctr, 4);

      const current_position = cur.position;
      const previous_position = prev.position;
      const position_change = round(current_position - previous_position, 1);

      // Evidence gates
      if (previous_impressions < minPreviousImpressions) return null;
      if (current_impressions < minCurrentImpressions) return null;

      const clickDropAbs = previous_clicks - current_clicks; // >0 means decline
      const clickDropPct =
        previous_clicks > 0
          ? (clickDropAbs / previous_clicks) * 100
          : clickDropAbs > 0
            ? 100
            : 0;
      const positionWorsening = position_change; // >0 means worse (higher SERP number)

      const hasClickDecline =
        clickDropAbs > 0 && clickDropPct >= minClickDropPercent;
      const hasPositionDecline = positionWorsening >= minPositionWorsening;

      // Must show real deterioration — not merely zero clicks or a weak position
      if (!hasClickDecline && !hasPositionDecline) return null;

      // Both periods at zero clicks with no meaningful position worsening already filtered
      if (previous_clicks === 0 && current_clicks === 0 && !hasPositionDecline) {
        return null;
      }

      const entity = buildEntity(cur);
      const metrics = {
        current_clicks,
        previous_clicks,
        click_change,
        click_change_percent,
        current_impressions,
        previous_impressions,
        impression_change,
        impression_change_percent,
        current_ctr: round(current_ctr, 4),
        previous_ctr: round(previous_ctr, 4),
        ctr_change,
        current_position: fmtPos(current_position),
        previous_position: fmtPos(previous_position),
        position_change,
        // aliases kept for AI grounding / older consumers
        clicks: current_clicks,
        impressions: current_impressions,
        ctr: round(current_ctr, 4),
        position: fmtPos(current_position),
        comparison_period: "prior_period",
      };

      const { score, score_breakdown } = scoreContentDecay({
        clickDrop: Math.max(0, clickDropAbs),
        positionDelta: Math.max(0, positionWorsening),
        clickDropPercent: round(clickDropPct, 1),
      });

      const parts = [];
      if (clickDropAbs > 0) {
        parts.push(
          `clicks decreased from ${previous_clicks} to ${current_clicks} (${round(click_change_percent, 1)}%)`
        );
      }
      if (positionWorsening > 0) {
        parts.push(
          `average position worsened from ${fmtPos(previous_position)} to ${fmtPos(current_position)}`
        );
      }
      if (impression_change !== 0) {
        parts.push(
          `impressions ${impression_change > 0 ? "rose" : "fell"} from ${previous_impressions} to ${current_impressions}`
        );
      }

      return buildOpportunity({
        opportunity_type: OPPORTUNITY_TYPES.CONTENT_DECAY,
        entity,
        metrics,
        reason: `${entity.label}: ${parts.join("; ")}.`,
        recommendation: `Review the page/query for "${entity.label}" for potential content or SERP changes between the previous and current period. Do not assume staleness without further evidence.`,
        score,
        score_breakdown,
      });
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  return wrapIntelligence("content_decay", applyLimit(out, limit));
};

module.exports = { contentDecay };
