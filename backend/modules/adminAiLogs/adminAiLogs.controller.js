const asyncHandler = require("../../utils/asyncHandler");
const { listAiErrorLogs } = require("../../services/aiErrorLog.service");
const { listAiUsageEvents } = require("../../services/aiUsageLog.service");
const {
  listModelsWithStatus,
  refreshModelStatuses,
} = require("../../services/aiModelStatus.service");

const listModels = asyncHandler(async (req, res) => {
  res.json(await listModelsWithStatus());
});

const refreshModels = asyncHandler(async (req, res) => {
  const results = await refreshModelStatuses();
  res.json({
    refreshedAt: new Date().toISOString(),
    results,
    models: await listModelsWithStatus(),
  });
});

const listLogs = asyncHandler(async (req, res) => {
  const limit = req.query.limit;
  const provider = req.query.provider || null;
  res.json(await listAiErrorLogs({ limit, provider }));
});

const listUsage = asyncHandler(async (req, res) => {
  const limit = req.query.limit;
  const workspaceId = req.query.workspaceId || null;
  const userId = req.query.userId || null;
  res.json(await listAiUsageEvents({ limit, workspaceId, userId }));
});

module.exports = { listModels, refreshModels, listLogs, listUsage };
