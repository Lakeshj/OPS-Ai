import { apiClient } from "@/modules/shared/apiClient";
import { Folder } from "@/modules/shared/types";

export const folderApiService = {
  getAll: async (): Promise<Folder[]> => {
    return apiClient.get<Folder[]>("/folders");
  },

  getByWorkspaceId: async (workspaceId: string): Promise<Folder[]> => {
    return apiClient.get<Folder[]>(`/workspaces/${workspaceId}/folders`);
  },

  getByWorkspaceAndUser: async (
    workspaceId: string,
    userId: string
  ): Promise<Folder[]> => {
    return apiClient.get<Folder[]>(
      `/workspaces/${workspaceId}/folders?userId=${userId}`
    );
  },

  getById: async (id: string): Promise<Folder | null> => {
    try {
      return await apiClient.get<Folder>(`/folders/${id}`);
    } catch (error) {
      return null;
    }
  },

  create: async (
    folderData: Omit<Folder, "id" | "createdAt" | "updatedAt">
  ): Promise<Folder> => {
    return apiClient.post<Folder>("/folders", folderData);
  },

  update: async (
    id: string,
    folderData: Partial<Folder>
  ): Promise<Folder | null> => {
    try {
      return await apiClient.put<Folder>(`/folders/${id}`, folderData);
    } catch (error) {
      return null;
    }
  },

  delete: async (id: string): Promise<boolean> => {
    try {
      await apiClient.delete(`/folders/${id}`);
      return true;
    } catch (error) {
      return false;
    }
  },
};
