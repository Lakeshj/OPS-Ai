const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/database");

const logAiError = async ({
  provider,
  model,
  capabilityType = null,
  assistantId = null,
  workspaceId = null,
  threadId = null,
  userId = null,
  statusCode = null,
  errorCode = null,
  message,
}) => {
  try {
    await pool.execute(
      `
      INSERT INTO ai_error_logs (
        id, provider, model, capability_type, assistant_id, workspace_id,
        thread_id, user_id, status_code, error_code, message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        uuidv4(),
        String(provider || "unknown").slice(0, 50),
        String(model || "unknown").slice(0, 100),
        capabilityType,
        assistantId,
        workspaceId,
        threadId,
        userId,
        statusCode == null ? null : Number(statusCode),
        errorCode ? String(errorCode).slice(0, 100) : null,
        String(message || "Unknown AI error").slice(0, 4000),
      ]
    );
  } catch (error) {
    console.error("[ai-error-log] failed to write:", error.message);
  }
};

const listAiErrorLogs = async ({ limit = 100, provider = null } = {}) => {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const params = [];
  let where = "";
  if (provider) {
    where = "WHERE provider = ?";
    params.push(provider);
  }

  const [rows] = await pool.execute(
    `
    SELECT
      id,
      provider,
      model,
      capability_type AS capabilityType,
      assistant_id AS assistantId,
      workspace_id AS workspaceId,
      thread_id AS threadId,
      user_id AS userId,
      status_code AS statusCode,
      error_code AS errorCode,
      message,
      created_at AS createdAt
    FROM ai_error_logs
    ${where}
    ORDER BY created_at DESC
    LIMIT ${safeLimit}
    `,
    params
  );

  return rows;
};

module.exports = {
  logAiError,
  listAiErrorLogs,
};
