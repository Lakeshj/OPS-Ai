const { pool } = require("../../config/database");
const AppError = require("../../utils/AppError");

const formatSettings = (row) => ({
  summaryModel: row.summary_model,
  evaluationModel: row.evaluation_model,
  evaluationPrompt: row.evaluation_prompt,
  updatedBy: row.updated_by,
  updatedAt: row.updated_at,
});

const get = async () => {
  const [rows] = await pool.execute(
    "SELECT * FROM admin_ai_settings WHERE id = 1"
  );
  if (rows.length === 0) {
    throw new AppError("AI settings not found", 404, "NOT_FOUND");
  }
  return formatSettings(rows[0]);
};

const update = async (
  { summaryModel, evaluationModel, evaluationPrompt },
  authUser
) => {
  const current = await get();
  const next = {
    summaryModel:
      typeof summaryModel === "string" && summaryModel.trim()
        ? summaryModel.trim()
        : current.summaryModel,
    evaluationModel:
      typeof evaluationModel === "string" && evaluationModel.trim()
        ? evaluationModel.trim()
        : current.evaluationModel,
    evaluationPrompt:
      typeof evaluationPrompt === "string" && evaluationPrompt.trim()
        ? evaluationPrompt.trim()
        : current.evaluationPrompt,
  };

  await pool.execute(
    `
    UPDATE admin_ai_settings
    SET
      summary_model = ?,
      evaluation_model = ?,
      evaluation_prompt = ?,
      updated_by = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
    `,
    [
      next.summaryModel,
      next.evaluationModel,
      next.evaluationPrompt,
      authUser.userId,
    ]
  );

  return get();
};

module.exports = { get, update };
