const { v4: uuidv4 } = require("uuid");
const { pool } = require("../../config/database");
const AppError = require("../../utils/AppError");
const {
  resolveUseCase,
  getUseCase,
  SYSTEM_PROMPT_USE_CASES,
  isBuiltInUseCase,
} = require("../../utils/systemPromptUseCases");
const {
  normalizeScoringCategories,
  DEFAULT_WORKSPACE_SUMMARY_CATEGORIES,
} = require("../../utils/scoringCategories");
const {
  normalizeBotScoringCategories,
  DEFAULT_BOT_DESIGN_CATEGORIES,
} = require("../../utils/botScoringCategories");

const parseConfig = (value) => {
  if (value == null) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

const formatPrompt = (row) => ({
  id: row.id,
  useCaseKey: row.use_case_key,
  name: row.name,
  description: row.description || "",
  promptContent: row.prompt_content,
  config: parseConfig(row.config_json),
  isActive: Boolean(row.is_active),
  builtIn: isBuiltInUseCase(row.use_case_key),
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const buildConfig = (useCaseKey, config = {}) => {
  const next = { ...(config && typeof config === "object" ? config : {}) };
  if (!next.model) next.model = "gpt-4o-mini";
  if (!next.feature) {
    next.feature = getUseCase(useCaseKey)?.feature || useCaseKey;
  }
  if (useCaseKey === "workspace_summary") {
    next.scoringCategories = normalizeScoringCategories(
      next.scoringCategories || DEFAULT_WORKSPACE_SUMMARY_CATEGORIES
    );
  } else if (useCaseKey === "bot_design") {
    next.scoringCategories = normalizeBotScoringCategories(
      next.scoringCategories || DEFAULT_BOT_DESIGN_CATEGORIES
    );
  }
  if (next.maxTokens == null) next.maxTokens = 2000;
  if (next.temperature == null) next.temperature = 0.1;
  return next;
};

const getAll = async () => {
  const [rows] = await pool.execute(
    `
    SELECT *
    FROM system_prompts
    ORDER BY name ASC
    `
  );
  return rows.map(formatPrompt);
};

const getById = async (id) => {
  const [rows] = await pool.execute(
    "SELECT * FROM system_prompts WHERE id = ?",
    [id]
  );
  if (rows.length === 0) {
    throw new AppError("System prompt not found", 404, "NOT_FOUND");
  }
  return formatPrompt(rows[0]);
};

const getByUseCase = async (useCaseKey, { requireActive = true } = {}) => {
  const key = String(useCaseKey || "").trim();
  if (!key) {
    throw new AppError("useCaseKey is required", 400, "VALIDATION_ERROR");
  }

  const [rows] = await pool.execute(
    requireActive
      ? `
        SELECT * FROM system_prompts
        WHERE use_case_key = ? AND is_active = 1
        LIMIT 1
        `
      : `
        SELECT * FROM system_prompts
        WHERE use_case_key = ?
        LIMIT 1
        `,
    [key]
  );

  if (rows.length === 0) {
    return null;
  }
  return formatPrompt(rows[0]);
};

const triggerSummaryScoreRefresh = () => {
  setImmediate(() => {
    const summaryService = require("../../services/workspaceSummary.service");
    summaryService
      .reevaluateAllSummaries(null)
      .then((results) => {
        console.log(
          `[system-prompts] reevaluated ${results.length} workspace summar(ies)`
        );
      })
      .catch((error) => {
        console.error(
          "[system-prompts] summary reevaluate failed:",
          error.message
        );
      });
  });
};

const create = async (
  { useCaseKey, name, description, promptContent, config, isActive },
  authUser
) => {
  const useCase = resolveUseCase(useCaseKey);
  const key = useCase.key;
  const normalizedName = String(name || "").trim() || useCase.label;
  const normalizedContent = String(promptContent || "").trim();

  if (!normalizedContent) {
    throw new AppError("promptContent is required", 400, "VALIDATION_ERROR");
  }

  const existing = await getByUseCase(key, { requireActive: false });
  if (existing) {
    throw new AppError(
      `A system prompt already exists for use case "${key}". Edit or delete it first.`,
      409,
      "CONFLICT"
    );
  }

  const id = uuidv4();
  const configJson = JSON.stringify(buildConfig(key, config));

  await pool.execute(
    `
    INSERT INTO system_prompts (
      id, use_case_key, name, description, prompt_content,
      config_json, is_active, created_by
    ) VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?)
    `,
    [
      id,
      key,
      normalizedName,
      String(description || "").trim() || useCase.description || null,
      normalizedContent,
      configJson,
      isActive === false ? 0 : 1,
      authUser?.userId || null,
    ]
  );

  const created = await getById(id);
  if (created.useCaseKey === "workspace_summary" && created.isActive) {
    triggerSummaryScoreRefresh();
  }
  return {
    ...created,
    summaryRefreshStarted: created.useCaseKey === "workspace_summary",
  };
};

const syncLegacySettings = async (updated) => {
  if (updated.useCaseKey !== "workspace_summary") return;

  await pool.execute(
    `
    UPDATE admin_ai_settings
    SET
      evaluation_prompt = ?,
      evaluation_model = ?,
      summary_model = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
    `,
    [
      updated.promptContent,
      updated.config?.model || "gpt-4o-mini",
      updated.config?.model || "gpt-4o-mini",
    ]
  );
};

const update = async (
  id,
  { name, description, promptContent, config, isActive, useCaseKey }
) => {
  const current = await getById(id);

  const fields = [];
  const values = [];
  let nextUseCaseKey = current.useCaseKey;

  if (useCaseKey !== undefined) {
    const useCase = resolveUseCase(useCaseKey);
    nextUseCaseKey = useCase.key;
    if (nextUseCaseKey !== current.useCaseKey) {
      if (current.builtIn) {
        throw new AppError(
          `Cannot change use case for built-in system prompt "${current.useCaseKey}".`,
          400,
          "PROTECTED_SYSTEM_PROMPT"
        );
      }
      const conflict = await getByUseCase(nextUseCaseKey, {
        requireActive: false,
      });
      if (conflict && conflict.id !== id) {
        throw new AppError(
          `A system prompt already exists for use case "${nextUseCaseKey}"`,
          409,
          "CONFLICT"
        );
      }
      fields.push("use_case_key = ?");
      values.push(nextUseCaseKey);
    }
  }

  if (name !== undefined) {
    const normalizedName = String(name).trim();
    if (!normalizedName) {
      throw new AppError("name cannot be empty", 400, "VALIDATION_ERROR");
    }
    fields.push("name = ?");
    values.push(normalizedName);
  }

  if (description !== undefined) {
    fields.push("description = ?");
    values.push(String(description || "").trim() || null);
  }

  if (promptContent !== undefined) {
    const normalizedContent = String(promptContent).trim();
    if (!normalizedContent) {
      throw new AppError(
        "promptContent cannot be empty",
        400,
        "VALIDATION_ERROR"
      );
    }
    fields.push("prompt_content = ?");
    values.push(normalizedContent);
  }

  if (config !== undefined) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new AppError("config must be an object", 400, "VALIDATION_ERROR");
    }
    fields.push("config_json = CAST(? AS JSON)");
    values.push(JSON.stringify(buildConfig(nextUseCaseKey, config)));
  }

  if (isActive !== undefined) {
    fields.push("is_active = ?");
    values.push(isActive ? 1 : 0);
  }

  if (fields.length === 0) {
    throw new AppError("No fields to update", 400, "VALIDATION_ERROR");
  }

  values.push(id);
  await pool.execute(
    `UPDATE system_prompts SET ${fields.join(", ")} WHERE id = ?`,
    values
  );

  const updated = await getById(id);
  await syncLegacySettings(updated);

  // Refresh summary scores with new prompt/checklist (eval only — not full file regen).
  if (updated.useCaseKey === "workspace_summary" && updated.isActive) {
    triggerSummaryScoreRefresh();
  }

  return {
    ...updated,
    summaryRefreshStarted: updated.useCaseKey === "workspace_summary",
  };
};

const remove = async (id) => {
  // Built-in prompts may be removed only by platform owner (route-gated).
  const [result] = await pool.execute(
    "DELETE FROM system_prompts WHERE id = ?",
    [id]
  );
  if (result.affectedRows === 0) {
    throw new AppError("System prompt not found", 404, "NOT_FOUND");
  }
  return { message: "System prompt deleted" };
};

const requireUseCase = async (useCaseKey) => {
  const prompt = await getByUseCase(useCaseKey, { requireActive: true });
  if (!prompt) {
    throw new AppError(
      `Active system prompt missing for use case "${useCaseKey}"`,
      500,
      "SYSTEM_PROMPT_MISSING"
    );
  }
  return prompt;
};

const listUseCases = () =>
  Object.values(SYSTEM_PROMPT_USE_CASES).map((item) => ({
    key: item.key,
    label: item.label,
    description: item.description,
    builtIn: item.builtIn,
  }));

module.exports = {
  getAll,
  getById,
  getByUseCase,
  requireUseCase,
  create,
  update,
  remove,
  listUseCases,
};
