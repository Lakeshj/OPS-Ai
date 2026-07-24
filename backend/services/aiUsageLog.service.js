const { pool } = require("../config/database");
const { inferProviderFromModel } = require("../utils/aiProviders");

const listAiUsageEvents = async ({ limit = 150, workspaceId = null } = {}) => {
  const safeLimit = Math.min(Math.max(Number(limit) || 150, 1), 500);
  const params = [];
  let where = "";

  if (workspaceId) {
    where = "WHERE u.workspace_id = ?";
    params.push(workspaceId);
  }

  const [rows] = await pool.execute(
    `
    SELECT
      u.id,
      u.workspace_id AS workspaceId,
      u.thread_id AS threadId,
      u.user_id AS userId,
      u.assistant_id AS assistantId,
      u.model,
      u.input_tokens AS inputTokens,
      u.cached_tokens AS cachedTokens,
      u.cache_write_tokens AS cacheWriteTokens,
      u.output_tokens AS outputTokens,
      u.total_tokens AS totalTokens,
      u.latency_ms AS latencyMs,
      u.created_at AS createdAt,
      a.name AS assistantName,
      w.name AS workspaceName,
      usr.name AS userName
    FROM ai_usage_events u
    LEFT JOIN keyword_assistants a ON a.id = u.assistant_id
    LEFT JOIN workspaces w ON w.id = u.workspace_id
    LEFT JOIN users usr ON usr.id = u.user_id
    ${where}
    ORDER BY u.created_at DESC
    LIMIT ${safeLimit}
    `,
    params
  );

  return rows.map((row) => ({
    ...row,
    provider: inferProviderFromModel(row.model),
    inputTokens: Number(row.inputTokens || 0),
    cachedTokens: Number(row.cachedTokens || 0),
    cacheWriteTokens: Number(row.cacheWriteTokens || 0),
    outputTokens: Number(row.outputTokens || 0),
    totalTokens: Number(row.totalTokens || 0),
    latencyMs: row.latencyMs == null ? null : Number(row.latencyMs),
  }));
};

module.exports = {
  listAiUsageEvents,
};
