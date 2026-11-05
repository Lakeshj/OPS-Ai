/**
 * Regular AI node Context Scope (Per Item / Entire Dataset) — AI-SCOPE-1..6
 */
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const {
  resolveAiContextScope,
  CONTEXT_SCOPE,
} = require("../services/workflowAiContextScope");
const { handlers } = require("../services/workflowNodes.service");
const aiClients = require("../config/aiClients");
const {
  aggregateGoogleAdsPerformanceForAi,
  applyGoogleAdsAiGrounding,
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
            const user = opts.messages?.find((m) => m.role === "user")?.content || "";
            const system =
              opts.messages?.find((m) => m.role === "system")?.content || "";
            return {
              choices: [
                {
                  message: {
                    content: `echo:${String(user).slice(0, 80)}`,
                  },
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

async function main() {
  console.log("\nAI Context Scope — regular AI node");

  await check("AI-SCOPE-1 regular AI defaults to Per Item", () => {
    assert.equal(resolveAiContextScope({}), CONTEXT_SCOPE.ITEM);
    assert.equal(resolveAiContextScope({}), "item");
    assert.equal(resolveAiContextScope({ contextScope: "dataset" }), "dataset");
    const schema = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/modules/workflows/nodeParameterSchemas.ts"
      ),
      "utf8"
    );
    assert.match(schema, /ai:\s*\[[\s\S]*?name: "contextScope"/);
    assert.match(schema, /displayName: "Context Scope"/);
    assert.match(schema, /name: "Per Item"[\s\S]*value: "item"/);
    assert.match(schema, /name: "Entire Dataset"[\s\S]*value: "dataset"/);
  });

  await check("AI-SCOPE-2 regular AI Per Item preserves existing behavior", async () => {
    await withMockedLlm(async (calls) => {
      const result = await handlers.ai(
        {
          id: "ai1",
          type: "ai",
          data: {
            contextScope: "item",
            provider: "openai",
            model: "gpt-4o-mini",
            prompt: "{{input.question}}",
            systemPrompt: "Answer briefly",
          },
        },
        {
          input: { question: "q1" },
          steps: {},
          items: {},
          inputItems: [
            { json: { question: "q1" } },
            { json: { question: "q2" } },
            { json: { question: "q3" } },
          ],
        }
      );
      assert.equal(calls.length, 3);
      assert.equal(result.items.length, 3);
      assert.equal(result.resolved.contextScope, "item");
      assert.equal(result.items[0].pairedItem.item, 0);
      assert.equal(result.items[2].pairedItem.item, 2);
      assert.match(String(calls[0].messages.find((m) => m.role === "user").content), /q1/);
      assert.match(String(calls[1].messages.find((m) => m.role === "user").content), /q2/);
      assert.match(String(calls[2].messages.find((m) => m.role === "user").content), /q3/);
    });
  });

  await check("AI-SCOPE-3 regular AI Entire Dataset runs once for many input items", async () => {
    await withMockedLlm(async (calls) => {
      const result = await handlers.ai(
        {
          id: "ai1",
          type: "ai",
          data: {
            contextScope: "dataset",
            provider: "openai",
            model: "gpt-4o-mini",
            prompt: "Summarize all rows",
            systemPrompt: "Be brief",
          },
        },
        {
          input: {},
          steps: {},
          items: {},
          inputItems: [
            { json: { n: 1 } },
            { json: { n: 2 } },
            { json: { n: 3 } },
            { json: { n: 4 } },
          ],
        }
      );
      assert.equal(calls.length, 1);
      assert.equal(result.items.length, 1);
      assert.equal(result.resolved.contextScope, "dataset");
      assert.equal(result.resolved.inputItemCount, 4);
    });
  });

  await check("AI-SCOPE-4 Google Ads 80 daily rows can be analyzed as one dataset", async () => {
    const rows = dailyAdsRows(80);
    assert.equal(rows.length, 80);
    const payloads = rows.map((r) => r.json);
    const aggregated = aggregateGoogleAdsPerformanceForAi(payloads);
    assert.ok(aggregated.length <= 5);
    assert.ok(aggregated.every((row) => row._aiAggregation === "period"));

    await withMockedLlm(async (calls) => {
      const result = await handlers.ai(
        {
          id: "ai-ads",
          type: "ai",
          data: {
            contextScope: "dataset",
            provider: "openai",
            model: "gpt-4o-mini",
            prompt: "Analyze last month's campaign performance",
            systemPrompt: "Use evidence totals only",
          },
        },
        {
          input: {},
          steps: {},
          items: {},
          inputItems: rows,
        }
      );
      assert.equal(calls.length, 1);
      assert.equal(result.items.length, 1);
      const system = String(
        calls[0].messages.find((m) => m.role === "system")?.content || ""
      );
      const user = String(
        calls[0].messages.find((m) => m.role === "user")?.content || ""
      );
      assert.match(system, /period totals|group by campaignId|Campaign Performance/i);
      assert.match(system, /Cost \(currency \/ Spend\)/);
      // Dataset must not also dump raw daily rows into the user prompt.
      assert.equal(user.includes("## Workflow runtime data"), false);
      assert.equal(result.output?.promptsUsed?.runtimeDataAttached, false);
      assert.equal(
        result.output?.promptsUsed?.mcpGroundingSource ||
          result.items[0].json?.promptsUsed?.mcpGroundingSource,
        "google_ads"
      );
    });

    const grounded = applyGoogleAdsAiGrounding({
      userPrompt: "Analyze last month's campaign performance",
      input: payloads,
    });
    assert.equal(grounded.grounded, true);
    assert.match(grounded.systemPrompt, /period totals/);
  });

  await check("AI-SCOPE-5 Basic AI Agent Context Scope remains unchanged", () => {
    assert.equal(resolveAgentContextScope({}), "item");
    assert.equal(resolveAgentContextScope({ contextScope: "dataset" }), "dataset");
    assert.equal(resolveAiContextScope({ contextScope: "dataset" }), "dataset");
    const schema = fs.readFileSync(
      path.join(
        __dirname,
        "../../frontend/src/modules/workflows/nodeParameterSchemas.ts"
      ),
      "utf8"
    );
    assert.match(schema, /aiAgent:\s*\[[\s\S]*?name: "contextScope"/);
    // Shared helper exists
    assert.equal(
      fs.existsSync(
        path.join(__dirname, "../services/workflowAiContextScope.js")
      ),
      true
    );
  });

  await check("AI-SCOPE-6 existing saved AI nodes without contextScope still behave as Per Item", async () => {
    assert.equal(resolveAiContextScope({ prompt: "{{input}}" }), "item");
    await withMockedLlm(async (calls) => {
      const result = await handlers.ai(
        {
          id: "ai-legacy",
          type: "ai",
          data: {
            // no contextScope field — legacy saved node
            provider: "openai",
            model: "gpt-4o-mini",
            prompt: "{{input.label}}",
            systemPrompt: "ok",
          },
        },
        {
          input: {},
          steps: {},
          items: {},
          inputItems: [
            { json: { label: "A" } },
            { json: { label: "B" } },
          ],
        }
      );
      assert.equal(calls.length, 2);
      assert.equal(result.items.length, 2);
      assert.equal(result.resolved.contextScope, "item");
    });
  });

  console.log(`\n${passed} AI-SCOPE checks passed`);
  process.exit(process.exitCode || 0);
}

void main();
