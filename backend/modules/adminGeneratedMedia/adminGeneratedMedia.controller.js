const asyncHandler = require("../../utils/asyncHandler");
const AppError = require("../../utils/AppError");
const {
  listGeneratedMedia,
  deleteGeneratedMedia,
  getGeneratedMediaStats,
} = require("../../services/generatedMedia.service");

const list = asyncHandler(async (_req, res) => {
  const [items, stats] = await Promise.all([
    listGeneratedMedia(),
    getGeneratedMediaStats(),
  ]);
  res.json({ items, stats });
});

const remove = asyncHandler(async (req, res) => {
  const filename = String(req.params.filename || "");
  const deleted = await deleteGeneratedMedia(filename);
  if (!deleted) {
    throw new AppError("Media file not found", 404, "NOT_FOUND");
  }
  res.status(204).send();
});

const purge = asyncHandler(async (req, res) => {
  const kind = String(req.query.kind || "all").toLowerCase();
  const items = await listGeneratedMedia();
  const targets = items.filter((row) => {
    if (kind === "image" || kind === "video") return row.kind === kind;
    return true;
  });

  let deleted = 0;
  for (const row of targets) {
    if (await deleteGeneratedMedia(row.filename)) deleted += 1;
  }

  res.json({
    deleted,
    remaining: (await listGeneratedMedia()).length,
  });
});

module.exports = { list, remove, purge };
