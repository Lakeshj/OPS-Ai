const { normalizeRow } = require("./ctrOpportunities");
const {
  OPPORTUNITY_TYPES,
  wrapIntelligence,
  buildEntity,
  buildMetrics,
  buildOpportunity,
  scoreCtrOpportunity,
  scoreRankingOpportunity,
  fmtPct,
  fmtPos,
  round,
} = require("../contracts/intelligenceOutput");

/**
 * Query gap analysis: high-visibility queries with weak capture.
 * Emits ctr_opportunity or ranking_opportunity with specific reasons (no generic copy).
 */
const queryGapAnalysis = (input = {}) => {
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const minImpressions = Number(input.minImpressions || 40);
  const maxCtr = Number(input.maxCtr || 0.04);
  const minPosition = Number(input.minPosition || 8);

  const opportunities = rows
    .map(normalizeRow)
    .filter((r) => {
      const key = r.query || r.page;
      if (!key) return false;
      if (r.impressions < minImpressions) return false;
      return r.ctr <= maxCtr || r.position >= minPosition;
    })
    .map((r) => {
      const entity = buildEntity(r);
      const weakCtr = r.ctr <= maxCtr;
      const expectedClicks = Math.round(r.impressions * 0.05);
      const clickGap = Math.max(0, expectedClicks - r.clicks);
      const metrics = buildMetrics(r, {
        expected_clicks: expectedClicks,
        click_gap: clickGap,
      });

      if (weakCtr) {
        const { score, score_breakdown } = scoreCtrOpportunity(r);
        return buildOpportunity({
          opportunity_type: OPPORTUNITY_TYPES.CTR,
          entity,
          metrics,
          reason: `Query "${entity.label}" ranks at position ${fmtPos(r.position)} with ${r.impressions} impressions but only ${r.clicks} clicks (${fmtPct(r.ctr)} CTR). At a 5% CTR benchmark that is a gap of ~${clickGap} clicks.`,
          recommendation: `Improve title/meta relevance for "${entity.label}" so the snippet matches the query; closing the gap to ~5% CTR would recover about ${clickGap} clicks at current impression volume.`,
          score,
          score_breakdown: {
            ...score_breakdown,
            click_gap: clickGap,
            expected_clicks: expectedClicks,
          },
        });
      }

      const { score, score_breakdown } = scoreRankingOpportunity(r);
      return buildOpportunity({
        opportunity_type: OPPORTUNITY_TYPES.RANKING,
        entity,
        metrics,
        reason: `Query "${entity.label}" gets ${r.impressions} impressions at average position ${fmtPos(r.position)} with ${r.clicks} clicks (${fmtPct(r.ctr)} CTR). Demand is visible but the ranking is too deep to capture it.`,
        recommendation: `Target a move from position ${fmtPos(r.position)} toward top-5 for "${entity.label}" with stronger on-page coverage and supporting internal links from related URLs.`,
        score: Math.round(score + clickGap),
        score_breakdown: {
          ...score_breakdown,
          formula: "impressions / position + click_gap",
          click_gap: clickGap,
          expected_clicks: expectedClicks,
          combined_score: round(score + clickGap, 0),
        },
      });
    })
    .sort((a, b) => b.score - a.score);

  return wrapIntelligence("query_gap_analysis", opportunities);
};

module.exports = { queryGapAnalysis };
