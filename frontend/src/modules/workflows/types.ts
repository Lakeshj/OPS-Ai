export type WorkflowStatus = "draft" | "active" | "archived";
export type WorkflowRunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "cancelled";

export type WorkflowNodeType =
  | "trigger"
  | "schedule"
  | "webhook"
  | "workflowTrigger"
  | "errorTrigger"
  | "ai"
  | "bot"
  | "http"
  | "condition"
  | "switch"
  | "set"
  | "splitOut"
  | "filter"
  | "limit"
  | "sort"
  | "removeDuplicates"
  | "aggregate"
  | "merge"
  | "code"
  | "document"
  | "spreadsheet"
  | "email"
  | "result"
  | "wait"
  | "executeWorkflow"
  | "loop"
  | "noop"
  | "integration";

export interface WorkflowSetMapping {
  key: string;
  value: string;
}

/** n8n-aligned discriminator; legacy alias `field` still accepted in engine */
export type ScheduleTriggerInterval =
  | "seconds"
  | "minutes"
  | "hours"
  | "days"
  | "weeks"
  | "months"
  | "cron";

/** @deprecated use ScheduleTriggerInterval */
export type ScheduleIntervalField = ScheduleTriggerInterval;

export interface ScheduleRule {
  /** Stable identity for scheduler registration */
  id?: string;
  /** n8n field name */
  triggerInterval?: ScheduleTriggerInterval;
  /** Legacy alias for triggerInterval */
  field?: ScheduleTriggerInterval;
  secondsInterval?: number;
  minutesInterval?: number;
  hoursInterval?: number;
  daysInterval?: number;
  weeksInterval?: number;
  monthsInterval?: number;
  /** Legacy alias — maps to *Interval fields by triggerInterval */
  every?: number;
  /** Weekday indices 0=Sun … 6=Sat */
  triggerAtDay?: number[];
  triggerAtHour?: number;
  triggerAtMinute?: number;
  /** Day of month for monthly rules (1–31); skip month if day absent */
  triggerAtDayOfMonth?: number;
  /** Raw cron when triggerInterval === "cron" */
  cronExpression?: string;
  /** Legacy alias */
  expression?: string;
  /** ISO anchor for every-N-weeks/months/days recurrence phase */
  recurrenceAnchor?: string;
}

/** n8n-aligned pairedItem — drives {{steps.*}} thread-walk */
export type WorkflowPairedItem =
  | number
  | { item: number; input?: number }
  | Array<{ item: number; input?: number }>;

export interface WorkflowItem {
  json: Record<string, unknown>;
  binary?: Record<string, unknown>;
  pairedItem?: WorkflowPairedItem;
}

export interface WorkflowEditorOccurrence {
  runIndex: number;
  status?: string;
  items?: WorkflowItem[];
  output?: unknown;
  portOutputs?: Record<string, WorkflowItem[]>;
  inputSources?: Record<string, unknown> | null;
  error?: string | null;
  executionContext?: {
    loopNodeId?: string;
    iterationIndex?: number;
    phase?: string;
    batchStart?: number;
    batchEnd?: number;
  } | null;
  startedAt?: string | null;
  completedAt?: string | null;
  executionTimeMs?: number;
}

export interface WorkflowEditorNodeResult {
  nodeId: string;
  status: "succeeded" | "failed" | "skipped" | "running";
  output?: unknown;
  items?: WorkflowItem[];
  portOutputs?: Record<string, WorkflowItem[]>;
  error?: string | null;
  executionTimeMs?: number;
  cacheState?: "clean" | "dirty" | "pinned";
  executionSignature?: string;
  cached?: boolean;
  /** Latest occurrence index (compat). */
  executionIndex?: number;
  /** Full occurrence history when a node ran more than once (Loop body / Loop). */
  occurrences?: WorkflowEditorOccurrence[];
}

export interface WorkflowEditorDirtyNode {
  dirty: boolean;
  reason?: string;
  since?: string;
}

export interface WorkflowEditorSession {
  workflowId: string;
  input: Record<string, unknown>;
  nodeResults: Record<string, WorkflowEditorNodeResult>;
  dirtyNodes?: Record<string, WorkflowEditorDirtyNode>;
  updatedAt: string;
}

export type EditorInvalidationEvent =
  | { type: "params" | "disabled"; nodeId: string }
  | {
      type: "pin";
      nodeId: string;
      unpinned?: boolean;
      pinContentChanged?: boolean;
    }
  | {
      type: "edge";
      targetNodeId: string;
      previousTarget?: string;
      sourceNodeId?: string;
      sourceHandle?: string | null;
      targetHandle?: string | null;
    }
  | {
      type: "edge_reconnect";
      edgeId: string;
      previous: {
        source: string;
        target: string;
        sourceHandle?: string | null;
        targetHandle?: string | null;
      };
      current: {
        source: string;
        target: string;
        sourceHandle?: string | null;
        targetHandle?: string | null;
      };
    }
  | { type: "delete"; nodeId: string }
  | {
      type: "insert_node";
      newNodeId: string;
      downstreamTargets: string[];
    };

export type WorkflowCredentialType =
  | "bearer"
  | "api_key_header"
  | "basic"
  | "query_param";

export interface WorkflowCredential {
  id: string;
  workspaceId: string;
  name: string;
  type: WorkflowCredentialType;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type WorkflowCredentialSecret = Record<string, string>;

export const CREDENTIAL_TYPE_FIELDS: Record<
  WorkflowCredentialType,
  { label: string; fields: { key: string; label: string; secret?: boolean }[] }
> = {
  bearer: {
    label: "Bearer token",
    fields: [{ key: "token", label: "Token", secret: true }],
  },
  api_key_header: {
    label: "API key in a header",
    fields: [
      { key: "headerName", label: "Header name" },
      { key: "value", label: "API key", secret: true },
    ],
  },
  basic: {
    label: "Basic auth",
    fields: [
      { key: "username", label: "Username" },
      { key: "password", label: "Password", secret: true },
    ],
  },
  query_param: {
    label: "API key in the query string",
    fields: [
      { key: "paramName", label: "Parameter name" },
      { key: "value", label: "API key", secret: true },
    ],
  },
};

export type WorkflowOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "is_empty"
  | "is_not_empty"
  | "regex"
  | "truthy";

/** Operators that ignore the right-hand operand. */
export const UNARY_OPERATORS: WorkflowOperator[] = [
  "is_empty",
  "is_not_empty",
  "truthy",
];

export const OPERATOR_LABELS: Record<WorkflowOperator, string> = {
  equals: "equals",
  not_equals: "not equals",
  contains: "contains",
  not_contains: "does not contain",
  gt: "greater than (number)",
  gte: "greater or equal (number)",
  lt: "less than (number)",
  lte: "less or equal (number)",
  is_empty: "is empty",
  is_not_empty: "is not empty",
  regex: "matches regex",
  truthy: "is truthy",
};

export interface WorkflowNodeData {
  label?: string;
  nodeType?: WorkflowNodeType;
  /** Library catalog metadata */
  libraryId?: string;
  libraryCategory?: string;
  libraryProvider?: string;
  available?: boolean;
  /** AI */
  prompt?: string;
  systemPrompt?: string;
  provider?: string;
  model?: string;
  assistantId?: string;
  assistantName?: string;
  outputFormat?: string;
  temperature?: number;
  maxTokens?: number;
  /** HTTP */
  url?: string;
  method?: string;
  body?: string;
  /** Condition */
  left?: string;
  right?: string;
  operator?: WorkflowOperator;
  /** Switch */
  rules?: Array<{
    id?: string;
    left?: string;
    operator?: WorkflowOperator;
    right?: string;
    label?: string;
  }>;
  routingMode?: "firstMatch" | "allMatches";
  enableFallback?: boolean;
  pinnedPortOutputs?: Record<string, WorkflowItem[]>;
  /** Result */
  mapFrom?: string;
  /** Schedule */
  cron?: string;
  timezone?: string;
  scheduleRules?: ScheduleRule[];
  /** Node state */
  disabled?: boolean;
  alwaysOutputData?: boolean;
  executeOnce?: boolean;
  notes?: string;
  notesInFlow?: boolean;
  /** Webhook */
  webhookPath?: string;
  /** Email */
  to?: string;
  subject?: string;
  emailBody?: string;
  /** Set / transform */
  mappings?: WorkflowSetMapping[];
  /** Item nodes (Split Out, Filter, Sort, Aggregate, ...) */
  fieldName?: string;
  maxItems?: number;
  keep?: "first" | "last";
  direction?: "asc" | "desc";
  operation?: "count" | "sum" | "avg" | "min" | "max" | "concat" | "list";
  separator?: string;
  mode?: "append" | "combine" | "all" | "each";
  /** Code node */
  code?: string;
  timeoutMs?: number;
  /** HTTP auth, query and pagination */
  credentialId?: string;
  queryParams?: WorkflowSetMapping[];
  pageParam?: string;
  pageSizeParam?: string;
  pageSize?: number;
  maxPages?: number;
  itemsPath?: string;
  rateLimitRetries?: number;
  /** Development pinning */
  pinned?: boolean;
  pinnedOutput?: unknown;
  pinnedItems?: unknown[];
  /** Editor cache validity — set from editor session dirtyNodes */
  cacheDirty?: boolean;
  /** Failure handling */
  onError?: "stop" | "continue" | "route";
  retries?: number;
  retryDelayMs?: number;
  /** Document / Spreadsheet */
  documentId?: string;
  documentName?: string;
  sheetName?: string;
  hasHeader?: boolean;
  rowLimit?: number;
  /** Execute Workflow */
  workflowId?: string;
  workflowName?: string;
  [key: string]: unknown;
}

export interface WorkflowDefinition {
  version: number;
  settings?: {
    timezone?: string;
    executionOrder?: "v1";
  };
  nodes: Array<{
    id: string;
    type: WorkflowNodeType;
    position: { x: number; y: number };
    data?: WorkflowNodeData;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }>;
}

export interface Workflow {
  id: string;
  workspaceId: string;
  name: string;
  description?: string | null;
  definition: WorkflowDefinition;
  status: WorkflowStatus;
  /** Soft-deleted live definition (Part 10C.1 historical retention). */
  isDeleted?: boolean;
  deletedAt?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Lightweight picker row from GET /workflows/callable-targets */
export interface WorkflowCallableTarget {
  id: string;
  name: string;
  status: WorkflowStatus;
  updatedAt: string;
  callable: boolean;
  isSelf: boolean;
  callability: {
    valid: boolean;
    errors: string[];
    workflowTriggerNodeId: string | null;
    resultNodeId: string | null;
  };
  disabledReason: string | null;
}

export interface WorkflowRunStep {
  id: string;
  runId: string;
  nodeId: string;
  /** Part 9A: which execution of this node within the run (0 = first). */
  executionIndex?: number;
  nodeType: string;
  status: string;
  input?: unknown;
  output?: unknown;
  error?: string | null;
  attempts?: number;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
}

export interface WorkflowRunWaitInfo {
  resumeMode?: "time" | "manual" | "external" | null;
  resumeMechanism?: "time" | "manual" | "external" | null;
  signalledAt?: string | null;
  waitStatus?: string | null;
  /** Authorized getRun only — never from public APIs. */
  externalResumeToken?: string | null;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workspaceId?: string | null;
  /** Display name (live or historical). */
  workflowName?: string | null;
  workflowNameSnapshot?: string | null;
  workflowDeleted?: boolean;
  status: WorkflowRunStatus;
  input?: unknown;
  output?: unknown;
  error?: string | null;
  waitingNodeId?: string | null;
  waitingReason?: string | null;
  resumeAt?: string | null;
  parentRunId?: string | null;
  parentNodeId?: string | null;
  parentExecutionIndex?: number | null;
  rootRunId?: string | null;
  hasDefinitionSnapshot?: boolean;
  /** Present only when live workflow is soft-deleted — for historical canvas. */
  historicalDefinition?: WorkflowDefinition | null;
  isSubworkflow?: boolean;
  childRunCount?: number;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdBy: string;
  createdAt: string;
  steps?: WorkflowRunStep[];
  wait?: WorkflowRunWaitInfo | null;
}

/** Part 10C — safe lineage node (no secrets / snapshots). */
export interface WorkflowLineageRun {
  runId: string;
  workflowId: string;
  workflowName: string;
  workflowDeleted?: boolean;
  status: string;
  waitingReason?: string | null;
  waitingNodeId?: string | null;
  resumeAt?: string | null;
  parentRunId?: string | null;
  parentNodeId?: string | null;
  parentExecutionIndex?: number | null;
  rootRunId?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt?: string | null;
  error?: string | null;
}

export interface WorkflowRunLineage {
  run: WorkflowLineageRun;
  ancestors: WorkflowLineageRun[];
  children: WorkflowLineageRun[];
  breadcrumb: Array<{
    runId: string;
    workflowId: string;
    workflowName: string;
    workflowDeleted?: boolean;
    status: string;
  }>;
  rootRunId: string;
}

export interface WorkflowChildInvocationSummary extends WorkflowLineageRun {
  parentRunId: string;
  parentNodeId: string;
  parentExecutionIndex: number;
  childWait?: {
    resumeMode?: string | null;
    waitStatus?: string | null;
    resumeAt?: string | null;
  } | null;
  openRunPath?: string | null;
  openWorkflowPath?: string | null;
}
