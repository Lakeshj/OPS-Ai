const { v4: uuidv4 } = require("uuid");
const { pool } = require("../../config/database");
const AppError = require("../../utils/AppError");
const {
  assertThreadAccess,
} = require("../../services/authorization.service");
const assistantsService = require("../assistants/assistants.service");
const { assemblePrompt } = require("../../services/promptAssembler.service");
const {
  generateByCapability,
} = require("../../services/botGeneration.service");
const { upsertSessionMemory } = require("../../services/sessionMemory.service");
const {
  shouldUseSessionMemory,
} = require("../../utils/sessionMemoryPolicy");

const logUsageEvent = async ({
  workspaceId,
  threadId,
  userId,
  assistantId,
  model,
  usage,
  latencyMs,
}) => {
  try {
    await pool.execute(
      `
      INSERT INTO ai_usage_events (
        id,
        workspace_id,
        thread_id,
        user_id,
        assistant_id,
        model,
        input_tokens,
        cached_tokens,
        cache_write_tokens,
        output_tokens,
        total_tokens,
        latency_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        uuidv4(),
        workspaceId,
        threadId,
        userId || null,
        assistantId || null,
        model,
        Number(usage?.prompt_tokens || 0),
        Number(usage?.prompt_tokens_details?.cached_tokens || 0),
        Number(usage?.prompt_tokens_details?.cache_write_tokens || 0),
        Number(usage?.completion_tokens || 0),
        Number(usage?.total_tokens || 0),
        latencyMs,
      ]
    );
  } catch (error) {
    console.error("[ai-usage] failed to log usage:", error.message);
  }
};

const generate = async ({ threadId, prompt, assistantId }, authUser) => {
  if (!threadId || typeof threadId !== "string") {
    throw new AppError("threadId is required", 400, "VALIDATION_ERROR");
  }
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    throw new AppError("Prompt is required", 400, "VALIDATION_ERROR");
  }

  const thread = await assertThreadAccess(authUser, threadId);
  const workspaceId = thread.workspace_id;

  let assistant = null;
  if (assistantId) {
    assistant = await assistantsService.getById(assistantId);
  }

  const assembled = await assemblePrompt({
    workspaceId,
    threadId,
    prompt: prompt.trim(),
    assistant,
  });

  const startedAt = Date.now();

  try {
    const generated = await generateByCapability({
      assembled,
      assistant,
      userPrompt: prompt.trim(),
      context: {
        workspaceId,
        threadId,
        userId: authUser.userId,
      },
    });

    const response = generated.response;
    const model = generated.model;
    const latencyMs = Date.now() - startedAt;

    await logUsageEvent({
      workspaceId,
      threadId,
      userId: authUser.userId,
      assistantId: assistant?.id || null,
      model,
      usage: generated.usage,
      latencyMs,
    });

    // Session memory: always with a bot; without a bot only for important prompts.
    const useSessionMemory =
      assembled.useSessionMemory ??
      shouldUseSessionMemory({ assistant, prompt: prompt.trim() });

    if (useSessionMemory) {
      const recentForSummary = [
        ...assembled.recentMessages,
        {
          is_user_message: 0,
          content: response,
        },
      ].slice(-12);

      const latestMessageId =
        assembled.recentMessages[assembled.recentMessages.length - 1]?.id ||
        null;

      await upsertSessionMemory({
        threadId,
        assistantId: assistant?.id || null,
        latestMessageId,
        recentMessages: recentForSummary,
      });
    }

    return {
      response,
      status: "success",
      meta: {
        model,
        promptCacheKey: assembled.promptCacheKey,
        summaryVersion: assembled.workspaceSummary.version,
        useSessionMemory,
        outputType: generated.outputType || "text",
        capabilityType: assistant?.capabilityType || null,
        retrievedChunkCount: 0,
        usage: generated.usage
          ? {
              inputTokens: Number(generated.usage?.prompt_tokens || 0),
              cachedTokens: Number(
                generated.usage?.prompt_tokens_details?.cached_tokens || 0
              ),
              outputTokens: Number(generated.usage?.completion_tokens || 0),
              totalTokens: Number(generated.usage?.total_tokens || 0),
            }
          : null,
        latencyMs,
      },
    };
  } catch (error) {
    console.error("AI generation failed:", error);
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      error?.message || "Failed to generate response",
      error?.statusCode || error?.status || 502,
      error?.code || "AI_GENERATION_FAILED"
    );
  }
};

module.exports = { generate };
