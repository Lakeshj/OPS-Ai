const validateCreate = (req) => {
  const errors = [];
  const { name, workspaceId } = req.body || {};
  if (!name || !String(name).trim()) errors.push("name is required");
  if (!workspaceId) errors.push("workspaceId is required");
  return errors;
};

const validateUpdate = (req) => {
  const errors = [];
  const body = req.body || {};
  if (body.name !== undefined && !String(body.name).trim()) {
    errors.push("name cannot be empty");
  }
  if (
    body.status !== undefined &&
    !["draft", "active", "archived"].includes(body.status)
  ) {
    errors.push("status must be draft, active, or archived");
  }
  return errors;
};

const CREDENTIAL_SECRET_FIELDS = {
  bearer: ["token"],
  api_key_header: ["headerName", "value"],
  basic: ["username", "password"],
  query_param: ["paramName", "value"],
};

const validateCredential = (req) => {
  const errors = [];
  const { workspaceId, name, type, secret } = req.body || {};
  if (!workspaceId) errors.push("workspaceId is required");
  if (!name || !String(name).trim()) errors.push("name is required");

  const required = CREDENTIAL_SECRET_FIELDS[type];
  if (!required) {
    errors.push(
      `type must be one of: ${Object.keys(CREDENTIAL_SECRET_FIELDS).join(", ")}`
    );
    return errors;
  }
  if (!secret || typeof secret !== "object") {
    errors.push("secret is required");
    return errors;
  }
  for (const field of required) {
    if (!String(secret[field] ?? "").trim()) {
      errors.push(`secret.${field} is required for ${type} credentials`);
    }
  }
  return errors;
};

module.exports = {
  validateCreate,
  validateUpdate,
  validateCredential,
};
