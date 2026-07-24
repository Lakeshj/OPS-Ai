const { pool } = require("../config/database");
const { getSessionMemory } = require("./sessionMemory.service");
const {
  shouldUseSessionMemory,
} = require("../utils/sessionMemoryPolicy");

const BASE_SYSTEM_PROMPT = `You are OpsAi, a workspace AI assistant.
Use the provided Workspace Summary as authoritative project context.
Follow the selected bot behavior instructions when a bot is selected.
Prefer concrete, accurate answers grounded in the provided memory.
If information is missing, say what is missing instead of inventing details.`;

const getWorkspaceSummary = async (workspaceId) => {
  const [rows] = await pool.execute(
    `
    SELECT content, version, updated_at
    FROM workspace_summaries
    WHERE workspace_id = ?
    `,
    [workspaceId]
  );

  if (rows.length === 0) {
    return {
      content:
        "# Workspace Summary\n\n_No workspace summary has been generated yet._",
      version: 0,
    };
  }

  return {
    content: rows[0].content,
    version: Number(rows[0].version || 1),
    updatedAt: rows[0].updated_at,
  };
};

const getRecentMessages = async (threadId, { limit = 12 } = {}) => {
  const safeLimit = Math.min(Math.max(Number(limit) || 12, 1), 50);
  const [rows] = await pool.execute(
    `
    SELECT id, content, is_user_message, created_at
    FROM chat_messages
    WHERE thread_id = ?
    ORDER BY created_at DESC
    LIMIT ${safeLimit}
    `,
    [threadId]
  );

  return rows.reverse();
};

const assemblePrompt = async ({
  workspaceId,
  threadId,
  prompt,
  assistant = null,
}) => {
  const workspaceSummary = await getWorkspaceSummary(workspaceId);
  const useSessionMemory = shouldUseSessionMemory({ assistant, prompt });
  const sessionMemory = useSessionMemory
    ? await getSessionMemory(threadId)
    : {
        exists: false,
        summary: "",
        keyDecisions: [],
        activeTasks: [],
        workingContext: "",
        summaryTokenCount: 0,
      };
  const recentMessages = await getRecentMessages(threadId, { limit: 12 });

  const botPrompt =
    assistant?.promptTemplate ||
    "You are a helpful workspace assistant for this project.";

  // Chat uses: base rules + workspace summary + bot prompt only.
  // Platform System Prompts are for global features (e.g. summary generation), not bots.
  const stableSystemPrompt = [
    BASE_SYSTEM_PROMPT,
    "",
    "## Workspace Summary",
    workspaceSummary.content,
    "",
    "## Selected Bot Instructions",
    botPrompt,
  ].join("\n");

  const messages = [{ role: "system", content: stableSystemPrompt }];

  if (useSessionMemory) {
    const dynamicContext = [
      "## Session Memory",
      sessionMemory.summary
        ? sessionMemory.summary
        : "_No session summary yet._",
      sessionMemory.workingContext
        ? `\n### Working Context\n${sessionMemory.workingContext}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    messages.push({ role: "system", content: dynamicContext });
  }

  for (const message of recentMessages) {
    messages.push({
      role: message.is_user_message ? "user" : "assistant",
      content: message.content,
    });
  }

  const lastIsCurrentPrompt =
    recentMessages.length > 0 &&
    recentMessages[recentMessages.length - 1].is_user_message &&
    recentMessages[recentMessages.length - 1].content === prompt;

  if (!lastIsCurrentPrompt) {
    messages.push({ role: "user", content: prompt });
  }

  const assistantId = assistant?.id || "default";
  const promptCacheKey = `workspace:${workspaceId}:bot:${assistantId}:summary:v${workspaceSummary.version}`;

  return {
    messages,
    promptCacheKey,
    workspaceSummary,
    sessionMemory,
    useSessionMemory,
    recentMessages,
    retrievedChunks: [],
  };
};

module.exports = {
  assemblePrompt,
  getWorkspaceSummary,
  getWorkspaceStaticMemory: getWorkspaceSummary,
  getRecentMessages,
};
