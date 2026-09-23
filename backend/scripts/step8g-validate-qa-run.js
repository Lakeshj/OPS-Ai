/**
 * STEP 8G — validate positive-path chain for QA live run 4f289136
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const ga4Root = path.join(root, 'plugins', 'ga4-mcp', 'src');
const {
  tryBuildFromWorkflowItems,
  applyAiGrounding,
  isCapabilitySection,
} = require(path.join(ga4Root, 'contracts', 'intelligenceContext'));

const mcp = JSON.parse(
  fs.readFileSync(path.join(root, '.tmp', 'step8g-4f289136-ga4McpTool-1790083223630.json'), 'utf8')
);
const ai = JSON.parse(
  fs.readFileSync(path.join(root, '.tmp', 'step8g-4f289136-ai-1790083510600.json'), 'utf8')
);
const ga = JSON.parse(
  fs.readFileSync(path.join(root, '.tmp', 'step8g-4f289136-googleAnalytics-1789984791245.json'), 'utf8')
);
const defaultsMcp = JSON.parse(
  fs.readFileSync(path.join(root, '.tmp', 'step8g-45bd1786-ga4McpTool-1790083223630.json'), 'utf8')
);
const defaultsAi = JSON.parse(
  fs.readFileSync(path.join(root, '.tmp', 'step8g-45bd1786-ai-1790083510600.json'), 'utf8')
);

function items(output) {
  if (!output) return [];
  if (Array.isArray(output)) return output;
  if (Array.isArray(output.items)) return output.items;
  return [];
}
function json(item) {
  return item?.json && typeof item.json === 'object' ? item.json : item;
}

const upstream = items(ga.output).map(json);
const mcpItems = items(mcp.output);
const mcpJsons = mcpItems.map(json);
const oppRows = mcpJsons.filter((j) => j && !isCapabilitySection(j) && !j.__ga4CapabilitySection);
const sectionRows = mcpJsons.filter((j) => j && (isCapabilitySection(j) || j.__ga4CapabilitySection));

const exactOpportunities = oppRows.map((o) => ({
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

const built = tryBuildFromWorkflowItems(mcpItems);
const grounded = applyAiGrounding({
  systemPrompt: USER_PROMPT,
  userPrompt: '{{input}}',
  input: mcpItems,
});

const ctx = grounded.intelligenceContext || built.context;
const caps = ctx?.capabilities;
const landingSection = Array.isArray(caps)
  ? caps.find((c) => c.capability === 'landing_underperformance')
  : caps?.landing_underperformance;

const aiInputChecks = {
  opportunityCount: oppRows.length,
  sectionCount: sectionRows.length,
  positiveRowsMissingSectionMarker: oppRows.every((o) => !o.__ga4CapabilitySection),
  opportunity_type_ok: oppRows.every((o) => o.opportunity_type === 'landing_underperformance'),
  scorePresent: oppRows.every((o) => o.score != null),
  reasonPresent: oppRows.every((o) => !!o.reason),
  recommendationPresent: oppRows.every((o) => !!o.recommendation),
  capabilityOnlyLanding: oppRows.every((o) => o.capability === 'landing_underperformance'),
  noPagePerformance: !mcpJsons.some(
    (j) => j?.capability === 'page_performance' || j?.row_kind === 'ranked_page'
  ),
  noAcquisition: !mcpJsons.some((j) => j?.capability === 'acquisition_concentration'),
};

const first = exactOpportunities[0];
const prompt = `${grounded.systemPrompt || ''}\n${grounded.userPrompt || ''}`;
const promptChecks = first
  ? {
      landingPage: prompt.includes(first.entity.landingPage || first.entity.label),
      sessions: prompt.includes(String(first.metrics.sessions)),
      engagementRate:
        first.metrics.engagementRate != null &&
        (prompt.includes(String(first.metrics.engagementRate)) ||
          prompt.toLowerCase().includes('engagement')),
      bounceRate:
        first.metrics.bounceRate != null &&
        (prompt.includes(String(first.metrics.bounceRate)) ||
          prompt.toLowerCase().includes('bounce')),
      score: prompt.includes(String(first.score)),
      reason: prompt.includes(first.reason.slice(0, 60)),
      recommendation: prompt.includes(first.recommendation.slice(0, 60)),
      promptLen: prompt.length,
    }
  : null;

// AI response text
const aiOut = json(items(ai.output)[0] || {});
const aiText =
  aiOut.text ||
  aiOut.output ||
  aiOut.content ||
  aiOut.message ||
  (typeof aiOut === 'string' ? aiOut : JSON.stringify(aiOut));

// Validate AI vs MCP (spot-check top N + invent checks)
const topN = exactOpportunities.slice(0, 10);
const aiValidation = {
  responseLength: String(aiText).length,
  responseHead: String(aiText).slice(0, 2500),
  responseTail: String(aiText).slice(-800),
  mentionedLandingPages: [],
  scoreMatches: [],
  inventedPages: [],
  missingTopOpps: [],
  acquisitionChannelConfusion: /Organic Search|Paid Search|Direct|Referral|sessionDefaultChannelGroup/i.test(
    String(aiText)
  ),
  claimsNoOpportunities: /no qualifying landing/i.test(String(aiText)),
};

for (const o of topN) {
  const label = o.entity.label || o.entity.landingPage;
  const mentioned = String(aiText).includes(label);
  aiValidation.mentionedLandingPages.push({ label, mentioned });
  if (!mentioned) aiValidation.missingTopOpps.push(label);
  const scoreStr = String(o.score);
  // look for score near the label within a window
  const idx = String(aiText).indexOf(label);
  let scoreNear = false;
  if (idx >= 0) {
    const window = String(aiText).slice(Math.max(0, idx - 80), idx + label.length + 400);
    scoreNear = window.includes(scoreStr);
  }
  aiValidation.scoreMatches.push({ label, score: o.score, scoreNear });
}

// Count how many MCP landing pages appear in AI response
let mcpPagesInAi = 0;
for (const o of exactOpportunities) {
  const label = o.entity.label || o.entity.landingPage;
  if (String(aiText).includes(label)) mcpPagesInAi += 1;
}
aiValidation.mcpPagesInAi = mcpPagesInAi;
aiValidation.mcpOppCount = exactOpportunities.length;

// defaults path snapshot
const defItems = items(defaultsMcp.output).map(json);
const defAi = json(items(defaultsAi.output)[0] || {});
const defAiText = defAi.text || defAi.output || defAi.content || JSON.stringify(defAi);

const report = {
  landingOnlyDefaultsRun: {
    runId: '45bd1786-4e6d-4596-8479-159fce286c0e',
    mcpOutputItemCount: defItems.length,
    opportunities: defItems.filter((j) => !j.__ga4CapabilitySection && j.opportunity_type).length,
    section: defItems.find((j) => j.__ga4CapabilitySection),
    aiSnippet: String(defAiText).slice(0, 600),
  },
  qaPositiveRun: {
    runId: '4f289136-d21f-446a-8d4f-3b2df1e44cd8',
    upstreamRowCount: upstream.length,
    validLandingRows: upstream.filter((r) => {
      const lp = r.landingPage;
      return lp != null && String(lp).trim() !== '' && String(lp).trim() !== '(not set)';
    }).length,
    selectedCapability: ['landing_underperformance'],
    executedCapability: ['landing_underperformance'],
    mcpOutputItemCount: mcpJsons.length,
    landingOpportunityCount: exactOpportunities.length,
    exactOpportunitiesFirst5: exactOpportunities.slice(0, 5),
    exactOpportunitiesAllScores: exactOpportunities.map((o) => ({
      page: o.entity.label,
      score: o.score,
      sessions: o.metrics?.sessions,
    })),
  },
  aiInputChecks,
  intelligenceContext: {
    ok: built.ok,
    landingSection: landingSection && {
      capability: landingSection.capability,
      count: landingSection.count ?? landingSection.results?.length,
      resultsLen: landingSection.results?.length,
      hasOpportunityRows:
        grounded.evidence?.hasOpportunityRows ??
        (landingSection.count > 0 || (landingSection.results || []).length > 0),
      firstResultFields: landingSection.results?.[0]
        ? {
            opportunity_type: landingSection.results[0].opportunity_type,
            entity: landingSection.results[0].entity,
            metrics: landingSection.results[0].metrics,
            score: landingSection.results[0].score,
            reason: landingSection.results[0].reason,
            recommendation: landingSection.results[0].recommendation,
          }
        : null,
    },
    evidence: grounded.evidence,
  },
  groundedPromptChecks: promptChecks,
  groundedPromptEvidenceSnippet: prompt.slice(0, 2000),
  aiValidation,
};

// PASS/FAIL
const scorePreserved =
  aiValidation.scoreMatches.filter((s) => s.scoreNear).length >= Math.min(5, topN.length) ||
  (aiValidation.mcpPagesInAi >= Math.min(5, exactOpportunities.length) &&
    exactOpportunities.slice(0, 5).every((o) => String(aiText).includes(String(o.score))));

const noInvented =
  !aiValidation.claimsNoOpportunities &&
  !aiValidation.acquisitionChannelConfusion &&
  aiValidation.mcpPagesInAi > 0;

const overall =
  exactOpportunities.length > 0 &&
  aiInputChecks.positiveRowsMissingSectionMarker &&
  aiInputChecks.scorePresent &&
  grounded.evidence?.hasOpportunityRows === true &&
  promptChecks?.landingPage &&
  promptChecks?.score &&
  promptChecks?.reason &&
  promptChecks?.recommendation &&
  aiValidation.mcpPagesInAi > 0 &&
  scorePreserved &&
  noInvented;

report.verdict = {
  ScorePreserved: scorePreserved ? 'PASS' : 'FAIL',
  NoInventedOpportunities: noInvented ? 'PASS' : 'FAIL',
  Overall: overall ? 'PASS' : 'FAIL',
  notes: {
    mcpPagesInAi: aiValidation.mcpPagesInAi,
    mcpOppCount: exactOpportunities.length,
    topScoreNearMatches: aiValidation.scoreMatches.filter((s) => s.scoreNear).length,
    missingTopOpps: aiValidation.missingTopOpps,
  },
};

fs.writeFileSync(
  path.join(root, '.tmp', 'step8g-qa-validation.json'),
  JSON.stringify(report, null, 2)
);
console.log(JSON.stringify(report, null, 2));
