/**
 * Part 14B.2 — product-level Copilot planner configuration.
 * Provider/model come from server env — never from workflow nodes or user prompts.
 */

const AppError = require("../utils/AppError");

const PLANNER_ERROR = Object.freeze({
  PROVIDER_UNAVAILABLE: "COPILOT_PROVIDER_UNAVAILABLE",
  PROVIDER_TIMEOUT: "COPILOT_PROVIDER_TIMEOUT",
  RESPONSE_INVALID: "COPILOT_RESPONSE_INVALID",
  PLAN_INVALID: "COPILOT_PLAN_INVALID",
});

const MAX_COPILOT_OPERATIONS = 100;
const MAX_COPILOT_UNRESOLVED = 30;
const MAX_COPILOT_QUESTIONS = 10;
const MAX_COPILOT_WARNINGS = 30;
const MAX_COPILOT_PLAN_REPAIR_ROUNDS = 2;
const MAX_CONVERSATION_TURNS = 8;
const MAX_MESSAGE_CHARS = 4000;
const MAX_TURN_CHARS = 2000;
const DEFAULT_COPILOT_TIMEOUT_MS = 45000;

/**
 * Resolve how Copilot should plan.
 * - mode "deterministic": tests / explicit COPILOT_PLANNER=deterministic
 * - mode "model": production LLM via server provider keys
 * - throws PROVIDER_UNAVAILABLE when production needs a model but none configured
 */
const resolveCopilotPlannerConfig = ({ forceMode } = {}) => {
  const explicit =
    forceMode ||
    String(process.env.COPILOT_PLANNER || "")
      .trim()
      .toLowerCase();

  if (
    explicit === "deterministic" ||
    explicit === "test" ||
    process.env.COPILOT_USE_TEST_PLANNER === "1"
  ) {
    return {
      mode: "deterministic",
      provider: "test",
      model: "deterministic-copilot-planner",
      timeoutMs: DEFAULT_COPILOT_TIMEOUT_MS,
    };
  }

  const provider = String(
    process.env.COPILOT_PROVIDER || process.env.OPENAI_PROVIDER || "openai"
  )
    .trim()
    .toLowerCase();
  const model = String(
    process.env.COPILOT_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini"
  ).trim();

  const keyEnv =
    provider === "deepseek"
      ? "DEEPSEEK_API_KEY"
      : provider === "gemini"
        ? "GEMINI_API_KEY"
        : "OPENAI_API_KEY";
  const apiKey = process.env[keyEnv];

  const keyMissing =
    !apiKey || !String(apiKey).trim() || String(apiKey).includes("your_");

  // Production must never silently use the test planner.
  if (keyMissing) {
    if (process.env.NODE_ENV === "production") {
      throw new AppError(
        "Copilot provider is not configured. Set COPILOT_PROVIDER / COPILOT_MODEL and the matching API key.",
        503,
        PLANNER_ERROR.PROVIDER_UNAVAILABLE
      );
    }
    // Local/smoke without keys: deterministic fixtures only.
    return {
      mode: "deterministic",
      provider: "test",
      model: "deterministic-copilot-planner",
      timeoutMs: DEFAULT_COPILOT_TIMEOUT_MS,
    };
  }

  if (!["openai", "deepseek", "gemini"].includes(provider)) {
    throw new AppError(
      `Unsupported Copilot provider "${provider}"`,
      503,
      PLANNER_ERROR.PROVIDER_UNAVAILABLE
    );
  }

  return {
    mode: "model",
    provider,
    model,
    timeoutMs: Number(process.env.COPILOT_TIMEOUT_MS) || DEFAULT_COPILOT_TIMEOUT_MS,
    temperature: 0.2,
    maxTokens: Number(process.env.COPILOT_MAX_TOKENS) || 4000,
  };
};

module.exports = {
  PLANNER_ERROR,
  MAX_COPILOT_OPERATIONS,
  MAX_COPILOT_UNRESOLVED,
  MAX_COPILOT_QUESTIONS,
  MAX_COPILOT_WARNINGS,
  MAX_COPILOT_PLAN_REPAIR_ROUNDS,
  MAX_CONVERSATION_TURNS,
  MAX_MESSAGE_CHARS,
  MAX_TURN_CHARS,
  DEFAULT_COPILOT_TIMEOUT_MS,
  resolveCopilotPlannerConfig,
};
