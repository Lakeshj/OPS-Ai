const asyncHandler = require("../../utils/asyncHandler");
const authService = require("./auth.service");

const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body);
  res.json(result);
});

const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body);
  res.status(201).json(result);
});

const forgotPassword = asyncHandler(async (req, res) => {
  const result = await authService.forgotPassword(req.body);
  res.json(result);
});

const verifyResetOtp = asyncHandler(async (req, res) => {
  const result = await authService.verifyResetOtp(req.body);
  res.json(result);
});

const resetPassword = asyncHandler(async (req, res) => {
  const result = await authService.resetPassword(req.body);
  res.json(result);
});

const me = asyncHandler(async (req, res) => {
  const user = await authService.getMe(req.user.userId);
  res.json(user);
});

module.exports = { login, register, forgotPassword, verifyResetOtp, resetPassword, me };
