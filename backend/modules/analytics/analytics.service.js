const { pool } = require("../../config/database");
const AppError = require("../../utils/AppError");

const getOverview = async () => {
  const [userCount] = await pool.execute("SELECT COUNT(*) as count FROM users");
  const [workspaceCount] = await pool.execute(
    "SELECT COUNT(*) as count FROM workspaces"
  );
  const [threadCount] = await pool.execute(
    "SELECT COUNT(*) as count FROM chat_threads"
  );
  const [messageCount] = await pool.execute(
    "SELECT COUNT(*) as count FROM chat_messages"
  );

  return {
    totalUsers: userCount[0].count,
    totalWorkspaces: workspaceCount[0].count,
    totalThreads: threadCount[0].count,
    totalMessages: messageCount[0].count,
  };
};

const getChartData = async (type) => {
  if (type === "user-growth") {
    return [
      { month: "Jan", users: 10 },
      { month: "Feb", users: 15 },
      { month: "Mar", users: 20 },
      { month: "Apr", users: 25 },
      { month: "May", users: 30 },
    ];
  }

  if (type === "workspace-activity") {
    const [rows] = await pool.execute(`
      SELECT w.name, 
             COUNT(DISTINCT ct.id) as threads, 
             COUNT(DISTINCT cm.id) as messages 
      FROM workspaces w 
      LEFT JOIN chat_threads ct ON w.id = ct.workspace_id 
      LEFT JOIN chat_messages cm ON ct.id = cm.thread_id 
      GROUP BY w.id, w.name
    `);
    return rows;
  }

  throw new AppError("Chart type not found", 404, "NOT_FOUND");
};

const getDashboardStats = async () => {
  const [userCount] = await pool.execute("SELECT COUNT(*) as count FROM users");
  const [workspaceCount] = await pool.execute(
    "SELECT COUNT(*) as count FROM workspaces"
  );
  const [threadCount] = await pool.execute(
    "SELECT COUNT(*) as count FROM chat_threads"
  );
  const [messageCount] = await pool.execute(
    "SELECT COUNT(*) as count FROM chat_messages"
  );
  const [activeUserCount] = await pool.execute(
    "SELECT COUNT(*) as count FROM users WHERE role != 'Employee'"
  );

  const [userGrowthData] = await pool.execute(`
    SELECT 
      DATE_FORMAT(created_at, '%b') as month,
      COUNT(*) as users
    FROM users 
    GROUP BY MONTH(created_at), DATE_FORMAT(created_at, '%b')
    ORDER BY MONTH(created_at)
  `);

  const [workspaceActivityData] = await pool.execute(`
    SELECT 
      w.name,
      COUNT(DISTINCT ct.id) as threads,
      COUNT(DISTINCT cm.id) as messages
    FROM workspaces w
    LEFT JOIN chat_threads ct ON w.id = ct.workspace_id
    LEFT JOIN chat_messages cm ON ct.id = cm.thread_id
    GROUP BY w.id, w.name
    ORDER BY threads DESC, messages DESC
  `);

  return {
    totalUsers: userCount[0].count,
    totalWorkspaces: workspaceCount[0].count,
    totalThreads: threadCount[0].count,
    totalMessages: messageCount[0].count,
    activeUsers: activeUserCount[0].count,
    recentActivity: [
      {
        id: "1",
        type: "user_created",
        description: "New user registered",
        timestamp: new Date().toISOString(),
        user: "John Doe",
      },
      {
        id: "2",
        type: "workspace_created",
        description: "New workspace created",
        timestamp: new Date().toISOString(),
        user: "Jane Smith",
      },
    ],
    userGrowth: userGrowthData,
    workspaceActivity: workspaceActivityData,
  };
};

module.exports = { getOverview, getChartData, getDashboardStats };
