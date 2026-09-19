const { normalizeRow } = require("./ctrOpportunities");
const {
  OPPORTUNITY_TYPES,
  wrapIntelligence,
  buildEntity,
  buildMetrics,
  buildOpportunity,
  scoreRankingOpportunity,
  fmtPct,
  fmtPos,
} = require("../contracts/intelligenceOutput");
const {
  validateIntelligenceFilters,
  applyLimit,
} = require("../contracts/intelligenceFilters");

/** Ranking opportunities: configurable impression floor + position range + limit. */
const rankingOpportunities = (input = {}) => {
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const validated = validateIntelligenceFilters("ranking_opportunities", input);
  if (!validated.ok) {
    const err = new Error(validated.error.message);
    err.code = validated.error.code;
    throw err;
  }
  const { minImpressions, minPosition, maxPosition, limit } = validated.filters;

  const out = rows
    .map(normalizeRow)
    .filter(
      (r) =>
        r.impressions >= minImpressions &&
        r.position >= minPosition &&
        r.position <= maxPosition
    )
    .map((r) => {
      const entity = buildEntity(r);
      const metrics = buildMetrics(r);
      const { score, score_breakdown } = scoreRankingOpportunity(r);
      const targetPos = r.position <= 10 ? 3 : 5;
      return buildOpportunity({
        opportunity_type: OPPORTUNITY_TYPES.RANKING,
        entity,
        metrics,
        reason: `${entity.label} averages position ${fmtPos(r.position)} with ${r.impressions} impressions and ${r.clicks} clicks (${fmtPct(r.ctr)} CTR). It is close enough that a modest ranking gain would unlock more traffic.`,
        recommendation: `Strengthen on-page relevance and internal links for "${entity.label}" to move from position ${fmtPos(r.position)} toward top-${targetPos}. Prioritize content depth for the primary intent of this query.`,
        score,
        score_breakdown,
      });
    })
    .sort((a, b) => b.score - a.score);

  return wrapIntelligence("ranking_opportunities", applyLimit(out, limit));
};

module.exports = { rankingOpportunities };
