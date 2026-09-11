const { v4: uuidv4 } = require("uuid");
const { pool } = require("../../config/database");
const AppError = require("../../utils/AppError");
const { assertWorkspaceAccess } = require("../../services/authorization.service");
const { encryptSecret, decryptSecret } = require("../../services/secretBox.service");
const oauth2 = require("../../services/genericOAuth2.service");

const HTTP_CREDENTIAL_TYPES = new Set([
  "bearer",
  "api_key_header",
  "basic",
  "query_param",
  "oauth2",
]);

const GOOGLE_CREDENTIAL_TYPES = new Set([
  "google_gsc",
  "google_ga4",
  "google_gmail",
  "google_sheets",
]);

const CREDENTIAL_TYPES = new Set([
  ...HTTP_CREDENTIAL_TYPES,
  ...GOOGLE_CREDENTIAL_TYPES,
]);

const parseConfig = (raw) => oauth2.parseConfig(raw);

/** Never returns the secret itself — only what is safe to render in the UI. */
const formatCredential = (row) => {
  const cfg = parseConfig(row.config_json);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    type: row.type,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    connected: row.type === "oauth2" ? Boolean(cfg.connected) : true,
    sharing: "workspace",
  };
};

const listByWorkspace = async (workspaceId, authUser) => {
  await assertWorkspaceAccess(authUser, workspaceId);
  const [rows] = await pool.execute(
    `SELECT * FROM workflow_credentials WHERE workspace_id = ? ORDER BY name ASC`,
    [workspaceId]
  );
  return rows.map(formatCredential);
};

const create = async ({ workspaceId, name, type, secret, config }, authUser) => {
  await assertWorkspaceAccess(authUser, workspaceId);

  if (GOOGLE_CREDENTIAL_TYPES.has(type)) {
    throw new AppError(
      "Connect Google from the credential picker — access tokens cannot be pasted",
      400,
      "VALIDATION_ERROR"
    );
  }
  if (!HTTP_CREDENTIAL_TYPES.has(type)) {
    throw new AppError(`Unsupported credential type: ${type}`, 400, "VALIDATION_ERROR");
  }
  if (!secret || typeof secret !== "object") {
    throw new AppError("secret object is required", 400, "VALIDATION_ERROR");
  }

  let configJson = null;
  if (type === "oauth2") {
    const checked = oauth2.validateOAuth2Config(
      { ...(config || {}), clientSecret: secret.clientSecret },
      { requireSecret: true }
    );
    if (checked.errors.length) {
      throw new AppError(checked.errors[0], 400, "VALIDATION_ERROR");
    }
    configJson = JSON.stringify({ ...checked.config, connected: false });
    secret = { clientSecret: String(secret.clientSecret || "") };
  } else if (config && Array.isArray(config.allowedDomains) && config.allowedDomains.length) {
    configJson = JSON.stringify({
      allowedDomains: config.allowedDomains.map((d) => String(d).trim()).filter(Boolean),
    });
  }

  const id = uuidv4();
  await pool.execute(
    `INSERT INTO workflow_credentials
      (id, workspace_id, name, type, secret_json, config_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      workspaceId,
      name,
      type,
      encryptSecret(secret),
      configJson,
      authUser.id || authUser.userId,
    ]
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

const getEditorView = async (id, authUser) => {
  const [rows] = await pool.execute(
    `SELECT * FROM workflow_credentials WHERE id = ?`,
    [id]
  );
  if (!rows.length) throw new AppError("Credential not found", 404, "NOT_FOUND");
  await assertWorkspaceAccess(authUser, rows[0].workspace_id);
  const row = rows[0];
  const formatted = formatCredential(row);
  if (row.type !== "oauth2") {
    return { ...formatted, editor: { allowedDomains: parseConfig(row.config_json).allowedDomains || [] } };
  }
  const secret = decryptSecret(row.secret_json);
  return {
    ...formatted,
    editor: {
      ...oauth2.editorSafeConfig(row.config_json),
      hasClientSecret: Boolean(secret && secret.clientSecret),
      hasAccessToken: Boolean(secret && secret.accessToken),
    },
  };
};

const getForWorkspace = async (credentialId, workspaceId) => {
  const [rows] = await pool.execute(
    `SELECT * FROM workflow_credentials WHERE id = ?`,
    [credentialId]
  );
  if (!rows.length) return null;
  if (workspaceId && rows[0].workspace_id !== workspaceId) return null;
  const row = rows[0];
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    workspaceId: row.workspace_id,
    secret: decryptSecret(row.secret_json),
    config: parseConfig(row.config_json),
  };
};

const saveSecretAndConfig = async (credentialId, secret, configObj) => {
  await pool.execute(
    `UPDATE workflow_credentials SET secret_json = ?, config_json = ? WHERE id = ?`,
    [encryptSecret(secret), JSON.stringify(configObj || {}), credentialId]
  );
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
  return {
    type: rows[0].type,
    name: rows[0].name,
    secret: decryptSecret(rows[0].secret_json),
    config: parseConfig(rows[0].config_json),
  };
};

module.exports = {
  listByWorkspace,
  create,
  remove,
  getEditorView,
  getForWorkspace,
  saveSecretAndConfig,
  getSecretForWorkspace,
  CREDENTIAL_TYPES,
  HTTP_CREDENTIAL_TYPES,
  GOOGLE_CREDENTIAL_TYPES,
  formatCredential,
};
