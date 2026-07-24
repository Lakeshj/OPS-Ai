import { apiClient } from "@/modules/shared/apiClient";

export type AiModelStatusRow = {
  provider: string;
  providerLabel: string;
  id: string;
  label: string;
  group?: string;
  tags?: string[];
  capabilities: string[];
  available: boolean;
  lastError?: string | null;
  lastStatusCode?: number | null;
  failCount?: number;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  updatedAt?: string | null;
};

export type AiErrorLogRow = {
  id: string;
  provider: string;
  model: string;
  capabilityType?: string | null;
  assistantId?: string | null;
  workspaceId?: string | null;
  threadId?: string | null;
  userId?: string | null;
  statusCode?: number | null;
  errorCode?: string | null;
  message: string;
  createdAt: string;
};

export type AiUsageLogRow = {
  id: string;
  provider: string;
  model: string;
  workspaceId: string;
  workspaceName?: string | null;
  threadId?: string | null;
  userId?: string | null;
  userName?: string | null;
  assistantId?: string | null;
  assistantName?: string | null;
  inputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs?: number | null;
  createdAt: string;
};

export const adminAiLogsApi = {
  listModels: () => apiClient.get<AiModelStatusRow[]>("/admin/ai-logs/models"),
  refreshModels: () =>
    apiClient.post<{
      refreshedAt: string;
      results: Array<{
        provider: string;
        model: string;
        available: boolean;
        error?: string;
      }>;
      models: AiModelStatusRow[];
    }>("/admin/ai-logs/models/refresh"),
  listErrors: (params?: { limit?: number; provider?: string }) => {
    const query = new URLSearchParams();
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.provider) query.set("provider", params.provider);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return apiClient.get<AiErrorLogRow[]>(`/admin/ai-logs/errors${suffix}`);
  },
  listUsage: (params?: { limit?: number; workspaceId?: string }) => {
    const query = new URLSearchParams();
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.workspaceId) query.set("workspaceId", params.workspaceId);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return apiClient.get<AiUsageLogRow[]>(`/admin/ai-logs/usage${suffix}`);
  },
};
