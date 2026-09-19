const { normalizeRow } = require("./ctrOpportunities");
const {
  OPPORTUNITY_TYPES,
  wrapIntelligence,
  buildEntity,
  buildMetrics,
  buildOpportunity,
  scoreKeywordConflict,
  fmtPct,
  fmtPos,
} = require("../contracts/intelligenceOutput");
const {
  validateIntelligenceFilters,
  applyLimit,
} = require("../contracts/intelligenceFilters");

/** Keyword conflict (cannibalization): configurable min pages + impressions. */
const keywordCannibalization = (input = {}) => {
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const validated = validateIntelligenceFilters(
    "keyword_cannibalization",
    input
  );
  if (!validated.ok) {
    const err = new Error(validated.error.message);
    err.code = validated.error.code;
    throw err;
  }
  const { minPages, minImpressions, limit } = validated.filters;

  const byQuery = new Map();
  for (const raw of rows) {
    const r = normalizeRow(raw);
    const q = String(r.query || "").trim().toLowerCase();
    if (!q) continue;
    if (!byQuery.has(q)) byQuery.set(q, []);
    byQuery.get(q).push(r);
  }

  const opportunities = [];
  for (const [query, list] of byQuery.entries()) {
    const pages = [...new Set(list.map((r) => r.page).filter(Boolean))];
    if (pages.length < minPages) continue;

    const clicks = list.reduce((s, r) => s + r.clicks, 0);
    const impressions = list.reduce((s, r) => s + r.impressions, 0);
    if (impressions < minImpressions) continue;

    const ctr = impressions > 0 ? clicks / impressions : 0;
    const best = [...list].sort((a, b) => a.position - b.position)[0];
    const pageSummary = list
      .filter((r) => r.page)
      .map(
        (r) =>
          `${r.page} (pos ${fmtPos(r.position)}, ${r.clicks} clicks / ${r.impressions} impr)`
      )
      .join("; ");

    const entity = buildEntity({ query, page: best?.page || pages[0] });
    const metrics = buildMetrics(
      {
        clicks,
        impressions,
        ctr,
        position: best?.position || 0,
      },
      {
        page_count: pages.length,
        pages,
        competing_pages: pages,
      }
    );
    const { score, score_breakdown } = scoreKeywordConflict({
      pageCount: pages.length,
      impressions,
    });

    opportunities.push(
      buildOpportunity({
        opportunity_type: OPPORTUNITY_TYPES.KEYWORD_CONFLICT,
        entity,
        metrics,
        reason: `Query "${query}" is ranking on ${pages.length} URLs (${pageSummary}). Combined CTR is ${fmtPct(ctr)} across ${impressions} impressions, so Google is splitting relevance across conflicting pages.`,
        recommendation: `Pick one canonical URL for "${query}" (prefer ${best?.page || pages[0]} at position ${fmtPos(best?.position || 0)}), consolidate or 301 the weaker pages, and point internal links + unique title/meta at the winner.`,
        score,
        score_breakdown,
      })
    );
  }

  opportunities.sort((a, b) => b.score - a.score);
  return wrapIntelligence(
    "keyword_cannibalization",
    applyLimit(opportunities, limit)
  );
};

module.exports = { keywordCannibalization };
