const { v4: uuidv4 } = require("uuid");
const { pool } = require("../../config/database");
const { formatFolder } = require("../../utils/formatters");
const AppError = require("../../utils/AppError");
const {
  isPrivileged,
  assertPrivileged,
  assertWorkspaceAccess,
  assertFolderAccess,
} = require("../../services/authorization.service");

const getAll = async (authUser) => {
  assertPrivileged(authUser);
  const [rows] = await pool.execute("SELECT * FROM folders");
  return rows.map(formatFolder);
};

const getByWorkspaceId = async (workspaceId, userId, authUser) => {
  await assertWorkspaceAccess(authUser, workspaceId);

  const effectiveUserId = isPrivileged(authUser.role)
    ? userId
    : authUser.userId;

  let query = "SELECT * FROM folders WHERE workspace_id = ?";
  const params = [workspaceId];

  if (effectiveUserId) {
    query += " AND created_by = ?";
    params.push(effectiveUserId);
  }

  const [rows] = await pool.execute(query, params);
  return rows.map(formatFolder);
};

const getById = async (id, authUser) => {
  await assertFolderAccess(authUser, id);
  const [rows] = await pool.execute("SELECT * FROM folders WHERE id = ?", [id]);
  return formatFolder(rows[0]);
};

const create = async ({ name, workspaceId, createdBy }, authUser) => {
  await assertWorkspaceAccess(authUser, workspaceId);

  const id = uuidv4();
  const ownerId = isPrivileged(authUser.role) ? createdBy : authUser.userId;

  await pool.execute(
    "INSERT INTO folders (id, name, workspace_id, created_by) VALUES (?, ?, ?, ?)",
    [id, name, workspaceId, ownerId]
  );

  return getById(id, authUser);
};

const update = async (id, { name }, authUser) => {
  await assertFolderAccess(authUser, id);

  await pool.execute(
    "UPDATE folders SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [name, id]
  );

  return getById(id, authUser);
};

const remove = async (id, authUser) => {
  await assertFolderAccess(authUser, id);

  const [threads] = await pool.execute(
    "SELECT id FROM chat_threads WHERE folder_id = ?",
    [id]
  );

  if (threads.length > 0) {
    const threadIds = threads.map((t) => t.id);
    const placeholders = threadIds.map(() => "?").join(",");
    await pool.execute(
      `DELETE FROM chat_messages WHERE thread_id IN (${placeholders})`,
      threadIds
    );
  }

  await pool.execute("DELETE FROM chat_threads WHERE folder_id = ?", [id]);
  await pool.execute("DELETE FROM folders WHERE id = ?", [id]);

  return { success: true };
};

module.exports = {
  getAll,
  getByWorkspaceId,
  getById,
  create,
  update,
  remove,
};
