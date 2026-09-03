import { apiClient } from "@/modules/shared/apiClient";
import type {
  Workflow,
  WorkflowCredential,
  WorkflowCredentialSecret,
  WorkflowDefinition,
  WorkflowRun,
} from "./types";

export const workflowsApi = {
  list: (workspaceId?: string) =>
    apiClient.get<Workflow[]>(
      workspaceId ? `/workflows?workspaceId=${encodeURIComponent(workspaceId)}` : "/workflows"
    ),

  getById: (id: string) => apiClient.get<Workflow>(`/workflows/${id}`),

  create: (payload: {
    name: string;
    workspaceId: string;
    description?: string;
    definition?: WorkflowDefinition;
  }) => apiClient.post<Workflow>("/workflows", payload),

  update: (
    id: string,
    payload: Partial<{
      name: string;
      description: string | null;
      status: Workflow["status"];
      definition: WorkflowDefinition;
    }>
  ) => apiClient.put<Workflow>(`/workflows/${id}`, payload),

  remove: (id: string) => apiClient.delete<{ success: boolean }>(`/workflows/${id}`),

  startRun: (id: string, input?: Record<string, unknown>) =>
    apiClient.post<WorkflowRun>(`/workflows/${id}/runs`, { input: input ?? {} }),

  listRuns: (id: string) => apiClient.get<WorkflowRun[]>(`/workflows/${id}/runs`),

  getRun: (workflowId: string, runId: string) =>
    apiClient.get<WorkflowRun>(`/workflows/${workflowId}/runs/${runId}`),

  cancelRun: (workflowId: string, runId: string) =>
    apiClient.post<WorkflowRun>(`/workflows/${workflowId}/runs/${runId}/cancel`, {}),

  resumeRun: (workflowId: string, runId: string) =>
    apiClient.post<{
      accepted: boolean;
      idempotent?: boolean;
      runId: string;
      run: WorkflowRun;
    }>(`/workflows/${workflowId}/runs/${runId}/resume`, {}),

  getEditorSession: (workflowId: string) =>
    apiClient.get<import("./types").WorkflowEditorSession>(
      `/workflows/${workflowId}/editor-session`
    ),

  invalidateEditorSession: (
    workflowId: string,
    payload: {
      definition?: import("./types").WorkflowDefinition;
      event: import("./types").EditorInvalidationEvent;
    }
  ) =>
    apiClient.post<{
      session: import("./types").WorkflowEditorSession;
      affected: string[];
    }>(`/workflows/${workflowId}/editor-session/invalidate`, payload),

  executeNodeStep: (
    workflowId: string,
    nodeId: string,
    payload: {
      definition?: import("./types").WorkflowDefinition;
      input?: Record<string, unknown>;
    }
  ) =>
    apiClient.post<{
      targetNodeId: string;
      results: Record<string, import("./types").WorkflowEditorNodeResult>;
      session: import("./types").WorkflowEditorSession;
      inputItems?: unknown[];
    }>(`/workflows/${workflowId}/nodes/${nodeId}/execute`, payload),

  runToNode: (
    workflowId: string,
    nodeId: string,
    payload: {
      definition?: import("./types").WorkflowDefinition;
      input?: Record<string, unknown>;
    }
  ) =>
    apiClient.post<{
      targetNodeId: string;
      results: Record<string, import("./types").WorkflowEditorNodeResult>;
      session: import("./types").WorkflowEditorSession;
    }>(`/workflows/${workflowId}/nodes/${nodeId}/run-to`, payload),

  getNodeInput: (workflowId: string, nodeId: string) =>
    apiClient.get<{
      nodeId: string;
      incoming: Record<string, unknown>;
      items: unknown[];
      portInputs?: Record<
        string,
        {
          portId: string;
          label: string;
          state: string;
          items?: unknown[];
          sourceNodeId?: string | null;
        }
      >;
      stale?: boolean;
      staleNodeIds?: string[];
      nodeCacheStatus?: Record<string, string>;
    }>(`/workflows/${workflowId}/nodes/${nodeId}/input`),

  executePrevious: (
    workflowId: string,
    nodeId: string,
    payload: {
      definition?: import("./types").WorkflowDefinition;
      input?: Record<string, unknown>;
    }
  ) =>
    apiClient.post<{
      targetNodeId: string;
      results: Record<string, import("./types").WorkflowEditorNodeResult>;
      session: import("./types").WorkflowEditorSession;
      inputItems?: unknown[];
    }>(`/workflows/${workflowId}/nodes/${nodeId}/execute-previous`, payload),

  previewExpression: (
    workflowId: string,
    nodeId: string,
    payload: {
      expression: string;
      itemIndex?: number;
      parameterName?: string;
      definition?: import("./types").WorkflowDefinition;
      input?: Record<string, unknown>;
    }
  ) =>
    apiClient.post<import("./expressionPreview").ExpressionPreviewResponse>(
      `/workflows/${workflowId}/nodes/${nodeId}/expression-preview`,
      payload
    ),

  previewScheduleOccurrences: (
    workflowId: string,
    nodeId: string,
    payload: {
      scheduleRules?: import("./types").ScheduleRule[];
      timezone?: string;
      cron?: string;
      count?: number;
      definition?: import("./types").WorkflowDefinition;
    }
  ) =>
    apiClient.post<{
      previews: Array<{
        ruleId: string;
        timezone: string;
        occurrences: Array<{ iso: string; label: string }>;
      }>;
      count: number;
    }>(`/workflows/${workflowId}/nodes/${nodeId}/schedule-preview`, payload),
};

/** Secrets are write-only: the API never returns a stored secret value. */
export const workflowCredentialsApi = {
  list: (workspaceId: string) =>
    apiClient.get<WorkflowCredential[]>(
      `/workflows/credentials?workspaceId=${encodeURIComponent(workspaceId)}`
    ),

  create: (payload: {
    workspaceId: string;
    name: string;
    type: WorkflowCredential["type"];
    secret: WorkflowCredentialSecret;
  }) => apiClient.post<WorkflowCredential>("/workflows/credentials", payload),

  remove: (credentialId: string) =>
    apiClient.delete<{ success: boolean }>(
      `/workflows/credentials/${credentialId}`
    ),
};
