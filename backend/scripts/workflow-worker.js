const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const { testConnection } = require("../config/database");
const {
  startWorkflowWorker,
  stopWorkflowWorker,
} = require("../services/workflowWorker.service");

const main = async () => {
  const ok = await testConnection();
  if (!ok) {
    console.error("[workflow-worker] database connection failed");
    process.exit(1);
  }

  startWorkflowWorker();

  const stop = () => {
    stopWorkflowWorker();
    console.info("[workflow-worker] shutting down...");
    setTimeout(() => process.exit(0), 500);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
};

main();
