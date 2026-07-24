import { apiClient } from "@/modules/shared/apiClient";
import { ChatMessage } from "@/modules/shared/types";

export const chatMessageApiService = {
  getAll: async (): Promise<ChatMessage[]> => {
    return apiClient.get<ChatMessage[]>("/chat-messages");
  },

  getByThreadId: async (threadId: string): Promise<ChatMessage[]> => {
    return apiClient.get<ChatMessage[]>(
      `/chat-threads/${threadId}/messages`
    );
  },

  getById: async (id: string): Promise<ChatMessage | null> => {
    try {
      return await apiClient.get<ChatMessage>(`/chat-messages/${id}`);
    } catch (error) {
      return null;
    }
  },

  create: async (
    messageData: Omit<ChatMessage, "id" | "createdAt" | "updatedAt">
  ): Promise<ChatMessage> => {
    return apiClient.post<ChatMessage>("/chat-messages", messageData);
  },

  update: async (
    id: string,
    messageData: Partial<ChatMessage>
  ): Promise<ChatMessage | null> => {
    try {
      return await apiClient.put<ChatMessage>(
        `/chat-messages/${id}`,
        messageData
      );
    } catch (error) {
      return null;
    }
  },

  delete: async (id: string): Promise<boolean> => {
    try {
      await apiClient.delete(`/chat-messages/${id}`);
      return true;
    } catch (error) {
      return false;
    }
  },
};
