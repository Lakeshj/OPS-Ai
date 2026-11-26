/**
 * workflow_credentials UNIQUE(workspace_id, type, name) with case-insensitive
 * collation (utf8mb4_0900_ai_ci). Name checks must be type-scoped and match
 * that collation or INSERT races / case variants surface as ER_DUP_ENTRY.
 *
 * Credential runtime resolution uses IDs (never ambiguous names).
 */
const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/database");
const AppError = require("../utils/AppError");

const normalizeCredentialNameKey = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en");

/**
 * Find an existing credential whose name collides under MySQL CI rules
 * within the same workspace + type.
 * @returns {Promise<{id:string,name:string,type:string}|null>}
 */
const findCredentialNameConflict = async (
  workspaceId,
  desiredName,
  { excludeId, type } = {}
) => {
  const wanted = normalizeCredentialNameKey(desiredName);
  if (!wanted) return null;
  const credType = String(type || "").trim();
  if (!credType) {
    throw new AppError(
      "credential type is required for name conflict checks",
      500,
      "INTERNAL_ERROR"
    );
  }
  const [rows] = await pool.execute(
    `SELECT id, name, type FROM workflow_credentials
     WHERE workspace_id = ? AND type = ?`,
    [workspaceId, credType]
  );
  for (const row of rows || []) {
    if (excludeId && String(row.id) === String(excludeId)) continue;
    if (normalizeCredentialNameKey(row.name) === wanted) {
      return {
        id: String(row.id),
        name: String(row.name || ""),
        type: String(row.type || ""),
      };
    }
  }
  return null;
};

const duplicateCredentialNameError = (desiredName, conflict) => {
  const display =
    String(desiredName || "").trim() ||
    String(conflict?.name || "").trim() ||
    "this connection";
  const typeHint = conflict?.type ? ` (${conflict.type})` : "";
  const err = new AppError(
    `A connection named ${display} already exists${typeHint}. Select or edit the existing connection.`,
    409,
    "CREDENTIAL_NAME_EXISTS"
  );
  err.details = conflict
    ? {
        conflictId: conflict.id,
        conflictName: conflict.name,
        conflictType: conflict.type,
      }
    : undefined;
  return err;
};

/**
 * Allocate a free display name within the same workspace + type
 * (Google / OAuth multi-account paths).
 */
const allocateUniqueCredentialName = async (
  workspaceId,
  desiredName,
  { excludeId, type } = {}
) => {
  const base =
    String(desiredName || "Google account").trim().slice(0, 160) ||
    "Google account";
  const credType = String(type || "").trim();
  const [rows] = credType
    ? await pool.execute(
        `SELECT id, name FROM workflow_credentials
         WHERE workspace_id = ? AND type = ?`,
        [workspaceId, credType]
      )
    : await pool.execute(
        `SELECT id, name FROM workflow_credentials WHERE workspace_id = ?`,
        [workspaceId]
      );
  const taken = new Set(
    (rows || [])
      .filter((r) => !excludeId || String(r.id) !== String(excludeId))
      .map((r) => normalizeCredentialNameKey(r.name))
      .filter(Boolean)
  );
  if (!taken.has(normalizeCredentialNameKey(base))) return base;
  for (let n = 2; n < 500; n += 1) {
    const candidate = `${base} (${n})`.slice(0, 190);
    if (!taken.has(normalizeCredentialNameKey(candidate))) return candidate;
  }
  return `${base} ${uuidv4().slice(0, 8)}`;
};

/**
 * API-key style credentials: keep the typed name or reject same-type duplicates.
 */
const assertCredentialNameAvailable = async (
  workspaceId,
  desiredName,
  { excludeId, type } = {}
) => {
  const name = String(desiredName || "").trim();
  if (!name) {
    throw new AppError("name cannot be empty", 400, "VALIDATION_ERROR");
  }
  const conflict = await findCredentialNameConflict(workspaceId, name, {
    excludeId,
    type,
  });
  if (conflict) {
    throw duplicateCredentialNameError(name, conflict);
  }
  return name;
};

module.exports = {
  allocateUniqueCredentialName,
  findCredentialNameConflict,
  assertCredentialNameAvailable,
  duplicateCredentialNameError,
  normalizeCredentialNameKey,
};
