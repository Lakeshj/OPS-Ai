const express = require("express");
const { requireRole } = require("../../middleware/auth");
const {
  get,
  update,
  regenerate,
  restore,
} = require("./workspaceSummary.controller");

const router = express.Router({ mergeParams: true });

router.get("/", get);
router.put("/", requireRole("Admin", "Project Manager"), update);
router.post(
  "/regenerate",
  requireRole("Admin", "Project Manager"),
  regenerate
);
router.post(
  "/versions/:versionId/restore",
  requireRole("Admin", "Project Manager"),
  restore
);

module.exports = router;
