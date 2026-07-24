import { apiClient } from "@/modules/shared/apiClient";
import { ChatThread } from "@/modules/shared/types";

export const chatThreadApiService = {
  getAll: async (): Promise<ChatThread[]> => {
    return apiClient.get<ChatThread[]>("/chat-threads");
  },

  getByFolderId: async (folderId: string): Promise<ChatThread[]> => {
    return apiClient.get<ChatThread[]>(`/folders/${folderId}/chat-threads`);
  },

  getByUserAndProject: async (
    userId: string,
    workspaceId: string
  ): Promise<ChatThread[]> => {
    return apiClient.get<ChatThread[]>(
      `/users/${userId}/workspaces/${workspaceId}/chat-threads`
    );
  },

  getByWorkspaceId: async (workspaceId: string): Promise<ChatThread[]> => {
    return apiClient.get<ChatThread[]>(
      `/workspaces/${workspaceId}/chat-threads`
    );
  },

  getById: async (id: string): Promise<ChatThread | null> => {
    try {
      return await apiClient.get<ChatThread>(`/chat-threads/${id}`);
    } catch (error) {
      return null;
    }
  },

  create: async (
    threadData: Omit<ChatThread, "id" | "createdAt" | "updatedAt">
  ): Promise<ChatThread> => {
    return apiClient.post<ChatThread>("/chat-threads", threadData);
  },

  update: async (
    id: string,
    threadData: Partial<ChatThread>
  ): Promise<ChatThread | null> => {
    try {
      return await apiClient.put<ChatThread>(`/chat-threads/${id}`, threadData);
    } catch (error) {
      return null;
    }
  },

  delete: async (id: string): Promise<boolean> => {
    try {
      await apiClient.delete(`/chat-threads/${id}`);
      return true;
    } catch (error) {
      return false;
    }
  },
};
