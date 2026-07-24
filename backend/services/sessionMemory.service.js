const { pool } = require("../config/database");
const { openai, openaiModel } = require("../config/openai");
const {
  withGenerationOptions,
} = require("../utils/openaiCompletionOptions");

const DEFAULT_SESSION = {
  summary: "",
  keyDecisions: [],
  activeTasks: [],
  workingContext: "",
  summaryTokenCount: 0,
};

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const getSessionMemory = async (threadId) => {
  const [rows] = await pool.execute(
    "SELECT * FROM chat_session_memory WHERE thread_id = ?",
    [threadId]
  );

  if (rows.length === 0) {
    return { ...DEFAULT_SESSION, exists: false };
  }

  const row = rows[0];
  return {
    exists: true,
    summary: row.summary || "",
    keyDecisions: parseJsonArray(row.key_decisions),
    activeTasks: parseJsonArray(row.active_tasks),
    workingContext: row.working_context || "",
    lastAssistantId: row.last_assistant_id,
    summarizedThroughMessageId: row.summarized_through_message_id,
    summaryTokenCount: Number(row.summary_token_count || 0),
  };
};

const estimateTokens = (text) =>
  Math.max(1, Math.ceil(String(text || "").length / 4));

const maybeSummarize = async ({ previousSummary, recentMessages }) => {
  const transcript = recentMessages
    .map(
      (message) =>
        `${message.is_user_message ? "User" : "Assistant"}: ${message.content}`
    )
    .join("\n");

  if (!transcript.trim()) {
    return previousSummary || "Conversation started.";
  }

  // Avoid an extra model call for short chats.
  if (transcript.length < 1200 && !previousSummary) {
    return `Recent discussion:\n${transcript.slice(0, 1000)}`;
  }

  try {
    const model = openaiModel || "gpt-4o-mini";
    const completion = await openai.chat.completions.create(
      withGenerationOptions(model, {
        temperature: 0.2,
        maxTokens: 300,
      messages: [
        {
          role: "system",
          content:
            "Summarize the workspace chat for future context. Keep key decisions, active tasks, and current working context. Be concise.",
        },
        {
          role: "user",
          content: `Previous summary:\n${previousSummary || "(none)"}\n\nNew messages:\n${transcript}`,
        },
      ],
      })
    );

    return (
      completion.choices[0]?.message?.content?.trim() ||
      previousSummary ||
      "Conversation in progress."
    );
  } catch (error) {
    console.error("[session-memory] summary failed:", error.message);
    return (
      previousSummary ||
      `Recent discussion:\n${transcript.slice(0, 1000)}`
    );
  }
};

const upsertSessionMemory = async ({
  threadId,
  assistantId = null,
  latestMessageId = null,
  recentMessages = [],
  forceSummarize = false,
}) => {
  const current = await getSessionMemory(threadId);
  const shouldSummarize =
    forceSummarize ||
    !current.exists ||
    recentMessages.length >= 8 ||
    current.summaryTokenCount > 800;

  const summary = shouldSummarize
    ? await maybeSummarize({
        previousSummary: current.summary,
        recentMessages,
      })
    : current.summary || "Conversation in progress.";

  const lastUser = [...recentMessages]
    .reverse()
    .find((message) => message.is_user_message);
  const lastAssistant = [...recentMessages]
    .reverse()
    .find((message) => !message.is_user_message);

  const workingContext = [
    lastUser ? `Latest user ask: ${String(lastUser.content).slice(0, 500)}` : null,
    lastAssistant
      ? `Latest assistant reply: ${String(lastAssistant.content).slice(0, 500)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const summaryTokenCount = estimateTokens(summary);

  if (!current.exists) {
    await pool.execute(
      `
      INSERT INTO chat_session_memory (
        thread_id,
        summary,
        key_decisions,
        active_tasks,
        working_context,
        last_assistant_id,
        summarized_through_message_id,
        summary_token_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        threadId,
        summary,
        JSON.stringify(current.keyDecisions),
        JSON.stringify(current.activeTasks),
        workingContext,
        assistantId,
        latestMessageId,
        summaryTokenCount,
      ]
    );
  } else {
    await pool.execute(
      `
      UPDATE chat_session_memory
      SET
        summary = ?,
        working_context = ?,
        last_assistant_id = COALESCE(?, last_assistant_id),
        summarized_through_message_id = COALESCE(?, summarized_through_message_id),
        summary_token_count = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE thread_id = ?
      `,
      [
        summary,
        workingContext,
        assistantId,
        latestMessageId,
        summaryTokenCount,
        threadId,
      ]
    );
  }

  return getSessionMemory(threadId);
};

module.exports = {
  getSessionMemory,
  upsertSessionMemory,
};
