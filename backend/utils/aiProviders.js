/**
 * AI brand + model catalog for OpsAi bots.
 * IDs were cross-checked against live OpenAI / DeepSeek / Gemini model lists
 * for this project's API keys (Jul 2026). Availability is still tracked in
 * ai_model_status (failures disable selection).
 *
 * - group: dropdown section for admin clarity
 * - tags: secondary labels (Coding, Vision, …)
 * - capabilities: which bot capability types can select this model
 */

const AI_CAPABILITIES = [
  { key: "chat", label: "Content / Chat" },
  { key: "image", label: "Image" },
  { key: "video", label: "Video" },
  { key: "audio", label: "Audio" },
];

const AI_PROVIDERS = [
  {
    key: "openai",
    label: "OpenAI",
    models: [
      // Chat / Text
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", group: "Chat / Text", tags: ["Chat", "Vision", "Coding"], capabilities: ["chat", "audio"] },
      { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", group: "Chat / Text", tags: ["Chat", "Vision"], capabilities: ["chat", "audio"] },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", group: "Chat / Text", tags: ["Chat"], capabilities: ["chat", "audio"] },
      { id: "gpt-5.5", label: "GPT-5.5", group: "Chat / Text", tags: ["Chat", "Coding", "Vision"], capabilities: ["chat", "audio"] },
      { id: "gpt-5.5-pro", label: "GPT-5.5 Pro", group: "Chat / Text", tags: ["Chat", "Coding"], capabilities: ["chat", "audio"] },
      { id: "gpt-5.4", label: "GPT-5.4", group: "Chat / Text", tags: ["Chat"], capabilities: ["chat", "audio"] },
      { id: "gpt-5.4-pro", label: "GPT-5.4 Pro", group: "Chat / Text", tags: ["Chat"], capabilities: ["chat", "audio"] },
      { id: "gpt-5.4-mini", label: "GPT-5.4 mini", group: "Chat / Text", tags: ["Chat"], capabilities: ["chat", "audio"] },
      { id: "gpt-5.4-nano", label: "GPT-5.4 nano", group: "Chat / Text", tags: ["Chat"], capabilities: ["chat", "audio"] },
      { id: "gpt-5", label: "GPT-5", group: "Chat / Text", tags: ["Chat"], capabilities: ["chat", "audio"] },
      { id: "gpt-5-pro", label: "GPT-5 Pro", group: "Chat / Text", tags: ["Chat"], capabilities: ["chat", "audio"] },
      { id: "gpt-5-mini", label: "GPT-5 mini", group: "Chat / Text", tags: ["Chat"], capabilities: ["chat", "audio"] },
      { id: "gpt-5-nano", label: "GPT-5 nano", group: "Chat / Text", tags: ["Chat"], capabilities: ["chat", "audio"] },
      { id: "gpt-4.1", label: "GPT-4.1", group: "Chat / Text", tags: ["Chat", "Vision"], capabilities: ["chat", "audio"] },
      { id: "gpt-4.1-mini", label: "GPT-4.1 mini", group: "Chat / Text", tags: ["Chat", "Vision"], capabilities: ["chat", "audio"] },
      { id: "gpt-4.1-nano", label: "GPT-4.1 nano", group: "Chat / Text", tags: ["Chat"], capabilities: ["chat", "audio"] },
      { id: "gpt-4o", label: "GPT-4o", group: "Chat / Text", tags: ["Chat", "Vision", "Coding", "Audio"], capabilities: ["chat", "audio"] },
      { id: "gpt-4o-mini", label: "GPT-4o mini", group: "Chat / Text", tags: ["Chat", "Vision", "Coding", "Audio"], capabilities: ["chat", "audio"] },

      // Reasoning
      { id: "o3", label: "o3", group: "Reasoning", tags: ["Reasoning", "Coding"], capabilities: ["chat"] },
      { id: "o3-pro", label: "o3-pro", group: "Reasoning", tags: ["Reasoning"], capabilities: ["chat"] },
      { id: "o4-mini", label: "o4-mini", group: "Reasoning", tags: ["Reasoning", "Coding"], capabilities: ["chat"] },

      // Coding helpers (also usable as chat bots)
      { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", group: "Coding", tags: ["Coding"], capabilities: ["chat"] },
      { id: "gpt-5.2-codex", label: "GPT-5.2 Codex", group: "Coding", tags: ["Coding"], capabilities: ["chat"] },

      // Image
      { id: "gpt-image-2", label: "GPT Image 2", group: "Image Generation", tags: ["Image"], capabilities: ["image"] },
      { id: "gpt-image-1.5", label: "GPT Image 1.5", group: "Image Generation", tags: ["Image"], capabilities: ["image"] },
      { id: "gpt-image-1", label: "GPT Image 1", group: "Image Generation", tags: ["Image"], capabilities: ["image"] },
      { id: "gpt-image-1-mini", label: "GPT Image 1 Mini", group: "Image Generation", tags: ["Image"], capabilities: ["image"] },
      { id: "chatgpt-image-latest", label: "ChatGPT Image (latest)", group: "Image Generation", tags: ["Image"], capabilities: ["image"] },

      // Video
      { id: "sora-2", label: "Sora 2", group: "Video Generation", tags: ["Video"], capabilities: ["video"] },
      { id: "sora-2-pro", label: "Sora 2 Pro", group: "Video Generation", tags: ["Video"], capabilities: ["video"] },

      // Speech / realtime (audio bots — text path until dedicated runners)
      { id: "gpt-4o-transcribe", label: "GPT-4o Transcribe", group: "Speech-to-Text", tags: ["STT"], capabilities: ["audio"] },
      { id: "gpt-4o-mini-transcribe", label: "GPT-4o mini Transcribe", group: "Speech-to-Text", tags: ["STT"], capabilities: ["audio"] },
      { id: "gpt-4o-mini-tts", label: "GPT-4o mini TTS", group: "Text-to-Speech", tags: ["TTS"], capabilities: ["audio"] },
      { id: "gpt-realtime", label: "GPT Realtime", group: "Realtime", tags: ["Realtime", "Audio"], capabilities: ["audio"] },
      { id: "gpt-realtime-mini", label: "GPT Realtime Mini", group: "Realtime", tags: ["Realtime"], capabilities: ["audio"] },
    ],
  },
  {
    key: "deepseek",
    label: "DeepSeek",
    models: [
      // Live API list returned v4; classic chat/reasoner ids still used by many accounts.
      { id: "deepseek-chat", label: "DeepSeek Chat", group: "Chat", tags: ["Chat", "Coding", "Tools"], capabilities: ["chat", "audio"] },
      { id: "deepseek-reasoner", label: "DeepSeek Reasoner", group: "Reasoning", tags: ["Reasoning", "Coding"], capabilities: ["chat"] },
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", group: "Chat", tags: ["Chat"], capabilities: ["chat", "audio"] },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", group: "Chat", tags: ["Chat", "Reasoning"], capabilities: ["chat", "audio"] },
    ],
  },
  {
    key: "gemini",
    label: "Gemini",
    models: [
      // Chat (OpenAI-compatible ids — no "models/" prefix)
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", group: "Chat", tags: ["Chat", "Reasoning", "Coding", "Vision"], capabilities: ["chat", "audio"] },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", group: "Chat", tags: ["Chat", "Reasoning", "Coding", "Vision"], capabilities: ["chat", "audio"] },
      { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", group: "Chat", tags: ["Chat"], capabilities: ["chat", "audio"] },
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", group: "Chat", tags: ["Chat", "Vision"], capabilities: ["chat", "audio"] },
      { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite", group: "Chat", tags: ["Chat"], capabilities: ["chat", "audio"] },
      { id: "gemini-flash-latest", label: "Gemini Flash (latest)", group: "Chat", tags: ["Chat"], capabilities: ["chat", "audio"] },
      { id: "gemini-pro-latest", label: "Gemini Pro (latest)", group: "Chat", tags: ["Chat"], capabilities: ["chat", "audio"] },
      { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", group: "Chat", tags: ["Chat"], capabilities: ["chat", "audio"] },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite", group: "Chat", tags: ["Chat"], capabilities: ["chat", "audio"] },
      { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", group: "Chat", tags: ["Chat"], capabilities: ["chat", "audio"] },

      // Image — prefer Gemini native image models (Imagen often blocked for new API keys)
      { id: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image", group: "Image Generation", tags: ["Image"], capabilities: ["image"] },
      { id: "gemini-3.1-flash-image-preview", label: "Gemini 3.1 Flash Image", group: "Image Generation", tags: ["Image"], capabilities: ["image"] },
      { id: "gemini-3-pro-image-preview", label: "Gemini 3 Pro Image", group: "Image Generation", tags: ["Image"], capabilities: ["image"] },
      { id: "imagen-4.0-generate-001", label: "Imagen 4 (legacy)", group: "Image Generation", tags: ["Image", "Legacy"], capabilities: ["image"] },
      { id: "imagen-4.0-fast-generate-001", label: "Imagen 4 Fast (legacy)", group: "Image Generation", tags: ["Image", "Legacy"], capabilities: ["image"] },
      { id: "imagen-4.0-ultra-generate-001", label: "Imagen 4 Ultra (legacy)", group: "Image Generation", tags: ["Image", "Legacy"], capabilities: ["image"] },

      // Video generation ids (catalog clarity; file generation not wired yet)
      { id: "veo-3.1-generate-preview", label: "Veo 3.1", group: "Video Generation", tags: ["Video"], capabilities: ["video"] },
      { id: "veo-3.1-fast-generate-preview", label: "Veo 3.1 Fast", group: "Video Generation", tags: ["Video"], capabilities: ["video"] },
    ],
  },
];

const DEFAULT_PROVIDER = "openai";
const DEFAULT_MODEL_BY_CAPABILITY = {
  chat: "gpt-4o-mini",
  image: "gpt-image-1",
  video: "sora-2",
  audio: "gpt-4o-mini",
};

const normalizeCapability = (capability) => {
  const key = String(capability || "chat")
    .trim()
    .toLowerCase();
  if (key === "content") return "chat";
  return AI_CAPABILITIES.some((item) => item.key === key) ? key : "chat";
};

const normalizeProvider = (provider) => {
  const key = String(provider || "")
    .trim()
    .toLowerCase();
  return AI_PROVIDERS.some((item) => item.key === key) ? key : null;
};

const getProvider = (providerKey) =>
  AI_PROVIDERS.find((item) => item.key === providerKey) || null;

const getModelsForProvider = (providerKey, capability) => {
  const provider = getProvider(providerKey);
  if (!provider) return [];
  const cap = normalizeCapability(capability);
  return provider.models.filter((model) => model.capabilities.includes(cap));
};

const getProvidersForCapability = (capability) => {
  const cap = normalizeCapability(capability);
  return AI_PROVIDERS.filter((provider) =>
    provider.models.some((model) => model.capabilities.includes(cap))
  );
};

const groupModels = (models) => {
  const order = [];
  const map = new Map();
  for (const model of models) {
    const group = model.group || "Other";
    if (!map.has(group)) {
      map.set(group, []);
      order.push(group);
    }
    map.get(group).push(model);
  }
  return order.map((group) => ({ group, models: map.get(group) }));
};

const listAllCatalogModels = () => {
  const rows = [];
  for (const provider of AI_PROVIDERS) {
    for (const model of provider.models) {
      rows.push({
        provider: provider.key,
        providerLabel: provider.label,
        id: model.id,
        label: model.label,
        group: model.group || "Other",
        tags: model.tags || [],
        capabilities: model.capabilities,
      });
    }
  }
  return rows;
};

const inferProviderFromModel = (modelId) => {
  const id = String(modelId || "")
    .trim()
    .toLowerCase()
    .replace(/^models\//, "");
  if (!id) return DEFAULT_PROVIDER;
  if (id.startsWith("deepseek")) return "deepseek";
  if (
    id.startsWith("gemini") ||
    id.startsWith("imagen") ||
    id.startsWith("veo") ||
    id.startsWith("lyria")
  ) {
    return "gemini";
  }
  return "openai";
};

const isValidProviderModel = (providerKey, modelId, capability) => {
  const models = getModelsForProvider(providerKey, capability);
  return models.some((model) => model.id === modelId);
};

const resolveDefaultSelection = (capability, providerKey = null) => {
  const cap = normalizeCapability(capability);
  const providers = getProvidersForCapability(cap);
  const preferred =
    normalizeProvider(providerKey) &&
    providers.some((item) => item.key === providerKey)
      ? providerKey
      : providers[0]?.key || DEFAULT_PROVIDER;
  const models = getModelsForProvider(preferred, cap);
  const preferredModel = DEFAULT_MODEL_BY_CAPABILITY[cap];
  const model =
    models.find((item) => item.id === preferredModel)?.id ||
    models[0]?.id ||
    preferredModel;
  return { provider: preferred, model, capability: cap };
};

const normalizeSelection = ({ capabilityType, provider, model } = {}) => {
  const base = resolveDefaultSelection(capabilityType, provider);
  const models = getModelsForProvider(base.provider, base.capability);
  const requested = String(model || "")
    .trim()
    .replace(/^models\//, "");
  const resolvedModel =
    requested && models.some((item) => item.id === requested)
      ? requested
      : base.model;
  return {
    capabilityType: base.capability,
    provider: base.provider,
    model: resolvedModel,
  };
};

module.exports = {
  AI_CAPABILITIES,
  AI_PROVIDERS,
  DEFAULT_PROVIDER,
  DEFAULT_MODEL_BY_CAPABILITY,
  normalizeCapability,
  normalizeProvider,
  getProvider,
  getModelsForProvider,
  getProvidersForCapability,
  groupModels,
  listAllCatalogModels,
  inferProviderFromModel,
  isValidProviderModel,
  resolveDefaultSelection,
  normalizeSelection,
};
