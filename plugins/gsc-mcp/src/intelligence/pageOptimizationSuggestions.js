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
 * Page optimization suggestions from upstream GSC rows.
 * Emits ctr_opportunity or ranking_opportunity with concrete, metric-backed copy.
 */
const pageOptimizationSuggestions = (input = {}) => {
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const minImpressions = Number(input.minImpressions || 25);

  const byPage = new Map();
  for (const raw of rows) {
    const r = normalizeRow(raw);
    const pageKey = String(r.page || r.query || "").trim();
    if (!pageKey || r.impressions < minImpressions) continue;
    if (!byPage.has(pageKey)) {
      byPage.set(pageKey, {
        page: r.page || "",
        query: r.query || "",
        clicks: 0,
        impressions: 0,
        positionSum: 0,
        weight: 0,
        queries: [],
      });
    }
    const agg = byPage.get(pageKey);
    agg.clicks += r.clicks;
    agg.impressions += r.impressions;
    agg.positionSum += r.position * Math.max(r.impressions, 1);
    agg.weight += Math.max(r.impressions, 1);
    if (r.query) agg.queries.push(r.query);
  }

  const opportunities = [];
  for (const agg of byPage.values()) {
    const ctr = agg.impressions > 0 ? agg.clicks / agg.impressions : 0;
    const position = agg.weight > 0 ? agg.positionSum / agg.weight : 0;
    const topQueries = [...new Set(agg.queries)].slice(0, 5);
    const primaryQuery = topQueries[0] || agg.query || agg.page;
    const row = {
      query: primaryQuery,
      page: agg.page || null,
      clicks: agg.clicks,
      impressions: agg.impressions,
      ctr,
      position,
    };
    const entity = buildEntity(row);
    const metrics = buildMetrics(row, {
      supporting_queries: topQueries,
      query_count: topQueries.length,
    });

    if (ctr < 0.03 && agg.impressions >= minImpressions) {
      const { score, score_breakdown } = scoreCtrOpportunity(row);
      opportunities.push(
        buildOpportunity({
          opportunity_type: OPPORTUNITY_TYPES.CTR,
          entity,
          metrics,
          reason: `${entity.label} averages position ${fmtPos(position)} with ${agg.impressions} impressions and ${agg.clicks} clicks (${fmtPct(ctr)} CTR)${topQueries.length ? ` across queries like ${topQueries.slice(0, 3).map((q) => `"${q}"`).join(", ")}` : ""}.`,
          recommendation: `Rewrite the title and meta for ${agg.page || `"${entity.label}"`} to lead with "${primaryQuery}" and a clearer benefit statement — lifting CTR from ${fmtPct(ctr)} toward 5% would add roughly ${Math.ceil(score_breakdown.missed_clicks)} clicks.`,
          score,
          score_breakdown,
        })
      );
      continue;
    }

    if (position >= 8 && position <= 20) {
      const { score, score_breakdown } = scoreRankingOpportunity(row);
      opportunities.push(
        buildOpportunity({
          opportunity_type: OPPORTUNITY_TYPES.RANKING,
          entity,
          metrics,
          reason: `${entity.label} is stuck around position ${fmtPos(position)} with ${agg.impressions} impressions and ${agg.clicks} clicks (${fmtPct(ctr)} CTR). A move into the top 5 would compound existing demand.`,
          recommendation: `Expand the page ${agg.page || `"${entity.label}"`} with a dedicated section for "${primaryQuery}", add 2–3 internal links from related ranking URLs, and tighten the H1/H2 match to that query.`,
          score,
          score_breakdown,
        })
      );
      continue;
    }

    if (position > 20) {
      const { score, score_breakdown } = scoreRankingOpportunity(row);
      opportunities.push(
        buildOpportunity({
          opportunity_type: OPPORTUNITY_TYPES.RANKING,
          entity,
          metrics,
          reason: `${entity.label} averages position ${fmtPos(position)} (beyond page 2) with ${agg.impressions} impressions and ${agg.clicks} clicks. The page is collecting residual impressions without competitive ranking.`,
          recommendation: `Reassess whether ${agg.page || `"${entity.label}"`} should target "${primaryQuery}" at all; if yes, rebuild the intro and primary heading around that intent and remove competing keyword targets from the same URL.`,
          score: Math.round(score * 0.5),
          score_breakdown: {
            ...score_breakdown,
            formula: "(impressions / position) * 0.5 for deep rankings",
            adjusted_score: round(score * 0.5, 0),
          },
        })
      );
    }
  }

  opportunities.sort((a, b) => b.score - a.score);
  return wrapIntelligence("page_optimization_suggestions", opportunities);
};

module.exports = { pageOptimizationSuggestions };
