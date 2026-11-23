const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/database");
const { inferProviderFromModel } = require("../utils/aiProviders");

/**
 * Persist one model generation into ai_usage_events (chat, bot, or AI Agent).
 * Never throws to callers — logging must not break generation.
 *
 * usage accepts either OpenAI-shaped fields (prompt_tokens, …) or
 * normalized { inputTokens, cachedTokens, outputTokens, totalTokens }.
 */
const recordAiUsageEvent = async ({
  workspaceId,
  threadId = null,
  userId = null,
  assistantId = null,
  model,
  provider = null,
  usage = null,
  latencyMs = null,
  source = null,
  workflowRunId = null,
  workflowNodeId = null,
  workflowNodeName = null,
  generationIndex = null,
} = {}) => {
  if (!workspaceId || !model) {
    return null;
  }

  const inputTokens = Number(
    usage?.inputTokens ?? usage?.prompt_tokens ?? 0
  );
  const cachedTokens = Number(
    usage?.cachedTokens ??
      usage?.prompt_tokens_details?.cached_tokens ??
      0
  );
  const cacheWriteTokens = Number(
    usage?.cacheWriteTokens ??
      usage?.prompt_tokens_details?.cache_write_tokens ??
      0
  );
  const outputTokens = Number(
    usage?.outputTokens ?? usage?.completion_tokens ?? 0
  );
  const totalTokens = Number(
    usage?.totalTokens ??
      usage?.total_tokens ??
      inputTokens + outputTokens
  );

  const inferredProvider =
    provider || inferProviderFromModel(model) || null;
  const id = uuidv4();

  try {
    await pool.execute(
      `
      INSERT INTO ai_usage_events (
        id,
        workspace_id,
        thread_id,
        user_id,
        assistant_id,
        source,
        workflow_run_id,
        workflow_node_id,
        workflow_node_name,
        generation_index,
        model,
        provider,
        input_tokens,
        cached_tokens,
        cache_write_tokens,
        output_tokens,
        total_tokens,
        latency_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        id,
        workspaceId,
        threadId || null,
        userId || null,
        assistantId || null,
        source || null,
        workflowRunId || null,
        workflowNodeId || null,
        workflowNodeName ? String(workflowNodeName).slice(0, 191) : null,
        generationIndex == null ? null : Number(generationIndex),
        String(model).slice(0, 100),
        inferredProvider ? String(inferredProvider).slice(0, 32) : null,
        inputTokens,
        cachedTokens,
        cacheWriteTokens,
        outputTokens,
        totalTokens,
        latencyMs == null ? null : Number(latencyMs),
      ]
    );
    return id;
  } catch (error) {
    // Older DBs without 032 columns: fall back to the original insert shape.
    if (
      error &&
      (error.code === "ER_BAD_FIELD_ERROR" ||
        /Unknown column/i.test(String(error.message || "")))
    ) {
      try {
        await pool.execute(
          `
          INSERT INTO ai_usage_events (
            id,
            workspace_id,
            thread_id,
            user_id,
            assistant_id,
            model,
            input_tokens,
            cached_tokens,
            cache_write_tokens,
            output_tokens,
            total_tokens,
            latency_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            id,
            workspaceId,
            threadId || null,
            userId || null,
            assistantId || null,
            String(model).slice(0, 100),
            inputTokens,
            cachedTokens,
            cacheWriteTokens,
            outputTokens,
            totalTokens,
            latencyMs == null ? null : Number(latencyMs),
          ]
        );
        return id;
      } catch (fallbackErr) {
        console.error(
          "[ai-usage] failed to log usage (fallback):",
          fallbackErr.message
        );
        return null;
      }
    }
    console.error("[ai-usage] failed to log usage:", error.message);
    return null;
  }
};

const listAiUsageEvents = async ({
  limit = 150,
  workspaceId = null,
  userId = null,
} = {}) => {
  const safeLimit = Math.min(Math.max(Number(limit) || 150, 1), 500);
  const params = [];
  const conditions = [];

  if (workspaceId) {
    conditions.push("u.workspace_id = ?");
    params.push(workspaceId);
  }
  if (userId) {
    conditions.push("u.user_id = ?");
    params.push(userId);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  let rows;
  try {
    const [result] = await pool.execute(
      `
      SELECT
        u.id,
        u.workspace_id AS workspaceId,
        u.thread_id AS threadId,
        u.user_id AS userId,
        u.assistant_id AS assistantId,
        u.source,
        u.workflow_run_id AS workflowRunId,
        u.workflow_node_id AS workflowNodeId,
        u.workflow_node_name AS workflowNodeName,
        u.generation_index AS generationIndex,
        u.model,
        u.provider AS storedProvider,
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
    rows = result;
  } catch (error) {
    if (
      !(
        error &&
        (error.code === "ER_BAD_FIELD_ERROR" ||
          /Unknown column/i.test(String(error.message || "")))
      )
    ) {
      throw error;
    }
    const [result] = await pool.execute(
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
    rows = result;
  }

  return rows.map((row) => ({
    ...row,
    source: row.source || null,
    workflowRunId: row.workflowRunId || null,
    workflowNodeId: row.workflowNodeId || null,
    workflowNodeName: row.workflowNodeName || null,
    generationIndex:
      row.generationIndex == null ? null : Number(row.generationIndex),
    provider:
      row.storedProvider || inferProviderFromModel(row.model),
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
  recordAiUsageEvent,
};
