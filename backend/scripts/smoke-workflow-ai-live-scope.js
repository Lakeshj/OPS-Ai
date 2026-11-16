/**
 * AI-LIVE-SCOPE — regular AI dataset scope through save/reload + finalize path.
 * Does not assume handlers.ai-only smokes prove live execution.
 */
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const {
  resolveAiContextScope,
  readAiNodeConfig,
  CONTEXT_SCOPE,
} = require("../services/workflowAiContextScope");
const { handlers, executeNode } = require("../services/workflowNodes.service");
const { normalizeNodeOutput } = require("../services/workflowProvenance.service");
const aiClients = require("../config/aiClients");
const {
  aggregateGoogleAdsPerformanceForAi,
} = require("../services/workflowGoogleAdsAiGrounding");
const { resolveAgentContextScope } = require("../services/workflowAiAgent.service");

let passed = 0;
const check = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
};

const dailyAdsRows = (n = 80) => {
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const campaignId = String(1000 + (i % 5));
    const cost = 10 + (i % 7);
    const impressions = 100 + i;
    const clicks = 1 + (i % 5);
    rows.push({
      json: {
        source: "google_ads",
        provider: "google_ads",
        reportType: "campaign_performance",
        campaignId,
        campaignName: `Campaign_${campaignId}`,
        date: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`,
        impressions,
        clicks,
        ctr: clicks / impressions,
        cost,
        costMicros: Math.round(cost * 1_000_000),
        averageCpc: cost / clicks,
        conversions: i % 3 === 0 ? 1 : 0,
        currencyCode: "INR",
        _meta: {
          provider: "google_ads",
          report: "campaign_performance",
          resource: "campaign",
        },
      },
    });
  }
  return rows;
};

async function withMockedLlm(fn) {
  const original = aiClients.getClientForProvider;
  const calls = [];
  aiClients.getClientForProvider = () => ({
    provider: "openai",
    client: {
      chat: {
        completions: {
          create: async (opts) => {
            calls.push(opts);
            const user =
              opts.messages?.find((m) => m.role === "user")?.content || "";
            const system =
              opts.messages?.find((m) => m.role === "system")?.content || "";
            // One monthly-style answer — never echo N daily tables.
            const body =
              system.includes("period") || system.includes("Campaign Performance")
                ? [
                    "| Campaign | Spend | Impressions | Clicks | CTR | CPC | Conv |",
                    "|---|---|---|---|---|---|---|",
                    "| Campaign_1000 | 100 | 1000 | 50 | 5% | 2 | 3 |",
                    "",
                    "Summary: October period totals by campaign.",
                  ].join("\n")
                : `echo:${String(user).slice(0, 80)}`;
            return {
              choices: [
                {
                  message: { content: body },
                  finish_reason: "stop",
                },
              ],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            };
          },
        },
      },
    },
  });
  try {
    return await fn(calls);
  } finally {
    aiClients.getClientForProvider = original;
  }
}

const roundTripDefinition = (definition) =>
  JSON.parse(JSON.stringify(definition));

const finalizeAi = (node, inputItems, result) =>
  normalizeNodeOutput(node, inputItems, result.items || []);

async function main() {
  console.log("\nAI Live Context Scope — save/reload + runtime");

  await check(
    "AI-LIVE-SCOPE-1 save/reload regular AI with dataset scope preserves dataset value",
    () => {
      const definition = {
        version: 1,
        nodes: [
          {
            id: "ai1",
            type: "ai",
            position: { x: 0, y: 0 },
            data: {
              label: "AI",
              nodeType: "ai",
              contextScope: "dataset",
              provider: "openai",
              model: "gpt-4o-mini",
              prompt: "Analyze last month",
              systemPrompt: "Be brief",
            },
          },
        ],
        edges: [],
      };
      const reloaded = roundTripDefinition(definition);
      const node = reloaded.nodes[0];
      assert.equal(node.data.contextScope, "dataset");
      assert.equal(resolveAiContextScope(node), CONTEXT_SCOPE.DATASET);
      assert.equal(resolveAiContextScope(node.data), CONTEXT_SCOPE.DATASET);
      assert.equal(readAiNodeConfig(node).contextScope, "dataset");

      // Nested / alias shapes that can appear after editors or imports.
      assert.equal(
        resolveAiContextScope({
          data: { parameters: { contextScope: "dataset" } },
        }),
        "dataset"
      );
      assert.equal(
        resolveAiContextScope({ contextScope: "Entire Dataset" }),
        "dataset"
      );
    }
  );

  await check(
    "AI-LIVE-SCOPE-2 3 incoming items + dataset = exactly 1 LLM call",
    async () => {
      await withMockedLlm(async (calls) => {
        const node = {
          id: "ai1",
          type: "ai",
          data: {
            contextScope: "dataset",
            provider: "openai",
            model: "gpt-4o-mini",
            prompt: "Summarize",
            systemPrompt: "ok",
          },
        };
        const inputItems = [
          { json: { n: 1 } },
          { json: { n: 2 } },
          { json: { n: 3 } },
        ];
        const result = await executeNode(node, {
          input: {},
          steps: {},
          items: {},
          inputItems,
        });
        assert.equal(calls.length, 1);
        assert.equal(result.resolved.llmCallCount, 1);
        assert.equal(result.resolved.contextScope, "dataset");
      });
    }
  );

  await check(
    "AI-LIVE-SCOPE-3 3 incoming items + dataset = exactly 1 output item",
    async () => {
      await withMockedLlm(async () => {
        const node = {
          id: "ai1",
          type: "ai",
          data: {
            contextScope: "dataset",
            provider: "openai",
            model: "gpt-4o-mini",
            prompt: "Summarize",
            systemPrompt: "ok",
          },
        };
        const inputItems = [
          { json: { n: 1 } },
          { json: { n: 2 } },
          { json: { n: 3 } },
        ];
        const result = await executeNode(node, {
          input: {},
          steps: {},
          items: {},
          inputItems,
        });
        const finalized = finalizeAi(node, inputItems, result);
        assert.equal(result.items.length, 1);
        assert.equal(finalized.length, 1);
      });
    }
  );

  await check(
    "AI-LIVE-SCOPE-4 3 incoming items + item scope = 3 LLM calls",
    async () => {
      await withMockedLlm(async (calls) => {
        const node = {
          id: "ai1",
          type: "ai",
          data: {
            contextScope: "item",
            provider: "openai",
            model: "gpt-4o-mini",
            prompt: "{{input.n}}",
            systemPrompt: "ok",
          },
        };
        const inputItems = [
          { json: { n: 1 } },
          { json: { n: 2 } },
          { json: { n: 3 } },
        ];
        const result = await executeNode(node, {
          input: {},
          steps: {},
          items: {},
          inputItems,
        });
        assert.equal(calls.length, 3);
        assert.equal(result.items.length, 3);
        assert.equal(result.resolved.llmCallCount, 3);
        assert.equal(result.resolved.contextScope, "item");
      });
    }
  );

  await check(
    "AI-LIVE-SCOPE-5 Google Ads daily dataset produces one monthly response",
    async () => {
      const rows = dailyAdsRows(80);
      const aggregated = aggregateGoogleAdsPerformanceForAi(
        rows.map((r) => r.json)
      );
      assert.ok(aggregated.length <= 5);
      assert.ok(aggregated.every((r) => r._aiAggregation === "period"));

      await withMockedLlm(async (calls) => {
        const node = {
          id: "ai-ads",
          type: "ai",
          data: {
            contextScope: "dataset",
            provider: "openai",
            model: "gpt-4o-mini",
            prompt: "Analyze last month's campaign performance",
            systemPrompt: "Use evidence totals only",
          },
        };
        // Simulate save/reload before execute.
        const reloaded = roundTripDefinition({
          nodes: [node],
        }).nodes[0];
        assert.equal(resolveAiContextScope(reloaded), "dataset");

        const result = await executeNode(reloaded, {
          input: {},
          steps: {},
          items: {},
          inputItems: rows,
        });
        const finalized = finalizeAi(reloaded, rows, result);
        assert.equal(calls.length, 1);
        assert.equal(result.items.length, 1);
        assert.equal(finalized.length, 1);
        const system = String(
          calls[0].messages.find((m) => m.role === "system")?.content || ""
        );
        const user = String(
          calls[0].messages.find((m) => m.role === "user")?.content || ""
        );
        assert.match(system, /period totals|Campaign Performance/i);
        assert.equal(user.includes("## Workflow runtime data"), false);
        assert.equal(
          result.output?.promptsUsed?.runtimeDataAttached ??
            result.items[0].json?.promptsUsed?.runtimeDataAttached,
          false
        );
        assert.equal(
          result.output?.promptsUsed?.mcpGroundingSource ||
            result.items[0].json?.promptsUsed?.mcpGroundingSource,
          "google_ads"
        );
      });
    }
  );

  await check(
    "AI-LIVE-SCOPE-6 dataset response contains one table/summary, not repeated outputs",
    async () => {
      await withMockedLlm(async (calls) => {
        const node = {
          id: "ai-ads",
          type: "ai",
          data: {
            contextScope: "dataset",
            provider: "openai",
            model: "gpt-4o-mini",
            prompt: "Analyze last month's campaign performance",
            systemPrompt: "One monthly table and one summary",
          },
        };
        const rows = dailyAdsRows(80);
        const result = await handlers.ai(node, {
          input: {},
          steps: {},
          items: {},
          inputItems: rows,
        });
        assert.equal(calls.length, 1);
        assert.equal(result.items.length, 1);
        const text = String(
          result.items[0].json?.text || result.output?.text || ""
        );
        const tableHeaderMatches = text.match(/\| Campaign \|/g) || [];
        const summaryMatches = text.match(/Summary:/gi) || [];
        assert.equal(tableHeaderMatches.length, 1);
        assert.equal(summaryMatches.length, 1);
        // Must not stitch 80 per-item answers.
        assert.equal((text.match(/echo:/g) || []).length, 0);
      });

      // Agent scope unchanged + schema still present.
      assert.equal(resolveAgentContextScope({}), "item");
      assert.equal(
        resolveAgentContextScope({ contextScope: "dataset" }),
        "dataset"
      );
      const schema = fs.readFileSync(
        path.join(
          __dirname,
          "../../frontend/src/modules/workflows/nodeParameterSchemas.ts"
        ),
        "utf8"
      );
      assert.match(schema, /ai:\s*\[[\s\S]*?name: "contextScope"/);
      assert.match(schema, /aiAgent:\s*\[[\s\S]*?name: "contextScope"/);
      assert.match(
        schema,
        /description: "Run once for each incoming item"/
      );
      assert.match(
        schema,
        /description: "Analyze all incoming items together once"/
      );

      // Legacy AI nodes without contextScope stay Per Item.
      assert.equal(resolveAiContextScope({ prompt: "{{input}}" }), "item");
    }
  );

  console.log(`\n${passed} AI-LIVE-SCOPE checks passed`);
  process.exit(process.exitCode || 0);
}

void main();
