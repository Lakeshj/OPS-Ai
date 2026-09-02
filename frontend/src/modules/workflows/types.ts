export type WorkflowStatus = "draft" | "active" | "archived";
export type WorkflowRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type WorkflowNodeType =
  | "trigger"
  | "schedule"
  | "webhook"
  | "ai"
  | "bot"
  | "http"
  | "condition"
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

export interface WorkflowEditorNodeResult {
  nodeId: string;
  status: "succeeded" | "failed" | "skipped" | "running";
  output?: unknown;
  items?: WorkflowItem[];
  error?: string | null;
  executionTimeMs?: number;
}

export interface WorkflowEditorSession {
  workflowId: string;
  input: Record<string, unknown>;
  nodeResults: Record<string, WorkflowEditorNodeResult>;
  updatedAt: string;
}

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
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRunStep {
  id: string;
  runId: string;
  nodeId: string;
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

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  input?: unknown;
  output?: unknown;
  error?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdBy: string;
  createdAt: string;
  steps?: WorkflowRunStep[];
}
