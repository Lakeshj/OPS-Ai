const express = require("express");
const { authenticateToken } = require("../middleware/auth");

const healthRoutes = require("../modules/health/health.routes");
const authRoutes = require("../modules/auth/auth.routes");
const usersRoutes = require("../modules/users/users.routes");
const workspacesRoutes = require("../modules/workspaces/workspaces.routes");
const foldersRoutes = require("../modules/folders/folders.routes");
const chatThreadsRoutes = require("../modules/chatThreads/chatThreads.routes");
const chatMessagesRoutes = require("../modules/chatMessages/chatMessages.routes");
const assistantsRoutes = require("../modules/assistants/assistants.routes");
const analyticsRoutes = require("../modules/analytics/analytics.routes");
const chatGenerateRoutes = require("../modules/chatGenerate/chatGenerate.routes");
const workspaceSummaryRoutes = require("../modules/workspaceSummary/workspaceSummary.routes");
const adminAiSettingsRoutes = require("../modules/adminAiSettings/adminAiSettings.routes");
const systemPromptsRoutes = require("../modules/systemPrompts/systemPrompts.routes");
const {
  workspaceRouter: workspaceDocumentsRoutes,
  documentRouter: documentsRoutes,
} = require("../modules/documents/documents.routes");

const { getByUserId } = require("../modules/workspaces/workspaces.controller");
const {
  getByWorkspaceId: getFoldersByWorkspaceId,
} = require("../modules/folders/folders.controller");
const {
  getByFolderId,
  getByUserAndWorkspace,
  getByWorkspaceId: getThreadsByWorkspaceId,
} = require("../modules/chatThreads/chatThreads.controller");
const {
  getByThreadId,
} = require("../modules/chatMessages/chatMessages.controller");

const router = express.Router();

// Public routes
router.use("/health", healthRoutes);
router.use("/auth", authRoutes);
// UUID filenames — needed for <video src> without Authorization headers
router.use(
  "/generated-media",
  require("../modules/generatedMedia/generatedMedia.routes")
);

// Protected routes
router.use(authenticateToken);

router.get("/users/:userId/workspaces", getByUserId);
router.get(
  "/users/:userId/workspaces/:workspaceId/chat-threads",
  getByUserAndWorkspace
);
router.get("/workspaces/:workspaceId/folders", getFoldersByWorkspaceId);
router.get("/workspaces/:workspaceId/chat-threads", getThreadsByWorkspaceId);
router.use("/workspaces/:workspaceId/documents", workspaceDocumentsRoutes);
router.use("/workspaces/:workspaceId/summary", workspaceSummaryRoutes);
router.get("/folders/:folderId/chat-threads", getByFolderId);
router.get("/chat-threads/:threadId/messages", getByThreadId);

router.use("/users", usersRoutes);
router.use("/workspaces", workspacesRoutes);
router.use("/folders", foldersRoutes);
router.use("/chat-threads", chatThreadsRoutes);
router.use("/chat-messages", chatMessagesRoutes);
router.use("/documents", documentsRoutes);
router.use("/assistants", assistantsRoutes);
router.use("/analytics", analyticsRoutes);
router.use("/chat", chatGenerateRoutes);
router.use("/admin/ai-settings", adminAiSettingsRoutes);
router.use("/admin/system-prompts", systemPromptsRoutes);
router.use("/admin/ai-logs", require("../modules/adminAiLogs/adminAiLogs.routes"));
router.use(
  "/admin/generated-media",
  require("../modules/adminGeneratedMedia/adminGeneratedMedia.routes")
);

module.exports = router;
