const { v4: uuidv4 } = require("uuid");
const { pool } = require("../../config/database");
const AppError = require("../../utils/AppError");
const { assertWorkspaceAccess } = require("../../services/authorization.service");
const { encryptSecret, decryptSecret } = require("../../services/secretBox.service");
const oauth2 = require("../../services/genericOAuth2.service");
const registry = require("../../services/connectionRegistry.service");
const {
  OAUTH_APP_MODE,
  redirectUri: googleRedirectUri,
  platformClientConfigured,
} = require("../../services/googleOAuth.service");

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

const googleConnected = (secret, cfg) =>
  Boolean(cfg?.connected) || Boolean(secret?.accessToken);

const normalizeSharingScope = (raw) => {
  const value = String(raw || "all").trim();
  if (value === "workspace" || value === "users") return value;
  return "all";
};

const sharingLabel = (scope) => {
  if (scope === "users") return "Specific users";
  if (scope === "workspace") return "This workspace only";
  return "All users and projects";
};

/** Never returns the secret itself — only what is safe to render in the UI. */
const formatCredential = (row) => {
  const cfg = parseConfig(row.config_json);
  const isGoogle = GOOGLE_CREDENTIAL_TYPES.has(row.type);
  const isOauth2 = row.type === "oauth2";
  const sharingScope = normalizeSharingScope(cfg.sharingScope);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    type: row.type,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    connected: isOauth2
      ? Boolean(cfg.connected)
      : isGoogle
        ? cfg.connected === undefined
          ? true
          : Boolean(cfg.connected)
        : true,
    sharing: sharingScope,
    sharingLabel: sharingLabel(sharingScope),
    oauthAppMode: isGoogle
      ? cfg.oauthAppMode ||
        (platformClientConfigured()
          ? OAUTH_APP_MODE.PLATFORM_MANAGED
          : OAUTH_APP_MODE.CUSTOM_APP)
      : undefined,
    accountEmail:
      isGoogle && cfg.accountEmail ? String(cfg.accountEmail) : undefined,
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

const validateGoogleCreate = ({ type, secret, config }) => {
  const entry = registry.getSupportedPredefined(type);
  const errors = [];
  const defaultMode = platformClientConfigured()
    ? OAUTH_APP_MODE.PLATFORM_MANAGED
    : OAUTH_APP_MODE.CUSTOM_APP;
  const mode = String(config?.oauthAppMode || defaultMode).trim();
  if (
    mode !== OAUTH_APP_MODE.CUSTOM_APP &&
    mode !== OAUTH_APP_MODE.PLATFORM_MANAGED
  ) {
    errors.push("oauthAppMode must be CUSTOM_APP or PLATFORM_MANAGED");
  }
  if (mode === OAUTH_APP_MODE.CUSTOM_APP) {
    if (!String(config?.clientId || "").trim()) {
      errors.push("Client ID is required");
    }
    if (!String(secret?.clientSecret || "").trim()) {
      errors.push("Client Secret is required");
    }
  } else if (!platformClientConfigured()) {
    errors.push(
      "Google sign-in is not available on this OpsAi instance yet. Please contact your workspace administrator."
    );
  }
  return {
    errors,
    mode,
    defaults: entry
      ? {
          allowedDomains: [...(entry.allowedDomains || [])],
          defaultScopes: [...(entry.oauth?.defaultScopes || [])],
        }
      : { allowedDomains: [], defaultScopes: [] },
  };
};

const create = async ({ workspaceId, name, type, secret, config }, authUser) => {
  await assertWorkspaceAccess(authUser, workspaceId);

  if (!secret || typeof secret !== "object") {
    throw new AppError("secret object is required", 400, "VALIDATION_ERROR");
  }

  let configJson = null;
  let secretPayload = secret;

  if (GOOGLE_CREDENTIAL_TYPES.has(type)) {
    const checked = validateGoogleCreate({ type, secret, config });
    if (checked.errors.length) {
      throw new AppError(checked.errors[0], 400, "VALIDATION_ERROR");
    }
    const allowedDomains =
      Array.isArray(config?.allowedDomains) && config.allowedDomains.length
        ? config.allowedDomains.map((d) => String(d).trim()).filter(Boolean)
        : checked.defaults.allowedDomains;
    const customScopes = String(config?.customScopes || "").trim();
    const sharingScope = normalizeSharingScope(config?.sharingScope);
    configJson = JSON.stringify({
      oauthAppMode: checked.mode,
      clientId:
        checked.mode === OAUTH_APP_MODE.CUSTOM_APP
          ? String(config.clientId || "").trim()
          : undefined,
      allowedDomains,
      customScopes: customScopes || undefined,
      sharingScope,
      connected: false,
    });
    secretPayload =
      checked.mode === OAUTH_APP_MODE.CUSTOM_APP
        ? {
            clientSecret: String(secret.clientSecret || ""),
            oauthAppMode: checked.mode,
          }
        : { oauthAppMode: checked.mode };
  } else if (!HTTP_CREDENTIAL_TYPES.has(type)) {
    throw new AppError(
      `Unsupported credential type: ${type}`,
      400,
      "VALIDATION_ERROR"
    );
  } else if (type === "oauth2") {
    const checked = oauth2.validateOAuth2Config(
      { ...(config || {}), clientSecret: secret.clientSecret },
      { requireSecret: true }
    );
    if (checked.errors.length) {
      throw new AppError(checked.errors[0], 400, "VALIDATION_ERROR");
    }
    configJson = JSON.stringify({
      ...checked.config,
      connected: false,
      sharingScope: normalizeSharingScope(config?.sharingScope),
    });
    secretPayload = { clientSecret: String(secret.clientSecret || "") };
  } else if (
    config &&
    Array.isArray(config.allowedDomains) &&
    config.allowedDomains.length
  ) {
    configJson = JSON.stringify({
      allowedDomains: config.allowedDomains
        .map((d) => String(d).trim())
        .filter(Boolean),
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
      encryptSecret(secretPayload),
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

const update = async (credentialId, { name, secret, config }, authUser) => {
  const [rows] = await pool.execute(
    `SELECT * FROM workflow_credentials WHERE id = ?`,
    [credentialId]
  );
  if (!rows.length) throw new AppError("Credential not found", 404, "NOT_FOUND");
  await assertWorkspaceAccess(authUser, rows[0].workspace_id);
  const row = rows[0];
  const existingSecret = decryptSecret(row.secret_json) || {};
  const existingConfig = parseConfig(row.config_json);

  if (!GOOGLE_CREDENTIAL_TYPES.has(row.type)) {
    throw new AppError(
      "Updating this connection type is not supported here",
      400,
      "VALIDATION_ERROR"
    );
  }

  const mode = String(
    config?.oauthAppMode ||
      existingConfig.oauthAppMode ||
      (platformClientConfigured()
        ? OAUTH_APP_MODE.PLATFORM_MANAGED
        : OAUTH_APP_MODE.CUSTOM_APP)
  ).trim();
  const nextClientId =
    config?.clientId !== undefined
      ? String(config.clientId || "").trim()
      : String(existingConfig.clientId || "").trim();
  const nextSecret =
    secret?.clientSecret !== undefined &&
    String(secret.clientSecret || "").trim()
      ? String(secret.clientSecret).trim()
      : existingSecret.clientSecret || "";
  if (mode === OAUTH_APP_MODE.CUSTOM_APP) {
    if (!nextClientId) {
      throw new AppError("Client ID is required", 400, "VALIDATION_ERROR");
    }
    if (!nextSecret) {
      throw new AppError("Client Secret is required", 400, "VALIDATION_ERROR");
    }
  }
  const entry = registry.getSupportedPredefined(row.type);
  const allowedDomains =
    Array.isArray(config?.allowedDomains) && config.allowedDomains.length
      ? config.allowedDomains.map((d) => String(d).trim()).filter(Boolean)
      : existingConfig.allowedDomains ||
        (entry ? [...(entry.allowedDomains || [])] : []);
  const customScopes =
    config?.customScopes !== undefined
      ? String(config.customScopes || "").trim()
      : existingConfig.customScopes || "";
  const nextConfig = {
    ...existingConfig,
    oauthAppMode: mode,
    clientId: mode === OAUTH_APP_MODE.CUSTOM_APP ? nextClientId : undefined,
    allowedDomains,
    customScopes: customScopes || undefined,
    sharingScope:
      config?.sharingScope !== undefined
        ? normalizeSharingScope(config.sharingScope)
        : normalizeSharingScope(existingConfig.sharingScope),
    connected: googleConnected(existingSecret, existingConfig),
    accountEmail: existingConfig.accountEmail,
  };
  const nextSecretObj = {
    ...existingSecret,
    oauthAppMode: mode,
    clientSecret: mode === OAUTH_APP_MODE.CUSTOM_APP ? nextSecret : undefined,
  };
  await pool.execute(
    `UPDATE workflow_credentials
        SET name = ?, secret_json = ?, config_json = ?
      WHERE id = ?`,
    [
      name != null ? String(name).trim() : row.name,
      encryptSecret(nextSecretObj),
      JSON.stringify(nextConfig),
      credentialId,
    ]
  );

  const [updated] = await pool.execute(
    `SELECT * FROM workflow_credentials WHERE id = ?`,
    [credentialId]
  );
  return formatCredential(updated[0]);
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
  const cfg = parseConfig(row.config_json);
  const secret = decryptSecret(row.secret_json) || {};

  if (GOOGLE_CREDENTIAL_TYPES.has(row.type)) {
    const entry = registry.getSupportedPredefined(row.type);
    return {
      ...formatted,
      editor: {
        oauthAppMode:
          cfg.oauthAppMode ||
          (platformClientConfigured()
            ? OAUTH_APP_MODE.PLATFORM_MANAGED
            : OAUTH_APP_MODE.CUSTOM_APP),
        clientId: cfg.clientId || "",
        hasClientSecret: Boolean(secret.clientSecret),
        hasAccessToken: Boolean(secret.accessToken),
        hasRefreshToken: Boolean(secret.refreshToken),
        connected: googleConnected(secret, cfg),
        redirectUri: googleRedirectUri(),
        platformManagedAvailable: platformClientConfigured(),
        allowedDomains:
          cfg.allowedDomains ||
          (entry ? [...(entry.allowedDomains || [])] : []),
        customScopes: cfg.customScopes || "",
        sharingScope: normalizeSharingScope(cfg.sharingScope),
        sharingLabel: sharingLabel(normalizeSharingScope(cfg.sharingScope)),
        defaultScopes: entry?.oauth?.defaultScopes
          ? [...entry.oauth.defaultScopes]
          : [],
        authorizationUrl: entry?.oauth?.authorizationUrl || "",
        tokenUrl: entry?.oauth?.tokenUrl || "",
        accountEmail: cfg.accountEmail || "",
      },
    };
  }

  if (row.type !== "oauth2") {
    return {
      ...formatted,
      editor: { allowedDomains: cfg.allowedDomains || [] },
    };
  }
  return {
    ...formatted,
    editor: {
      ...oauth2.editorSafeConfig(row.config_json),
      hasClientSecret: Boolean(secret && secret.clientSecret),
      hasAccessToken: Boolean(secret && secret.accessToken),
      sharingScope: normalizeSharingScope(cfg.sharingScope),
      sharingLabel: sharingLabel(normalizeSharingScope(cfg.sharingScope)),
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
  update,
  remove,
  getEditorView,
  getForWorkspace,
  saveSecretAndConfig,
  getSecretForWorkspace,
  CREDENTIAL_TYPES,
  HTTP_CREDENTIAL_TYPES,
  GOOGLE_CREDENTIAL_TYPES,
  formatCredential,
  OAUTH_APP_MODE,
};
