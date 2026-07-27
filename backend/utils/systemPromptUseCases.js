/**
 * Platform System Prompt use-case registry (source of truth).
 * Frontend loads this via GET /admin/system-prompts/use-cases.
 * Unknown keys are rejected — no free-form custom use cases.
 */

const AppError = require("./AppError");

const SYSTEM_PROMPT_USE_CASES = {
  workspace_summary: {
    key: "workspace_summary",
    label: "Workspace Knowledge Evaluator",
    description:
      "Runs after workspace summary generation or update to score knowledge quality.",
    builtIn: true,
    feature: "workspace_summary",
  },
  bot_design: {
    key: "bot_design",
    label: "AI Assistant Design Validator",
    description:
      "Scores bot design quality (prompt, role clarity, capability fit) on the Assistants page.",
    builtIn: true,
    feature: "bot_design",
  },
};

const USE_CASE_KEYS = Object.keys(SYSTEM_PROMPT_USE_CASES);

const getUseCase = (key) =>
  SYSTEM_PROMPT_USE_CASES[String(key || "").trim().toLowerCase()] || null;

const normalizeUseCaseKey = (key) =>
  String(key || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

const assertUseCaseKeyFormat = (key) => {
  const normalized = normalizeUseCaseKey(key);
  if (!normalized) {
    throw new AppError("useCaseKey is required", 400, "VALIDATION_ERROR");
  }
  if (!/^[a-z0-9_]+$/.test(normalized)) {
    throw new AppError(
      "useCaseKey must be lowercase letters, numbers, and underscores",
      400,
      "VALIDATION_ERROR"
    );
  }
  return normalized;
};

/** Known registry entry only — admin selects from dropdown; no free-form keys. */
const resolveUseCase = (key) => {
  const normalized = assertUseCaseKeyFormat(key);
  const known = getUseCase(normalized);
  if (!known) {
    throw new AppError(
      `Unknown use case "${normalized}". Pick one from the registered list.`,
      400,
      "VALIDATION_ERROR"
    );
  }
  return known;
};

module.exports = {
  SYSTEM_PROMPT_USE_CASES,
  USE_CASE_KEYS,
  getUseCase,
  normalizeUseCaseKey,
  assertUseCaseKeyFormat,
  resolveUseCase,
  // Back-compat alias
  assertValidUseCaseKey: resolveUseCase,
};
