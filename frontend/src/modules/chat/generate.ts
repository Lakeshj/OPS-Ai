const API_URL =
  (process.env.NEXT_PUBLIC_API_URL || "/api") + "/chat/generate";

export interface GenerateResponseMeta {
  model?: string;
  promptCacheKey?: string;
  staticMemoryVersion?: number;
  retrievedChunkCount?: number;
  usage?: {
    inputTokens: number;
    cachedTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  latencyMs?: number;
}

export const chatService = {
  generateResponse: async ({
    prompt,
    threadId,
    assistantId,
  }: {
    prompt: string;
    threadId: string;
    assistantId?: string;
  }): Promise<{ response: string; meta?: GenerateResponseMeta }> => {
    const token = localStorage.getItem("token");
    const headers: HeadersInit = { "Content-Type": "application/json" };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt,
        threadId,
        assistantId,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const message =
        (typeof errorData?.error === "string"
          ? errorData.error
          : errorData?.error?.message) ||
        "Failed to generate response";
      throw new Error(message);
    }

    const data = await response.json();
    return {
      response: data.response || data.message,
      meta: data.meta,
    };
  },
};
