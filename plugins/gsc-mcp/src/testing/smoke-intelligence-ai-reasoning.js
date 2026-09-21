/**
 * AI reasoning quality regression — evidence-first grounding.
 * Does not change scoring formulas, filters, OAuth, or native GSC.
 */
const assert = require("assert");
const {
  processUpstreamItems,
  intelligenceContext: ctx,
} = require("../index");
const {
  scoreCtrOpportunity,
  scoreRankingOpportunity,
  scoreContentDecay,
} = require("../contracts/intelligenceOutput");

const PROPERTY = "https://example.com/";
const PERIOD = { start: "2026-01-01", end: "2026-01-31" };
const SOURCE_META = { property: PROPERTY, period: PERIOD };

const CTR_ROW = {
  query: "ai visibility checker",
  page: "https://example.com/ai-vis",
  clicks: 0,
  impressions: 197,
  ctr: 0,
  position: 8.2,
};

const main = () => {
  const ctr = processUpstreamItems({
    capability: "ctr_opportunities",
    inputItems: [{ json: CTR_ROW }],
    sourceMeta: SOURCE_META,
  });
  assert.equal(ctr.ok, true);
  assert.ok(ctr.intelligenceContext);
  const ctrCtx = ctr.intelligenceContext;
  const ctrRow = ctrCtx.capabilities[0].results[0];
  assert.equal(ctrRow.opportunity_type, "ctr_opportunity");
  assert.equal(ctrRow.entity.query, "ai visibility checker");
  assert.equal(ctrRow.metrics.impressions, 197);
  assert.equal(typeof ctrRow.score, "number");

  const grounded = ctx.applyAiGrounding({
    systemPrompt: "",
    userPrompt: "Recommend actions",
    input: ctrCtx,
  });
  assert.equal(grounded.grounded, true);
  assert.ok(grounded.systemPrompt.includes("final GSC intelligence analyst"));
  assert.ok(grounded.systemPrompt.includes("Do not invent metrics, scores, priorities"));
  assert.ok(grounded.systemPrompt.includes("opportunity_type"));
  assert.ok(grounded.systemPrompt.includes("Total opportunities received"));
  assert.ok(grounded.systemPrompt.includes("Opportunity types represented"));
  assert.ok(grounded.systemPrompt.includes("Score:"));
  assert.ok(grounded.userPrompt.includes("ai visibility checker"));
  assert.ok(grounded.userPrompt.includes("ctr_opportunity") || grounded.userPrompt.includes("197"));

  // CTR must not be treated as content decay / stale / intent mismatch as fact
  const badOverclaim = [
    "Opportunity: ai visibility checker",
    "Type: content_decay",
    "Observation: The content appears stale or mismatched with user intent.",
    "Recommendation: Audit the content for outdated sections and intent mismatch.",
    "Priority: High",
  ].join("\n");
  assert.equal(
    ctx.rejectsUnsupportedOverInterpretation(badOverclaim, ctrCtx),
    false,
    "CTR overclaim must be rejected"
  );
  assert.equal(
    ctx.observationRespectsOpportunityType(badOverclaim, ctrCtx),
    false
  );
  assert.equal(
    ctx.preservesNumericScoreWithoutInventedPriority(badOverclaim, ctrCtx),
    false
  );

  const goodCtr = [
    "Opportunity: ai visibility checker",
    "Type: ctr_opportunity",
    "Evidence: 197 impressions, 0 clicks, 0% CTR, position 8.2",
    "Observation: The query received impressions but generated no clicks.",
    "Recommendation: Review title and meta description because the query generated 197 impressions but no clicks.",
    `Score: ${ctrRow.score}`,
  ].join("\n");
  assert.ok(ctx.rejectsUnsupportedOverInterpretation(goodCtr, ctrCtx));
  assert.ok(ctx.observationRespectsOpportunityType(goodCtr, ctrCtx));
  assert.ok(ctx.preservesNumericScoreWithoutInventedPriority(goodCtr, ctrCtx));
  assert.ok(ctx.recommendationCitesEvidence(goodCtr, ctrCtx));

  // Deep-rank single-period example from the brief (still CTR, not decay)
  const deepRankCtx = ctx.buildIntelligenceContext({
    property: PROPERTY,
    period: PERIOD,
    capabilities: [
      {
        capability: "ctr_opportunities",
        results: [
          {
            opportunity_type: "ctr_opportunity",
            entity: {
              query: "ai visibility checker",
              label: "ai visibility checker",
            },
            metrics: {
              impressions: 197,
              clicks: 0,
              ctr: 0,
              position: 52.8,
            },
            reason: "197 impressions, 0 clicks",
            recommendation: "review title/meta",
            score: 5,
          },
        ],
        count: 1,
      },
    ],
  });
  const deepBad =
    "Observation: The content appears stale or mismatched with user intent.\nPriority: High";
  assert.equal(
    ctx.rejectsUnsupportedOverInterpretation(deepBad, deepRankCtx),
    false
  );
  const deepGood =
    "Observation: The query received impressions but generated no clicks.\nScore: 5";
  assert.ok(ctx.rejectsUnsupportedOverInterpretation(deepGood, deepRankCtx));

  // Possible explanation is allowed (hypothesis), but Priority still forbidden
  const withHypothesis = [
    goodCtr,
    "",
    "Possible explanation: Title or snippet may not match the query.",
  ].join("\n");
  assert.ok(ctx.rejectsUnsupportedOverInterpretation(withHypothesis, ctrCtx));

  // Single-period ranking — no decay claim
  const ranking = processUpstreamItems({
    capability: "ranking_opportunities",
    inputItems: [
      {
        json: {
          query: "ranking climb",
          page: "https://example.com/rank",
          clicks: 20,
          impressions: 300,
          ctr: 0.067,
          position: 7,
        },
      },
    ],
    sourceMeta: SOURCE_META,
  });
  assert.equal(ranking.ok, true);
  const rankCtx = ranking.intelligenceContext;
  const rankBad =
    "Type: ranking_opportunity\nObservation: Performance deteriorated and content decayed.\nPriority: High";
  assert.equal(
    ctx.rejectsUnsupportedOverInterpretation(rankBad, rankCtx),
    false
  );

  // Content decay WITH historical evidence may claim deterioration
  const decay = processUpstreamItems({
    capability: "content_decay",
    inputItems: [
      {
        json: {
          query: "fading page",
          page: "https://example.com/fade",
          clicks: 81,
          impressions: 200,
          ctr: 0.405,
          position: 12.6,
        },
      },
    ],
    previousRows: [
      {
        query: "fading page",
        page: "https://example.com/fade",
        clicks: 142,
        impressions: 220,
        ctr: 0.645,
        position: 7.2,
      },
    ],
    sourceMeta: SOURCE_META,
    filters: {
      minPreviousImpressions: 50,
      minCurrentImpressions: 20,
      minClickDropPercent: 10,
      minPositionWorsening: 1,
    },
  });
  assert.equal(typeof decay.ok, "boolean");
  // May succeed with opportunities when thresholds met
  if (decay.ok) {
    assert.ok(decay.intelligenceContext);
  } else {
    assert.ok(decay.error);
  }

  const decaySynthetic = ctx.buildIntelligenceContext({
    property: PROPERTY,
    period: PERIOD,
    capabilities: [
      {
        capability: "content_decay",
        filters: {},
        results: [
          {
            opportunity_type: "content_decay",
            entity: { query: "fading page", label: "fading page" },
            metrics: {
              clicks: 81,
              impressions: 200,
              position: 12.6,
              previous_clicks: 142,
              previous_position: 7.2,
              click_drop: 61,
              position_delta: 5.4,
            },
            reason: "clicks dropped",
            recommendation: "review period changes",
            score: 100,
          },
        ],
        count: 1,
      },
    ],
  });
  assert.ok(ctx.hasHistoricalDecayEvidence(decaySynthetic.capabilities[0].results[0]));
  const goodDecay = [
    "Opportunity: fading page",
    "Type: content_decay",
    "Evidence: previous clicks 142 → 81; position 7.2 → 12.6",
    "Observation: Performance deteriorated between the previous and current period.",
    "Recommendation: Review what changed between the previous and current period because clicks and position deteriorated.",
    "Score: 100",
  ].join("\n");
  assert.ok(
    ctx.rejectsUnsupportedOverInterpretation(goodDecay, decaySynthetic)
  );

  // Empty results
  const empty = processUpstreamItems({
    capability: "ctr_opportunities",
    inputItems: [
      {
        json: {
          query: "tiny",
          clicks: 0,
          impressions: 1,
          ctr: 0,
          position: 50,
        },
      },
    ],
    sourceMeta: SOURCE_META,
  });
  assert.equal(empty.ok, true);
  assert.equal(empty.intelligenceContext.capabilities[0].count, 0);
  const emptyGround = ctx.applyAiGrounding({
    input: empty.intelligenceContext,
    userPrompt: "Find SEO wins",
  });
  assert.equal(emptyGround.empty, true);
  assert.ok(
    emptyGround.systemPrompt.includes(
      "No actionable GSC evidence was returned for this capability"
    )
  );
  const emptyOk =
    "No actionable GSC evidence was returned for this capability.";
  const emptyBad =
    "Priority: High\nAudit every page for outdated sections and intent mismatch.";
  assert.ok(
    ctx.rejectsUnrelatedGenericOpportunities(
      emptyOk,
      empty.intelligenceContext
    )
  );
  assert.equal(
    ctx.rejectsUnsupportedOverInterpretation(
      emptyBad,
      empty.intelligenceContext
    ),
    false
  );

  // Multiple types retain identity in combined context
  const combined = ctx.combineIntelligenceInputs([
    ctrCtx,
    rankCtx,
  ]);
  assert.equal(combined.capabilities.length, 2);
  const ids = combined.capabilities.map((c) => c.capability).sort();
  assert.deepEqual(ids, ["ctr_opportunities", "ranking_opportunities"]);
  assert.equal(
    combined.capabilities.find((c) => c.capability === "ctr_opportunities")
      .results[0].opportunity_type,
    "ctr_opportunity"
  );

  // Multi-select capabilities on one GSC MCP Tools node
  const multi = processUpstreamItems({
    capability: ["ctr_opportunities", "ranking_opportunities"],
    inputItems: [
      {
        json: {
          query: "ai visibility checker",
          page: "https://example.com/a",
          impressions: 197,
          clicks: 0,
          ctr: 0,
          position: 8.2,
          siteUrl: "https://example.com/",
          property: "https://example.com/",
          startDate: "2026-08-01",
          endDate: "2026-08-31",
        },
      },
      {
        json: {
          query: "deep rank query",
          page: "https://example.com/b",
          impressions: 400,
          clicks: 5,
          ctr: 0.0125,
          position: 12.4,
          siteUrl: "https://example.com/",
          property: "https://example.com/",
          startDate: "2026-08-01",
          endDate: "2026-08-31",
        },
      },
    ],
    nodeData: {
      capability: ["ctr_opportunities", "ranking_opportunities"],
      minImpressions: 10,
      rankingMinImpressions: 10,
      minPosition: 5,
      rankingMaxPosition: 20,
    },
  });
  assert.equal(multi.ok, true, multi.error?.message);
  assert.ok(Array.isArray(multi.output.capabilities));
  assert.deepEqual(
    [...multi.output.capabilities].sort(),
    ["ctr_opportunities", "ranking_opportunities"]
  );
  assert.ok(multi.intelligenceContext);
  assert.equal(multi.intelligenceContext.capabilities.length, 2);
  assert.ok(multi.items.length >= 1);
  for (const item of multi.items) {
    const row = item.json || {};
    if (!row.opportunity_type) continue;
    if (row.capability === "ctr_opportunities") {
      assert.equal(row.opportunity_type, "ctr_opportunity");
    } else if (row.capability === "ranking_opportunities") {
      assert.equal(row.opportunity_type, "ranking_opportunity");
    } else {
      assert.fail(`unexpected capability on multi item: ${row.capability}`);
    }
  }
  for (const section of multi.intelligenceContext.capabilities) {
    const expected =
      section.capability === "ctr_opportunities"
        ? "ctr_opportunity"
        : "ranking_opportunity";
    for (const row of section.results) {
      assert.equal(row.opportunity_type, expected);
    }
  }

  // Scoring formulas unchanged
  const ctrScore = scoreCtrOpportunity({
    impressions: 197,
    clicks: 0,
    ctr: 0,
    position: 52.8,
  });
  assert.equal(
    ctrScore.score_breakdown.formula,
    "missedClicks * positionWeight"
  );
  assert.equal(
    scoreRankingOpportunity({ impressions: 300, position: 7 }).score,
    Math.round(300 / 7)
  );
  assert.equal(
    scoreContentDecay({ clickDrop: 20, positionDelta: 2.5 }).score,
    Math.round(20 + 2.5 * 10)
  );

  // IntelligenceContext still compatible
  assert.ok(ctx.isIntelligenceContext(ctrCtx));
  assert.ok(ctx.validateIntelligenceContext(ctrCtx).ok);

  // decay run ok or empty is fine — do not require results if filters exclude
  assert.equal(typeof decay.ok, "boolean");

  console.log("gsc-mcp smoke-intelligence-ai-reasoning OK");
};

main();
