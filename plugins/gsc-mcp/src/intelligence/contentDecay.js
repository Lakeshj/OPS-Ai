const { normalizeRow } = require("./ctrOpportunities");
const {
  OPPORTUNITY_TYPES,
  wrapIntelligence,
  buildEntity,
  buildMetrics,
  buildOpportunity,
  scoreContentDecay,
  fmtPct,
  fmtPos,
  round,
} = require("../contracts/intelligenceOutput");
const {
  validateIntelligenceFilters,
  applyLimit,
} = require("../contracts/intelligenceFilters");

/**
 * Content decay with configurable comparison period, drop %, and limit.
 * - snapshot: deep position + weak CTR heuristic (ignores previousRows)
 * - prior_period: requires previousRows; enforces dropPercentage on clicks
 */
const contentDecay = (input = {}) => {
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const previous = Array.isArray(input.previousRows) ? input.previousRows : [];
  const validated = validateIntelligenceFilters("content_decay", input);
  if (!validated.ok) {
    const err = new Error(validated.error.message);
    err.code = validated.error.code;
    throw err;
  }
  const {
    comparisonPeriod,
    dropPercentage,
    limit,
    minImpressions,
    maxCtr,
    minPosition,
  } = validated.filters;

  if (comparisonPeriod === "prior_period") {
    if (!previous.length) {
      return wrapIntelligence("content_decay", []);
    }

    const prevMap = new Map(
      previous.map((r) => {
        const n = normalizeRow(r);
        return [n.query || n.page, n];
      })
    );
    const out = rows
      .map(normalizeRow)
      .map((r) => {
        const key = r.query || r.page;
        const p = prevMap.get(key);
        if (!p) return null;
        const clickDrop = p.clicks - r.clicks;
        const positionDelta = r.position - p.position;
        if (clickDrop <= 0 && positionDelta <= 0) return null;

        const dropPct =
          p.clicks > 0 ? (clickDrop / p.clicks) * 100 : clickDrop > 0 ? 100 : 0;

        // When dropPercentage is set, require click decline to meet the threshold.
        if (dropPercentage > 0) {
          if (clickDrop <= 0 || dropPct < dropPercentage) return null;
        }

        const entity = buildEntity(r);
        const metrics = buildMetrics(r, {
          previous_clicks: p.clicks,
          previous_position: fmtPos(p.position),
          click_drop: clickDrop,
          position_delta: round(positionDelta, 1),
          drop_percentage: round(dropPct, 1),
          comparison_period: "prior_period",
        });
        const { score, score_breakdown } = scoreContentDecay({
          clickDrop,
          positionDelta,
        });

        const parts = [];
        if (clickDrop > 0) {
          parts.push(
            `clicks fell from ${p.clicks} to ${r.clicks} (−${clickDrop}, ${round(dropPct, 1)}%)`
          );
        }
        if (positionDelta > 0) {
          parts.push(
            `average position worsened from ${fmtPos(p.position)} to ${fmtPos(r.position)} (+${round(positionDelta, 1)})`
          );
        }

        return buildOpportunity({
          opportunity_type: OPPORTUNITY_TYPES.CONTENT_DECAY,
          entity,
          metrics,
          reason: `${entity.label} declined vs the prior period: ${parts.join("; ")}. Current CTR is ${fmtPct(r.ctr)} on ${r.impressions} impressions.`,
          recommendation: `Refresh the content for "${entity.label}" (update stats, examples, and headings), reclaim lost internal links, and re-target the primary query to recover the ${clickDrop > 0 ? `${clickDrop} lost clicks` : "lost ranking positions"}.`,
          score,
          score_breakdown,
        });
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
    return wrapIntelligence("content_decay", applyLimit(out, limit));
  }

  // Snapshot mode — ignore previousRows
  const out = rows
    .map(normalizeRow)
    .filter(
      (r) =>
        r.impressions >= minImpressions &&
        r.ctr < maxCtr &&
        r.position > minPosition
    )
    .map((r) => {
      const entity = buildEntity(r);
      const metrics = buildMetrics(r, { comparison_period: "snapshot" });
      const { score, score_breakdown } = scoreContentDecay({
        impressions: r.impressions,
        ctr: r.ctr,
      });
      return buildOpportunity({
        opportunity_type: OPPORTUNITY_TYPES.CONTENT_DECAY,
        entity,
        metrics,
        reason: `${entity.label} sits at position ${fmtPos(r.position)} with ${r.impressions} impressions but only ${r.clicks} clicks (${fmtPct(r.ctr)} CTR). Deep ranking plus near-zero engagement usually means stale or mismatched content.`,
        recommendation: `Audit "${entity.label}" for outdated sections and intent mismatch, then rewrite the intro and H2s around the query and add a fresh example or FAQ to regain engagement.`,
        score,
        score_breakdown,
      });
    })
    .sort((a, b) => b.score - a.score);
  return wrapIntelligence("content_decay", applyLimit(out, limit));
};

module.exports = { contentDecay };
