/**
 * STEP 8G — landing positive-path diagnosis (QA only, no production writes).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const ga4Root = path.join(root, 'plugins', 'ga4-mcp', 'src');

const { processUpstreamItems } = require(path.join(ga4Root, 'adapters', 'processUpstream'));
const { FILTER_DEFAULTS } = require(path.join(ga4Root, 'contracts', 'filters'));
const {
  tryBuildFromWorkflowItems,
  applyAiGrounding,
  isCapabilitySection,
} = require(path.join(ga4Root, 'contracts', 'intelligenceContext'));

const upstreamPath = path.join(root, '.tmp', 'step8g-a9881bbe-googleAnalytics-1789984791245.json');
const upstreamDump = JSON.parse(fs.readFileSync(upstreamPath, 'utf8'));

function unwrapItems(output) {
  if (!output) return [];
  if (Array.isArray(output)) return output;
  if (Array.isArray(output.items)) return output.items;
  return [];
}

function rowJson(item) {
  if (!item || typeof item !== 'object') return null;
  if (item.json && typeof item.json === 'object') return item.json;
  return item;
}

const upstreamItems = unwrapItems(upstreamDump.output);
const rows = upstreamItems.map(rowJson).filter(Boolean);

function dist(nums) {
  const a = nums.filter((n) => n != null && Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return { count: 0 };
  const pct = (p) => a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
  return {
    count: a.length,
    min: a[0],
    p25: pct(25),
    p50: pct(50),
    p75: pct(75),
    max: a[a.length - 1],
    mean: Number((a.reduce((s, n) => s + n, 0) / a.length).toFixed(6)),
  };
}

function normalizeRate(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n > 1 && n <= 100) return n / 100;
  return n;
}

const validLanding = rows.filter((r) => {
  const lp = r.landingPage;
  return lp != null && String(lp).trim() !== '' && String(lp).trim() !== '(not set)';
});

const sessions = validLanding.map((r) => Number(r.sessions)).filter(Number.isFinite);
const ers = validLanding.map((r) => normalizeRate(r.engagementRate)).filter((n) => n != null);
const brs = validLanding.map((r) => normalizeRate(r.bounceRate)).filter((n) => n != null);

const defaultLandingFilters = { ...FILTER_DEFAULTS.landing_underperformance };

function filterElimination(rowsIn, filters) {
  const stats = {
    total: rowsIn.length,
    validLanding: 0,
    failMinSessions: 0,
    failUnderperforming: 0,
    passSignal: 0,
    erWeakCount: 0,
    bounceWeakCount: 0,
    failUnderperformingSamples: [],
    aboveSessionsSamples: [],
  };

  for (const row of rowsIn) {
    const lp = row.landingPage;
    if (lp == null || String(lp).trim() === '' || String(lp).trim() === '(not set)') continue;
    stats.validLanding += 1;
    const sess = Number(row.sessions);
    if (!Number.isFinite(sess) || sess < filters.minSessions) {
      stats.failMinSessions += 1;
      continue;
    }
    const er = normalizeRate(row.engagementRate);
    const br = normalizeRate(row.bounceRate);
    const erWeak = er != null && er <= filters.maxEngagementRate;
    const bounceWeak = br != null && br >= filters.minBounceRate;
    if (erWeak) stats.erWeakCount += 1;
    if (bounceWeak) stats.bounceWeakCount += 1;
    if (stats.aboveSessionsSamples.length < 10) {
      stats.aboveSessionsSamples.push({
        landingPage: lp,
        sessions: sess,
        engagementRate: er,
        bounceRate: br,
      });
    }
    if (!(erWeak || bounceWeak)) {
      stats.failUnderperforming += 1;
      if (stats.failUnderperformingSamples.length < 10) {
        stats.failUnderperformingSamples.push({
          landingPage: lp,
          sessions: sess,
          engagementRate: er,
          bounceRate: br,
          needErLe: filters.maxEngagementRate,
          needBrGe: filters.minBounceRate,
        });
      }
      continue;
    }
    stats.passSignal += 1;
  }
  return stats;
}

const elimDefaults = filterElimination(rows, defaultLandingFilters);
const qaFilters = {
  minSessions: 0,
  maxEngagementRate: 1,
  minBounceRate: 0,
  minScore: 0,
  limit: 50,
};

console.log('=== UPSTREAM ===');
console.log(JSON.stringify({
  inputRowCount: rows.length,
  validLandingRows: validLanding.length,
  sessionsDistribution: dist(sessions),
  engagementRateDistribution: dist(ers),
  bounceRateDistribution: dist(brs),
  configuredLandingFiltersDefaults: defaultLandingFilters,
  filterEliminationDefaults: elimDefaults,
}, null, 2));

function runLandingOnly(filtersObj) {
  return processUpstreamItems({
    capabilities: ['landing_underperformance'],
    inputItems: upstreamItems,
    nodeData: {
      capabilities: ['landing_underperformance'],
      capability: 'landing_underperformance',
      capabilitySettings: {
        landing_underperformance: filtersObj || {},
      },
    },
  });
}

function summarizeRun(label, result) {
  const items = result.items || [];
  const jsons = items.map((i) => i.json || i);
  const opps = jsons.filter((j) => j && !isCapabilitySection(j) && !j.__ga4CapabilitySection);
  const sections = jsons.filter((j) => j && (isCapabilitySection(j) || j.__ga4CapabilitySection));
  const opportunityReport = opps.map((o) => ({
    capability: o.capability,
    opportunity_type: o.opportunity_type,
    entity: o.entity,
    metrics: o.metrics,
    score: o.score,
    reason: o.reason,
    recommendation: o.recommendation,
    filters: o.filters,
    warnings: o.warnings,
  }));
  const out = {
    label,
    ok: result.ok,
    inputRowCount: rows.length,
    selectedCapabilities: result.output?.capabilities,
    executed: result.output?.executed,
    outputItemCount: items.length,
    landingOpportunityCount: opportunityReport.length,
    perCapability: result.output?.perCapability || result.perCapability,
    sectionPreview: sections.map((s) => ({
      capability: s.capability,
      count: s.count,
      warnings: s.warnings,
      filters: s.filters,
    })),
    exactOpportunities: opportunityReport,
  };
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(out, null, 2));
  return { result, items, opps, sections, opportunityReport, summary: out };
}

const defRun = summarizeRun('LANDING-ONLY DEFAULT FILTERS', runLandingOnly({}));
const qaRun = summarizeRun('LANDING-ONLY QA FILTERS', runLandingOnly(qaFilters));

// IntelligenceContext + AI grounding on QA positive path
const USER_PROMPT = `Analyze the structured GA4 MCP landing underperformance opportunities.

Report every qualifying landing-page opportunity provided by the MCP.

For each result show:
- Landing page
- Sessions
- Engagement rate, if provided
- Bounce rate, if provided
- MCP score
- Reason
- Recommendation

Use the MCP score exactly as provided.
Do not recalculate the score.
Do not invent metrics.
Do not create additional opportunities.
Do not confuse landing pages with acquisition channels.

If there are no qualifying landing underperformance opportunities, state that clearly.`;

const built = tryBuildFromWorkflowItems(qaRun.items);
console.log('\n=== tryBuildFromWorkflowItems ===');
console.log(JSON.stringify({
  ok: !!built,
  keys: built ? Object.keys(built) : [],
  capabilities: built?.capabilities || built?.context?.capabilities,
}, null, 2));

const grounded = applyAiGrounding({
  systemPrompt: 'You are a GA4 analyst.',
  userPrompt: USER_PROMPT,
  input: qaRun.items,
  userInstructions: USER_PROMPT,
});

console.log('\n=== AI INPUT CHECKS (QA positive rows) ===');
const aiInputChecks = qaRun.opps.map((o, idx) => ({
  idx,
  hasCapabilitySectionMarker: !!o.__ga4CapabilitySection,
  opportunity_type: o.opportunity_type,
  scorePresent: o.score != null,
  reasonPresent: !!o.reason,
  recommendationPresent: !!o.recommendation,
  entityLabel: o.entity?.label,
}));
console.log(JSON.stringify(aiInputChecks.slice(0, 10), null, 2));

const ctx = grounded.intelligenceContext || built?.context || built;
const landingCtx =
  ctx?.capabilities?.landing_underperformance ||
  ctx?.landing_underperformance ||
  null;

console.log('\n=== IntelligenceContext ===');
console.log(JSON.stringify({
  landing_underperformance: landingCtx,
  count: landingCtx?.count,
  hasOpportunityRows: landingCtx?.hasOpportunityRows,
  resultsSample: (landingCtx?.results || landingCtx?.opportunities || []).slice(0, 3),
}, null, 2));

const systemPrompt = grounded.systemPrompt || '';
const userPrompt = grounded.userPrompt || '';
const groundedCombined = `${systemPrompt}\n\n${userPrompt}`;

console.log('\n=== Final grounded prompt contains MCP opportunity? ===');
const firstOpp = qaRun.opportunityReport[0];
const checks = firstOpp
  ? {
      landingPageInPrompt: groundedCombined.includes(String(firstOpp.entity?.label || '')),
      sessionsInPrompt:
        firstOpp.metrics?.sessions != null &&
        groundedCombined.includes(String(firstOpp.metrics.sessions)),
      scoreInPrompt:
        firstOpp.score != null && groundedCombined.includes(String(firstOpp.score)),
      reasonInPrompt: firstOpp.reason
        ? groundedCombined.includes(String(firstOpp.reason).slice(0, 40))
        : null,
      recommendationInPrompt: firstOpp.recommendation
        ? groundedCombined.includes(String(firstOpp.recommendation).slice(0, 40))
        : null,
      engagementInPrompt:
        firstOpp.metrics?.engagementRate != null
          ? groundedCombined.includes(String(firstOpp.metrics.engagementRate)) ||
            groundedCombined.toLowerCase().includes('engagement')
          : 'n/a',
      bounceInPrompt:
        firstOpp.metrics?.bounceRate != null
          ? groundedCombined.includes(String(firstOpp.metrics.bounceRate)) ||
            groundedCombined.toLowerCase().includes('bounce')
          : 'n/a',
      promptLength: groundedCombined.length,
      evidenceSnippet: groundedCombined.slice(0, 2500),
    }
  : { noOpportunities: true };

console.log(JSON.stringify(checks, null, 2));

fs.writeFileSync(
  path.join(root, '.tmp', 'step8g-landing-only-qa.json'),
  JSON.stringify(
    {
      summary: qaRun.summary,
      items: qaRun.items,
      opportunities: qaRun.opportunityReport,
      intelligenceContext: ctx,
      grounded: {
        systemPrompt,
        userPrompt,
        empty: grounded.empty,
        evidence: grounded.evidence,
      },
      upstreamStats: {
        inputRowCount: rows.length,
        validLandingRows: validLanding.length,
        sessionsDistribution: dist(sessions),
        engagementRateDistribution: dist(ers),
        bounceRateDistribution: dist(brs),
        filterEliminationDefaults: elimDefaults,
        defaultFilters: defaultLandingFilters,
      },
      defaultsSummary: defRun.summary,
    },
    null,
    2
  )
);

console.log('\nWrote .tmp/step8g-landing-only-qa.json');
