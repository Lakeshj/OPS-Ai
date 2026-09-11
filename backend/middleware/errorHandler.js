const AppError = require("../utils/AppError");

const errorHandler = (err, req, res, next) => {
  console.error(`[${req.method} ${req.originalUrl}]`, err.message);

  if (err.isOperational) {
    return res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
  }

  if (err.code === "ER_DUP_ENTRY") {
    return res.status(409).json({
      error: "Resource already exists",
      code: "DUPLICATE_ENTRY",
    });
  }

  // OpenAI / fetch-style / Google provider errors often expose status + message.
  // Do not return 502 here — Cloudflare replaces origin 502 with its own
  // Bad Gateway HTML page, which breaks the SPA error toast.
  // Important: never forward provider 401 as HTTP 401 — the SPA treats 401 as
  // OpsAi session expiry and signs the user out (GSC/GA4 credential failures).
  const upstreamStatus = Number(err.status || err.statusCode || 0);
  if (upstreamStatus >= 400 && upstreamStatus < 600 && err.message) {
    let status = upstreamStatus >= 500 ? 500 : upstreamStatus;
    const code =
      typeof err.code === "string" && err.code ? err.code : "UPSTREAM_ERROR";
    if (status === 401) {
      status = 400;
    }
    return res.status(status).json({
      error: err.message,
      code,
    });
  }

  res.status(500).json({
    error: err.message || "Something went wrong!",
    code: "INTERNAL_ERROR",
  });
};

const notFoundHandler = (req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
    code: "NOT_FOUND",
  });
};

module.exports = { errorHandler, notFoundHandler };
