import { apiClient } from "@/modules/shared/apiClient";
import { Workspace } from "@/modules/shared/types";

export const workspaceApiService = {
  getAll: async (): Promise<Workspace[]> => {
    return apiClient.get<Workspace[]>("/workspaces");
  },

  getById: async (id: string): Promise<Workspace | null> => {
    try {
      return await apiClient.get<Workspace>(`/workspaces/${id}`);
    } catch (error) {
      return null;
    }
  },

  get: async (id: string): Promise<Workspace | null> => {
    return workspaceApiService.getById(id);
  },

  getByUserId: async (userId: string): Promise<Workspace[]> => {
    return apiClient.get<Workspace[]>(`/users/${userId}/workspaces`);
  },

  create: async (
    workspaceData: Omit<Workspace, "id" | "createdAt" | "updatedAt">
  ): Promise<Workspace> => {
    return apiClient.post<Workspace>("/workspaces", workspaceData);
  },

  update: async (
    id: string,
    workspaceData: Partial<Workspace>
  ): Promise<Workspace | null> => {
    try {
      return await apiClient.put<Workspace>(`/workspaces/${id}`, workspaceData);
    } catch (error) {
      return null;
    }
  },

  delete: async (id: string): Promise<boolean> => {
    try {
      await apiClient.delete(`/workspaces/${id}`);
      return true;
    } catch (error) {
      return false;
    }
  },
};
