const validateLogin = (req) => {
  const errors = [];
  const { email, password } = req.body || {};

  if (!email || typeof email !== "string") errors.push("Email is required");
  if (!password || typeof password !== "string")
    errors.push("Password is required");

  return errors;
};

const validateRegister = (req) => {
  const errors = [];
  const { name, email, password, role } = req.body || {};

  if (!name || typeof name !== "string" || name.trim().length > 100)
    errors.push("A valid name is required");
  if (
    !email ||
    typeof email !== "string" ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )
    errors.push("A valid email is required");
  if (!password || typeof password !== "string" || password.length < 8)
    errors.push("Password must be at least 8 characters");
  if (role && role !== "Employee")
    errors.push("Role cannot be assigned during registration");

  return errors;
};

const validateForgotPassword = (req) => {
  const errors = [];
  const { email } = req.body || {};

  if (!email || typeof email !== "string") errors.push("Email is required");

  return errors;
};

const validateVerifyResetOtp = (req) => {
  const errors = [];
  const { email, otp } = req.body || {};

  if (!email || typeof email !== "string") errors.push("Email is required");
  if (!otp || typeof otp !== "string" || otp.length < 6)
    errors.push("Valid OTP is required");

  return errors;
};

const validateResetPassword = (req) => {
  const errors = [];
  const { resetToken, newPassword, confirmPassword } = req.body || {};

  if (!resetToken || typeof resetToken !== "string")
    errors.push("resetToken is required");
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 6)
    errors.push("New password must be at least 6 characters");
  if (!confirmPassword || typeof confirmPassword !== "string")
    errors.push("Confirm password is required");

  return errors;
};

module.exports = {
  validateLogin,
  validateRegister,
  validateForgotPassword,
  validateVerifyResetOtp,
  validateResetPassword,
};
