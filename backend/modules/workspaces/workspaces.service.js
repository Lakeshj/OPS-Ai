const { v4: uuidv4 } = require("uuid");
const { pool } = require("../../config/database");
const { formatWorkspace } = require("../../utils/formatters");
const AppError = require("../../utils/AppError");

const mapWorkspaceRow = (row) => ({
  ...formatWorkspace(row),
  assignedUsers: row.assignedUsers ? row.assignedUsers.split(",") : [],
});

const creatorOwnsWorkspace = (workspace, authUser) =>
  workspace.created_by === authUser.userId;

const assertWorkspaceViewAccess = (workspace, authUser) => {
  if (authUser.role === "Admin") return;

  if (authUser.role === "Project Manager") {
    if (!creatorOwnsWorkspace(workspace, authUser)) {
      throw new AppError("Access denied to workspace", 403, "FORBIDDEN");
    }
    return;
  }

  const assignedUsers = workspace.assignedUsers
    ? workspace.assignedUsers.split(",")
    : [];
  if (workspace.creator_role && workspace.creator_role !== "Project Manager") {
    throw new AppError("Access denied to workspace", 403, "FORBIDDEN");
  }
  if (!assignedUsers.includes(authUser.userId)) {
    throw new AppError("Access denied to workspace", 403, "FORBIDDEN");
  }
};

const getAll = async (authUser) => {
  if (authUser.role === "Project Manager") {
    const [rows] = await pool.execute(
      `
      SELECT w.*, GROUP_CONCAT(wu.user_id) as assignedUsers
      FROM workspaces w
      LEFT JOIN workspace_users wu ON w.id = wu.workspace_id
      WHERE w.created_by = ?
      GROUP BY w.id
      ORDER BY w.created_at DESC
      `,
      [authUser.userId]
    );
    return rows.map(mapWorkspaceRow);
  }

  if (authUser.role === "Employee") {
    return getByUserId(authUser.userId, authUser);
  }

  const [rows] = await pool.execute(`
    SELECT w.*, creator.role as creator_role, GROUP_CONCAT(wu.user_id) as assignedUsers
    FROM workspaces w 
    LEFT JOIN users creator ON creator.id = w.created_by
    LEFT JOIN workspace_users wu ON w.id = wu.workspace_id 
    GROUP BY w.id
    ORDER BY w.created_at DESC
  `);
  return rows.map(mapWorkspaceRow);
};

const getById = async (id, authUser = null) => {
  const [rows] = await pool.execute(
    `
    SELECT w.*, creator.role as creator_role, GROUP_CONCAT(wu.user_id) as assignedUsers 
    FROM workspaces w 
    LEFT JOIN users creator ON creator.id = w.created_by
    LEFT JOIN workspace_users wu ON w.id = wu.workspace_id 
    WHERE w.id = ? 
    GROUP BY w.id
  `,
    [id]
  );

  if (rows.length === 0) {
    throw new AppError("Workspace not found", 404, "NOT_FOUND");
  }

  if (authUser) {
    assertWorkspaceViewAccess(rows[0], authUser);
  }

  return mapWorkspaceRow(rows[0]);
};

const getByUserId = async (userId, authUser) => {
  if (authUser.role === "Project Manager" && authUser.userId !== userId) {
    throw new AppError("Access denied", 403, "FORBIDDEN");
  }
  if (authUser.role === "Employee" && authUser.userId !== userId) {
    throw new AppError("Access denied", 403, "FORBIDDEN");
  }
  if (authUser.role === "Admin") {
    const [rows] = await pool.execute(
      `
      SELECT w.*, GROUP_CONCAT(wu2.user_id) as assignedUsers
      FROM workspaces w
      INNER JOIN workspace_users wu ON w.id = wu.workspace_id
      LEFT JOIN workspace_users wu2 ON w.id = wu2.workspace_id
      WHERE wu.user_id = ?
      GROUP BY w.id
      ORDER BY w.created_at DESC
      `,
      [userId]
    );
    return rows.map(mapWorkspaceRow);
  }

  const [rows] = await pool.execute(
    `
    SELECT w.*, creator.role as creator_role, GROUP_CONCAT(wu2.user_id) as assignedUsers
    FROM workspaces w
    INNER JOIN workspace_users wu ON w.id = wu.workspace_id
    INNER JOIN users creator ON creator.id = w.created_by
    LEFT JOIN workspace_users wu2 ON w.id = wu2.workspace_id
    WHERE wu.user_id = ?
      AND creator.role = 'Project Manager'
    GROUP BY w.id
    ORDER BY w.created_at DESC
  `,
    [userId]
  );
  return rows.map(mapWorkspaceRow);
};

const create = async ({ name, description, createdBy, assignedUsers = [] }) => {
  const ownerId = createdBy;
  const id = uuidv4();

  await pool.execute(
    "INSERT INTO workspaces (id, name, description, created_by) VALUES (?, ?, ?, ?)",
    [id, name, description, ownerId]
  );

  const uniqueUserIds = [
    ...new Set([ownerId, ...assignedUsers].filter(Boolean)),
  ];

  if (uniqueUserIds.length > 0) {
    const userValues = uniqueUserIds.map((userId) => [id, userId]);
    const placeholders = userValues.map(() => "(?, ?)").join(", ");
    await pool.execute(
      `INSERT INTO workspace_users (workspace_id, user_id) VALUES ${placeholders}`,
      userValues.flat()
    );
  }

  return getById(id);
};

const update = async (id, { name, description, assignedUsers }, authUser) => {
  const [workspaceRows] = await pool.execute(
    "SELECT id, created_by FROM workspaces WHERE id = ?",
    [id]
  );
  if (workspaceRows.length === 0) {
    throw new AppError("Workspace not found", 404, "NOT_FOUND");
  }
  const workspace = workspaceRows[0];
  if (authUser.role === "Project Manager" && workspace.created_by !== authUser.userId) {
    throw new AppError("Access denied", 403, "FORBIDDEN");
  }
  if (authUser.role === "Employee") {
    throw new AppError("Insufficient permissions", 403, "FORBIDDEN");
  }

  const updateFields = [];
  const values = [];

  if (name !== undefined) {
    updateFields.push("name = ?");
    values.push(name);
  }
  if (description !== undefined) {
    updateFields.push("description = ?");
    values.push(description);
  }

  if (updateFields.length > 0) {
    values.push(id);
    await pool.execute(
      `UPDATE workspaces SET ${updateFields.join(
        ", "
      )}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      values
    );
  }

  if (assignedUsers) {
    await pool.execute("DELETE FROM workspace_users WHERE workspace_id = ?", [
      id,
    ]);

    const uniqueUserIds = [
      ...new Set(
        [authUser.userId, ...assignedUsers].filter(Boolean)
      ),
    ];

    if (uniqueUserIds.length > 0) {
      const userValues = uniqueUserIds.map((userId) => [id, userId]);
      const placeholders = userValues.map(() => "(?, ?)").join(", ");
      await pool.execute(
        `INSERT INTO workspace_users (workspace_id, user_id) VALUES ${placeholders}`,
        userValues.flat()
      );
    }
  }

  return getById(id, authUser);
};

const remove = async (id, authUser) => {
  const [workspace] = await pool.execute(
    "SELECT id, created_by FROM workspaces WHERE id = ?",
    [id]
  );
  if (workspace.length === 0) {
    throw new AppError("Workspace not found", 404, "NOT_FOUND");
  }
  if (authUser.role === "Project Manager" && workspace[0].created_by !== authUser.userId) {
    throw new AppError("Access denied", 403, "FORBIDDEN");
  }
  if (authUser.role === "Employee") {
    throw new AppError("Insufficient permissions", 403, "FORBIDDEN");
  }

  await pool.execute("DELETE FROM workspaces WHERE id = ?", [id]);
  return { message: "Workspace deleted successfully" };
};

module.exports = { getAll, getById, getByUserId, create, update, remove };
