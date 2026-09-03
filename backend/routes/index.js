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
const workflowsRoutes = require("../modules/workflows/workflows.routes");
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

// Public ping — open http://host:PORT/api in a browser to confirm API is up
router.get("/", (_req, res) => {
  res.status(200).json({
    ok: true,
    message: "OpsAi API is working",
    service: "opsai-backend",
    time: new Date().toISOString(),
    health: "/api/health",
  });
});

// Public routes
router.use("/health", healthRoutes);
router.use("/auth", authRoutes);
// UUID filenames — needed for <video src> without Authorization headers
router.use(
  "/generated-media",
  require("../modules/generatedMedia/generatedMedia.routes")
);

// Part 8B: opaque external Wait resume (token in body/Authorization — not URL path)
const rateLimit = require("express-rate-limit");
const config = require("../config");
const { resumeByExternalToken } = require("../modules/workflows/workflows.controller");
const workflowResumeLimiter =
  config.env === "development"
    ? (_req, _res, next) => next()
    : rateLimit({
        windowMs: 60 * 1000,
        max: 30,
        standardHeaders: true,
        legacyHeaders: false,
        message: { ok: false, code: "RATE_LIMIT" },
      });
router.post("/workflow-resume", workflowResumeLimiter, resumeByExternalToken);

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
router.use("/workflows", workflowsRoutes);
router.use("/admin/ai-logs", require("../modules/adminAiLogs/adminAiLogs.routes"));
router.use(
  "/admin/generated-media",
  require("../modules/adminGeneratedMedia/adminGeneratedMedia.routes")
);

module.exports = router;
