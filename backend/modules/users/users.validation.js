const validateCreateUser = (req) => {
  const errors = [];
  const { name, email, role, password } = req.body || {};
  const validRoles = ["Admin", "Project Manager", "Employee"];

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
  if (!role || !validRoles.includes(role)) errors.push("Valid role is required");

  return errors;
};

const validateUpdateUser = (req) => {
  const { name, email, role, password } = req.body || {};
  const validRoles = ["Admin", "Project Manager", "Employee"];
  const errors = [];

  if (!name && !email && !role && !password) {
    return ["No fields to update"];
  }
  if (name !== undefined && (typeof name !== "string" || !name.trim() || name.trim().length > 100))
    errors.push("Name is invalid");
  if (
    email !== undefined &&
    (typeof email !== "string" ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  )
    errors.push("Email is invalid");
  if (role !== undefined && !validRoles.includes(role))
    errors.push("Role is invalid");
  if (password !== undefined && (typeof password !== "string" || password.length < 8))
    errors.push("Password must be at least 8 characters");

  return errors;
};

module.exports = { validateCreateUser, validateUpdateUser };
