const asyncHandler = require("../../utils/asyncHandler");
const analyticsService = require("./analytics.service");

const getOverview = asyncHandler(async (req, res) => {
  res.json(await analyticsService.getOverview());
});

const getChartData = asyncHandler(async (req, res) => {
  res.json(await analyticsService.getChartData(req.params.type));
});

const getDashboardStats = asyncHandler(async (req, res) => {
  res.json(await analyticsService.getDashboardStats());
});

module.exports = { getOverview, getChartData, getDashboardStats };
