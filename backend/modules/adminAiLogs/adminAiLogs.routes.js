const express = require("express");
const { requireRole } = require("../../middleware/auth");
const {
  listModels,
  refreshModels,
  listLogs,
  listUsage,
} = require("./adminAiLogs.controller");

const router = express.Router();

router.use(requireRole("Admin"));
router.get("/models", listModels);
router.post("/models/refresh", refreshModels);
router.get("/errors", listLogs);
router.get("/usage", listUsage);

module.exports = router;
