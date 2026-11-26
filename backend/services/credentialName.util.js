/**
 * workflow_credentials has UNIQUE(workspace_id, name) with a case-insensitive
 * collation (utf8mb4_0900_ai_ci). Name checks must match that behaviour or
 * INSERT races / case variants surface as generic ER_DUP_ENTRY
 * ("Resource already exists").
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
 * Find an existing credential whose name collides under MySQL CI rules.
 * @returns {Promise<{id:string,name:string,type:string}|null>}
 */
const findCredentialNameConflict = async (
  workspaceId,
  desiredName,
  { excludeId } = {}
) => {
  const wanted = normalizeCredentialNameKey(desiredName);
  if (!wanted) return null;
  const [rows] = await pool.execute(
    `SELECT id, name, type FROM workflow_credentials WHERE workspace_id = ?`,
    [workspaceId]
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
    ? { conflictId: conflict.id, conflictName: conflict.name, conflictType: conflict.type }
    : undefined;
  return err;
};

/**
 * Allocate a free display name (Google / OAuth multi-account paths).
 * Uses case-insensitive matching so we never race MySQL's CI unique index.
 */
const allocateUniqueCredentialName = async (
  workspaceId,
  desiredName,
  { excludeId } = {}
) => {
  const base =
    String(desiredName || "Google account").trim().slice(0, 160) ||
    "Google account";
  const [rows] = await pool.execute(
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
 * API-key style credentials (Apify / Perigon / Bearer / HTTP headers):
 * keep the exact name the user typed. Reject collisions with a clear error
 * so the picker can show the existing connection instead of silent rename.
 */
const assertCredentialNameAvailable = async (
  workspaceId,
  desiredName,
  { excludeId } = {}
) => {
  const name = String(desiredName || "").trim();
  if (!name) {
    throw new AppError("name cannot be empty", 400, "VALIDATION_ERROR");
  }
  const conflict = await findCredentialNameConflict(workspaceId, name, {
    excludeId,
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
