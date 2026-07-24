const { v4: uuidv4 } = require("uuid");
const { pool } = require("../../config/database");
const { formatThread } = require("../../utils/formatters");
const AppError = require("../../utils/AppError");
const {
  isPrivileged,
  assertPrivileged,
  assertSelfOrPrivileged,
  assertWorkspaceAccess,
  assertFolderAccess,
  assertThreadAccess,
} = require("../../services/authorization.service");

const getAll = async (authUser) => {
  assertPrivileged(authUser);
  const [rows] = await pool.execute(
    "SELECT * FROM chat_threads ORDER BY created_at DESC"
  );
  return rows.map(formatThread);
};

const getByFolderId = async (folderId, authUser) => {
  await assertFolderAccess(authUser, folderId);

  const [rows] = await pool.execute(
    "SELECT * FROM chat_threads WHERE folder_id = ? ORDER BY created_at DESC",
    [folderId]
  );
  return rows.map(formatThread);
};

const getByUserAndWorkspace = async (userId, workspaceId, authUser) => {
  assertSelfOrPrivileged(authUser, userId);
  await assertWorkspaceAccess(authUser, workspaceId);

  const [rows] = await pool.execute(
    "SELECT * FROM chat_threads WHERE workspace_id = ? AND created_by = ? ORDER BY created_at DESC",
    [workspaceId, userId]
  );
  return rows.map(formatThread);
};

const getByWorkspaceId = async (workspaceId, authUser) => {
  await assertWorkspaceAccess(authUser, workspaceId);

  const [rows] = await pool.execute(
    "SELECT * FROM chat_threads WHERE workspace_id = ? ORDER BY created_at DESC",
    [workspaceId]
  );
  return rows.map(formatThread);
};

const getById = async (id, authUser) => {
  await assertThreadAccess(authUser, id);
  const [rows] = await pool.execute(
    "SELECT * FROM chat_threads WHERE id = ?",
    [id]
  );
  return formatThread(rows[0]);
};

const create = async (
  { name, workspaceId, folderId, createdBy },
  authUser
) => {
  await assertWorkspaceAccess(authUser, workspaceId);

  if (folderId) {
    await assertFolderAccess(authUser, folderId);
  }

  const id = uuidv4();
  const folder_id = folderId || null;
  const ownerId = isPrivileged(authUser.role) ? createdBy : authUser.userId;

  await pool.execute(
    "INSERT INTO chat_threads (id, name, workspace_id, folder_id, created_by) VALUES (?, ?, ?, ?, ?)",
    [id, name, workspaceId, folder_id, ownerId]
  );

  return getById(id, authUser);
};

const update = async (id, { name, folderId }, authUser) => {
  await assertThreadAccess(authUser, id);

  if (folderId !== undefined && folderId !== null) {
    await assertFolderAccess(authUser, folderId);
  }

  const updateFields = [];
  const values = [];

  if (name !== undefined) {
    updateFields.push("name = ?");
    values.push(name);
  }
  if (folderId !== undefined) {
    updateFields.push("folder_id = ?");
    values.push(folderId);
  }

  if (updateFields.length === 0) {
    throw new AppError("No fields to update", 400, "VALIDATION_ERROR");
  }

  values.push(id);
  await pool.execute(
    `UPDATE chat_threads SET ${updateFields.join(
      ", "
    )}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    values
  );

  return getById(id, authUser);
};

const remove = async (id, authUser) => {
  await assertThreadAccess(authUser, id);

  await pool.execute("DELETE FROM chat_messages WHERE thread_id = ?", [id]);
  await pool.execute("DELETE FROM chat_threads WHERE id = ?", [id]);

  return { message: "Thread and all messages deleted successfully" };
};

module.exports = {
  getAll,
  getByFolderId,
  getByUserAndWorkspace,
  getByWorkspaceId,
  getById,
  create,
  update,
  remove,
};
