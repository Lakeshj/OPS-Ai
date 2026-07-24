const { pool } = require("../../config/database");
const asyncHandler = require("../../utils/asyncHandler");

const getHealth = asyncHandler(async (req, res) => {
  let dbStatus = "disconnected";

  try {
    await pool.execute("SELECT 1");
    dbStatus = "connected";
  } catch {
    dbStatus = "disconnected";
  }

  const status = dbStatus === "connected" ? "ok" : "degraded";

  res.status(status === "ok" ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    services: {
      database: dbStatus,
    },
  });
});

module.exports = { getHealth };
