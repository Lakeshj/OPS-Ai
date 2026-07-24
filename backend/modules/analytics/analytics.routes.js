const express = require("express");
const { requireRole } = require("../../middleware/auth");
const {
  getOverview,
  getChartData,
  getDashboardStats,
} = require("./analytics.controller");

const router = express.Router();

router.use(requireRole("Admin"));

router.get("/overview", getOverview);
router.get("/charts/:type", getChartData);
router.get("/dashboard-stats", getDashboardStats);

module.exports = router;
