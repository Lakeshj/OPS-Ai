const { v4: uuidv4 } = require("uuid");
const { randomInt } = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { pool } = require("../../config/database");
const config = require("../../config");
const AppError = require("../../utils/AppError");
const { withOwnerCapabilities } = require("../../utils/platformOwner");
const { sendPasswordResetOtp } = require("../../services/mailer.service");

const toPublicUser = (user) => withOwnerCapabilities(user);

const signToken = (user) =>
  jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      isDeveloper: Boolean(user.is_developer === true || user.is_developer === 1),
    },
    config.jwt.secret,
    { algorithm: "HS256", expiresIn: config.jwt.expiresIn }
  );

const login = async ({ email, password }) => {
  const [users] = await pool.execute("SELECT * FROM users WHERE email = ?", [
    email.trim().toLowerCase(),
  ]);

  if (users.length === 0) {
    throw new AppError("Invalid credentials", 401, "INVALID_CREDENTIALS");
  }

  const user = users[0];

  if (!user.password || typeof user.password !== "string") {
    throw new AppError("Invalid credentials", 401, "INVALID_CREDENTIALS");
  }

  const validPassword = await bcrypt.compare(password, user.password);

  if (!validPassword) {
    throw new AppError("Invalid credentials", 401, "INVALID_CREDENTIALS");
  }

  return {
    token: signToken(user),
    user: toPublicUser(user),
  };
};

const register = async ({ name, email, password }) => {
  const normalizedEmail = email.trim().toLowerCase();
  const [existingUsers] = await pool.execute(
    "SELECT id FROM users WHERE email = ?",
    [normalizedEmail]
  );

  if (existingUsers.length > 0) {
    throw new AppError("Email already registered", 400, "EMAIL_EXISTS");
  }

  const id = uuidv4();
  const passwordHash = await bcrypt.hash(password, 10);

  await pool.execute(
    "INSERT INTO users (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)",
    [id, name.trim(), normalizedEmail, passwordHash, "Employee"]
  );

  const [newUser] = await pool.execute(
    "SELECT id, name, email, role, created_at FROM users WHERE email = ?",
    [normalizedEmail]
  );

  return {
    token: signToken(newUser[0]),
    user: toPublicUser(newUser[0]),
  };
};

const ensureOtpTable = async () => {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS password_reset_otps (
      id VARCHAR(36) NOT NULL PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      email VARCHAR(255) NOT NULL,
      otp_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      verified_at DATETIME NULL,
      used_at DATETIME NULL,
      attempts INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
};

const generateOtp = () => randomInt(100000, 1000000).toString();

const forgotPassword = async ({ email }) => {
  await ensureOtpTable();
  const normalizedEmail = email.trim().toLowerCase();

  const [users] = await pool.execute(
    "SELECT id, email FROM users WHERE email = ? LIMIT 1",
    [normalizedEmail]
  );

  if (users.length === 0) {
    return {
      message: "If an account exists with this email, an OTP has been sent.",
    };
  }

  const user = users[0];
  const otp = generateOtp();
  const otpHash = await bcrypt.hash(otp, 10);
  const otpId = uuidv4();
  const expiresAt = new Date(Date.now() + config.otp.expiresMinutes * 60 * 1000);

  await pool.execute(
    "UPDATE password_reset_otps SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL",
    [user.id]
  );

  await pool.execute(
    "INSERT INTO password_reset_otps (id, user_id, email, otp_hash, expires_at) VALUES (?, ?, ?, ?, ?)",
    [otpId, user.id, user.email, otpHash, expiresAt]
  );

  await sendPasswordResetOtp(user.email, otp);

  return {
    message: "If an account exists with this email, an OTP has been sent.",
  };
};

const verifyResetOtp = async ({ email, otp }) => {
  await ensureOtpTable();
  const normalizedEmail = email.trim().toLowerCase();

  const [rows] = await pool.execute(
    `SELECT * FROM password_reset_otps
     WHERE email = ? AND used_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [normalizedEmail]
  );

  if (rows.length === 0) {
    throw new AppError("OTP not found. Request a new OTP.", 400, "OTP_INVALID");
  }

  const record = rows[0];
  if (new Date(record.expires_at).getTime() < Date.now()) {
    throw new AppError("OTP expired. Request a new OTP.", 400, "OTP_EXPIRED");
  }

  const isMatch = await bcrypt.compare(otp, record.otp_hash);
  if (!isMatch) {
    const attempts = record.attempts + 1;
    if (attempts >= config.otp.maxAttempts) {
      await pool.execute(
        "UPDATE password_reset_otps SET attempts = ?, used_at = NOW() WHERE id = ?",
        [attempts, record.id]
      );
      throw new AppError("Too many invalid OTP attempts.", 429, "OTP_LOCKED");
    }
    await pool.execute("UPDATE password_reset_otps SET attempts = ? WHERE id = ?", [
      attempts,
      record.id,
    ]);
    throw new AppError("Invalid OTP.", 400, "OTP_INVALID");
  }

  await pool.execute(
    "UPDATE password_reset_otps SET verified_at = NOW() WHERE id = ?",
    [record.id]
  );

  const resetToken = jwt.sign(
    {
      purpose: "password_reset",
      otpId: record.id,
      userId: record.user_id,
      email: normalizedEmail,
    },
    config.jwt.secret,
    {
      algorithm: "HS256",
      expiresIn: `${config.otp.resetTokenMinutes}m`,
    }
  );

  return {
    message: "OTP verified successfully.",
    resetToken,
  };
};

const resetPassword = async ({ resetToken, newPassword, confirmPassword }) => {
  if (newPassword !== confirmPassword) {
    throw new AppError("Passwords do not match.", 400, "PASSWORD_MISMATCH");
  }

  let payload;
  try {
    payload = jwt.verify(resetToken, config.jwt.secret, {
      algorithms: ["HS256"],
    });
  } catch {
    throw new AppError("Invalid or expired reset token.", 401, "INVALID_RESET_TOKEN");
  }

  if (payload.purpose !== "password_reset") {
    throw new AppError("Invalid reset token.", 401, "INVALID_RESET_TOKEN");
  }

  const [rows] = await pool.execute(
    "SELECT * FROM password_reset_otps WHERE id = ? LIMIT 1",
    [payload.otpId]
  );
  if (rows.length === 0) {
    throw new AppError("Reset request not found.", 400, "RESET_NOT_FOUND");
  }

  const record = rows[0];
  if (
    record.user_id !== payload.userId ||
    record.email.toLowerCase() !== String(payload.email).toLowerCase()
  ) {
    throw new AppError("Invalid reset token.", 401, "INVALID_RESET_TOKEN");
  }
  if (record.used_at) {
    throw new AppError("Reset token already used.", 400, "RESET_ALREADY_USED");
  }
  if (!record.verified_at) {
    throw new AppError("OTP not verified.", 400, "OTP_NOT_VERIFIED");
  }
  if (new Date(record.expires_at).getTime() < Date.now()) {
    throw new AppError("Reset request expired.", 400, "RESET_EXPIRED");
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await pool.execute("UPDATE users SET password = ? WHERE id = ?", [
    passwordHash,
    payload.userId,
  ]);
  await pool.execute("UPDATE password_reset_otps SET used_at = NOW() WHERE id = ?", [
    record.id,
  ]);

  return { message: "Password has been reset successfully." };
};

const getMe = async (userId) => {
  const [users] = await pool.execute(
    "SELECT id, name, email, role, is_developer, created_at, updated_at FROM users WHERE id = ?",
    [userId]
  );

  if (users.length === 0) {
    throw new AppError("User not found", 404, "NOT_FOUND");
  }

  return toPublicUser(users[0]);
};

module.exports = {
  login,
  register,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  getMe,
};
