const { pool } = require("../config/database");
const AppError = require("../utils/AppError");

const PRIVILEGED_ROLES = ["Admin", "Project Manager"];

const isPrivileged = (role) => PRIVILEGED_ROLES.includes(role);

const assertSelfOrPrivileged = (authUser, targetUserId) => {
  if (isPrivileged(authUser.role)) return;
  if (authUser.userId !== targetUserId) {
    throw new AppError("Access denied", 403, "FORBIDDEN");
  }
};

const assertPrivileged = (authUser) => {
  if (!isPrivileged(authUser.role)) {
    throw new AppError("Insufficient permissions", 403, "FORBIDDEN");
  }
};

const assertAdmin = (authUser) => {
  if (authUser.role !== "Admin") {
    throw new AppError("Insufficient permissions", 403, "FORBIDDEN");
  }
};

const isWorkspaceMember = async (workspaceId, userId) => {
  const [rows] = await pool.execute(
    "SELECT 1 FROM workspace_users WHERE workspace_id = ? AND user_id = ?",
    [workspaceId, userId]
  );
  return rows.length > 0;
};

const assertWorkspaceAccess = async (authUser, workspaceId) => {
  if (authUser?.role === "system") return;
  if (isPrivileged(authUser.role)) return;

  const member = await isWorkspaceMember(workspaceId, authUser.userId);
  if (!member) {
    throw new AppError("Access denied to workspace", 403, "FORBIDDEN");
  }
};

const assertWorkspaceManageAccess = async (authUser, workspaceId) => {
  const [rows] = await pool.execute(
    "SELECT id, created_by FROM workspaces WHERE id = ?",
    [workspaceId]
  );
  if (rows.length === 0) {
    throw new AppError("Workspace not found", 404, "NOT_FOUND");
  }

  const workspace = rows[0];
  if (authUser.role === "Admin") return workspace;

  if (
    authUser.role === "Project Manager" &&
    workspace.created_by === authUser.userId
  ) {
    return workspace;
  }

  throw new AppError(
    "Only Admin or the workspace Project Manager can manage static memory",
    403,
    "FORBIDDEN"
  );
};

const getFolderRecord = async (folderId) => {
  const [rows] = await pool.execute("SELECT * FROM folders WHERE id = ?", [
    folderId,
  ]);
  if (rows.length === 0) {
    throw new AppError("Folder not found", 404, "NOT_FOUND");
  }
  return rows[0];
};

const getThreadRecord = async (threadId) => {
  const [rows] = await pool.execute(
    "SELECT * FROM chat_threads WHERE id = ?",
    [threadId]
  );
  if (rows.length === 0) {
    throw new AppError("Chat thread not found", 404, "NOT_FOUND");
  }
  return rows[0];
};

const getMessageRecord = async (messageId) => {
  const [rows] = await pool.execute(
    "SELECT * FROM chat_messages WHERE id = ?",
    [messageId]
  );
  if (rows.length === 0) {
    throw new AppError("Message not found", 404, "NOT_FOUND");
  }
  return rows[0];
};

const assertFolderAccess = async (authUser, folderId) => {
  const folder = await getFolderRecord(folderId);
  await assertWorkspaceAccess(authUser, folder.workspace_id);

  if (!isPrivileged(authUser.role) && folder.created_by !== authUser.userId) {
    throw new AppError("Access denied to folder", 403, "FORBIDDEN");
  }

  return folder;
};

const assertThreadAccess = async (authUser, threadId) => {
  const thread = await getThreadRecord(threadId);
  await assertWorkspaceAccess(authUser, thread.workspace_id);

  if (!isPrivileged(authUser.role) && thread.created_by !== authUser.userId) {
    throw new AppError("Access denied to chat thread", 403, "FORBIDDEN");
  }

  return thread;
};

const assertMessageAccess = async (authUser, messageId) => {
  const message = await getMessageRecord(messageId);
  await assertThreadAccess(authUser, message.thread_id);
  return message;
};

module.exports = {
  isPrivileged,
  assertSelfOrPrivileged,
  assertPrivileged,
  assertAdmin,
  assertWorkspaceAccess,
  assertWorkspaceManageAccess,
  assertFolderAccess,
  assertThreadAccess,
  assertMessageAccess,
  isWorkspaceMember,
};
