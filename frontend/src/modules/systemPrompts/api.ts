import { apiClient } from "@/modules/shared/apiClient";
import { SystemPrompt } from "@/modules/shared/types";

export type SystemPromptPayload = {
  useCaseKey?: string;
  name: string;
  description?: string;
  promptContent: string;
  config?: Record<string, unknown>;
  isActive?: boolean;
};

export const systemPromptsApiService = {
  getAll: (): Promise<SystemPrompt[]> =>
    apiClient.get("/admin/system-prompts"),

  getById: (id: string): Promise<SystemPrompt> =>
    apiClient.get(`/admin/system-prompts/${id}`),

  create: (payload: SystemPromptPayload): Promise<SystemPrompt> =>
    apiClient.post("/admin/system-prompts", payload),

  update: (
    id: string,
    payload: Partial<SystemPromptPayload>
  ): Promise<SystemPrompt> =>
    apiClient.put(`/admin/system-prompts/${id}`, payload),

  remove: (id: string): Promise<{ message: string }> =>
    apiClient.delete(`/admin/system-prompts/${id}`),
};
