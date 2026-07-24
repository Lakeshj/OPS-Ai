import { apiClient } from "@/modules/shared/apiClient";
import { KeywordAssistant } from "@/modules/shared/types";

export const keywordAssistantApiService = {
  getAll: async (): Promise<KeywordAssistant[]> => {
    return apiClient.get<KeywordAssistant[]>("/assistants");
  },

  getById: async (id: string): Promise<KeywordAssistant | null> => {
    try {
      return await apiClient.get<KeywordAssistant>(`/assistants/${id}`);
    } catch (error) {
      return null;
    }
  },

  create: async (
    assistantData: Omit<KeywordAssistant, "id" | "createdAt" | "updatedAt">
  ): Promise<KeywordAssistant> => {
    return apiClient.post<KeywordAssistant>("/assistants", assistantData);
  },

  update: async (
    id: string,
    assistantData: Partial<KeywordAssistant>
  ): Promise<KeywordAssistant | null> => {
    try {
      return await apiClient.put<KeywordAssistant>(
        `/assistants/${id}`,
        assistantData
      );
    } catch (error) {
      return null;
    }
  },

  delete: async (id: string): Promise<boolean> => {
    try {
      await apiClient.delete(`/assistants/${id}`);
      return true;
    } catch (error) {
      return false;
    }
  },
};
