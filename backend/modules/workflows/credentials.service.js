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
  normalizeSelectedGmailPermissions,
} = require("../../services/googleOAuth.service");
const {
  allocateUniqueCredentialName,
  assertCredentialNameAvailable,
  duplicateCredentialNameError,
  findCredentialNameConflict,
} = require("../../services/credentialName.util");

const HTTP_CREDENTIAL_TYPES = new Set([
  "bearer",
  "api_key_header",
  "basic",
  "query_param",
  "oauth2",
]);

/** Exact-name types: reject duplicates instead of silent "(2)" rename. */
const STRICT_CREDENTIAL_NAME_TYPES = new Set([
  "apify",
  "perigon",
  "bearer",
  "api_key_header",
  "basic",
  "query_param",
]);

const GOOGLE_CREDENTIAL_TYPES = new Set([
  "google_gsc",
  "google_ga4",
  "google_gmail",
  "google_sheets",
  "google_ads",
]);

const META_CREDENTIAL_TYPES = new Set(["meta_ads"]);
const INSTAGRAM_CREDENTIAL_TYPES = new Set(["instagram"]);
const FACEBOOK_PAGE_CREDENTIAL_TYPES = new Set(["facebook_page"]);
const APIFY_CREDENTIAL_TYPES = new Set(["apify"]);
const PERIGON_CREDENTIAL_TYPES = new Set(["perigon"]);

const CREDENTIAL_TYPES = new Set([
  ...HTTP_CREDENTIAL_TYPES,
  ...GOOGLE_CREDENTIAL_TYPES,
  ...META_CREDENTIAL_TYPES,
  ...INSTAGRAM_CREDENTIAL_TYPES,
  ...FACEBOOK_PAGE_CREDENTIAL_TYPES,
  ...APIFY_CREDENTIAL_TYPES,
  ...PERIGON_CREDENTIAL_TYPES,
]);

const parseConfig = (raw) => oauth2.parseConfig(raw);

const googleConnected = (secret, cfg) => {
  if (cfg?.reconnectRequired || secret?.revoked) return false;
  return Boolean(cfg?.connected) || Boolean(secret?.accessToken);
};

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
  const isMetaAds = row.type === "meta_ads";
  const isInstagram = row.type === "instagram";
  const isFacebookPage = row.type === "facebook_page";
  const isPerigon = row.type === "perigon";
  const sharingScope = normalizeSharingScope(cfg.sharingScope);
  const metaExpired =
    isMetaAds && cfg.expiresAt ? Date.parse(cfg.expiresAt) <= Date.now() : false;
  const igExpired =
    isInstagram && cfg.expiresAt ? Date.parse(cfg.expiresAt) <= Date.now() : false;
  const fbExpired =
    isFacebookPage && cfg.expiresAt
      ? Date.parse(cfg.expiresAt) <= Date.now()
      : false;
  const igReconnect =
    Boolean(cfg.reconnectRequired) || igExpired;
  const fbReconnect = Boolean(cfg.reconnectRequired) || fbExpired;
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
        ? cfg.reconnectRequired
          ? false
          : cfg.connected === undefined
            ? true
            : Boolean(cfg.connected)
        : isInstagram
          ? igReconnect
            ? false
            : cfg.connected === undefined
              ? true
              : Boolean(cfg.connected)
          : isFacebookPage
            ? fbReconnect
              ? false
              : cfg.connected === undefined
                ? true
                : Boolean(cfg.connected)
            : isPerigon
              ? Boolean(cfg.connected)
              : true,
    reconnectRequired: isGoogle
      ? Boolean(cfg.reconnectRequired)
      : isMetaAds
        ? Boolean(cfg.reconnectRequired) || metaExpired
        : isInstagram
          ? igReconnect
          : isFacebookPage
            ? fbReconnect
            : undefined,
    reconnectSoon:
      isInstagram && cfg.expiresAt && !igReconnect
        ? Date.parse(cfg.expiresAt) - Date.now() <= 7 * 24 * 60 * 60 * 1000
        : undefined,
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
    workflowId:
      isGoogle && cfg.workflowId ? String(cfg.workflowId) : undefined,
    metaDisplayName:
      (isMetaAds || isFacebookPage) && cfg.metaDisplayName
        ? String(cfg.metaDisplayName)
        : undefined,
    metaUserId:
      (isMetaAds || isFacebookPage) && cfg.metaUserId
        ? String(cfg.metaUserId)
        : undefined,
    expiresAt:
      (isMetaAds || isInstagram || isFacebookPage) && cfg.expiresAt
        ? String(cfg.expiresAt)
        : undefined,
    selectedAdAccountId:
      isMetaAds && cfg.selectedAdAccountId
        ? String(cfg.selectedAdAccountId)
        : undefined,
    selectedPageId:
      isFacebookPage && cfg.selectedPageId
        ? String(cfg.selectedPageId)
        : undefined,
    pages:
      isFacebookPage && Array.isArray(cfg.pages) ? cfg.pages : undefined,
    instagramUserId:
      isInstagram && cfg.instagramUserId
        ? String(cfg.instagramUserId)
        : undefined,
    username:
      isInstagram && cfg.username ? String(cfg.username) : undefined,
    accountType:
      isInstagram && cfg.accountType ? String(cfg.accountType) : undefined,
    profilePictureUrl:
      isInstagram && cfg.profilePictureUrl
        ? String(cfg.profilePictureUrl)
        : undefined,
    missingPermissions:
      isInstagram && Array.isArray(cfg.missingPermissions)
        ? cfg.missingPermissions.map(String)
        : undefined,
    grantedPermissions:
      isInstagram && Array.isArray(cfg.grantedPermissions)
        ? cfg.grantedPermissions.map(String)
        : undefined,
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

const buildGoogleCreateSecret = ({ type, mode, secret }) => {
  const developerToken = String(secret?.developerToken || "").trim();
  return {
    oauthAppMode: mode,
    ...(mode === OAUTH_APP_MODE.CUSTOM_APP
      ? { clientSecret: String(secret?.clientSecret || "") }
      : {}),
    ...(type === "google_ads" && developerToken ? { developerToken } : {}),
  };
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

  if (type === "meta_ads") {
    throw new AppError(
      "Use Connect with Meta. Do not paste a Meta access token.",
      400,
      "VALIDATION_ERROR"
    );
  }

  if (type === "instagram") {
    throw new AppError(
      "Use Connect Instagram. Do not paste an Instagram access token.",
      400,
      "VALIDATION_ERROR"
    );
  }

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
    const gmailPermissions =
      type === "google_gmail"
        ? normalizeSelectedGmailPermissions(config?.gmailPermissions)
        : undefined;
    configJson = JSON.stringify({
      oauthAppMode: checked.mode,
      clientId:
        checked.mode === OAUTH_APP_MODE.CUSTOM_APP
          ? String(config.clientId || "").trim()
          : undefined,
      allowedDomains,
      customScopes: customScopes || undefined,
      ...(gmailPermissions ? { gmailPermissions } : {}),
      sharingScope,
      connected: false,
    });
    secretPayload = buildGoogleCreateSecret({
      type,
      mode: checked.mode,
      secret,
    });
  } else if (APIFY_CREDENTIAL_TYPES.has(type)) {
    const apiToken = String(
      secret?.apiToken || secret?.token || secret?.accessToken || ""
    ).trim();
    if (!apiToken) {
      throw new AppError(
        "Apify API token is required.",
        400,
        "VALIDATION_ERROR"
      );
    }
    secretPayload = { apiToken };
    configJson = JSON.stringify({
      connected: true,
      provider: "apify",
      sharingScope: normalizeSharingScope(config?.sharingScope),
    });
  } else if (PERIGON_CREDENTIAL_TYPES.has(type)) {
    const apiKey = String(
      secret?.apiKey || secret?.api_key || secret?.token || secret?.accessToken || ""
    ).trim();
    if (!apiKey) {
      throw new AppError(
        "Perigon API key is required.",
        400,
        "VALIDATION_ERROR"
      );
    }
    secretPayload = { apiKey };
    // Do not mark Connected until Test connection succeeds against LinkedIn Social.
    configJson = JSON.stringify({
      connected: false,
      verified: false,
      provider: "perigon",
      sharingScope: normalizeSharingScope(config?.sharingScope),
    });
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
  const desiredName = String(name || "").trim();
  let uniqueName;
  if (STRICT_CREDENTIAL_NAME_TYPES.has(type)) {
    // Apify / Perigon / Bearer / HTTP keys: keep the typed name or fail clearly.
    uniqueName = await assertCredentialNameAvailable(workspaceId, desiredName);
  } else {
    uniqueName = await allocateUniqueCredentialName(workspaceId, desiredName);
  }

  try {
    await pool.execute(
      `INSERT INTO workflow_credentials
        (id, workspace_id, name, type, secret_json, config_json, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        workspaceId,
        uniqueName,
        type,
        encryptSecret(secretPayload),
        configJson,
        authUser.id || authUser.userId,
      ]
    );
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      // Race: two creates allocated/asserted the same free name.
      const conflict = await findCredentialNameConflict(
        workspaceId,
        uniqueName
      );
      if (STRICT_CREDENTIAL_NAME_TYPES.has(type) || conflict) {
        throw duplicateCredentialNameError(uniqueName, conflict);
      }
      // OAuth / Google: retry once with a freshly allocated unique name.
      uniqueName = await allocateUniqueCredentialName(
        workspaceId,
        `${desiredName || uniqueName}`
      );
      await pool.execute(
        `INSERT INTO workflow_credentials
          (id, workspace_id, name, type, secret_json, config_json, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          workspaceId,
          uniqueName,
          type,
          encryptSecret(secretPayload),
          configJson,
          authUser.id || authUser.userId,
        ]
      );
    } else {
      throw err;
    }
  }

  const [rows] = await pool.execute(
    `SELECT * FROM workflow_credentials WHERE id = ?`,
    [id]
  );
  return formatCredential(rows[0]);
};

const API_KEY_EDITABLE_TYPES = new Set([
  ...HTTP_CREDENTIAL_TYPES,
  ...APIFY_CREDENTIAL_TYPES,
  ...PERIGON_CREDENTIAL_TYPES,
]);

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

  // API-key style credentials (Perigon / Apify / HTTP): name + optional secret rotate.
  // Never return the previous secret to the client.
  if (API_KEY_EDITABLE_TYPES.has(row.type) && !GOOGLE_CREDENTIAL_TYPES.has(row.type)) {
    const nextName =
      name !== undefined ? String(name || "").trim() : String(row.name || "");
    if (!nextName) {
      throw new AppError("name cannot be empty", 400, "VALIDATION_ERROR");
    }
    if (STRICT_CREDENTIAL_NAME_TYPES.has(row.type)) {
      await assertCredentialNameAvailable(row.workspace_id, nextName, {
        excludeId: credentialId,
      });
    }
    let nextSecret = { ...existingSecret };
    let nextConfig = { ...existingConfig };
    if (secret && typeof secret === "object") {
      if (row.type === "perigon") {
        const apiKey = String(
          secret.apiKey || secret.api_key || secret.token || secret.accessToken || ""
        ).trim();
        if (apiKey) {
          nextSecret = { apiKey };
          // Rotating the key invalidates prior LinkedIn verification.
          nextConfig = {
            ...nextConfig,
            connected: false,
            verified: false,
            lastTestStatus: null,
            lastTestAt: null,
            lastTestCode: null,
            linkedInAccess: null,
            provider: "perigon",
          };
        }
      } else if (row.type === "apify") {
        const apiToken = String(
          secret.apiToken || secret.token || secret.accessToken || ""
        ).trim();
        if (apiToken) {
          nextSecret = { apiToken };
          nextConfig = { ...nextConfig, connected: true, provider: "apify" };
        }
      } else if (row.type === "bearer") {
        const token = String(secret.token || "").trim();
        if (token) nextSecret = { token };
      } else if (row.type === "api_key_header") {
        const headerName = String(
          secret.headerName || existingSecret.headerName || ""
        ).trim();
        const value = String(secret.value || existingSecret.value || "").trim();
        if (secret.value != null && !value) {
          throw new AppError("secret.value is required", 400, "VALIDATION_ERROR");
        }
        if (headerName || value) {
          nextSecret = {
            headerName: headerName || existingSecret.headerName,
            value: value || existingSecret.value,
          };
        }
      } else if (row.type === "basic") {
        const username = String(
          secret.username != null ? secret.username : existingSecret.username || ""
        ).trim();
        const password =
          secret.password != null
            ? String(secret.password)
            : String(existingSecret.password || "");
        if (secret.password != null && !String(secret.password).length) {
          throw new AppError("secret.password is required", 400, "VALIDATION_ERROR");
        }
        nextSecret = { username, password };
      } else if (row.type === "query_param") {
        const paramName = String(
          secret.paramName || existingSecret.paramName || ""
        ).trim();
        const value = String(secret.value || existingSecret.value || "").trim();
        if (secret.value != null && !value) {
          throw new AppError("secret.value is required", 400, "VALIDATION_ERROR");
        }
        nextSecret = {
          paramName: paramName || existingSecret.paramName,
          value: value || existingSecret.value,
        };
      } else if (row.type === "oauth2") {
        throw new AppError(
          "Updating oauth2 secrets here is not supported. Reconnect OAuth instead.",
          400,
          "VALIDATION_ERROR"
        );
      }
    }
    if (config && typeof config === "object" && config.sharingScope != null) {
      nextConfig.sharingScope = normalizeSharingScope(config.sharingScope);
    }
    try {
      await pool.execute(
        `UPDATE workflow_credentials
         SET name = ?, secret_json = ?, config_json = ?
         WHERE id = ?`,
        [
          nextName,
          encryptSecret(nextSecret),
          JSON.stringify(nextConfig),
          credentialId,
        ]
      );
    } catch (err) {
      if (err && err.code === "ER_DUP_ENTRY") {
        const conflict = await findCredentialNameConflict(
          row.workspace_id,
          nextName,
          { excludeId: credentialId }
        );
        throw duplicateCredentialNameError(nextName, conflict);
      }
      throw err;
    }
    const [updated] = await pool.execute(
      `SELECT * FROM workflow_credentials WHERE id = ?`,
      [credentialId]
    );
    return formatCredential(updated[0]);
  }

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
  const gmailPermissions =
    row.type === "google_gmail"
      ? normalizeSelectedGmailPermissions(
          config?.gmailPermissions !== undefined
            ? config.gmailPermissions
            : existingConfig.gmailPermissions
        )
      : undefined;
  const nextConfig = {
    ...existingConfig,
    oauthAppMode: mode,
    clientId: mode === OAUTH_APP_MODE.CUSTOM_APP ? nextClientId : undefined,
    allowedDomains,
    customScopes: customScopes || undefined,
    ...(gmailPermissions ? { gmailPermissions } : {}),
    sharingScope:
      config?.sharingScope !== undefined
        ? normalizeSharingScope(config.sharingScope)
        : normalizeSharingScope(existingConfig.sharingScope),
    connected: googleConnected(existingSecret, existingConfig),
    accountEmail: existingConfig.accountEmail,
  };
  const nextDeveloperToken =
    row.type === "google_ads" &&
    secret?.developerToken !== undefined &&
    String(secret.developerToken || "").trim()
      ? String(secret.developerToken).trim()
      : existingSecret.developerToken;
  const nextSecretObj = {
    ...existingSecret,
    oauthAppMode: mode,
    clientSecret: mode === OAUTH_APP_MODE.CUSTOM_APP ? nextSecret : undefined,
    ...(row.type === "google_ads" && nextDeveloperToken
      ? { developerToken: nextDeveloperToken }
      : {}),
  };
  await pool.execute(
    `UPDATE workflow_credentials
        SET name = ?, secret_json = ?, config_json = ?
      WHERE id = ?`,
    [
      name != null
        ? await allocateUniqueCredentialName(
            row.workspace_id,
            String(name).trim(),
            { excludeId: credentialId }
          )
        : row.name,
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

/** Node data keys that may hold a workspace credential id. */
const CREDENTIAL_ID_KEYS = Object.freeze([
  "credentialId",
  "apifyCredentialId",
  "perigonCredentialId",
  "nativeFeedCredentialId",
  "httpCredentialId",
  "authCredentialId",
]);

const nodeReferencesCredential = (nodeData, credentialId) => {
  if (!nodeData || typeof nodeData !== "object") return false;
  const id = String(credentialId);
  for (const key of CREDENTIAL_ID_KEYS) {
    if (String(nodeData[key] || "").trim() === id) return true;
  }
  for (const [key, value] of Object.entries(nodeData)) {
    if (!/credentialid$/i.test(key)) continue;
    if (String(value || "").trim() === id) return true;
  }
  return false;
};

/**
 * List workflows in the credential's workspace that reference credentialId
 * on any node (including Perigon / Apify / feed credential fields).
 */
const listCredentialUsage = async (credentialId, authUser) => {
  const [rows] = await pool.execute(
    `SELECT * FROM workflow_credentials WHERE id = ?`,
    [credentialId]
  );
  if (rows.length === 0) {
    throw new AppError("Credential not found", 404, "NOT_FOUND");
  }
  const workspaceId = rows[0].workspace_id;
  await assertWorkspaceAccess(authUser, workspaceId);
  const [workflows] = await pool.execute(
    `SELECT id, name, definition_json FROM workflows
     WHERE workspace_id = ? AND deleted_at IS NULL`,
    [workspaceId]
  );
  const id = String(credentialId);
  const matches = [];
  for (const wf of workflows) {
    let definition = { nodes: [] };
    try {
      definition =
        typeof wf.definition_json === "string"
          ? JSON.parse(wf.definition_json || "{}")
          : wf.definition_json || {};
    } catch {
      definition = { nodes: [] };
    }
    const nodes = Array.isArray(definition.nodes) ? definition.nodes : [];
    const uses = nodes.some((node) =>
      nodeReferencesCredential(node?.data, id)
    );
    if (uses) {
      matches.push({ id: wf.id, name: String(wf.name || "Untitled workflow") });
    }
  }
  return {
    credentialId: id,
    workspaceId,
    workflowCount: matches.length,
    workflows: matches.slice(0, 20),
  };
};

/**
 * Permanently delete a credential.
 * When other workflows still reference it, requires `{ force: true }` after UI confirmation.
 */
const remove = async (id, authUser, { force = false } = {}) => {
  const [rows] = await pool.execute(
    `SELECT * FROM workflow_credentials WHERE id = ?`,
    [id]
  );
  if (rows.length === 0) {
    throw new AppError("Credential not found", 404, "NOT_FOUND");
  }
  await assertWorkspaceAccess(authUser, rows[0].workspace_id);
  const usage = await listCredentialUsage(id, authUser);
  if (usage.workflowCount > 0 && !force) {
    const names = usage.workflows.map((w) => w.name).join(", ");
    const err = new AppError(
      `This connection is still used by ${usage.workflowCount} workflow(s)` +
        (names ? `: ${names}` : "") +
        `. Disconnect it from those workflows first, or confirm force delete.`,
      409,
      "CREDENTIAL_IN_USE"
    );
    err.details = { usage };
    throw err;
  }
  await pool.execute(`DELETE FROM workflow_credentials WHERE id = ?`, [id]);
  return { success: true, forced: Boolean(force), previousUsage: usage };
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

  if (row.type === "meta_ads") {
    const expiresAt = cfg.expiresAt ? Date.parse(cfg.expiresAt) : NaN;
    return {
      ...formatted,
      editor: {
        hasAccessToken: Boolean(secret.accessToken),
        metaUserId: cfg.metaUserId || "",
        metaDisplayName: cfg.metaDisplayName || "",
        tokenKind: cfg.tokenKind || "",
        expiresAt: cfg.expiresAt || null,
        grantedPermissions: Array.isArray(cfg.grantedPermissions)
          ? cfg.grantedPermissions
          : [],
        reconnectRequired:
          Boolean(cfg.reconnectRequired) ||
          (Number.isFinite(expiresAt) && expiresAt <= Date.now()),
        selectedAdAccountId: cfg.selectedAdAccountId || "",
        sharingScope: normalizeSharingScope(cfg.sharingScope),
      },
    };
  }

  if (row.type === "instagram") {
    const expiresAt = cfg.expiresAt ? Date.parse(cfg.expiresAt) : NaN;
    return {
      ...formatted,
      editor: {
        hasAccessToken: Boolean(secret.accessToken),
        instagramUserId: cfg.instagramUserId || "",
        username: cfg.username || "",
        accountType: cfg.accountType || "",
        profilePictureUrl: cfg.profilePictureUrl || "",
        tokenKind: cfg.tokenKind || "",
        expiresAt: cfg.expiresAt || null,
        grantedPermissions: Array.isArray(cfg.grantedPermissions)
          ? cfg.grantedPermissions
          : [],
        missingPermissions: Array.isArray(cfg.missingPermissions)
          ? cfg.missingPermissions
          : [],
        reconnectRequired:
          Boolean(cfg.reconnectRequired) ||
          (Number.isFinite(expiresAt) && expiresAt <= Date.now()),
        sharingScope: normalizeSharingScope(cfg.sharingScope),
      },
    };
  }

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
        hasDeveloperToken: Boolean(secret.developerToken),
        hasAccessToken: Boolean(secret.accessToken),
        hasRefreshToken: Boolean(secret.refreshToken),
        connected: googleConnected(secret, cfg),
        reconnectRequired: Boolean(cfg.reconnectRequired) || Boolean(secret.revoked),
        redirectUri: googleRedirectUri(),
        platformManagedAvailable: platformClientConfigured(),
        allowedDomains:
          cfg.allowedDomains ||
          (entry ? [...(entry.allowedDomains || [])] : []),
        customScopes: cfg.customScopes || "",
        gmailPermissions: Array.isArray(cfg.gmailPermissions)
          ? cfg.gmailPermissions
          : [],
        gmailPermissionOptions: require("../../services/googleOAuth.service")
          .GMAIL_PERMISSION_OPTIONS,
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

/**
 * Persist Perigon LinkedIn Social verification result (never stores the API key in config).
 */
const markPerigonConnectionStatus = async (credentialId, workspaceId, statusPatch = {}) => {
  const cred = await getForWorkspace(credentialId, workspaceId);
  if (!cred || cred.type !== "perigon") {
    throw new AppError("Perigon credential not found", 404, "NOT_FOUND");
  }
  const nextConfig = {
    ...(cred.config || {}),
    connected: Boolean(statusPatch.connected),
    verified: Boolean(statusPatch.connected),
    lastTestStatus: statusPatch.status || null,
    lastTestAt: new Date().toISOString(),
    lastTestCode: statusPatch.code || null,
    linkedInAccess: statusPatch.linkedInAccess ?? null,
    provider: "perigon",
  };
  await saveSecretAndConfig(credentialId, cred.secret, nextConfig);
  return { id: credentialId, connected: nextConfig.connected, config: nextConfig };
};

module.exports = {
  listByWorkspace,
  create,
  update,
  remove,
  listCredentialUsage,
  getEditorView,
  getForWorkspace,
  saveSecretAndConfig,
  getSecretForWorkspace,
  markPerigonConnectionStatus,
  CREDENTIAL_TYPES,
  HTTP_CREDENTIAL_TYPES,
  GOOGLE_CREDENTIAL_TYPES,
  META_CREDENTIAL_TYPES,
  PERIGON_CREDENTIAL_TYPES,
  INSTAGRAM_CREDENTIAL_TYPES,
  FACEBOOK_PAGE_CREDENTIAL_TYPES,
  APIFY_CREDENTIAL_TYPES,
  formatCredential,
  OAUTH_APP_MODE,
  validateGoogleCreate,
  buildGoogleCreateSecret,
};
