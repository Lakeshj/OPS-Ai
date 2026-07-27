const { openai } = require("../config/openai");
const AppError = require("../utils/AppError");
const { withGenerationOptions } = require("../utils/openaiCompletionOptions");
const { getByUseCase } = require("../modules/systemPrompts/systemPrompts.service");
const assistantsService = require("../modules/assistants/assistants.service");
const { pool } = require("../config/database");
const {
  resolveBotScoringCategories,
  DEFAULT_BOT_DESIGN_CATEGORIES,
} = require("../utils/botScoringCategories");

const DEFAULT_PROMPT = `You are OpsAi's AI Assistant Design Validator.

Evaluate the bot configuration for production readiness. Score how well the bot is designed to serve users inside a workspace chat product.

Be strict but fair. Prefer concrete feedback over vague praise.
Return JSON only as specified in the contract.`;

const extractJsonObject = (raw) => {
  const text = String(raw || "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return {};
      }
    }
    return {};
  }
};

const normalizeEvaluationDetails = (raw, categoryKeys) => {
  const details = raw && typeof raw === "object" ? raw : {};
  const score = Number(details.score);
  const categories = {};
  const sourceCats =
    details.categories && typeof details.categories === "object"
      ? details.categories
      : {};

  for (const key of categoryKeys) {
    const item = sourceCats[key] || {};
    categories[key] = {
      score: Number.isFinite(Number(item.score))
        ? Math.max(0, Math.min(100, Number(item.score)))
        : null,
      feedback: typeof item.feedback === "string" ? item.feedback : "",
      label: typeof item.label === "string" ? item.label : key,
    };
  }

  return {
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null,
    feedback: typeof details.feedback === "string" ? details.feedback : "",
    categories,
    strengths: Array.isArray(details.strengths)
      ? details.strengths.map(String)
      : [],
    gaps: Array.isArray(details.gaps) ? details.gaps.map(String) : [],
    recommendations: Array.isArray(details.recommendations)
      ? details.recommendations.map(String)
      : [],
    confidence:
      typeof details.confidence === "string" ? details.confidence : null,
    confidenceReason:
      typeof details.confidenceReason === "string"
        ? details.confidenceReason
        : null,
  };
};

const buildEvaluationJsonContract = (scoringCategories) => {
  const categoryLines = scoringCategories
    .map(
      (item) =>
        `    "${item.key}": { "score": <0-100>, "feedback": "<short reason>", "label": "${item.label}" }`
    )
    .join(",\n");

  return `IMPORTANT: Respond with a single JSON object only (valid json). Do not use markdown tables.

Required JSON shape:
{
  "score": <number 0-100 overall design quality>,
  "feedback": "<short overall assessment>",
  "categories": {
${categoryLines}
  },
  "strengths": ["<strength>", "..."],
  "gaps": ["<gap>", "..."],
  "recommendations": ["<improvement>", "..."],
  "confidence": "Low|Medium|High|Very High",
  "confidenceReason": "<why>"
}

Only score these selected categories: ${scoringCategories.map((c) => c.label).join(", ")}.`;
};

const getEvaluatorSettings = async () => {
  const prompt = await getByUseCase("bot_design");
  const config = prompt?.config || {};
  const scoringCategories = resolveBotScoringCategories(
    config.scoringCategories || DEFAULT_BOT_DESIGN_CATEGORIES
  );

  return {
    evaluation_model: config.model || "gpt-4o-mini",
    evaluation_prompt: prompt?.promptContent || DEFAULT_PROMPT,
    evaluation_config: {
      model: config.model || "gpt-4o-mini",
      temperature: config.temperature ?? 0.1,
      maxTokens: config.maxTokens ?? 2000,
    },
    scoringCategories,
  };
};

const getUsageStats = async (assistantId) => {
  const [rows] = await pool.execute(
    `
    SELECT
      COUNT(*) AS callCount,
      AVG(total_tokens) AS avgTotalTokens,
      AVG(latency_ms) AS avgLatencyMs,
      SUM(CASE WHEN total_tokens > 0 THEN 1 ELSE 0 END) AS successCount
    FROM ai_usage_events
    WHERE assistant_id = ?
    `,
    [assistantId]
  );
  const row = rows[0] || {};
  return {
    callCount: Number(row.callCount || 0),
    avgTotalTokens: row.avgTotalTokens == null ? null : Math.round(Number(row.avgTotalTokens)),
    avgLatencyMs: row.avgLatencyMs == null ? null : Math.round(Number(row.avgLatencyMs)),
  };
};

const buildBotPayload = (assistant, stats) => {
  return [
    "Evaluate this OpsAi bot design.",
    "",
    `Name: ${assistant.name}`,
    `Task type: ${assistant.taskType}`,
    `Capability: ${assistant.capabilityType}`,
    `Provider: ${assistant.provider || "openai"}`,
    `Model: ${assistant.model}`,
    `Description: ${assistant.description || "(none)"}`,
    "",
    "Prompt template:",
    assistant.promptTemplate || "(empty)",
    "",
    "Recent usage stats (optional context, not the main score target):",
    JSON.stringify(stats),
  ].join("\n");
};

const evaluateBotDesign = async (assistantId) => {
  const assistant = await assistantsService.getById(assistantId);
  const settings = await getEvaluatorSettings();
  const stats = await getUsageStats(assistantId);
  const scoringCategories = settings.scoringCategories;
  const evaluationModel =
    settings.evaluation_config?.model ||
    settings.evaluation_model ||
    "gpt-4o-mini";
  const evaluationPrompt = `${settings.evaluation_prompt}\n\n${buildEvaluationJsonContract(
    scoringCategories
  )}`;

  try {
    const completion = await openai.chat.completions.create(
      withGenerationOptions(evaluationModel, {
        temperature: Number(settings.evaluation_config?.temperature ?? 0.1),
        maxTokens: Number(settings.evaluation_config?.maxTokens ?? 2000),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: evaluationPrompt },
          {
            role: "user",
            content: buildBotPayload(assistant, stats),
          },
        ],
      })
    );

    const details = normalizeEvaluationDetails(
      extractJsonObject(completion.choices[0]?.message?.content || "{}"),
      scoringCategories.map((item) => item.key)
    );

    await pool.execute(
      `
      UPDATE keyword_assistants
      SET
        quality_score = ?,
        quality_feedback = ?,
        quality_details = ?,
        quality_model = ?,
        quality_evaluated_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [
        details.score,
        details.feedback,
        JSON.stringify(details),
        evaluationModel,
        assistantId,
      ]
    );

    return assistantsService.getById(assistantId);
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("[bot-quality] evaluation failed:", error.message);
    throw new AppError(
      error?.message || "Failed to evaluate bot design",
      error?.status || error?.statusCode || 502,
      "BOT_EVALUATION_FAILED"
    );
  }
};

module.exports = {
  evaluateBotDesign,
  getUsageStats,
};
