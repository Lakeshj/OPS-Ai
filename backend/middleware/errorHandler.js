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

  // OpenAI / fetch-style errors often expose status + message
  const upstreamStatus = Number(err.status || err.statusCode || 0);
  if (upstreamStatus >= 400 && upstreamStatus < 600 && err.message) {
    return res.status(upstreamStatus >= 500 ? 502 : upstreamStatus).json({
      error: err.message,
      code: "UPSTREAM_ERROR",
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
