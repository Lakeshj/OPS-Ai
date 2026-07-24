const { openaiModel } = require("../config/openai");
const { getClientForProvider } = require("../config/aiClients");
const AppError = require("../utils/AppError");
const {
  withGenerationOptions,
} = require("../utils/openaiCompletionOptions");
const {
  inferProviderFromModel,
  normalizeProvider,
} = require("../utils/aiProviders");
const { logAiError } = require("./aiErrorLog.service");
const {
  markModelSuccess,
  markModelFailure,
} = require("./aiModelStatus.service");
const {
  saveGeneratedMedia,
  publicMediaUrl,
} = require("./generatedMedia.service");

const resolveProvider = (assistant) =>
  normalizeProvider(assistant?.provider) ||
  inferProviderFromModel(assistant?.model) ||
  "openai";

/** Default workspace chat (no @bot) uses OPENAI_MODEL or gpt-4o-mini. */
const resolveChatModel = (assistant) => {
  const configured = assistant?.model?.trim();
  if (!configured) return openaiModel || "gpt-4o-mini";
  if (/^(dall-e|gpt-image|sora|veo|video|image)/i.test(configured)) {
    return openaiModel || "gpt-4o-mini";
  }
  return configured;
};

const resolveImageModel = (assistant) => {
  const configured = String(assistant?.model || "")
    .trim()
    .replace(/^models\//, "");
  if (
    configured &&
    /^(dall-e|gpt-image|chatgpt-image|imagen|gemini-.*-image)/i.test(configured)
  ) {
    return configured;
  }
  const provider = resolveProvider(assistant);
  if (provider === "gemini") return "gemini-2.5-flash-image";
  return "gpt-image-1";
};

const mimeToExtension = (mimeType = "image/png") => {
  if (/jpeg|jpg/i.test(mimeType)) return "jpg";
  if (/webp/i.test(mimeType)) return "webp";
  if (/gif/i.test(mimeType)) return "gif";
  return "png";
};

const toImageMarkdown = async ({ url, b64, mimeType = "image/png" }) => {
  if (url && !String(url).startsWith("data:")) {
    return `![Generated image](${url})`;
  }
  if (b64) {
    const buffer = Buffer.from(b64, "base64");
    const saved = await saveGeneratedMedia({
      buffer,
      extension: mimeToExtension(mimeType),
      mimeType,
    });
    return `![Generated image](${publicMediaUrl(saved.publicPath)})`;
  }
  return null;
};

const runOpenAiImageGeneration = async ({ imageModel, imagePrompt }) => {
  const { client } = getClientForProvider("openai");
  const result = await client.images.generate({
    model: imageModel,
    prompt: imagePrompt.slice(0, 4000),
    n: 1,
    size: "1024x1024",
  });

  const image = result.data?.[0];
  const markdown = await toImageMarkdown({
    url: image?.url,
    b64: image?.b64_json,
  });
  if (!markdown) {
    throw new AppError(
      "Image generation returned no result",
      502,
      "OPENAI_ERROR"
    );
  }
  return markdown;
};

const runGeminiImagenGeneration = async ({ imageModel, imagePrompt }) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AppError(
      "Gemini API key is not configured (GEMINI_API_KEY)",
      503,
      "AI_PROVIDER_NOT_CONFIGURED"
    );
  }

  const modelId = String(imageModel || "").replace(/^models\//, "");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    modelId
  )}:predict?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt: imagePrompt.slice(0, 2000) }],
      parameters: { sampleCount: 1 },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      payload?.error?.message ||
      `Gemini Imagen failed (${response.status})`;
    const err = new Error(detail);
    err.status = response.status;
    err.code = payload?.error?.status || "GEMINI_IMAGEN_FAILED";
    throw err;
  }

  const prediction = payload?.predictions?.[0] || {};
  const b64 =
    prediction.bytesBase64Encoded ||
    prediction.image?.bytesBase64Encoded ||
    null;
  const mimeType = prediction.mimeType || "image/png";
  const markdown = await toImageMarkdown({ b64, mimeType });
  if (!markdown) {
    throw new AppError(
      "Gemini Imagen returned no image bytes",
      502,
      "GEMINI_IMAGE_EMPTY"
    );
  }
  return markdown;
};

const runGeminiNativeImageGeneration = async ({ imageModel, imagePrompt }) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AppError(
      "Gemini API key is not configured (GEMINI_API_KEY)",
      503,
      "AI_PROVIDER_NOT_CONFIGURED"
    );
  }

  const modelId = String(imageModel || "").replace(/^models\//, "");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    modelId
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  // IMAGE-only avoids text-only replies that caused GEMINI_IMAGE_EMPTY.
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: imagePrompt.slice(0, 3000) }],
        },
      ],
      generationConfig: {
        responseModalities: ["IMAGE"],
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      payload?.error?.message ||
      `Gemini image generation failed (${response.status})`;
    const err = new Error(detail);
    err.status = response.status;
    err.code = payload?.error?.status || "GEMINI_IMAGE_FAILED";
    throw err;
  }

  const parts = payload?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    const inline = part.inlineData || part.inline_data;
    if (inline?.data) {
      const markdown = await toImageMarkdown({
        b64: inline.data,
        mimeType: inline.mimeType || inline.mime_type || "image/png",
      });
      if (markdown) return markdown;
    }
  }

  throw new AppError(
    "Gemini image model returned no image part. Try OpenAI GPT Image, or a shorter visual prompt.",
    502,
    "GEMINI_IMAGE_EMPTY"
  );
};

const buildImagePrompt = ({ assembled, userPrompt, assistant }) => {
  const summary = assembled.workspaceSummary?.content || "";
  const summarySnippet = summary.slice(0, 600);
  const styleHint =
    assistant?.promptTemplate
      ? String(assistant.promptTemplate).slice(0, 400)
      : "Create a clear, high-quality image.";

  // Keep prompt visual — long chat-style bot templates cause text-only replies.
  return [
    "Generate an image (not text).",
    styleHint,
    summarySnippet ? `Brand/workspace context: ${summarySnippet}` : "",
    `User request: ${userPrompt}`,
  ]
    .filter(Boolean)
    .join("\n\n");
};

const buildVideoPrompt = ({ assembled, userPrompt, assistant }) => {
  const summary = assembled.workspaceSummary?.content || "";
  const summarySnippet = summary.slice(0, 500);
  const styleHint = assistant?.promptTemplate
    ? String(assistant.promptTemplate).slice(0, 400)
    : "Cinematic, clear motion, high quality.";

  return [
    styleHint,
    summarySnippet ? `Workspace context: ${summarySnippet}` : "",
    `Video request: ${userPrompt}`,
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 2000);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const resolveVideoModel = (assistant) => {
  const configured = String(assistant?.model || "")
    .trim()
    .replace(/^models\//, "");
  const provider = resolveProvider(assistant);

  if (/^sora-/i.test(configured)) return configured;
  if (/^veo-/i.test(configured)) return configured;

  if (provider === "gemini") return "veo-3.1-fast-generate-preview";
  return "sora-2";
};

const runOpenAiSoraGeneration = async ({ videoModel, videoPrompt }) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AppError(
      "OpenAI API key is not configured (OPENAI_API_KEY)",
      503,
      "AI_PROVIDER_NOT_CONFIGURED"
    );
  }

  const createRes = await fetch("https://api.openai.com/v1/videos", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: videoModel || "sora-2",
      prompt: videoPrompt,
      seconds: "4",
      size: "720x1280",
    }),
  });
  const job = await createRes.json().catch(() => ({}));
  if (!createRes.ok) {
    const err = new Error(job?.error?.message || "Sora video create failed");
    err.status = createRes.status;
    throw err;
  }

  const videoId = job.id;
  let status = job.status;
  for (let i = 0; i < 45; i += 1) {
    if (status === "completed") break;
    if (status === "failed") {
      throw new AppError(
        job?.error?.message || "Sora video generation failed",
        502,
        "SORA_FAILED"
      );
    }
    await sleep(4000);
    const pollRes = await fetch(`https://api.openai.com/v1/videos/${videoId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const polled = await pollRes.json().catch(() => ({}));
    status = polled.status;
    if (status === "failed") {
      throw new AppError(
        polled?.error?.message || "Sora video generation failed",
        502,
        "SORA_FAILED"
      );
    }
  }

  if (status !== "completed") {
    throw new AppError(
      "Sora video generation timed out. Try again with a shorter prompt.",
      504,
      "SORA_TIMEOUT"
    );
  }

  const contentRes = await fetch(
    `https://api.openai.com/v1/videos/${videoId}/content`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );
  if (!contentRes.ok) {
    throw new AppError(
      "Failed to download Sora video content",
      502,
      "SORA_DOWNLOAD_FAILED"
    );
  }
  const buffer = Buffer.from(await contentRes.arrayBuffer());
  const saved = await saveGeneratedMedia({
    buffer,
    extension: "mp4",
    mimeType: "video/mp4",
  });
  const url = publicMediaUrl(saved.publicPath);
  return `Here's your generated video:\n\n[Generated video](${url})`;
};

const runGeminiVeoGeneration = async ({ videoModel, videoPrompt }) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AppError(
      "Gemini API key is not configured (GEMINI_API_KEY)",
      503,
      "AI_PROVIDER_NOT_CONFIGURED"
    );
  }

  const modelId = String(videoModel || "veo-3.1-fast-generate-preview").replace(
    /^models\//,
    ""
  );
  const startUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    modelId
  )}:predictLongRunning?key=${encodeURIComponent(apiKey)}`;

  const startRes = await fetch(startUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt: videoPrompt }],
    }),
  });
  const started = await startRes.json().catch(() => ({}));
  if (!startRes.ok || !started.name) {
    const err = new Error(
      started?.error?.message || "Veo video create failed"
    );
    err.status = startRes.status;
    throw err;
  }

  let operation = started;
  for (let i = 0; i < 45; i += 1) {
    if (operation.done) break;
    await sleep(4000);
    const pollRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${operation.name}?key=${encodeURIComponent(
        apiKey
      )}`
    );
    operation = await pollRes.json().catch(() => ({}));
    if (operation.error) {
      throw new AppError(
        operation.error.message || "Veo video generation failed",
        502,
        "VEO_FAILED"
      );
    }
  }

  if (!operation.done) {
    throw new AppError(
      "Veo video generation timed out. Try again with a shorter prompt.",
      504,
      "VEO_TIMEOUT"
    );
  }

  const sample =
    operation?.response?.generateVideoResponse?.generatedSamples?.[0] ||
    operation?.response?.generateVideoResponse?.generated_samples?.[0];
  const downloadUri = sample?.video?.uri || sample?.video?.url;
  if (!downloadUri) {
    throw new AppError(
      "Veo returned no video file",
      502,
      "VEO_EMPTY"
    );
  }

  const join = downloadUri.includes("?") ? "&" : "?";
  const downloadRes = await fetch(
    `${downloadUri}${join}key=${encodeURIComponent(apiKey)}`
  );
  if (!downloadRes.ok) {
    throw new AppError(
      "Failed to download Veo video content",
      502,
      "VEO_DOWNLOAD_FAILED"
    );
  }
  const buffer = Buffer.from(await downloadRes.arrayBuffer());
  const saved = await saveGeneratedMedia({
    buffer,
    extension: "mp4",
    mimeType: "video/mp4",
  });
  const url = publicMediaUrl(saved.publicPath);
  return `Here's your generated video:\n\n[Generated video](${url})`;
};

const formatUpstreamError = (provider, error) => {
  const status = Number(error?.status || error?.statusCode || 0);
  const raw =
    error?.error?.message ||
    error?.message ||
    `${provider} generation failed`;

  if (status === 402 || /insufficient balance/i.test(raw)) {
    return `${provider} account has insufficient balance. Top up the provider wallet or switch the bot to OpenAI.`;
  }
  if (status === 404 || /does not exist|not found/i.test(raw)) {
    return `${provider} model is unavailable (404). Pick another model — unavailable ones are disabled in Admin after failure.`;
  }
  if (status === 401 || /invalid.*api.?key|incorrect api key/i.test(raw)) {
    return `${provider} API key is invalid. Check backend .env and restart the server.`;
  }
  if (status === 403 || /does not have access/i.test(raw)) {
    return `${provider} project does not have access to this model. Pick another model in the bot settings.`;
  }
  return raw;
};

const recordFailure = async ({
  provider,
  model,
  capabilityType,
  assistant,
  context,
  error,
  message,
}) => {
  const statusCode = error?.status || error?.statusCode || null;
  const errorCode = error?.code || error?.error?.code || null;
  await markModelFailure(provider, model, { message, statusCode });
  await logAiError({
    provider,
    model,
    capabilityType,
    assistantId: assistant?.id || null,
    workspaceId: context?.workspaceId || null,
    threadId: context?.threadId || null,
    userId: context?.userId || null,
    statusCode,
    errorCode,
    message,
  });
};

const runChatGeneration = async ({
  assembled,
  assistant,
  model,
  context,
}) => {
  const provider = resolveProvider(assistant);
  const { client } = getClientForProvider(provider, model);

  const generationOptions = withGenerationOptions(model, {
    messages: assembled.messages,
    temperature: 0.4,
    maxTokens: 1200,
    ...(provider === "openai"
      ? { prompt_cache_key: assembled.promptCacheKey }
      : {}),
  });

  try {
    const completion = await client.chat.completions.create(generationOptions);
    const content = completion.choices?.[0]?.message?.content;
    await markModelSuccess(provider, model);

    return {
      response:
        typeof content === "string" && content.trim()
          ? content.trim()
          : "I could not generate a response.",
      model,
      provider,
      usage: completion.usage,
      outputType: "text",
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message = formatUpstreamError(provider, error);
    await recordFailure({
      provider,
      model,
      capabilityType: assistant?.capabilityType || "chat",
      assistant,
      context,
      error,
      message,
    });
    throw new AppError(message, error?.status || 502, "AI_GENERATION_FAILED");
  }
};

const runImageGeneration = async ({
  assembled,
  assistant,
  userPrompt,
  context,
}) => {
  const provider = resolveProvider(assistant);
  const imageModel = resolveImageModel(assistant);
  const imagePrompt = buildImagePrompt({ assembled, userPrompt, assistant });

  try {
    let markdown;

    if (provider === "openai") {
      markdown = await runOpenAiImageGeneration({ imageModel, imagePrompt });
    } else if (provider === "gemini") {
      if (/^imagen-/i.test(imageModel)) {
        markdown = await runGeminiImagenGeneration({ imageModel, imagePrompt });
      } else if (/image/i.test(imageModel)) {
        markdown = await runGeminiNativeImageGeneration({
          imageModel,
          imagePrompt,
        });
      } else {
        throw new AppError(
          `Gemini model "${imageModel}" is not an image model. Pick Imagen 4 or Gemini Flash Image.`,
          400,
          "IMAGE_MODEL_UNSUPPORTED"
        );
      }
    } else {
      throw new AppError(
        "DeepSeek has no image models. Use OpenAI (GPT Image) or Gemini (Imagen / Flash Image).",
        400,
        "IMAGE_PROVIDER_UNSUPPORTED"
      );
    }

    await markModelSuccess(provider, imageModel);

    return {
      response: markdown,
      model: imageModel,
      provider,
      usage: null,
      outputType: "image",
    };
  } catch (error) {
    if (error instanceof AppError) {
      await recordFailure({
        provider,
        model: imageModel,
        capabilityType: "image",
        assistant,
        context,
        error,
        message: error.message,
      });
      throw error;
    }
    const message = formatUpstreamError(provider, error);
    await recordFailure({
      provider,
      model: imageModel,
      capabilityType: "image",
      assistant,
      context,
      error,
      message,
    });
    throw new AppError(message, error?.status || 502, "AI_GENERATION_FAILED");
  }
};

const runVideoGeneration = async ({
  assembled,
  assistant,
  userPrompt,
  context,
}) => {
  const provider = resolveProvider(assistant);
  const videoModel = resolveVideoModel(assistant);
  const videoPrompt = buildVideoPrompt({ assembled, userPrompt, assistant });

  try {
    let response;
    if (provider === "openai" || /^sora-/i.test(videoModel)) {
      response = await runOpenAiSoraGeneration({ videoModel, videoPrompt });
    } else if (provider === "gemini" || /^veo-/i.test(videoModel)) {
      response = await runGeminiVeoGeneration({ videoModel, videoPrompt });
    } else {
      throw new AppError(
        "Video generation requires OpenAI (Sora) or Gemini (Veo). Edit the bot brand/model.",
        400,
        "VIDEO_PROVIDER_UNSUPPORTED"
      );
    }

    await markModelSuccess(
      /^sora-/i.test(videoModel) ? "openai" : "gemini",
      videoModel
    );

    return {
      response,
      model: videoModel,
      provider: /^sora-/i.test(videoModel) ? "openai" : "gemini",
      usage: null,
      outputType: "video",
    };
  } catch (error) {
    const resolvedProvider = /^sora-/i.test(videoModel) ? "openai" : "gemini";
    if (error instanceof AppError) {
      await recordFailure({
        provider: resolvedProvider,
        model: videoModel,
        capabilityType: "video",
        assistant,
        context,
        error,
        message: error.message,
      });
      throw error;
    }
    const message = formatUpstreamError(resolvedProvider, error);
    await recordFailure({
      provider: resolvedProvider,
      model: videoModel,
      capabilityType: "video",
      assistant,
      context,
      error,
      message,
    });
    throw new AppError(message, error?.status || 502, "AI_GENERATION_FAILED");
  }
};

const generateByCapability = async ({
  assembled,
  assistant,
  userPrompt,
  context = {},
}) => {
  const capability = String(assistant?.capabilityType || "chat")
    .trim()
    .toLowerCase();
  const model = String(assistant?.model || "")
    .trim()
    .toLowerCase()
    .replace(/^models\//, "");

  const isImageBot =
    capability === "image" ||
    /^(dall-e|gpt-image|chatgpt-image|imagen|gemini-.*-image)/i.test(model);

  if (isImageBot) {
    return runImageGeneration({
      assembled,
      assistant,
      userPrompt,
      context,
    });
  }

  const isVideoBot =
    capability === "video" || /^veo-/i.test(model) || /^sora-/i.test(model);

  if (isVideoBot) {
    return runVideoGeneration({
      assembled,
      assistant,
      userPrompt,
      context,
    });
  }

  return runChatGeneration({
    assembled,
    assistant,
    model: resolveChatModel(assistant),
    context,
  });
};

module.exports = {
  generateByCapability,
  resolveChatModel,
  resolveProvider,
};
