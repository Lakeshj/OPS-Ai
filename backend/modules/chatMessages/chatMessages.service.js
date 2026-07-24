const { v4: uuidv4 } = require("uuid");
const { pool } = require("../../config/database");
const { formatMessage } = require("../../utils/formatters");
const AppError = require("../../utils/AppError");
const {
  assertPrivileged,
  assertThreadAccess,
  assertMessageAccess,
} = require("../../services/authorization.service");

const getAll = async (authUser) => {
  assertPrivileged(authUser);
  const [rows] = await pool.execute(
    "SELECT * FROM chat_messages ORDER BY created_at ASC"
  );
  return rows.map(formatMessage);
};

const getByThreadId = async (threadId, authUser) => {
  await assertThreadAccess(authUser, threadId);

  const [rows] = await pool.execute(
    "SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC",
    [threadId]
  );
  return rows.map(formatMessage);
};

const getById = async (id, authUser) => {
  await assertMessageAccess(authUser, id);
  const [rows] = await pool.execute(
    "SELECT * FROM chat_messages WHERE id = ?",
    [id]
  );
  return formatMessage(rows[0]);
};

const create = async ({ threadId, content, isUserMessage }, authUser) => {
  await assertThreadAccess(authUser, threadId);

  const id = uuidv4();
  await pool.execute(
    "INSERT INTO chat_messages (id, thread_id, content, is_user_message) VALUES (?, ?, ?, ?)",
    [id, threadId, content, isUserMessage]
  );

  return getById(id, authUser);
};

const update = async (id, { content }, authUser) => {
  await assertMessageAccess(authUser, id);

  await pool.execute("UPDATE chat_messages SET content = ? WHERE id = ?", [
    content,
    id,
  ]);

  return getById(id, authUser);
};

const remove = async (id, authUser) => {
  await assertMessageAccess(authUser, id);

  const [result] = await pool.execute(
    "DELETE FROM chat_messages WHERE id = ?",
    [id]
  );
  if (result.affectedRows === 0) {
    throw new AppError("Message not found", 404, "NOT_FOUND");
  }
};

module.exports = {
  getAll,
  getByThreadId,
  getById,
  create,
  update,
  remove,
};
