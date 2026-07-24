const { pool } = require("../config/database");
const { getClientForProvider } = require("../config/aiClients");
const { listAllCatalogModels } = require("../utils/aiProviders");

const markModelSuccess = async (provider, model) => {
  try {
    await pool.execute(
      `
      INSERT INTO ai_model_status (
        provider, model, available, last_error, last_status_code,
        fail_count, last_success_at
      ) VALUES (?, ?, 1, NULL, NULL, 0, NOW())
      ON DUPLICATE KEY UPDATE
        available = 1,
        last_error = NULL,
        last_status_code = NULL,
        fail_count = 0,
        last_success_at = NOW()
      `,
      [provider, model]
    );
  } catch (error) {
    console.error("[ai-model-status] success update failed:", error.message);
  }
};

const markModelFailure = async (provider, model, { message, statusCode } = {}) => {
  try {
    await pool.execute(
      `
      INSERT INTO ai_model_status (
        provider, model, available, last_error, last_status_code,
        fail_count, last_failure_at
      ) VALUES (?, ?, 0, ?, ?, 1, NOW())
      ON DUPLICATE KEY UPDATE
        available = 0,
        last_error = VALUES(last_error),
        last_status_code = VALUES(last_status_code),
        fail_count = fail_count + 1,
        last_failure_at = NOW()
      `,
      [
        provider,
        model,
        String(message || "Unknown error").slice(0, 2000),
        statusCode == null ? null : Number(statusCode),
      ]
    );
  } catch (error) {
    console.error("[ai-model-status] failure update failed:", error.message);
  }
};

const getModelStatusMap = async () => {
  const [rows] = await pool.execute(
    `
    SELECT
      provider,
      model,
      available,
      last_error AS lastError,
      last_status_code AS lastStatusCode,
      fail_count AS failCount,
      last_success_at AS lastSuccessAt,
      last_failure_at AS lastFailureAt,
      updated_at AS updatedAt
    FROM ai_model_status
    `
  );

  const map = {};
  for (const row of rows) {
    map[`${row.provider}::${row.model}`] = {
      available: Boolean(row.available),
      lastError: row.lastError,
      lastStatusCode: row.lastStatusCode,
      failCount: Number(row.failCount || 0),
      lastSuccessAt: row.lastSuccessAt,
      lastFailureAt: row.lastFailureAt,
      updatedAt: row.updatedAt,
    };
  }
  return map;
};

const listModelsWithStatus = async () => {
  const statusMap = await getModelStatusMap();
  return listAllCatalogModels().map((item) => {
    const status = statusMap[`${item.provider}::${item.id}`];
    return {
      ...item,
      available: status ? status.available : true,
      lastError: status?.lastError || null,
      lastStatusCode: status?.lastStatusCode || null,
      failCount: status?.failCount || 0,
      lastSuccessAt: status?.lastSuccessAt || null,
      lastFailureAt: status?.lastFailureAt || null,
      updatedAt: status?.updatedAt || null,
    };
  });
};

const probeChatModel = async (provider, modelId) => {
  const { client } = getClientForProvider(provider, modelId);
  await client.chat.completions.create({
    model: modelId,
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 1,
  });
};

const probeImageModel = async (provider, modelId) => {
  if (provider !== "openai") {
    throw new Error("Image probe only supported for OpenAI");
  }
  const { client } = getClientForProvider("openai");
  await client.images.generate({
    model: modelId,
    prompt: "tiny blue square icon",
    n: 1,
    size: "1024x1024",
  });
};

const refreshModelStatuses = async () => {
  const catalog = listAllCatalogModels();
  const results = [];

  for (const item of catalog) {
    const isImage = item.capabilities.includes("image");
    try {
      if (isImage) {
        await probeImageModel(item.provider, item.id);
      } else {
        await probeChatModel(item.provider, item.id);
      }
      await markModelSuccess(item.provider, item.id);
      results.push({
        provider: item.provider,
        model: item.id,
        available: true,
      });
    } catch (error) {
      const message = error?.error?.message || error?.message || "Probe failed";
      const statusCode = error?.status || error?.statusCode || null;
      await markModelFailure(item.provider, item.id, { message, statusCode });
      results.push({
        provider: item.provider,
        model: item.id,
        available: false,
        error: message,
        statusCode,
      });
    }
  }

  return results;
};

module.exports = {
  markModelSuccess,
  markModelFailure,
  getModelStatusMap,
  listModelsWithStatus,
  refreshModelStatuses,
};
