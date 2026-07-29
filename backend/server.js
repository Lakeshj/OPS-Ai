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

app.use("/auth/login", authRateLimiter);
app.use("/auth/register", authRateLimiter);
app.use("/auth/forgot-password", authRateLimiter);
app.use("/auth/verify-reset-otp", authRateLimiter);
app.use("/auth/reset-password", authRateLimiter);
app.use("/", apiRateLimiter);
app.use("/", apiRoutes);

app.use(errorHandler);
app.use(notFoundHandler);

const attachServerErrorHandler = (server) => {
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

const readSslCredentials = () => {
  const keyPath = config.ssl.keyPath;
  const certPath = config.ssl.certPath;

  if (!keyPath || !certPath) {
    throw new Error(
      "SSL_KEY_PATH and SSL_CERT_PATH must be set when USE_NODE_HTTPS=true"
    );
  }

  if (!fs.existsSync(keyPath)) {
    throw new Error(`SSL key file not found: ${keyPath}`);
  }

  if (!fs.existsSync(certPath)) {
    throw new Error(`SSL cert file not found: ${certPath}`);
  }

  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };
};

const startServer = () => {
  const useNodeHttps = process.env.USE_NODE_HTTPS === "true";

  if (useNodeHttps) {
    const server = attachServerErrorHandler(
      https.createServer(readSslCredentials(), app).listen(config.port, () => {
        console.info(`HTTPS server listening on port ${config.port}`);
      })
    );
    return server;
  }

  const server = attachServerErrorHandler(
    app.listen(config.port, () => {
      console.info(`HTTP server listening on port ${config.port}`);
    })
  );

  return server;
};

let server;
try {
  server = startServer();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Failed to start server"
  );
  process.exit(1);
}

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
