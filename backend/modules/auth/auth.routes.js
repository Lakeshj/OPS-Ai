const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateToken } = require("../../middleware/auth");
const {
  login,
  register,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  me,
} = require("./auth.controller");
const {
  validateLogin,
  validateRegister,
  validateForgotPassword,
  validateVerifyResetOtp,
  validateResetPassword,
} = require("./auth.validation");

const router = express.Router();

router.post("/login", validate(validateLogin), login);
router.post("/register", validate(validateRegister), register);
router.post("/forgot-password", validate(validateForgotPassword), forgotPassword);
router.post("/verify-reset-otp", validate(validateVerifyResetOtp), verifyResetOtp);
router.post("/reset-password", validate(validateResetPassword), resetPassword);
router.get("/me", authenticateToken, me);

module.exports = router;
