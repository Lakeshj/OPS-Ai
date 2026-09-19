/**
 * workflow_credentials has UNIQUE(workspace_id, name).
 * Allocate a free display name so connecting another Google account
 * does not fail with "Resource already exists".
 */
const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/database");

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
      .map((r) => String(r.name || ""))
  );
  if (!taken.has(base)) return base;
  for (let n = 2; n < 500; n += 1) {
    const candidate = `${base} (${n})`.slice(0, 190);
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} ${uuidv4().slice(0, 8)}`;
};

module.exports = { allocateUniqueCredentialName };
