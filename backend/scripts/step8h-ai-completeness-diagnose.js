/**
 * STEP 8H — AI response completeness diagnosis (QA only, no production writes).
 * Replays MCP→grounding→OpenAI with the same runtime config as workflow AI node.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const ga4Root = path.join(root, 'plugins', 'ga4-mcp', 'src');
const { processUpstreamItems } = require(path.join(ga4Root, 'adapters', 'processUpstream'));
const { applyAiGrounding } = require(path.join(ga4Root, 'contracts', 'intelligenceContext'));
const { getClientForProvider } = require('../config/aiClients');
const { withGenerationOptions } = require('../utils/openaiCompletionOptions');

const VERBOSE_PROMPT = `Analyze the structured GA4 MCP landing underperformance opportunities.

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

const CONCISE_PROMPT = `Report every qualifying landing-page opportunity provided by the MCP.

For each result show only:
- Landing page
- Sessions
- Engagement rate
- Bounce rate
- MCP score

Use MCP values exactly as provided.
Do not invent or recalculate anything.

Report all qualifying opportunities.`;

// Exact workflow AI node defaults (workflowNodes.service.js runLlmNode)
const MODEL = 'gpt-4o-mini'; // data.model undefined → withGenerationOptions(model || "gpt-4o-mini")
const PROVIDER = 'openai';
const MAX_TOKENS = 1200; // data.maxTokens ?? 1200
const TEMPERATURE = 0.4; // data.temperature ?? 0.4

const upstreamPath = path.join(root, '.tmp', 'step8g-4f289136-googleAnalytics-1789984791245.json');
const upstreamDump = JSON.parse(fs.readFileSync(upstreamPath, 'utf8'));
const upstreamItems = Array.isArray(upstreamDump.output)
  ? upstreamDump.output
  : upstreamDump.output?.items || [];

function countReported(text) {
  const t = String(text || '');
  const pages = [...t.matchAll(/\*\*Landing Page:\*\*\s*(\S+)/g)].map((m) => m[1]);
  // also match concise "Landing page:" variants
  const pages2 = [...t.matchAll(/(?:^|\n)\s*(?:\d+\.\s*)?(?:\*\*)?Landing [Pp]age(?:\*\*)?[:\s]+(\S+)/g)].map(
    (m) => m[1].replace(/\*+/g, '')
  );
  const set = new Set([...pages, ...pages2].filter(Boolean));
  return { count: set.size || pages.length || pages2.length, pages: [...set] };
}

function endsTruncated(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  // ends mid-field or without terminal punctuation/list close
  if (/Engagement Rate:\*\*\s*[\d.]+%?\s*$/i.test(t)) return true;
  if (/MCP Score:\*\*\s*$/i.test(t)) return true;
  if (/:\s*$/.test(t)) return true;
  if (!/[.!?)\]]\s*$/.test(t) && t.length > 200) {
    // incomplete last line without sentence end
    const lastLine = t.split('\n').pop() || '';
    if (lastLine.length > 0 && !/[.!?]$/.test(lastLine.trim()) && /\d+\.\s+\*\*/.test(t)) {
      // numbered list that may be incomplete
      return !/\*\*Recommendation:\*\*/i.test(lastLine) && !/MCP [Ss]core/i.test(lastLine.slice(-40));
    }
  }
  return false;
}

function runMcp(limit) {
  return processUpstreamItems({
    capabilities: ['landing_underperformance'],
    inputItems: upstreamItems,
    nodeData: {
      capabilities: ['landing_underperformance'],
      capability: 'landing_underperformance',
      capabilitySettings: {
        landing_underperformance: {
          minSessions: 0,
          maxEngagementRate: 1,
          minBounceRate: 0,
          minScore: 0,
          limit,
        },
      },
    },
  });
}

async function callAi({ systemUserInstructions, mcpItems, label }) {
  const grounded = applyAiGrounding({
    systemPrompt: systemUserInstructions,
    userPrompt: '{{input}}',
    input: mcpItems,
  });

  const oppCount = (mcpItems || []).filter((i) => {
    const j = i.json || i;
    return j && !j.__ga4CapabilitySection && j.opportunity_type;
  }).length;

  const { client } = getClientForProvider(PROVIDER, MODEL);
  const generationOptions = withGenerationOptions(MODEL, {
    messages: [
      { role: 'system', content: grounded.systemPrompt },
      { role: 'user', content: String(grounded.userPrompt) },
    ],
    temperature: TEMPERATURE,
    maxTokens: MAX_TOKENS,
  });

  const completion = await client.chat.completions.create(generationOptions);
  const choice = completion.choices?.[0] || {};
  const text = choice.message?.content || '';
  const reported = countReported(text);
  const truncatedHeuristic = endsTruncated(text);
  const finishReason = choice.finish_reason || null;

  return {
    label,
    mcpOpportunityCount: oppCount,
    aiInputOpportunityCount: oppCount,
    groundedEvidenceOpportunityRowCount: grounded.evidence?.opportunityRowCount,
    groundedHasOpportunityRows: grounded.evidence?.hasOpportunityRows,
    groundedSystemPromptChars: String(grounded.systemPrompt || '').length,
    groundedUserPromptChars: String(grounded.userPrompt || '').length,
    groundedTotalPromptChars:
      String(grounded.systemPrompt || '').length + String(grounded.userPrompt || '').length,
    generationRequest: {
      model: generationOptions.model,
      max_tokens: generationOptions.max_tokens ?? null,
      max_completion_tokens: generationOptions.max_completion_tokens ?? null,
      temperature: generationOptions.temperature ?? null,
    },
    finish_reason: finishReason,
    usage: completion.usage || null,
    responseChars: text.length,
    responseApproxTokens: Math.ceil(text.length / 4),
    aiReportedCount: reported.count,
    aiReportedPages: reported.pages,
    truncatedHeuristic,
    endsNaturally: finishReason === 'stop' && !truncatedHeuristic,
    responseHead: text.slice(0, 600),
    responseTail: text.slice(-400),
    fullText: text,
  };
}

function sizeEstimates(verbose50Text, verbose50Count) {
  const n = Math.max(1, verbose50Count || 10);
  const avgChars = Math.round(String(verbose50Text || '').length / n);
  return {
    measuredFromVerbosePartialResponse: {
      responseChars: String(verbose50Text || '').length,
      reportedItems: n,
      avgCharsPerOpportunity: avgChars,
      avgApproxTokensPerOpportunity: Math.ceil(avgChars / 4),
      estCharsFor10: avgChars * 10,
      estCharsFor50: avgChars * 50,
      estApproxTokensFor10: Math.ceil((avgChars * 10) / 4),
      estApproxTokensFor50: Math.ceil((avgChars * 50) / 4),
      configuredMaxTokens: MAX_TOKENS,
      canFit50AtThisVerbosity: Math.ceil((avgChars * 50) / 4) <= MAX_TOKENS,
    },
  };
}

(async () => {
  const outDir = path.join(root, '.tmp');
  const results = {
    config: {
      source: 'backend/services/workflowNodes.service.js runLlmNode',
      provider: PROVIDER,
      model: MODEL,
      modelSource: 'AI node data.model unset → withGenerationOptions(model || "gpt-4o-mini")',
      maxTokens: MAX_TOKENS,
      maxTokensSource: 'data.maxTokens ?? 1200 (AI node has no maxTokens field)',
      temperature: TEMPERATURE,
      temperatureSource: 'data.temperature ?? 0.4',
      apiParam: 'max_tokens (gpt-4o-mini uses legacy max_tokens via withGenerationOptions)',
      finishReasonStoredInWorkflowOutput: false,
      finishReasonNote:
        'runLlmNode reads completion.choices[0].message.content only; finish_reason and usage are discarded from workflow step output',
      workflowSpecificResultLimit: 'none found on AI node / runLlmNode beyond maxTokens',
      contextWindow: 'not configured in workflow; model gpt-4o-mini has 128k context (vendor docs, not read from code)',
    },
    matrix: [],
    concise50: null,
    sizeEstimates: null,
  };

  const limits = [5, 10, 20, 50];
  for (const limit of limits) {
    console.log('RUN limit=', limit);
    const mcp = runMcp(limit);
    const items = mcp.items || [];
    const row = await callAi({
      systemUserInstructions: VERBOSE_PROMPT,
      mcpItems: items,
      label: `verbose-limit-${limit}`,
    });
    results.matrix.push(row);
    console.log(
      JSON.stringify(
        {
          limit,
          mcp: row.mcpOpportunityCount,
          aiIn: row.aiInputOpportunityCount,
          aiOut: row.aiReportedCount,
          finish_reason: row.finish_reason,
          chars: row.responseChars,
          usage: row.usage,
          truncatedHeuristic: row.truncatedHeuristic,
        },
        null,
        2
      )
    );
  }

  const r50 = results.matrix.find((r) => r.label === 'verbose-limit-50');
  if (r50) {
    results.sizeEstimates = sizeEstimates(r50.fullText, r50.aiReportedCount || 10);
  }

  console.log('RUN concise limit=50');
  const mcp50 = runMcp(50);
  results.concise50 = await callAi({
    systemUserInstructions: CONCISE_PROMPT,
    mcpItems: mcp50.items || [],
    label: 'concise-limit-50',
  });
  console.log(
    JSON.stringify(
      {
        mcp: results.concise50.mcpOpportunityCount,
        aiOut: results.concise50.aiReportedCount,
        finish_reason: results.concise50.finish_reason,
        chars: results.concise50.responseChars,
        usage: results.concise50.usage,
        truncatedHeuristic: results.concise50.truncatedHeuristic,
      },
      null,
      2
    )
  );

  // Strip fullText from matrix for smaller meta file; keep in separate files
  for (const row of results.matrix) {
    fs.writeFileSync(
      path.join(outDir, `step8h-${row.label}.txt`),
      row.fullText || ''
    );
    delete row.fullText;
    delete row.aiReportedPages;
  }
  fs.writeFileSync(
    path.join(outDir, 'step8h-concise-limit-50.txt'),
    results.concise50.fullText || ''
  );
  delete results.concise50.fullText;
  delete results.concise50.aiReportedPages;

  // Reproduce 8G artifact measurements
  const priorAi = JSON.parse(
    fs.readFileSync(path.join(outDir, 'step8g-4f289136-ai-1790083510600.json'), 'utf8')
  );
  const priorItems = Array.isArray(priorAi.output) ? priorAi.output : priorAi.output?.items || [];
  const priorText = (priorItems[0]?.json || priorItems[0] || {}).text || '';
  const priorReported = countReported(priorText);
  results.prior8gLiveRun = {
    runId: '4f289136-d21f-446a-8d4f-3b2df1e44cd8',
    mcpOpportunityCount: 50,
    aiInputOpportunityCount: 50,
    aiReportedCount: priorReported.count,
    responseChars: priorText.length,
    truncatedHeuristic: endsTruncated(priorText),
    finish_reason: 'NOT STORED in workflow AI step output',
    model: (priorItems[0]?.json || priorItems[0] || {}).model,
  };

  // Classification
  const verbose50 = results.matrix.find((r) => r.label === 'verbose-limit-50');
  const allPresentInPrompt =
    verbose50 &&
    verbose50.mcpOpportunityCount === 50 &&
    verbose50.aiInputOpportunityCount === 50 &&
    verbose50.groundedEvidenceOpportunityRowCount === 50;

  results.classification = {
    inputOrOutput:
      allPresentInPrompt && verbose50.aiReportedCount < 50 ? 'OUTPUT-side' : 'investigate',
    boundary:
      allPresentInPrompt &&
      (verbose50.finish_reason === 'length' ||
        results.concise50?.finish_reason === 'length' ||
        (verbose50.finish_reason === 'length' && verbose50.aiReportedCount < 50))
        ? 'BOUNDARY_E — AI GENERATION OUTPUT LIMIT'
        : verbose50?.finish_reason === 'length'
          ? 'BOUNDARY_E — AI GENERATION OUTPUT LIMIT'
          : `finish_reason=${verbose50?.finish_reason}`,
    productionCodeChangeRequired:
      allPresentInPrompt && verbose50.finish_reason === 'length' ? 'YES (config/runtime only — not MCP)' : 'TBD',
  };

  if (verbose50?.finish_reason === 'length') {
    results.classification.boundary = 'BOUNDARY_E — AI GENERATION OUTPUT LIMIT';
    results.classification.rootCause =
      'Workflow AI node default maxTokens=1200 (max_tokens) exhausted; API finish_reason=length. All 50 opportunities are in the grounded prompt.';
    results.classification.productionCodeChangeRequired =
      'YES — raise AI node maxTokens / expose finish_reason (not MCP changes)';
  }

  fs.writeFileSync(path.join(outDir, 'step8h-diagnosis.json'), JSON.stringify(results, null, 2));
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(results, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
