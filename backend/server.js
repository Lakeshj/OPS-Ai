const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const https = require("https");
const fs = require("fs");

const config = require("./config");
const { testConnection } = require("./config/database");
const {
  resumePendingDocumentConversions,
} = require("./services/documentProcessing.service");
const apiRoutes = require("./routes");
const {
  errorHandler,
  notFoundHandler,
} = require("./middleware/errorHandler");
const {
  helmetMiddleware,
  corsMiddleware,
  authRateLimiter,
  apiRateLimiter,
} = require("./middleware/security");
const {
  startWorkflowWorker,
  stopWorkflowWorker,
} = require("./services/workflowWorker.service");
const {
  startWorkflowScheduler,
  stopWorkflowScheduler,
} = require("./services/workflowScheduler.service");

const app = express();
app.set("trust proxy", 1);

app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(express.json({ limit: "15mb" }));

testConnection().then((connected) => {
  if (!connected) return;

  resumePendingDocumentConversions().catch((error) => {
    console.error(
      "[document-conversion] Failed to resume pending documents:",
      error.message
    );
  });
});

app.use("/auth/login", authRateLimiter);
app.use("/auth/register", authRateLimiter);
app.use("/auth/forgot-password", authRateLimiter);
app.use("/auth/verify-reset-otp", authRateLimiter);
app.use("/auth/reset-password", authRateLimiter);

app.use("/", apiRateLimiter);
app.use("/", apiRoutes);

app.use(errorHandler);
app.use(notFoundHandler);

const readSslCredentials = () => {
  const { keyPath, certPath } = config.ssl;

  if (!keyPath || !certPath) {
    throw new Error(
      "SSL_KEY_PATH and SSL_CERT_PATH must be configured."
    );
  }

  if (!fs.existsSync(keyPath)) {
    throw new Error(`SSL key file not found: ${keyPath}`);
  }

  if (!fs.existsSync(certPath)) {
    throw new Error(`SSL certificate file not found: ${certPath}`);
  }

  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };
};

const attachServerErrorHandler = (server) => {
  server.on("error", (err) => {
    switch (err.code) {
      case "EADDRINUSE":
        console.error(
          `❌ Port ${config.port} is already in use. Stop the existing process or choose another port.`
        );
        break;

      case "EACCES":
        console.error(
          `❌ Permission denied. Cannot bind to port ${config.port}.`
        );
        break;

      default:
        console.error("❌ Server Error:", err);
    }

    process.exit(1);
  });

  return server;
};

// Same file for local + prod:
// - SSL paths set (prod) → HTTPS
// - SSL paths empty (local) → HTTP, no certs needed
const useHttps = Boolean(config.ssl.keyPath && config.ssl.certPath);

let server;
try {
  if (useHttps) {
    const sslCredentials = readSslCredentials();
    server = attachServerErrorHandler(
      https.createServer(sslCredentials, app)
    );
    server.listen(config.port, () => {
      console.info(
        `✅ HTTPS server is running on https://localhost:${config.port}`
      );
      if (process.env.WORKFLOW_WORKER_EMBEDDED !== "false") {
        startWorkflowWorker();
      }
      if (process.env.WORKFLOW_SCHEDULER_EMBEDDED !== "false") {
        startWorkflowScheduler();
      }
    });
  } else {
    server = attachServerErrorHandler(app.listen(config.port, () => {
      console.info(
        `✅ HTTP server is running on http://localhost:${config.port} (no SSL_KEY_PATH/SSL_CERT_PATH — local mode)`
      );
      if (process.env.WORKFLOW_WORKER_EMBEDDED !== "false") {
        startWorkflowWorker();
      }
      if (process.env.WORKFLOW_SCHEDULER_EMBEDDED !== "false") {
        startWorkflowScheduler();
      }
    }));
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Failed to start server"
  );
  process.exit(1);
}

const shutdown = () => {
  console.info("Gracefully shutting down server...");
  stopWorkflowWorker();
  stopWorkflowScheduler();

  server.close((err) => {
    if (err) {
      console.error("Error during shutdown:", err);
      process.exit(1);
    }

    console.info("Server stopped.");
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Promise Rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

module.exports = app;
