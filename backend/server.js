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

const app = express();

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

app.use("/api/auth/login", authRateLimiter);
app.use("/api/auth/register", authRateLimiter);
app.use("/api/auth/forgot-password", authRateLimiter);
app.use("/api/auth/verify-reset-otp", authRateLimiter);
app.use("/api/auth/reset-password", authRateLimiter);
app.use("/api", apiRateLimiter);
app.use("/api", apiRoutes);

app.use(errorHandler);
app.use(notFoundHandler);

const startServer = () => {
  if (config.isProduction) {
    const options = {
      key: fs.readFileSync(config.ssl.keyPath),
      cert: fs.readFileSync(config.ssl.certPath),
    };

    const server = https.createServer(options, app);
    server.listen(config.port, () => {
      console.info(`https server is running on port ${config.port}`);
    });
    return server;
  }

  const server = app.listen(config.port, () => {
    console.info(`Node app listening on port ${config.port}`);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `Port ${config.port} is already in use. Stop the other backend process and try again.`
      );
      process.exit(1);
    }

    throw err;
  });

  return server;
};

const server = startServer();

const shutdown = () => {
  server.close(() => {
    process.exit(0);
  });
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

module.exports = app;
