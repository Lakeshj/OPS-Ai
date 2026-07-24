export type AiCapabilityKey = "chat" | "image" | "video" | "audio";
export type AiProviderKey = "openai" | "deepseek" | "gemini";

export type AiModelOption = {
  id: string;
  label: string;
  group: string;
  tags: string[];
  capabilities: AiCapabilityKey[];
};

export const AI_CAPABILITIES = [
  { key: "chat" as const, label: "Content / Chat" },
  { key: "image" as const, label: "Image" },
  { key: "video" as const, label: "Video" },
  { key: "audio" as const, label: "Audio" },
];

export const AI_PROVIDERS: Array<{
  key: AiProviderKey;
  label: string;
  models: AiModelOption[];
}> = [
  {
    key: "openai",
    label: "OpenAI",
    models: [
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
      { id: "o3", label: "o3", group: "Reasoning", tags: ["Reasoning", "Coding"], capabilities: ["chat"] },
      { id: "o3-pro", label: "o3-pro", group: "Reasoning", tags: ["Reasoning"], capabilities: ["chat"] },
      { id: "o4-mini", label: "o4-mini", group: "Reasoning", tags: ["Reasoning", "Coding"], capabilities: ["chat"] },
      { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", group: "Coding", tags: ["Coding"], capabilities: ["chat"] },
      { id: "gpt-5.2-codex", label: "GPT-5.2 Codex", group: "Coding", tags: ["Coding"], capabilities: ["chat"] },
      { id: "gpt-image-2", label: "GPT Image 2", group: "Image Generation", tags: ["Image"], capabilities: ["image"] },
      { id: "gpt-image-1.5", label: "GPT Image 1.5", group: "Image Generation", tags: ["Image"], capabilities: ["image"] },
      { id: "gpt-image-1", label: "GPT Image 1", group: "Image Generation", tags: ["Image"], capabilities: ["image"] },
      { id: "gpt-image-1-mini", label: "GPT Image 1 Mini", group: "Image Generation", tags: ["Image"], capabilities: ["image"] },
      { id: "chatgpt-image-latest", label: "ChatGPT Image (latest)", group: "Image Generation", tags: ["Image"], capabilities: ["image"] },
      { id: "sora-2", label: "Sora 2", group: "Video Generation", tags: ["Video"], capabilities: ["video"] },
      { id: "sora-2-pro", label: "Sora 2 Pro", group: "Video Generation", tags: ["Video"], capabilities: ["video"] },
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
      { id: "veo-3.1-fast-generate-preview", label: "Veo 3.1 Fast", group: "Video Generation", tags: ["Video"], capabilities: ["video"] },
      { id: "veo-3.1-generate-preview", label: "Veo 3.1", group: "Video Generation", tags: ["Video"], capabilities: ["video"] },
    ],
  },
];

const DEFAULT_MODEL_BY_CAPABILITY: Record<AiCapabilityKey, string> = {
  chat: "gpt-4o-mini",
  image: "gpt-image-1",
  video: "sora-2",
  audio: "gpt-4o-mini",
};

export const normalizeCapability = (capability?: string): AiCapabilityKey => {
  const key = String(capability || "chat")
    .trim()
    .toLowerCase();
  if (key === "content") return "chat";
  if (AI_CAPABILITIES.some((item) => item.key === key)) {
    return key as AiCapabilityKey;
  }
  return "chat";
};

export const getProvidersForCapability = (capability?: string) => {
  const cap = normalizeCapability(capability);
  return AI_PROVIDERS.filter((provider) =>
    provider.models.some((model) => model.capabilities.includes(cap))
  );
};

export const getModelsForProvider = (
  providerKey?: string,
  capability?: string
) => {
  const provider = AI_PROVIDERS.find((item) => item.key === providerKey);
  if (!provider) return [];
  const cap = normalizeCapability(capability);
  return provider.models.filter((model) => model.capabilities.includes(cap));
};

export const groupModels = (models: AiModelOption[]) => {
  const order: string[] = [];
  const map = new Map<string, AiModelOption[]>();
  for (const model of models) {
    const group = model.group || "Other";
    if (!map.has(group)) {
      map.set(group, []);
      order.push(group);
    }
    map.get(group)!.push(model);
  }
  return order.map((group) => ({ group, models: map.get(group)! }));
};

export const inferProviderFromModel = (modelId?: string): AiProviderKey => {
  const id = String(modelId || "")
    .trim()
    .toLowerCase()
    .replace(/^models\//, "");
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

export const resolveDefaultSelection = (
  capability?: string,
  providerKey?: string | null
) => {
  const cap = normalizeCapability(capability);
  const providers = getProvidersForCapability(cap);
  const preferred =
    providerKey && providers.some((item) => item.key === providerKey)
      ? (providerKey as AiProviderKey)
      : providers[0]?.key || "openai";
  const models = getModelsForProvider(preferred, cap);
  const preferredModel = DEFAULT_MODEL_BY_CAPABILITY[cap];
  const model =
    models.find((item) => item.id === preferredModel)?.id ||
    models[0]?.id ||
    preferredModel;
  return { provider: preferred, model, capability: cap };
};

export const normalizeSelection = (input: {
  capabilityType?: string;
  provider?: string | null;
  model?: string | null;
}) => {
  const base = resolveDefaultSelection(input.capabilityType, input.provider);
  const models = getModelsForProvider(base.provider, base.capability);
  const requested = String(input.model || "")
    .trim()
    .replace(/^models\//, "");
  const model =
    requested && models.some((item) => item.id === requested)
      ? requested
      : base.model;
  return {
    capabilityType: base.capability,
    provider: base.provider,
    model,
  };
};
