/**
 * Platform System Prompt use-case registry (suggested list).
 * Admins may also create custom use-case keys.
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
  document_classification: {
    key: "document_classification",
    label: "Document Classification",
    description: "Future: classify uploaded documents by type or purpose.",
    builtIn: false,
    feature: "documents",
  },
  content_moderation: {
    key: "content_moderation",
    label: "Content Moderation",
    description: "Future: moderate generated or user content.",
    builtIn: false,
    feature: "moderation",
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

/** Known registry entry or a valid custom key. */
const resolveUseCase = (key) => {
  const normalized = assertUseCaseKeyFormat(key);
  const known = getUseCase(normalized);
  return (
    known || {
      key: normalized,
      label: normalized
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" "),
      description: "",
      builtIn: false,
      feature: "custom",
    }
  );
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
