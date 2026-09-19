const {
  OPPORTUNITY_TYPES,
  wrapIntelligence,
  buildEntity,
  buildMetrics,
  buildOpportunity,
  scoreCtrOpportunity,
  fmtPct,
  fmtPos,
} = require("../contracts/intelligenceOutput");
const {
  validateIntelligenceFilters,
  applyLimit,
} = require("../contracts/intelligenceFilters");

const normalizeRow = (r) => {
  const keys = Array.isArray(r.keys) ? r.keys : [];
  return {
    query: r.query || keys[0] || r.page || "",
    page: r.page || (keys.length > 1 ? keys[1] : ""),
    clicks: Number(r.clicks || 0),
    impressions: Number(r.impressions || 0),
    ctr: Number(
      r.ctr != null
        ? r.ctr
        : r.clicks && r.impressions
          ? r.clicks / r.impressions
          : 0
    ),
    position: Number(r.position || 0),
  };
};

/** CTR opportunities: high impressions, low CTR, configurable position/score/limit. */
const ctrOpportunities = (input = {}) => {
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const validated = validateIntelligenceFilters("ctr_opportunities", input);
  if (!validated.ok) {
    const err = new Error(validated.error.message);
    err.code = validated.error.code;
    throw err;
  }
  const {
    minImpressions,
    maxPosition,
    minScore,
    limit,
    maxCtr,
    minPosition,
  } = validated.filters;

  const out = rows
    .map(normalizeRow)
    .filter(
      (r) =>
        r.impressions >= minImpressions &&
        r.ctr <= maxCtr &&
        r.position >= minPosition &&
        r.position <= maxPosition
    )
    .map((r) => {
      const entity = buildEntity(r);
      const metrics = buildMetrics(r);
      const { score, score_breakdown } = scoreCtrOpportunity(r);
      const missed = score_breakdown.missed_clicks;
      return buildOpportunity({
        opportunity_type: OPPORTUNITY_TYPES.CTR,
        entity,
        metrics,
        reason: `${entity.label} is ranking at position ${fmtPos(r.position)} with ${r.impressions} impressions and ${r.clicks} clicks (${fmtPct(r.ctr)} CTR). Visibility is not converting into clicks.`,
        recommendation: `Rewrite the title and meta description for "${entity.label}" to match search intent and raise CTR toward ~5% (about ${Math.ceil(missed)} additional clicks at current impressions).`,
        score,
        score_breakdown,
      });
    })
    .filter((o) => o.score >= minScore)
    .sort((a, b) => b.score - a.score);

  return wrapIntelligence("ctr_opportunities", applyLimit(out, limit));
};

module.exports = { ctrOpportunities, normalizeRow };
