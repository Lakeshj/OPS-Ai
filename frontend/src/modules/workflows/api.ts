import { apiClient } from "@/modules/shared/apiClient";
import type { McpDynamicProvider, McpDynamicTool } from "./mcpDynamicTools";
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

  /** Editor test for webhook workflows (returns run + simulated HTTP response). */
  testWebhook: (id: string, body?: Record<string, unknown>) =>
    apiClient.post<{
      mode: "immediate" | "respond";
      run: WorkflowRun;
      httpResponse: {
        statusCode: number;
        body: unknown;
        headers?: Record<string, string>;
        responseType?: string;
      } | null;
    }>(`/workflows/${id}/webhook/test`, body ?? {}),

  listRuns: (id: string) => apiClient.get<WorkflowRun[]>(`/workflows/${id}/runs`),

  getRun: (workflowId: string, runId: string) =>
    apiClient.get<WorkflowRun>(`/workflows/${workflowId}/runs/${runId}`),

  getRunLineage: (workflowId: string, runId: string) =>
    apiClient.get<import("./types").WorkflowRunLineage>(
      `/workflows/${workflowId}/runs/${runId}/lineage`
    ),

  getErrorRouting: (workflowId: string, runId: string) =>
    apiClient.get<import("./types").WorkflowErrorRouting>(
      `/workflows/${workflowId}/runs/${runId}/error-routing`
    ),

  getChildInvocation: (
    workflowId: string,
    runId: string,
    nodeId: string,
    executionIndex = 0
  ) =>
    apiClient.get<import("./types").WorkflowChildInvocationSummary | null>(
      `/workflows/${workflowId}/runs/${runId}/nodes/${encodeURIComponent(nodeId)}/child-invocation?executionIndex=${executionIndex}`
    ),

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

  syncEditorSessionFromRun: (workflowId: string, runId: string) =>
    apiClient.post<{
      session: import("./types").WorkflowEditorSession;
      synced: boolean;
      runId?: string;
      reason?: string;
    }>(`/workflows/${workflowId}/runs/${runId}/sync-editor-session`, {}),

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
      runIndex?: number;
      runId?: string;
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

  listCallableTargets: (workspaceId: string, excludeWorkflowId?: string) => {
    const params = new URLSearchParams({ workspaceId });
    if (excludeWorkflowId) {
      params.set("excludeWorkflowId", excludeWorkflowId);
    }
    return apiClient.get<import("./types").WorkflowCallableTarget[]>(
      `/workflows/callable-targets?${params.toString()}`
    );
  },

  listErrorTargets: (workspaceId: string, excludeWorkflowId?: string) => {
    const params = new URLSearchParams({ workspaceId });
    if (excludeWorkflowId) {
      params.set("excludeWorkflowId", excludeWorkflowId);
    }
    return apiClient.get<import("./types").WorkflowErrorTarget[]>(
      `/workflows/error-targets?${params.toString()}`
    );
  },

  setErrorWorkflow: (id: string, errorWorkflowId: string | null) =>
    apiClient.patch<Workflow>(`/workflows/${id}/error-workflow`, {
      errorWorkflowId,
    }),

  /** Part 14B — planning turn for Workflow Copilot drawer (no workflow_runs). */
  copilotPlan: (
    id: string,
    payload: import("./workflowCopilot").CopilotPlanRequest
  ) =>
    apiClient.post<import("./workflowCopilot").CopilotPlanResponse>(
      `/workflows/${id}/copilot/plan`,
      payload
    ),

  /** Part 14A/14D — apply validated plan to draft definition (returned only). */
  copilotApplyPlan: (
    id: string,
    payload: {
      definition: import("./types").WorkflowDefinition;
      plan: unknown;
      baseRevisionHash?: string | null;
      workspace?: unknown;
    }
  ) =>
    apiClient.post<{
      resultingDefinition?: import("./types").WorkflowDefinition;
      definition?: import("./types").WorkflowDefinition;
      revisionHash?: string;
      preview?: unknown;
    }>(`/workflows/${id}/copilot/apply-plan`, payload),

  previewImport: (payload: {
    workspaceId: string;
    workflow: unknown;
  }) =>
    apiClient.post<{
      ok?: boolean;
      format?: string;
      detection?: { format?: string };
      structureImportable?: boolean;
      runtimeReady?: boolean;
      commitToken?: string | null;
      fingerprint?: string;
      draftName?: string;
      report?: unknown;
      error?: string;
    }>("/workflows/import/preview", payload),

  commitImport: (payload: {
    workspaceId: string;
    workflow: unknown;
    commitToken: string;
    name?: string;
  }) =>
    apiClient.post<{
      workflow: Workflow;
      format?: string;
      report?: unknown;
      runtimeReady?: boolean;
    }>("/workflows/import", payload),

  exportNative: async (id: string) => {
    // Use apiClient base via fetch through get — blob download handled by caller
    return apiClient.get<Record<string, unknown>>(`/workflows/${id}/export`);
  },

  listMcpProviders: () =>
    apiClient.get<McpDynamicProvider[]>("/workflows/plugins/mcp/providers"),

  listMcpTools: (provider: string) =>
    apiClient.get<McpDynamicTool[]>(
      `/workflows/plugins/mcp/tools?provider=${encodeURIComponent(provider)}`
    ),

  getMcpTool: (provider: string, toolId: string) =>
    apiClient.get<McpDynamicTool>(
      `/workflows/plugins/mcp/tools/${encodeURIComponent(provider)}/${encodeURIComponent(toolId)}`
    ),
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
    config?: Record<string, unknown>;
  }) => apiClient.post<WorkflowCredential>("/workflows/credentials", payload),

  update: (
    credentialId: string,
    payload: {
      name?: string;
      secret?: WorkflowCredentialSecret;
      config?: Record<string, unknown>;
    }
  ) =>
    apiClient.put<WorkflowCredential>(
      `/workflows/credentials/${credentialId}`,
      payload
    ),

  remove: (credentialId: string, opts?: { force?: boolean }) =>
    apiClient.delete<{ success: boolean }>(
      `/workflows/credentials/${credentialId}${
        opts?.force ? "?force=1" : ""
      }`
    ),

  getCredentialUsage: (credentialId: string) =>
    apiClient.get<{
      credentialId: string;
      workspaceId: string;
      workflowCount: number;
      workflows: Array<{ id: string; name: string }>;
    }>(`/workflows/credentials/${encodeURIComponent(credentialId)}/usage`),

  listInstagramMediaOptions: (workspaceId: string, credentialId: string) =>
    apiClient.get<{
      instagramUserId?: string;
      options: Array<{
        id: string;
        mediaId: string;
        label: string;
        captionSnippet?: string;
        mediaType?: string;
        timestamp?: string;
        thumbnailUrl?: string;
      }>;
    }>(
      `/workflows/instagram/media-options?workspaceId=${encodeURIComponent(workspaceId)}&credentialId=${encodeURIComponent(credentialId)}`
    ),

  listInstagramCommentOptions: (
    workspaceId: string,
    credentialId: string,
    mediaId: string
  ) =>
    apiClient.get<{
      instagramUserId?: string;
      mediaId: string;
      options: Array<{
        id: string;
        commentId: string;
        label: string;
        username?: string;
        text?: string;
        timestamp?: string;
        repliesCount?: number;
      }>;
    }>(
      `/workflows/instagram/comment-options?workspaceId=${encodeURIComponent(workspaceId)}&credentialId=${encodeURIComponent(credentialId)}&mediaId=${encodeURIComponent(mediaId)}`
    ),

  stageInstagramPublishMedia: (payload: {
    workspaceId: string;
    file: File;
    kind?: "image" | "video";
  }) => {
    const form = new FormData();
    form.append("file", payload.file);
    form.append("workspaceId", payload.workspaceId);
    if (payload.kind) form.append("kind", payload.kind);
    return apiClient.postForm<{
      url: string;
      publicPath: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
      kind: string;
    }>("/workflows/instagram/stage-media", form);
  },

  startOAuth2: (payload: { workspaceId: string; credentialId: string }) =>
    apiClient.post<{ url: string; callbackOrigin: string; redirectUri: string }>(
      "/workflows/oauth2/start",
      payload
    ),

  listConnectionTypes: () =>
    apiClient.get<{
      predefined: Array<{
        id: string;
        displayName: string;
        provider: string;
        category: string;
        authScheme: string;
        kind: string;
        status: string;
        searchText: string;
        reason?: string;
        oauthManaged?: boolean;
        oauthMode?: string;
        allowedDomains?: string[];
        defaultScopes?: string[];
      }>;
      generic: Array<{
        id: string;
        displayName: string;
        status: string;
        dbType: string | null;
      }>;
      oauth2RedirectUri: string;
      googleOAuthRedirectUri?: string;
      platformManagedGoogleOAuthAvailable?: boolean;
    }>("/workflows/connection-types"),

  editorView: (credentialId: string) =>
    apiClient.get<
      WorkflowCredential & {
        editor?: Record<string, unknown>;
      }
    >(`/workflows/credentials/${credentialId}/editor`),

  startGoogleOAuth: (payload: {
    workspaceId: string;
    workflowId?: string;
    product: WorkflowCredential["type"];
    name?: string;
    credentialId?: string;
    gmailPermissions?: string[];
  }) =>
    apiClient.post<{
      url: string;
      state: string;
      callbackOrigin: string;
      redirectUri?: string;
      oauthAppMode?: string;
      scopes?: string[];
      gmailPermissions?: string[];
    }>("/workflows/google-oauth/start", payload),

  test: (credentialId: string) =>
    apiClient.post<{ ok: boolean; type: string; metaDisplayName?: string; reconnectSoon?: boolean }>(
      `/workflows/credentials/${credentialId}/test`,
      {}
    ),

  startMetaOAuth: (payload: {
    workspaceId: string;
    name?: string;
    credentialId?: string;
  }) =>
    apiClient.post<{
      url: string;
      callbackOrigin: string;
      redirectUri?: string;
      scopes?: string[];
      apiVersion?: string;
    }>("/workflows/meta-oauth/start", payload),

  listMetaAdAccounts: (credentialId: string) =>
    apiClient.get<{
      metaDisplayName?: string;
      selectedAdAccountId?: string;
      adAccounts: Array<{
        adAccountId: string;
        apiId: string;
        name: string;
        currency: string;
        timezoneName: string;
        accountStatus: number | null;
        accountStatusLabel: string | null;
      }>;
    }>(
      `/workflows/meta-oauth/ad-accounts?credentialId=${encodeURIComponent(credentialId)}`
    ),

  selectMetaAdAccount: (credentialId: string, adAccountId: string) =>
    apiClient.post<{ adAccountId: string; apiId: string }>(
      `/workflows/credentials/${credentialId}/meta-ad-account`,
      { adAccountId }
    ),

  startFacebookPageOAuth: (payload: {
    workspaceId: string;
    name?: string;
    credentialId?: string;
  }) =>
    apiClient.post<{
      url: string;
      callbackOrigin: string;
      redirectUri?: string;
      scopes?: string[];
      apiVersion?: string;
    }>("/workflows/facebook-page-oauth/start", payload),

  getFacebookPageOAuthStatus: () =>
    apiClient.get<{
      facebookPageIntegrationConfigured: boolean;
      missingConfigKeys: string[];
      preferredEnvKeys?: string[];
      sharedProviderFallbackKeys?: string[];
      redirectUriConfigured?: boolean;
      resolvedRedirectUri?: string;
      oauthScopesConfigured?: string[];
      apiVersion?: string;
      credentialSchemaReady?: boolean;
      facebookPageTypeSupported?: boolean;
      configJsonColumnPresent?: boolean;
    }>("/workflows/facebook-page-oauth/status"),

  listFacebookPages: (credentialId: string) =>
    apiClient.get<{
      apiVersion?: string;
      metaUserId?: string;
      metaDisplayName?: string;
      selectedPageId?: string;
      pages: Array<{
        pageId: string;
        pageName?: string;
        category?: string;
        username?: string;
        link?: string;
        fanCount?: number | null;
        followersCount?: number | null;
        pictureUrl?: string | null;
        tasks?: string[];
      }>;
    }>(
      `/workflows/facebook-page-oauth/pages?credentialId=${encodeURIComponent(credentialId)}`
    ),

  selectFacebookPage: (credentialId: string, pageId: string) =>
    apiClient.post<{ pageId: string }>(
      `/workflows/credentials/${credentialId}/facebook-page`,
      { pageId }
    ),

  listFacebookPagePostOptions: (
    credentialId: string,
    pageId: string,
    limit = 10
  ) =>
    apiClient.get<{
      pageId: string;
      posts: Array<{
        postId: string;
        label: string;
        createdTime?: string | null;
        permalinkUrl?: string;
      }>;
      paging?: unknown;
    }>(
      `/workflows/facebook-page/post-options?credentialId=${encodeURIComponent(credentialId)}&pageId=${encodeURIComponent(pageId)}&limit=${encodeURIComponent(String(limit))}`
    ),

  getLinkedInLeadDiscoveryCatalog: () =>
    apiClient.get<{
      operations: Array<{ id: string; label: string }>;
      providers: Array<{ id: string; label: string }>;
      library: {
        version: number;
        categoryCount: number;
        originalKeywordCount: number;
        intentVariationCount: number;
        categories: Array<{
          id: string;
          label: string;
          keywordCount: number;
          keywords: string[];
        }>;
        intentVariations: Array<{ id: string; label: string }>;
      };
      nativeStatus?: {
        feedConfigured?: boolean;
        allowFixtures?: boolean;
        queryBatchSize?: number;
        concurrency?: number;
        envFeedConfigured?: boolean;
        sources?: Record<string, string>;
      };
      nativeSources?: Array<{
        id: string;
        label: string;
        description?: string;
      }>;
    }>("/workflows/linkedin-lead-discovery/catalog"),

  testLinkedInNativeFeed: (args: {
    feedUrl: string;
    workspaceId?: string;
    credentialId?: string;
  }) =>
    apiClient.post<{
      ok: boolean;
      status: string;
      message?: string;
      code?: string;
      httpStatus?: number;
      feedUrl?: string;
    }>("/workflows/linkedin-lead-discovery/test-feed", args),

  testLinkedInPerigon: (args: {
    workspaceId: string;
    credentialId: string;
  }) =>
    apiClient.post<{
      ok: boolean;
      status: string;
      message?: string;
      code?: string;
      linkedInAccess?: boolean | null;
      socialQuotaPresent?: boolean | null;
      probeNumResults?: number | null;
      usage?: {
        available?: boolean;
        social?: {
          requestsUsed?: number;
          requestLimit?: number | null;
          since?: string | null;
          resetAt?: string | null;
        } | null;
        refreshedAt?: string | null;
        reason?: string | null;
      };
    }>("/workflows/linkedin-lead-discovery/test-perigon", args),

  getLinkedInLeadDiscoveryUsage: (args: {
    provider?: string;
    credentialId?: string;
    workspaceId?: string;
    refresh?: boolean;
  }) => {
    const params = new URLSearchParams();
    if (args.provider) params.set("provider", args.provider);
    if (args.credentialId) params.set("credentialId", args.credentialId);
    if (args.workspaceId) params.set("workspaceId", args.workspaceId);
    if (args.refresh) params.set("refresh", "1");
    return apiClient.get<{
      available: boolean;
      connected?: boolean;
      reason?: string;
      allowanceNote?: string;
      refreshedAt?: string;
      sharedAllowance?: boolean;
      provider?: string;
      social?: {
        requestsUsed?: number;
        requestLimit?: number | null;
        since?: string | null;
        resetAt?: string | null;
        lastMadeAt?: string | null;
      } | null;
      free: null | {
        usedPercent?: number | null;
        remainingPercent?: number | null;
        usedUsd?: number | null;
        remainingUsd?: number | null;
        limitUsd?: number | null;
        periodStart?: string | null;
        periodEnd?: string | null;
        available?: boolean;
        infinite?: boolean;
        reason?: string;
        requestsUsed?: number | null;
        requestsRemaining?: number | null;
        requestLimit?: number | null;
        label?: string;
      };
      paid: null | {
        usedPercent?: number | null;
        remainingPercent?: number | null;
        usedUsd?: number | null;
        remainingUsd?: number | null;
        limitUsd?: number | null;
        periodStart?: string | null;
        periodEnd?: string | null;
        available?: boolean;
        infinite?: boolean;
        reason?: string;
      };
    }>(`/workflows/linkedin-lead-discovery/usage?${params.toString()}`);
  },

  startInstagramOAuth: (payload: {
    workspaceId: string;
    name?: string;
    credentialId?: string;
  }) =>
    apiClient.post<{
      url: string;
      callbackOrigin: string;
      redirectUri?: string;
      scopes?: string[];
      apiVersion?: string;
    }>("/workflows/instagram-oauth/start", payload),

  getInstagramOAuthStatus: () =>
    apiClient.get<{
      instagramIntegrationConfigured: boolean;
      unifiedLoginConfigured?: boolean;
      missingConfigKeys: string[];
      redirectUriConfigured?: boolean;
      resolvedRedirectUri?: string;
      authMode?: string;
      tokenKind?: string;
      credentialSchemaReady?: boolean;
      instagramTypeSupported?: boolean;
      configJsonColumnPresent?: boolean;
      encryptionKeyConfigured?: boolean;
      requiredUnifiedPermissions?: string[];
      oauthScopesConfigured?: string[];
      accessDependencyPermissions?: string[];
    }>("/workflows/instagram-oauth/status"),

  listInstagramAccounts: (credentialId: string) =>
    apiClient.get<{
      apiVersion?: string;
      accounts: Array<{
        id: string;
        username: string;
        accountType: string;
        profilePictureUrl?: string;
      }>;
    }>(
      `/workflows/instagram-oauth/accounts?credentialId=${encodeURIComponent(credentialId)}`
    ),

  listGscSites: (workspaceId: string, credentialId: string) =>
    apiClient.get<{
      sites: {
        siteUrl: string;
        permissionLevel?: string;
        kind?: string;
        label?: string;
      }[];
    }>(
      `/workflows/google-oauth/gsc-sites?workspaceId=${encodeURIComponent(workspaceId)}&credentialId=${encodeURIComponent(credentialId)}`
    ),

  listGa4Properties: (workspaceId: string, credentialId: string) =>
    apiClient.get<{
      properties: { propertyId: string; displayName: string }[];
    }>(
      `/workflows/google-oauth/ga4-properties?workspaceId=${encodeURIComponent(workspaceId)}&credentialId=${encodeURIComponent(credentialId)}`
    ),

  listGmailLabels: (workspaceId: string, credentialId: string) =>
    apiClient.get<{ labels: { id: string; name: string }[] }>(
      `/workflows/google-oauth/gmail-labels?workspaceId=${encodeURIComponent(workspaceId)}&credentialId=${encodeURIComponent(credentialId)}`
    ),

  listSheetTabs: (workspaceId: string, credentialId: string, spreadsheetId: string) =>
    apiClient.get<{ sheets: { title: string; sheetId?: number }[] }>(
      `/workflows/google-oauth/sheet-tabs?workspaceId=${encodeURIComponent(workspaceId)}&credentialId=${encodeURIComponent(credentialId)}&spreadsheetId=${encodeURIComponent(spreadsheetId)}`
    ),
};
