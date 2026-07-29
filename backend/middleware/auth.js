const jwt = require("jsonwebtoken");
const config = require("../config");
const AppError = require("../utils/AppError");
const { isDeveloperFlag } = require("../utils/platformOwner");

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return next(new AppError("Authentication required", 401, "UNAUTHORIZED"));
  }

  jwt.verify(token, config.jwt.secret, { algorithms: ["HS256"] }, (err, user) => {
    if (err) {
      return next(new AppError("Invalid or expired token", 401, "UNAUTHORIZED"));
    }
    req.user = user;
    next();
  });
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return next(new AppError("Authentication required", 401, "UNAUTHORIZED"));
  }

  if (!roles.includes(req.user.role)) {
    return next(new AppError("Insufficient permissions", 403, "FORBIDDEN"));
  }

  next();
};

/** Silent gate for developer account — no special role name exposed. */
const requirePlatformOwner = (req, res, next) => {
  if (!req.user || !isDeveloperFlag(req.user.isDeveloper)) {
    return next(new AppError("Insufficient permissions", 403, "FORBIDDEN"));
  }
  next();
};

module.exports = { authenticateToken, requireRole, requirePlatformOwner };
