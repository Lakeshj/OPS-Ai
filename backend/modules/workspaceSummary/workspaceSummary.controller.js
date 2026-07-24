const asyncHandler = require("../../utils/asyncHandler");
const summaryService = require("../../services/workspaceSummary.service");

const get = asyncHandler(async (req, res) => {
  res.json(
    await summaryService.getSummaryWithVersions(
      req.params.workspaceId,
      req.user
    )
  );
});

const update = asyncHandler(async (req, res) => {
  res.json(
    await summaryService.updateSummary(
      req.params.workspaceId,
      req.body?.content,
      req.user
    )
  );
});

const regenerate = asyncHandler(async (req, res) => {
  res.json(
    await summaryService.regenerateSummaryForUser(
      req.params.workspaceId,
      req.user
    )
  );
});

const restore = asyncHandler(async (req, res) => {
  res.json(
    await summaryService.restoreVersion(
      req.params.workspaceId,
      req.params.versionId,
      req.user
    )
  );
});

module.exports = {
  get,
  update,
  regenerate,
  restore,
};
