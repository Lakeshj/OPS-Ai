const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const env = process.env.NODE_ENV || "development";
const jwtSecret = process.env.JWT_SECRET;
const credentialsKey = process.env.WORKFLOW_CREDENTIALS_KEY;

if (env === "production" && (!jwtSecret || jwtSecret === "your-secret-key")) {
  throw new Error("JWT_SECRET must be set to a strong value in production");
}

if (env === "production" && !credentialsKey) {
  throw new Error(
    "WORKFLOW_CREDENTIALS_KEY must be set in production (32+ random chars) to encrypt stored workflow credentials"
  );
}

const config = {
  env,
  port: parseInt(process.env.PORT, 10) || 5013,
  isProduction:
    process.env.NODE_ENV === "production" ||
    process.env.NODE_ENV === "testing",
  db: {
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "opsai",
    connectionLimit: 10,
  },
  jwt: {
    secret: jwtSecret || "development-only-secret-change-me",
    expiresIn: process.env.JWT_EXPIRES_IN || "12h",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  },
  workflows: {
    // Encrypts workflow credentials at rest. Falls back to the JWT secret in
    // development so local setups keep working without extra configuration.
    credentialsKey:
      credentialsKey || jwtSecret || "development-only-secret-change-me",
  },
  storage: {
    root: path.resolve(
      __dirname,
      "..",
      process.env.STATIC_MEMORY_STORAGE_PATH || "storage/static-memory"
    ),
    maxFileSizeBytes:
      (parseInt(process.env.STATIC_MEMORY_MAX_FILE_MB, 10) || 25) *
      1024 *
      1024,
    maxWorkspaceBytes:
      (parseInt(process.env.STATIC_MEMORY_WORKSPACE_QUOTA_MB, 10) || 500) *
      1024 *
      1024,
  },
  ssl: {
    keyPath: process.env.SSL_KEY_PATH || "",
    certPath: process.env.SSL_CERT_PATH || "",
  },
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:3001",
  },
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 2000,
    authWindowMs: 15 * 60 * 1000,
    authMax: parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10) || 50,
  },
  otp: {
    expiresMinutes: parseInt(process.env.OTP_EXPIRES_MINUTES, 10) || 10,
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS, 10) || 5,
    resetTokenMinutes: parseInt(process.env.RESET_TOKEN_MINUTES, 10) || 10,
  },
  smtp: {
    host: (process.env.SMTP_HOST || "").trim(),
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === "true",
    user: (process.env.SMTP_USER || "").trim(),
    pass: (process.env.SMTP_PASS || "").trim().replace(/^["']|["']$/g, ""),
    from: (process.env.SMTP_FROM || "no-reply@opsai.local").trim(),
  },
};

module.exports = config;
