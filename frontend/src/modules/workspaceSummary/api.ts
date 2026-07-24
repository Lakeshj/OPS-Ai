import { apiClient } from "@/modules/shared/apiClient";
import {
  AdminAiSettings,
  WorkspaceSummary,
  WorkspaceSummaryResponse,
} from "@/modules/shared/types";

export const workspaceSummaryApiService = {
  get: (workspaceId: string): Promise<WorkspaceSummaryResponse> =>
    apiClient.get(`/workspaces/${workspaceId}/summary`),

  update: (workspaceId: string, content: string): Promise<WorkspaceSummary> =>
    apiClient.put(`/workspaces/${workspaceId}/summary`, { content }),

  regenerate: (workspaceId: string): Promise<WorkspaceSummary> =>
    apiClient.post(`/workspaces/${workspaceId}/summary/regenerate`),

  restore: (
    workspaceId: string,
    versionId: string
  ): Promise<WorkspaceSummary> =>
    apiClient.post(
      `/workspaces/${workspaceId}/summary/versions/${versionId}/restore`
    ),
};

export const adminAiSettingsApiService = {
  get: (): Promise<AdminAiSettings> =>
    apiClient.get("/admin/ai-settings"),

  update: (
    settings: Pick<
      AdminAiSettings,
      "summaryModel" | "evaluationModel" | "evaluationPrompt"
    >
  ): Promise<AdminAiSettings> =>
    apiClient.put("/admin/ai-settings", settings),
};
