/**
 * STEP 8I — AI node maxTokens configuration (default 1200, configurable).
 */
const fs = require("fs");
const path = require("path");
const assert = require("node:assert");

const registerAiMaxTokensTests = ({ check, section, assert: a }) => {
  const assertX = a || assert;
  section("STEP 8I AI Max Output Tokens");

  const paramSchemaPath = path.join(
    __dirname,
    "../../frontend/src/modules/workflows/nodeParameterSchemas.ts"
  );
  const nodesPath = path.join(__dirname, "../services/workflowNodes.service.js");
  const aiClients = require("../config/aiClients");
  const { handlers } = require("../services/workflowNodes.service");
  const { withGenerationOptions } = require("../utils/openaiCompletionOptions");

  const schemaSrc = fs.readFileSync(paramSchemaPath, "utf8");
  const nodesSrc = fs.readFileSync(nodesPath, "utf8");

  /** Extract the `ai: [ ... ],` block (top-level schema key). */
  const aiBlockMatch = schemaSrc.match(/\n\s{4}ai:\s*\[([\s\S]*?)\n\s{4}\],\s*\n\s{4}bot:/);
  assertX.ok(aiBlockMatch, "ai parameter schema block present");
  const aiBlock = aiBlockMatch[1];

  check("8I-1 AI schema exposes maxTokens (Max Output Tokens)", () => {
    assertX.ok(aiBlock.includes('name: "maxTokens"'), "maxTokens field on ai node");
    assertX.ok(
      aiBlock.includes('displayName: "Max Output Tokens"'),
      "display label Max Output Tokens"
    );
    assertX.ok(
      /default:\s*1200/.test(aiBlock) && aiBlock.includes("maxTokens"),
      "default 1200 in ai schema"
    );
    assertX.ok(/min:\s*1/.test(aiBlock), "min: 1 prevents zero/negative");
    assertX.ok(
      aiBlock.includes(
        "Maximum number of tokens the AI can generate in its response."
      ),
      "description present"
    );
  });

  check("8I-2 Runtime still uses data.maxTokens ?? 1200 (single mechanism)", () => {
    assertX.ok(
      nodesSrc.includes("maxTokens: data.maxTokens ?? 1200"),
      "single default path preserved"
    );
    assertX.ok(
      !nodesSrc.includes("maxOutputTokens"),
      "no second token-limit field"
    );
  });

  // Mirror frontend paramSchemaValidation number rules for this field.
  const validateMaxTokens = (value) => {
    const param = {
      displayName: "Max Output Tokens",
      type: "number",
      min: 1,
    };
    if (value != null && value !== "") {
      const n = Number(value);
      if (Number.isNaN(n)) return `${param.displayName} must be a number`;
      if (param.min != null && n < param.min) {
        return `${param.displayName} must be at least ${param.min}`;
      }
    }
    return null;
  };

  check("8I-3 Invalid maxTokens → validation error", () => {
    assertX.equal(validateMaxTokens(0), "Max Output Tokens must be at least 1");
    assertX.equal(validateMaxTokens(-5), "Max Output Tokens must be at least 1");
    assertX.equal(
      validateMaxTokens("abc"),
      "Max Output Tokens must be a number"
    );
    assertX.equal(validateMaxTokens(1200), null);
    assertX.equal(validateMaxTokens(4000), null);
    assertX.equal(validateMaxTokens(undefined), null);
  });

  check("8I-4 withGenerationOptions maps maxTokens for gpt-4o-mini", () => {
    const opts = withGenerationOptions("gpt-4o-mini", {
      messages: [],
      maxTokens: 4000,
      temperature: 0.4,
    });
    assertX.equal(opts.max_tokens, 4000);
    assertX.equal(opts.max_completion_tokens, undefined);
  });

  const withMockedLlm = async (nodeData) => {
    const original = aiClients.getClientForProvider;
    let captured = null;
    aiClients.getClientForProvider = () => ({
      provider: "openai",
      client: {
        chat: {
          completions: {
            create: async (opts) => {
              captured = opts;
              return {
                choices: [
                  {
                    message: { content: "ok" },
                    finish_reason: "stop",
                  },
                ],
                usage: {
                  prompt_tokens: 10,
                  completion_tokens: 5,
                  total_tokens: 15,
                },
              };
            },
          },
        },
      },
    });
    try {
      const result = await handlers.ai(
        {
          id: "ai-test",
          type: "ai",
          data: {
            provider: "openai",
            model: "gpt-4o-mini",
            prompt: "{{input}}",
            systemPrompt: "Say ok.",
            ...nodeData,
          },
        },
        {
          input: { hello: "world" },
          steps: {},
          items: [{ json: { hello: "world" } }],
          inputItems: [{ json: { hello: "world" } }],
        }
      );
      return { result, captured };
    } finally {
      aiClients.getClientForProvider = original;
    }
  };

  check("8I-A AI node without maxTokens → generation max_tokens 1200", async () => {
    const { result, captured } = await withMockedLlm({});
    assertX.ok(captured, "LLM called");
    assertX.equal(captured.max_tokens, 1200);
    assertX.equal(result.output.finishReason, "stop");
    assertX.deepEqual(result.output.usage, {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
    assertX.equal(result.output.maxTokens, 1200);
    assertX.equal(result.output.text, "ok");
  });

  check("8I-B AI node with maxTokens=4000 → generation receives 4000", async () => {
    const { result, captured } = await withMockedLlm({ maxTokens: 4000 });
    assertX.ok(captured, "LLM called");
    assertX.equal(captured.max_tokens, 4000);
    assertX.equal(result.output.maxTokens, 4000);
    assertX.equal(result.output.finishReason, "stop");
  });

  check("8I-D Existing AI text output contract preserved", async () => {
    const { result } = await withMockedLlm({ maxTokens: 800 });
    assertX.equal(result.output.text, "ok");
    assertX.equal(result.output.isLlm, true);
    assertX.equal(result.output.provider, "openai");
    assertX.equal(result.output.model, "gpt-4o-mini");
    assertX.ok("promptsUsed" in result.output);
  });

  check("8I-E Larger budget requestable with many upstream items (no MCP truncate)", async () => {
    const original = aiClients.getClientForProvider;
    let captured = null;
    const many = Array.from({ length: 50 }, (_, i) => ({
      json: {
        capability: "landing_underperformance",
        opportunity_type: "landing_underperformance",
        entity: { landingPage: `/p${i}`, label: `/p${i}` },
        metrics: { sessions: 10 + i, engagementRate: 0.1, bounceRate: 0.9 },
        score: 0.2,
        reason: `reason ${i}`,
        recommendation: `rec ${i}`,
        __ga4Intelligence: true,
      },
    }));
    aiClients.getClientForProvider = () => ({
      provider: "openai",
      client: {
        chat: {
          completions: {
            create: async (opts) => {
              captured = opts;
              return {
                choices: [
                  {
                    message: { content: "report" },
                    finish_reason: "stop",
                  },
                ],
                usage: {
                  prompt_tokens: 100,
                  completion_tokens: 50,
                  total_tokens: 150,
                },
              };
            },
          },
        },
      },
    });
    try {
      await handlers.ai(
        {
          id: "ai-ga4",
          type: "ai",
          data: {
            provider: "openai",
            model: "gpt-4o-mini",
            prompt: "{{input}}",
            systemPrompt: "Report all opportunities.",
            maxTokens: 4000,
          },
        },
        {
          input: many[0].json,
          steps: {},
          items: many,
          inputItems: many,
          item: many[0],
        }
      );
      assertX.ok(captured, "LLM called");
      assertX.equal(captured.max_tokens, 4000);
      // Evidence must still be allowed into the prompt (no silent 10-row cap).
      const userContent = String(captured.messages?.[1]?.content || "");
      const systemContent = String(captured.messages?.[0]?.content || "");
      const combined = `${systemContent}\n${userContent}`;
      assertX.ok(
        combined.includes("/p0") || combined.includes("landing_underperformance"),
        "GA4 MCP-shaped evidence reaches generation"
      );
      assertX.ok(
        combined.length > 500,
        "prompt carries substantial multi-row evidence"
      );
    } finally {
      aiClients.getClientForProvider = original;
    }
  });

  check("8I-F finish_reason / usage diagnostics preserved on AI output", async () => {
    const { result } = await withMockedLlm({});
    assertX.equal(result.output.finishReason, "stop");
    assertX.equal(result.output.usage.completion_tokens, 5);
  });
};

module.exports = { registerAiMaxTokensTests };
