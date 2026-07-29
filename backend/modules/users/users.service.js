const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcrypt");
const { pool } = require("../../config/database");
const { formatUser } = require("../../utils/formatters");
const AppError = require("../../utils/AppError");

const ALLOWED_ROLES = new Set(["Admin", "Project Manager", "Employee"]);

const assertPublicRole = (role) => {
  if (!ALLOWED_ROLES.has(role)) {
    throw new AppError("Invalid role", 400, "VALIDATION_ERROR");
  }
};

const getAll = async () => {
  const [rows] = await pool.execute("SELECT * FROM users");
  return rows.map(formatUser);
};

const getById = async (id) => {
  const [rows] = await pool.execute("SELECT * FROM users WHERE id = ?", [id]);
  if (rows.length === 0) {
    throw new AppError("User not found", 404, "NOT_FOUND");
  }
  return formatUser(rows[0]);
};

const create = async ({ name, email, role, password }) => {
  if (!password) {
    throw new AppError("Password is required", 400, "VALIDATION_ERROR");
  }

  assertPublicRole(role);

  const normalizedEmail = email.trim().toLowerCase();
  const [existingUsers] = await pool.execute(
    "SELECT id FROM users WHERE email = ?",
    [normalizedEmail]
  );

  if (existingUsers.length > 0) {
    throw new AppError("Email already exists!", 400, "EMAIL_EXISTS");
  }

  const id = uuidv4();
  const passwordHash = await bcrypt.hash(password, 10);

  await pool.execute(
    "INSERT INTO users (id, name, email, role, password) VALUES (?, ?, ?, ?, ?)",
    [id, name.trim(), normalizedEmail, role, passwordHash]
  );

  const [rows] = await pool.execute("SELECT * FROM users WHERE id = ?", [id]);
  return formatUser(rows[0]);
};

const update = async (id, { name, email, role, password }) => {
  const updateFields = [];
  const values = [];

  if (name !== undefined) {
    updateFields.push("name = ?");
    values.push(name.trim());
  }
  if (email !== undefined) {
    updateFields.push("email = ?");
    values.push(email.trim().toLowerCase());
  }
  if (role !== undefined) {
    assertPublicRole(role);
    updateFields.push("role = ?");
    values.push(role);
  }
  if (password !== undefined) {
    updateFields.push("password = ?");
    values.push(await bcrypt.hash(password, 10));
  }

  if (updateFields.length === 0) {
    throw new AppError("No fields to update", 400, "VALIDATION_ERROR");
  }

  values.push(id);
  await pool.execute(
    `UPDATE users SET ${updateFields.join(
      ", "
    )}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    values
  );

  return getById(id);
};

const remove = async (id) => {
  const [result] = await pool.execute("DELETE FROM users WHERE id = ?", [id]);
  if (result.affectedRows === 0) {
    throw new AppError("User not found", 404, "NOT_FOUND");
  }
};

module.exports = { getAll, getById, create, update, remove };
