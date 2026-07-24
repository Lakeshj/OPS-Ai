const asyncHandler = require("../../utils/asyncHandler");
const settingsService = require("./adminAiSettings.service");

const get = asyncHandler(async (req, res) => {
  res.json(await settingsService.get());
});

const update = asyncHandler(async (req, res) => {
  res.json(await settingsService.update(req.body || {}, req.user));
});

module.exports = { get, update };
