const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const config = require("../config");

const helmetMiddleware = helmet({
  // Allow Next.js (different origin/port) to embed generated images/videos.
  crossOriginResourcePolicy: { policy: "cross-origin" },
  // Media is served from the API origin; keep default CSP on API responses.
});

const corsOrigins = (process.env.CORS_ORIGIN || "http://localhost:3001")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsMiddleware = cors({
  origin(origin, callback) {
    // Allow requests with no origin (mobile apps, curl) or from allowed list
    if (!origin || corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    console.warn(`CORS blocked for origin: ${origin}`);
    callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

const authRateLimiter = rateLimit({
  windowMs: config.rateLimit.authWindowMs,
  max: config.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many authentication attempts, please try again later",
    code: "RATE_LIMIT",
  },
});

const apiRateLimiter =
  config.env === "development"
    ? (_req, _res, next) => next()
    : rateLimit({
        windowMs: config.rateLimit.windowMs,
        max: config.rateLimit.max,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
          error: "Too many requests, please try again later",
          code: "RATE_LIMIT",
        },
      });

module.exports = {
  helmetMiddleware,
  corsMiddleware,
  authRateLimiter,
  apiRateLimiter,
};
