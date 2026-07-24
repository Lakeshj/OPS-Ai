const { v4: uuidv4 } = require("uuid");
const { pool } = require("../../config/database");
const { formatAssistant } = require("../../utils/formatters");
const AppError = require("../../utils/AppError");
const {
  normalizeCapability,
  normalizeProvider,
  inferProviderFromModel,
  resolveDefaultSelection,
} = require("../../utils/aiProviders");

const getAll = async () => {
  const [rows] = await pool.execute("SELECT * FROM keyword_assistants");
  return rows.map(formatAssistant);
};

const getById = async (id) => {
  const [rows] = await pool.execute(
    "SELECT * FROM keyword_assistants WHERE id = ?",
    [id]
  );
  if (rows.length === 0) {
    throw new AppError("Assistant not found", 404, "NOT_FOUND");
  }
  return formatAssistant(rows[0]);
};

const create = async ({
  name,
  taskType,
  capabilityType = "chat",
  provider,
  model,
  promptTemplate,
  description,
}) => {
  const defaults = resolveDefaultSelection(capabilityType, provider);
  const normalizedCapability = normalizeCapability(
    capabilityType || defaults.capability
  );
  const normalizedProvider =
    normalizeProvider(provider) ||
    inferProviderFromModel(model) ||
    defaults.provider;
  const normalizedModel = String(model || defaults.model).trim();

  if (!normalizedCapability || !normalizedModel || !normalizedProvider) {
    throw new AppError(
      "capabilityType, provider, and model are required",
      400,
      "VALIDATION_ERROR"
    );
  }

  const id = uuidv4();
  await pool.execute(
    `INSERT INTO keyword_assistants
      (id, name, task_type, capability_type, provider, model, prompt_template, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      name,
      taskType,
      normalizedCapability,
      normalizedProvider,
      normalizedModel,
      promptTemplate,
      description,
    ]
  );
  return getById(id);
};

const update = async (
  id,
  {
    name,
    taskType,
    capabilityType,
    provider,
    model,
    promptTemplate,
    description,
  }
) => {
  const updateFields = [];
  const values = [];

  if (name !== undefined) {
    updateFields.push("name = ?");
    values.push(name);
  }
  if (taskType !== undefined) {
    updateFields.push("task_type = ?");
    values.push(taskType);
  }
  if (capabilityType !== undefined) {
    const normalizedCapability = normalizeCapability(capabilityType);
    if (!normalizedCapability) {
      throw new AppError(
        "capabilityType cannot be empty",
        400,
        "VALIDATION_ERROR"
      );
    }
    updateFields.push("capability_type = ?");
    values.push(normalizedCapability);
  }
  if (provider !== undefined) {
    const normalizedProvider = normalizeProvider(provider);
    if (!normalizedProvider) {
      throw new AppError(
        "provider must be one of: openai, deepseek, gemini",
        400,
        "VALIDATION_ERROR"
      );
    }
    updateFields.push("provider = ?");
    values.push(normalizedProvider);
  }
  if (model !== undefined) {
    const normalizedModel = String(model).trim();
    if (!normalizedModel) {
      throw new AppError("model cannot be empty", 400, "VALIDATION_ERROR");
    }
    updateFields.push("model = ?");
    values.push(normalizedModel);
    if (provider === undefined) {
      updateFields.push("provider = ?");
      values.push(inferProviderFromModel(normalizedModel));
    }
  }
  if (promptTemplate !== undefined) {
    updateFields.push("prompt_template = ?");
    values.push(promptTemplate);
  }
  if (description !== undefined) {
    updateFields.push("description = ?");
    values.push(description);
  }

  if (updateFields.length === 0) {
    throw new AppError("No fields to update", 400, "VALIDATION_ERROR");
  }

  values.push(id);
  await pool.execute(
    `UPDATE keyword_assistants SET ${updateFields.join(
      ", "
    )}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    values
  );

  return getById(id);
};

const remove = async (id) => {
  const [result] = await pool.execute(
    "DELETE FROM keyword_assistants WHERE id = ?",
    [id]
  );
  if (result.affectedRows === 0) {
    throw new AppError("Assistant not found", 404, "NOT_FOUND");
  }
};

module.exports = { getAll, getById, create, update, remove };
