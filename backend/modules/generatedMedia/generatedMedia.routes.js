const express = require("express");
const path = require("path");
const { resolveMediaFile } = require("../../services/generatedMedia.service");
const AppError = require("../../utils/AppError");
const asyncHandler = require("../../utils/asyncHandler");

const router = express.Router();

router.get(
  "/:filename",
  asyncHandler(async (req, res) => {
    const filename = req.params.filename;
    const fullPath = await resolveMediaFile(filename);
    if (!fullPath) {
      throw new AppError("Media not found", 404, "NOT_FOUND");
    }
    const ext = path.extname(fullPath).toLowerCase();
    if (ext === ".mp4") res.type("video/mp4");
    else if (ext === ".webm") res.type("video/webm");
    else if (ext === ".png") res.type("image/png");
    else if (ext === ".jpg" || ext === ".jpeg") res.type("image/jpeg");
    else if (ext === ".webp") res.type("image/webp");
    else if (ext === ".gif") res.type("image/gif");

    const forceDownload =
      String(req.query.download || "") === "1" ||
      String(req.query.download || "").toLowerCase() === "true";

    if (forceDownload) {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${path.basename(filename)}"`
      );
    }

    res.sendFile(fullPath);
  })
);

module.exports = router;
