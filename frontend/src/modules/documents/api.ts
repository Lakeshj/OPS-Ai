import { apiClient } from "@/modules/shared/apiClient";
import { WorkspaceDocument } from "@/modules/shared/types";

export const workspaceDocumentApiService = {
  list: (workspaceId: string): Promise<WorkspaceDocument[]> =>
    apiClient.get<WorkspaceDocument[]>(
      `/workspaces/${workspaceId}/documents`
    ),

  upload: (workspaceId: string, file: File): Promise<WorkspaceDocument> => {
    const formData = new FormData();
    formData.append("file", file);
    return apiClient.postForm<WorkspaceDocument>(
      `/workspaces/${workspaceId}/documents`,
      formData
    );
  },

  remove: (documentId: string): Promise<{ message: string }> =>
    apiClient.delete<{ message: string }>(`/documents/${documentId}`),

  reconvert: (
    documentId: string
  ): Promise<{
    id: string;
    status: string;
    tokenCount?: number;
    chunkCount?: number;
    document: WorkspaceDocument;
  }> =>
    apiClient.post(`/documents/${documentId}/reconvert`),
};
