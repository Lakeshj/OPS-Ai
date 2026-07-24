const AppError = require("../utils/AppError");

const validate = (schemaFn) => (req, res, next) => {
  const result = schemaFn(req);

  if (result && result.length > 0) {
    return next(new AppError(result.join("; "), 400, "VALIDATION_ERROR"));
  }

  next();
};

module.exports = validate;
