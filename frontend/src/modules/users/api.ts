import { apiClient } from "@/modules/shared/apiClient";
import { User } from "@/modules/shared/types";

export const userApiService = {
  getAll: async (): Promise<User[]> => {
    return apiClient.get<User[]>("/users");
  },

  getById: async (id: string): Promise<User | null> => {
    try {
      return await apiClient.get<User>(`/users/${id}`);
    } catch (error) {
      return null;
    }
  },

  create: async (
    userData: Omit<User, "id" | "createdAt" | "updatedAt">
  ): Promise<User> => {
    return apiClient.post<User>("/users", userData);
  },

  update: async (
    id: string,
    userData: Partial<User>
  ): Promise<User | null> => {
    try {
      return await apiClient.put<User>(`/users/${id}`, userData);
    } catch (error) {
      return null;
    }
  },

  delete: async (id: string): Promise<boolean> => {
    try {
      await apiClient.delete(`/users/${id}`);
      return true;
    } catch (error) {
      return false;
    }
  },
};
