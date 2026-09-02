const { v4: uuidv4 } = require("uuid");
const { pool } = require("../../config/database");
const AppError = require("../../utils/AppError");
const { assertWorkspaceAccess } = require("../../services/authorization.service");
const { encryptSecret, decryptSecret } = require("../../services/secretBox.service");

const CREDENTIAL_TYPES = new Set([
  "bearer",
  "api_key_header",
  "basic",
  "query_param",
]);

/** Never returns the secret itself — only what is safe to render in the UI. */
const formatCredential = (row) => ({
  id: row.id,
  workspaceId: row.workspace_id,
  name: row.name,
  type: row.type,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const listByWorkspace = async (workspaceId, authUser) => {
  await assertWorkspaceAccess(authUser, workspaceId);
  const [rows] = await pool.execute(
    `SELECT * FROM workflow_credentials WHERE workspace_id = ? ORDER BY name ASC`,
    [workspaceId]
  );
  return rows.map(formatCredential);
};

const create = async ({ workspaceId, name, type, secret }, authUser) => {
  await assertWorkspaceAccess(authUser, workspaceId);

  if (!CREDENTIAL_TYPES.has(type)) {
    throw new AppError(`Unsupported credential type: ${type}`, 400, "VALIDATION_ERROR");
  }
  if (!secret || typeof secret !== "object") {
    throw new AppError("secret object is required", 400, "VALIDATION_ERROR");
  }

  const id = uuidv4();
  await pool.execute(
    `INSERT INTO workflow_credentials
      (id, workspace_id, name, type, secret_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, workspaceId, name, type, encryptSecret(secret), authUser.id]
  );

  const [rows] = await pool.execute(
    `SELECT * FROM workflow_credentials WHERE id = ?`,
    [id]
  );
  return formatCredential(rows[0]);
};

const remove = async (id, authUser) => {
  const [rows] = await pool.execute(
    `SELECT * FROM workflow_credentials WHERE id = ?`,
    [id]
  );
  if (rows.length === 0) {
    throw new AppError("Credential not found", 404, "NOT_FOUND");
  }
  await assertWorkspaceAccess(authUser, rows[0].workspace_id);
  await pool.execute(`DELETE FROM workflow_credentials WHERE id = ?`, [id]);
};

/**
 * Engine-side lookup. Workspace-scoped so a workflow cannot reference another
 * workspace's secrets, and the plaintext never leaves this call.
 */
const getSecretForWorkspace = async (credentialId, workspaceId) => {
  const [rows] = await pool.execute(
    `SELECT * FROM workflow_credentials WHERE id = ?`,
    [credentialId]
  );
  if (rows.length === 0) {
    throw new Error("Credential not found — re-select it in the node settings");
  }
  if (workspaceId && rows[0].workspace_id !== workspaceId) {
    throw new Error("Credential belongs to a different workspace");
  }
  return { type: rows[0].type, name: rows[0].name, secret: decryptSecret(rows[0].secret_json) };
};

module.exports = {
  listByWorkspace,
  create,
  remove,
  getSecretForWorkspace,
  CREDENTIAL_TYPES,
};
