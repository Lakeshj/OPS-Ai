/**
 * OpsAi workflow node contract — single source of truth for ports, cardinality,
 * pairedItem policy, settings applicability, param schemas, and dirty rules.
 *
 * Governance: docs/workflow-builder-rules.md
 * n8n is behavioral reference only — do not clone n8n UI when implementing these contracts.
 *
 * Engine, inspector, and expression resolver should read from NODE_CONTRACTS.
 * See docs/workflow-node-contracts.md for human-readable notes.
 */

import type { WorkflowNodeType } from "./types";

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export type PortKind =
  | "main"
  | "error"
  | "true"
  | "false"
  | "fallback"
  | "ai_languageModel"
  | "ai_memory"
  | "ai_tool";

export interface NodePortDef {
  id: string;
  kind: PortKind;
  direction: "in" | "out";
  /** Max connections; undefined = unlimited */
  maxConnections?: number;
  required?: boolean;
  label?: string;
  /** Short helper for tooltips / inspector */
  description?: string;
}

// ---------------------------------------------------------------------------
// pairedItem
// ---------------------------------------------------------------------------

/** How the engine assigns pairedItem on output items. */
export type PairedItemPolicy =
  | "none" // origin nodes (triggers) — no upstream provenance
  | "identity1to1" // out[i] → in[i]
  | "fanOut" // all outs → single source item (split, pagination read)
  | "identityBySurvival" // survivors keep original input index (filter, sort, limit)
  | "fanIn" // out.pairedItem = array of all contributing indices (aggregate, write)
  | "multiPort" // out carries { item, input } port index (merge)
  | "routing" // routed items keep index on branch output (condition)
  | "manual"; // code node — user must set when counts differ

export type PairedItem =
  | number
  | { item: number; input?: number }
  | Array<{ item: number; input?: number }>;

// ---------------------------------------------------------------------------
// Cardinality
// ---------------------------------------------------------------------------

export type NodeCardinality =
  | "0-to-1" // triggers
  | "N-to-N" // 1:1 per item
  | "N-to-leqN" // subset (filter, limit, dedupe)
  | "N-to-N-reorder" // same count, reorder (sort)
  | "1-to-N" // fan-out (splitOut, spreadsheet read, http pagination)
  | "N-to-1" // fan-in (aggregate, spreadsheet write)
  | "N-to-0" // terminal (result)
  | "N-split-branches" // condition: sum across branches = N
  | "arbitrary"; // code

// ---------------------------------------------------------------------------
// Settings & capabilities
// ---------------------------------------------------------------------------

export type NodeCapability =
  | "execute_step"
  | "disable"
  | "pin"
  | "error_policy"
  | "retry"
  | "timeout"
  | "always_output"
  | "execute_once"
  | "notes"
  | "test_trigger";

export interface NodeSettingsMatrix {
  disabled: boolean;
  onError: boolean;
  retries: boolean;
  timeoutMs: boolean;
  alwaysOutputData: boolean;
  executeOnce: boolean;
  notes: boolean;
}

export type DirtyTrigger =
  | "params"
  | "edges"
  | "pin"
  | "disabled"
  | "typedPorts";

// ---------------------------------------------------------------------------
// Parameter schema (declarative inspector)
// ---------------------------------------------------------------------------

export type ParamFieldType =
  | "string"
  | "number"
  | "boolean"
  | "options"
  | "multiOptions"
  | "json"
  | "code"
  | "credential"
  | "collection"
  | "fixedCollection"
  | "notice"
  | "hidden";

/** OpsAi-owned specialized field renderers (configured in contract, not if-type switches). */
export type ParamCustomRenderer =
  | "credential"
  | "documentPicker"
  | "spreadsheetPicker"
  | "botAssistant"
  | "scheduleRules"
  | "queryParams"
  | "httpPagination"
  | "workflowPicker";

export interface DisplayOptions {
  show?: Record<string, Array<string | number | boolean>>;
  hide?: Record<string, Array<string | number | boolean>>;
}

export interface ParamOption {
  name: string;
  value: string | number | boolean;
}

export interface ParamDescriptor {
  name: string;
  displayName: string;
  type: ParamFieldType;
  default?: unknown;
  description?: string;
  placeholder?: string;
  options?: ParamOption[];
  /** Nested fields for collection / fixedCollection */
  fields?: ParamDescriptor[];
  /** Discriminator field inside fixedCollection items */
  typeOptions?: Record<string, ParamDescriptor[]>;
  displayOptions?: DisplayOptions;
  required?: boolean;
  /** Use ExpressionField when previewContext is available */
  expression?: boolean;
  /** Multiline string / json / code */
  multiline?: boolean;
  /** Delegate to a registered specialized renderer */
  customRenderer?: ParamCustomRenderer;
  min?: number;
  max?: number;
}

// ---------------------------------------------------------------------------
// Node contract
// ---------------------------------------------------------------------------

export interface NodeContract {
  type: WorkflowNodeType;
  version: number;
  category: string;
  label: string;
  inputs: NodePortDef[];
  outputs: NodePortDef[];
  cardinality: NodeCardinality;
  pairedItemPolicy: PairedItemPolicy;
  pairedItemNotes?: string;
  settings: NodeSettingsMatrix;
  capabilities: NodeCapability[];
  isTrigger?: boolean;
  isTerminal?: boolean;
  /** Sends email, HTTP mutation, AI call, etc. */
  isSideEffecting?: boolean;
  /** Persistent state outside execution cache (dedupe history, bot memory) */
  isStateful?: boolean;
  stateScope?: "node" | "workflow";
  params: ParamDescriptor[];
  /** Static output keys for triggers (shown before any run) */
  outputSchema?: Record<string, string>;
  dirtyTriggers: DirtyTrigger[];
  edgeCases: string[];
  /** Dynamic output ports resolved from node data (e.g. Switch rules). */
  dynamicOutputs?: { resolver: "switchOutputs" };
  /** Optional panel-level renderer (triggers, complex pickers) */
  parametersPanel?: "standard" | "trigger" | "bot" | "placeholder";
  /** When parametersPanel is placeholder — drives inspector copy */
  placeholderKind?: "stub" | "passthrough";
}

// ---------------------------------------------------------------------------
// Port helpers
// ---------------------------------------------------------------------------

const mainIn = (label = "Input", maxConnections = 1): NodePortDef => ({
  id: "main",
  kind: "main",
  direction: "in",
  maxConnections,
  label,
});

const mainOut: NodePortDef = {
  id: "main",
  kind: "main",
  direction: "out",
  label: "Output",
};

const errorOut: NodePortDef = {
  id: "error",
  kind: "error",
  direction: "out",
  label: "Error",
};

const trueOut: NodePortDef = {
  id: "true",
  kind: "true",
  direction: "out",
  label: "True",
};

const falseOut: NodePortDef = {
  id: "false",
  kind: "false",
  direction: "out",
  label: "False",
};

const mergeInput = (index: number): NodePortDef => ({
  id: `input${index}`,
  kind: "main",
  direction: "in",
  maxConnections: 1,
  label: `Input ${index}`,
});

const SETTINGS_ACTION: NodeSettingsMatrix = {
  disabled: true,
  onError: true,
  retries: true,
  timeoutMs: true,
  alwaysOutputData: true,
  executeOnce: true,
  notes: true,
};

const SETTINGS_LOGIC: NodeSettingsMatrix = {
  disabled: true,
  onError: false,
  retries: false,
  timeoutMs: false,
  alwaysOutputData: true,
  executeOnce: false,
  notes: true,
};

const SETTINGS_TRIGGER: NodeSettingsMatrix = {
  disabled: false,
  onError: false,
  retries: false,
  timeoutMs: false,
  alwaysOutputData: false,
  executeOnce: false,
  notes: true,
};

const SETTINGS_TERMINAL: NodeSettingsMatrix = {
  disabled: true,
  onError: false,
  retries: false,
  timeoutMs: false,
  alwaysOutputData: true,
  executeOnce: false,
  notes: true,
};

const CAP_ACTION: NodeCapability[] = [
  "execute_step",
  "disable",
  "pin",
  "error_policy",
  "retry",
  "timeout",
  "always_output",
  "execute_once",
  "notes",
];

const CAP_TRIGGER: NodeCapability[] = ["pin", "notes", "test_trigger"];

/** n8n-aligned schedule rule param schema (fixedCollection). */
export const SCHEDULE_RULE_PARAMS: ParamDescriptor[] = [
  {
    name: "triggerInterval",
    displayName: "Trigger Interval",
    type: "options",
    default: "weeks",
    options: [
      { name: "Seconds", value: "seconds" },
      { name: "Minutes", value: "minutes" },
      { name: "Hours", value: "hours" },
      { name: "Days", value: "days" },
      { name: "Weeks", value: "weeks" },
      { name: "Months", value: "months" },
      { name: "Custom (cron)", value: "cron" },
    ],
  },
  {
    name: "secondsInterval",
    displayName: "Seconds Between Triggers",
    type: "number",
    default: 30,
    displayOptions: { show: { triggerInterval: ["seconds"] } },
  },
  {
    name: "minutesInterval",
    displayName: "Minutes Between Triggers",
    type: "number",
    default: 5,
    displayOptions: { show: { triggerInterval: ["minutes"] } },
  },
  {
    name: "hoursInterval",
    displayName: "Hours Between Triggers",
    type: "number",
    default: 1,
    displayOptions: { show: { triggerInterval: ["hours"] } },
  },
  {
    name: "triggerAtMinute",
    displayName: "Trigger at Minute",
    type: "number",
    default: 0,
    displayOptions: {
      show: { triggerInterval: ["hours", "days", "weeks", "months"] },
    },
  },
  {
    name: "daysInterval",
    displayName: "Days Between Triggers",
    type: "number",
    default: 1,
    displayOptions: { show: { triggerInterval: ["days"] } },
  },
  {
    name: "triggerAtHour",
    displayName: "Trigger at Hour",
    type: "number",
    default: 9,
    displayOptions: {
      show: { triggerInterval: ["days", "weeks", "months"] },
    },
  },
  {
    name: "weeksInterval",
    displayName: "Weeks Between Triggers",
    type: "number",
    default: 1,
    displayOptions: { show: { triggerInterval: ["weeks"] } },
  },
  {
    name: "triggerAtDay",
    displayName: "Trigger on Weekdays",
    type: "multiOptions",
    default: [1],
    options: [
      { name: "Sunday", value: 0 },
      { name: "Monday", value: 1 },
      { name: "Tuesday", value: 2 },
      { name: "Wednesday", value: 3 },
      { name: "Thursday", value: 4 },
      { name: "Friday", value: 5 },
      { name: "Saturday", value: 6 },
    ],
    displayOptions: { show: { triggerInterval: ["weeks"] } },
  },
  {
    name: "monthsInterval",
    displayName: "Months Between Triggers",
    type: "number",
    default: 1,
    displayOptions: { show: { triggerInterval: ["months"] } },
  },
  {
    name: "triggerAtDayOfMonth",
    displayName: "Trigger at Day of Month",
    type: "number",
    default: 1,
    displayOptions: { show: { triggerInterval: ["months"] } },
  },
  {
    name: "cronExpression",
    displayName: "Cron Expression",
    type: "string",
    placeholder: "0 7 * * 1",
    displayOptions: { show: { triggerInterval: ["cron"] } },
  },
];

const SCHEDULE_OUTPUT_SCHEMA: Record<string, string> = {
  timestamp: "ISO-8601 with timezone offset",
  "Readable date": "September 1st 2026, 4:51:00 pm",
  "Readable time": "4:51:00 pm",
  "Day of week": "Tuesday",
  Year: "2026",
  Month: "September",
  "Day of month": "01",
  Hour: "16",
  Minute: "51",
  Second: "00",
  Timezone: "Asia/Calcutta (UTC+05:30)",
};

// ---------------------------------------------------------------------------
// Full registry — engine node types (contracts are authoritative)
// ---------------------------------------------------------------------------

export const NODE_CONTRACTS: Record<WorkflowNodeType, NodeContract> = {
  // ---- TRIGGERS ----
  trigger: {
    type: "trigger",
    version: 1,
    category: "Triggers",
    label: "Manual Trigger",
    inputs: [],
    outputs: [mainOut],
    cardinality: "0-to-1",
    pairedItemPolicy: "none",
    settings: SETTINGS_TRIGGER,
    capabilities: CAP_TRIGGER,
    isTrigger: true,
    params: [],
    outputSchema: { json: "{}" },
    dirtyTriggers: ["pin"],
    edgeCases: [
      "No INPUT panel",
      "OUTPUT before run = single empty item [{ json: {} }]",
      "Nothing may wire into this node",
    ],
  },

  schedule: {
    type: "schedule",
    version: 1,
    category: "Triggers",
    label: "Schedule Trigger",
    inputs: [],
    outputs: [mainOut],
    cardinality: "0-to-1",
    pairedItemPolicy: "none",
    settings: SETTINGS_TRIGGER,
    capabilities: CAP_TRIGGER,
    isTrigger: true,
    params: [
      {
        name: "notice",
        displayName: "Info",
        type: "notice",
        description:
          "This schedule runs only when the workflow is published. Use Test trigger for manual runs.",
      },
      {
        name: "scheduleRules",
        displayName: "Trigger Rules",
        type: "fixedCollection",
        default: [],
        fields: SCHEDULE_RULE_PARAMS,
      },
      {
        name: "timezone",
        displayName: "Timezone",
        type: "string",
        default: "UTC",
        placeholder: "America/New_York",
      },
    ],
    outputSchema: SCHEDULE_OUTPUT_SCHEMA,
    dirtyTriggers: ["params"],
    edgeCases: [
      "No INPUT panel",
      "weeksInterval/monthsInterval/daysInterval > 1 → anchor-date math, NOT cron",
      "One scheduler timer per rule — never merge rules into one cron",
      "secondsInterval > 60 or non-divisor intervals → computed timer, not */N cron",
      "Production runs only when workflow status = active",
      "Test trigger synthesizes timestamp bundle from now() in workflow timezone",
    ],
  },

  webhook: {
    type: "webhook",
    version: 1,
    category: "Triggers",
    label: "Webhook",
    inputs: [],
    outputs: [mainOut],
    cardinality: "0-to-1",
    pairedItemPolicy: "none",
    settings: SETTINGS_TRIGGER,
    capabilities: CAP_TRIGGER,
    isTrigger: true,
    params: [
      { name: "webhookPath", displayName: "Path", type: "string", required: true },
      {
        name: "method",
        displayName: "Method",
        type: "options",
        default: "POST",
        options: [
          { name: "GET", value: "GET" },
          { name: "POST", value: "POST" },
          { name: "PUT", value: "PUT" },
          { name: "PATCH", value: "PATCH" },
          { name: "DELETE", value: "DELETE" },
        ],
      },
      {
        name: "responseMode",
        displayName: "Response Mode",
        type: "options",
        default: "immediate",
        options: [
          { name: "Immediately", value: "immediate" },
          { name: "When last node finishes", value: "lastNode" },
          { name: "Using Respond to Webhook node", value: "respondNode" },
        ],
      },
      { name: "credentialId", displayName: "Authentication", type: "credential" },
    ],
    dirtyTriggers: ["params"],
    edgeCases: [
      "No INPUT panel",
      "Pin ignored in production — real request body wins",
      "Test URL vs production URL are distinct UI states",
    ],
  },

  workflowTrigger: {
    type: "workflowTrigger",
    version: 1,
    category: "Triggers",
    label: "Workflow Trigger",
    inputs: [],
    outputs: [mainOut],
    cardinality: "0-to-1",
    pairedItemPolicy: "none",
    settings: SETTINGS_TRIGGER,
    capabilities: CAP_TRIGGER,
    isTrigger: true,
    params: [],
    outputSchema: { json: "{}" },
    dirtyTriggers: ["pin"],
    edgeCases: [
      "Start this workflow when called by another workflow.",
      "No INPUT panel",
      "Nothing may wire into this node",
      "Callable workflows require exactly one Workflow Trigger and one Result",
    ],
  },

  // Part 11A — hidden until 11B UI
  errorTrigger: {
    type: "errorTrigger",
    version: 1,
    category: "Triggers",
    label: "Error Trigger",
    inputs: [],
    outputs: [mainOut],
    cardinality: "0-to-1",
    pairedItemPolicy: "none",
    settings: SETTINGS_TRIGGER,
    capabilities: CAP_TRIGGER,
    isTrigger: true,
    params: [],
    outputSchema: {
      event: "workflow_failed",
      workflow: { id: "", name: "" },
      execution: {},
      failure: {},
    },
    dirtyTriggers: ["pin"],
    edgeCases: [
      "Starts when another workflow reaches terminal FAILED",
      "Exactly one Error Trigger required on Error Workflows",
      "Result node not required",
      "Library unavailable until Part 11B",
    ],
  },

  // ---- DATA / TRANSFORM ----
  set: {
    type: "set",
    version: 1,
    category: "Data",
    label: "Set fields",
    inputs: [mainIn()],
    outputs: [mainOut],
    cardinality: "N-to-N",
    pairedItemPolicy: "identity1to1",
    settings: SETTINGS_ACTION,
    capabilities: CAP_ACTION,
    params: [
      {
        name: "mappings",
        displayName: "Fields to Set",
        type: "fixedCollection",
        fields: [
          { name: "key", displayName: "Name", type: "string" },
          { name: "value", displayName: "Value", type: "string" },
        ],
      },
      {
        name: "keepOnlySet",
        displayName: "Keep Only Set Fields",
        type: "boolean",
        default: false,
      },
    ],
    dirtyTriggers: ["params", "edges", "pin", "disabled"],
    edgeCases: [
      "executeOnce → output is 1 item regardless of input count; pairedItem = 0",
    ],
  },

  splitOut: {
    type: "splitOut",
    version: 1,
    category: "Data",
    label: "Split Out",
    inputs: [mainIn()],
    outputs: [mainOut],
    cardinality: "1-to-N",
    pairedItemPolicy: "fanOut",
    pairedItemNotes: "Every output links to the single source input item",
    settings: SETTINGS_ACTION,
    capabilities: CAP_ACTION,
    params: [
      { name: "fieldName", displayName: "Field to Split Out", type: "string", required: true },
      {
        name: "includeOtherFields",
        displayName: "Include Other Fields",
        type: "boolean",
        default: true,
      },
    ],
    dirtyTriggers: ["params", "edges", "pin", "disabled"],
    edgeCases: [
      "Canonical fan-out node — downstream {{steps.*}} must resolve to parent item",
      "Non-array field → single item or error (pick one policy and document)",
    ],
  },

  filter: {
    type: "filter",
    version: 1,
    category: "Data",
    label: "Filter",
    inputs: [mainIn()],
    outputs: [mainOut],
    cardinality: "N-to-leqN",
    pairedItemPolicy: "identityBySurvival",
    pairedItemNotes: "Survivors keep original input index, never renumbered",
    settings: SETTINGS_ACTION,
    capabilities: CAP_ACTION,
    params: [
      {
        name: "conditions",
        displayName: "Conditions",
        type: "collection",
        fields: [
          { name: "left", displayName: "Field", type: "string" },
          {
            name: "operator",
            displayName: "Operator",
            type: "options",
            options: [
              { name: "equals", value: "equals" },
              { name: "not_equals", value: "not_equals" },
              { name: "contains", value: "contains" },
              { name: "gt", value: "gt" },
              { name: "truthy", value: "truthy" },
            ],
          },
          { name: "right", displayName: "Value", type: "string" },
        ],
      },
      {
        name: "combinator",
        displayName: "Combinator",
        type: "options",
        default: "and",
        options: [
          { name: "AND", value: "and" },
          { name: "OR", value: "or" },
        ],
      },
    ],
    dirtyTriggers: ["params", "edges", "pin", "disabled"],
    edgeCases: [
      "Drops items — does NOT route (contrast condition)",
      "alwaysOutputData meaningful when result would be empty",
    ],
  },

  limit: {
    type: "limit",
    version: 1,
    category: "Data",
    label: "Limit",
    inputs: [mainIn()],
    outputs: [mainOut],
    cardinality: "N-to-leqN",
    pairedItemPolicy: "identityBySurvival",
    settings: SETTINGS_ACTION,
    capabilities: CAP_ACTION,
    params: [
      { name: "maxItems", displayName: "Max Items", type: "number", default: 10 },
      {
        name: "keep",
        displayName: "Keep",
        type: "options",
        default: "first",
        options: [
          { name: "First Items", value: "first" },
          { name: "Last Items", value: "last" },
        ],
      },
    ],
    dirtyTriggers: ["params", "edges", "pin", "disabled"],
    edgeCases: ['"keep last" preserves original indices of last k items in pairedItem'],
  },

  sort: {
    type: "sort",
    version: 1,
    category: "Data",
    label: "Sort",
    inputs: [mainIn()],
    outputs: [mainOut],
    cardinality: "N-to-N-reorder",
    pairedItemPolicy: "identityBySurvival",
    pairedItemNotes: "out at position p carries original index of that item — critical for thread-walk",
    settings: SETTINGS_ACTION,
    capabilities: CAP_ACTION,
    params: [
      { name: "fieldName", displayName: "Sort Field", type: "string" },
      {
        name: "direction",
        displayName: "Direction",
        type: "options",
        default: "asc",
        options: [
          { name: "Ascending", value: "asc" },
          { name: "Descending", value: "desc" },
        ],
      },
    ],
    dirtyTriggers: ["params", "edges", "pin", "disabled"],
    edgeCases: [
      "Reference test for pairedItem thread-walk — positional renumbering breaks {{steps.*}}",
    ],
  },

  removeDuplicates: {
    type: "removeDuplicates",
    version: 1,
    category: "Data",
    label: "Remove Duplicates",
    inputs: [mainIn()],
    outputs: [mainOut],
    cardinality: "N-to-leqN",
    pairedItemPolicy: "identityBySurvival",
    settings: SETTINGS_ACTION,
    capabilities: CAP_ACTION,
    isStateful: true,
    stateScope: "workflow",
    params: [
      {
        name: "operation",
        displayName: "Operation",
        type: "options",
        default: "withinCurrentInput",
        options: [
          { name: "Within Current Input", value: "withinCurrentInput" },
          { name: "Across Executions", value: "acrossExecutions" },
          { name: "Clear History", value: "clearHistory" },
        ],
      },
      {
        name: "compareFields",
        displayName: "Compare Fields",
        type: "string",
        displayOptions: { show: { operation: ["withinCurrentInput"] } },
      },
      {
        name: "valueToDedupeOn",
        displayName: "Value to Dedupe On",
        type: "string",
        displayOptions: { show: { operation: ["acrossExecutions"] } },
      },
      {
        name: "historySize",
        displayName: "History Size",
        type: "number",
        default: 10000,
        displayOptions: { show: { operation: ["acrossExecutions"] } },
      },
    ],
    dirtyTriggers: ["params", "edges", "pin", "disabled"],
    edgeCases: [
      "acrossExecutions uses persistent MySQL history — NOT editor cache",
      "clearHistory is maintenance only — no item flow",
    ],
  },

  aggregate: {
    type: "aggregate",
    version: 1,
    category: "Data",
    label: "Aggregate",
    inputs: [mainIn()],
    outputs: [mainOut],
    cardinality: "N-to-1",
    pairedItemPolicy: "fanIn",
    pairedItemNotes:
      "Single output pairedItem = [{item:0},…,{item:N-1}] — triggers 'Multiple matching items' on .item walk",
    settings: SETTINGS_ACTION,
    capabilities: CAP_ACTION,
    params: [
      {
        name: "operation",
        displayName: "Operation",
        type: "options",
        default: "count",
        options: [
          { name: "Count", value: "count" },
          { name: "Sum", value: "sum" },
          { name: "Average", value: "avg" },
          { name: "Min", value: "min" },
          { name: "Max", value: "max" },
          { name: "Concatenate", value: "concat" },
          { name: "All Item Data", value: "allItemData" },
        ],
      },
      {
        name: "fieldName",
        displayName: "Field",
        type: "string",
        displayOptions: {
          show: { operation: ["sum", "avg", "min", "max", "concat"] },
        },
      },
      { name: "separator", displayName: "Separator", type: "string", default: ", " },
    ],
    dirtyTriggers: ["params", "edges", "pin", "disabled"],
    edgeCases: [
      "Downstream must use .first() / .all()[i] to disambiguate fan-in provenance",
    ],
  },

  merge: {
    type: "merge",
    version: 1,
    category: "Data",
    label: "Merge",
    inputs: [mergeInput(1), mergeInput(2)],
    outputs: [mainOut],
    cardinality: "N-to-N",
    pairedItemPolicy: "multiPort",
    pairedItemNotes:
      "append: {item, input}; by-position: [{item:i,input:0},{item:i,input:1}]",
    settings: SETTINGS_ACTION,
    capabilities: CAP_ACTION,
    params: [
      {
        name: "mode",
        displayName: "Mode",
        type: "options",
        default: "append",
        options: [
          { name: "Append", value: "append" },
          { name: "Combine by Position", value: "combineByPosition" },
          { name: "Combine by Key", value: "combineByKey" },
        ],
      },
      {
        name: "matchFields",
        displayName: "Match Fields",
        type: "collection",
        displayOptions: { show: { mode: ["combineByKey"] } },
        fields: [
          { name: "field1", displayName: "Input 1 Field", type: "string" },
          { name: "field2", displayName: "Input 2 Field", type: "string" },
        ],
      },
      {
        name: "joinMode",
        displayName: "Output",
        type: "options",
        default: "keepMatches",
        displayOptions: { show: { mode: ["combineByKey"] } },
        options: [
          { name: "Keep Matches", value: "keepMatches" },
          { name: "Keep Non-Matches", value: "keepNonMatches" },
          { name: "Enrich Input 1", value: "enrichInput1" },
        ],
      },
    ],
    dirtyTriggers: ["params", "edges", "pin", "disabled"],
    edgeCases: [
      "Blocking barrier — do not emit until ALL connected inputs have data",
      "INPUT panel: one tab per port; render independently (don't block display)",
      "input field in pairedItem is mandatory",
    ],
  },

  code: {
    type: "code",
    version: 1,
    category: "Data",
    label: "Code",
    inputs: [mainIn()],
    outputs: [mainOut, errorOut],
    cardinality: "arbitrary",
    pairedItemPolicy: "manual",
    pairedItemNotes:
      "Per-item mode auto-sets index; all-items mode requires user pairedItem when counts differ",
    settings: { ...SETTINGS_ACTION, timeoutMs: true },
    capabilities: CAP_ACTION,
    params: [
      {
        name: "mode",
        displayName: "Mode",
        type: "options",
        default: "each",
        options: [
          { name: "Run Once for All Items", value: "all" },
          { name: "Run Once for Each Item", value: "each" },
        ],
      },
      { name: "code", displayName: "JavaScript", type: "code", required: true },
    ],
    dirtyTriggers: ["params", "edges", "pin", "disabled"],
    edgeCases: [
      "Brand-new arrays without pairedItem → 'Info for expression missing from previous node'",
    ],
  },

  // ---- LOGIC ----
  condition: {
    type: "condition",
    version: 1,
    category: "Logic",
    label: "IF",
    inputs: [mainIn()],
    outputs: [trueOut, falseOut],
    cardinality: "N-split-branches",
    pairedItemPolicy: "routing",
    pairedItemNotes: "Each routed item keeps original index on its branch output",
    settings: SETTINGS_LOGIC,
    capabilities: ["execute_step", "disable", "pin", "always_output", "notes"],
    params: [
      { name: "left", displayName: "Value 1", type: "string" },
      {
        name: "operator",
        displayName: "Operator",
        type: "options",
        default: "equals",
        options: [{ name: "equals", value: "equals" }],
      },
      { name: "right", displayName: "Value 2", type: "string" },
    ],
    dirtyTriggers: ["params", "edges", "pin", "disabled"],
    edgeCases: [
      "Routes — does NOT drop (contrast filter)",
      "Branch skip: unreached branch downstream sees 'no data', not 'dirty'",
    ],
  },

  switch: {
    type: "switch",
    version: 1,
    category: "Logic",
    label: "Switch",
    inputs: [mainIn()],
    outputs: [],
    dynamicOutputs: { resolver: "switchOutputs" },
    cardinality: "N-split-branches",
    pairedItemPolicy: "routing",
    pairedItemNotes:
      "Each routed item keeps original input index on its branch output",
    settings: SETTINGS_LOGIC,
    capabilities: ["execute_step", "disable", "pin", "always_output", "notes"],
    params: [],
    dirtyTriggers: ["params", "edges", "pin", "disabled"],
    edgeCases: [
      "Per-item routing with stable rule IDs as output handles",
      "All configured outputs settle after execution (empty or with items)",
      "Skipped Switch propagates skipped to every dynamic output",
    ],
  },

  // ---- FILES ----
  document: {
    type: "document",
    version: 1,
    category: "Files",
    label: "Document",
    inputs: [mainIn()],
    outputs: [mainOut],
    cardinality: "N-to-N",
    pairedItemPolicy: "identity1to1",
    settings: SETTINGS_ACTION,
    capabilities: CAP_ACTION,
    params: [
      {
        name: "operation",
        displayName: "Operation",
        type: "options",
        options: [
          { name: "Read", value: "read" },
          { name: "Extract", value: "extract" },
          { name: "Generate", value: "generate" },
        ],
      },
      { name: "documentId", displayName: "Document", type: "string" },
      {
        name: "binaryPropertyName",
        displayName: "Binary Property",
        type: "string",
        default: "data",
      },
    ],
    dirtyTriggers: ["params", "edges", "pin", "disabled"],
    edgeCases: [
      "Extract-to-rows can be 1→N — all outputs link to source item",
      "Binary lives on item.binary[propertyName]",
    ],
  },

  spreadsheet: {
    type: "spreadsheet",
    version: 1,
    category: "Files",
    label: "Spreadsheet",
    inputs: [mainIn()],
    outputs: [mainOut],
    cardinality: "N-to-N",
    pairedItemPolicy: "identity1to1",
    pairedItemNotes: "read=1→N fanOut; write=N→1 fanIn — policy switches by operation",
    settings: SETTINGS_ACTION,
    capabilities: CAP_ACTION,
    params: [
      {
        name: "operation",
        displayName: "Operation",
        type: "options",
        options: [
          { name: "Read", value: "read" },
          { name: "Write", value: "write" },
        ],
      },
      { name: "sheetName", displayName: "Sheet", type: "string" },
      { name: "hasHeader", displayName: "Has Header Row", type: "boolean", default: true },
      { name: "rowLimit", displayName: "Row Limit", type: "number" },
    ],
    dirtyTriggers: ["params", "edges", "pin", "disabled"],
    edgeCases: [
      "Read: rows become items, all link to source (fanOut)",
      "Write: items → file, output pairedItem = array of all input indices (fanIn)",
    ],
  },

  // ---- COMM ----
  email: {
    type: "email",
    version: 1,
    category: "Communication",
    label: "Email",
    inputs: [mainIn()],
    outputs: [mainOut],
    cardinality: "N-to-N",
    pairedItemPolicy: "identity1to1",
    settings: SETTINGS_ACTION,
    capabilities: CAP_ACTION,
    isSideEffecting: true,
    params: [
      { name: "to", displayName: "To", type: "string", required: true },
      { name: "subject", displayName: "Subject", type: "string" },
      { name: "emailBody", displayName: "Body", type: "string" },
      { name: "credentialId", displayName: "SMTP Credential", type: "credential" },
    ],
    dirtyTriggers: ["params", "edges", "pin", "disabled"],
    edgeCases: [
      "Side-effecting — Run step sends real email unless test mode gate added",
      "onError continue/route very meaningful for send failures",
    ],
  },

  http: {
    type: "http",
    version: 1,
    category: "HTTP",
    label: "HTTP Request",
    inputs: [mainIn()],
    outputs: [mainOut, errorOut],
    cardinality: "N-to-N",
    pairedItemPolicy: "identity1to1",
    pairedItemNotes: "Pagination fan-out uses fanOut policy per page batch",
    settings: SETTINGS_ACTION,
    capabilities: CAP_ACTION,
    isSideEffecting: true,
    params: [
      { name: "method", displayName: "Method", type: "options", default: "GET" },
      { name: "url", displayName: "URL", type: "string", required: true },
      { name: "credentialId", displayName: "Authentication", type: "credential" },
      { name: "body", displayName: "Body", type: "json" },
      {
        name: "pagination",
        displayName: "Pagination",
        type: "collection",
        fields: [
          { name: "pageParam", displayName: "Page Param", type: "string" },
          { name: "maxPages", displayName: "Max Pages", type: "number", default: 10 },
        ],
      },
    ],
    dirtyTriggers: ["params", "edges", "pin", "disabled"],
    edgeCases: [
      "Non-GET is side-effecting",
      "Retry only on 5xx/429, not 4xx",
      "Pagination: all page outputs link to origin item (fanOut)",
    ],
  },

  // ---- END ----
  result: {
    type: "result",
    version: 1,
    category: "Core",
    label: "Result",
    inputs: [mainIn()],
    outputs: [],
    cardinality: "N-to-0",
    pairedItemPolicy: "none",
    settings: SETTINGS_TERMINAL,
    capabilities: ["execute_step", "disable", "pin", "always_output", "notes"],
    isTerminal: true,
    params: [{ name: "mapFrom", displayName: "Map From", type: "string" }],
    dirtyTriggers: ["params"],
    edgeCases: [
      "Terminal — no output port, no + Add next step",
      "OUTPUT panel shows final run payload (mapFrom → output.result)",
      "Callable return uses incoming items at Result (__callableReturnItems), not mapFrom wrapper",
    ],
  },

  // ---- FLOW CONTROL ----
  wait: {
    type: "wait",
    version: 1,
    category: "Core",
    label: "Wait",
    inputs: [mainIn()],
    outputs: [mainOut],
    cardinality: "N-to-N",
    pairedItemPolicy: "identity1to1",
    pairedItemNotes: "Passthrough — Wait does not transform business data",
    settings: {
      disabled: true,
      onError: false,
      retries: false,
      timeoutMs: false,
      alwaysOutputData: false,
      executeOnce: false,
      notes: true,
    },
    capabilities: ["execute_step", "disable", "pin", "notes"],
    params: [],
    dirtyTriggers: ["params", "edges", "pin", "disabled"],
    edgeCases: [
      "Production TIME: suspends until resumeAt; survives backend restart",
      "Production MANUAL: waits until authorized Resume; no resumeAt timer",
      "Production EXTERNAL: waits for one-time opaque token (hash at rest)",
      "Editor Run Step: preview only — does not create durable waiting run or tokens",
    ],
  },

  executeWorkflow: {
    type: "executeWorkflow",
    version: 1,
    category: "Core",
    label: "Execute Workflow",
    inputs: [mainIn()],
    outputs: [mainOut],
    cardinality: "N-to-N",
    pairedItemPolicy: "none",
    settings: {
      disabled: true,
      onError: false,
      retries: false,
      timeoutMs: false,
      alwaysOutputData: false,
      executeOnce: false,
      notes: true,
    },
    capabilities: ["execute_step", "disable", "pin", "notes"],
    params: [
      {
        name: "workflowId",
        displayName: "Workflow",
        type: "string",
        required: true,
        customRenderer: "workflowPicker",
      },
    ],
    dirtyTriggers: ["params", "edges", "pin", "disabled"],
    edgeCases: [
      "Production: parent waits for child run (waitingReason child_run) until Result",
      "Editor Run Step / partial execution: not supported (EXECUTE_WORKFLOW_PARTIAL_UNSUPPORTED)",
      "Target must be callable: exactly one Workflow Trigger + one Result, reachable",
      "Cannot select the same workflow (no self-call)",
    ],
  },

  loop: {
    type: "loop",
    version: 1,
    category: "Logic",
    label: "Loop Over Items",
    inputs: [
      {
        id: "items",
        kind: "main",
        direction: "in",
        maxConnections: 1,
        required: true,
        label: "Items",
        description: "Initial items to loop over",
      },
      {
        id: "continue",
        kind: "main",
        direction: "in",
        maxConnections: 1,
        required: false,
        label: "Continue",
        description: "Connect the end of the loop body back here",
      },
    ],
    outputs: [
      {
        id: "batch",
        kind: "main",
        direction: "out",
        label: "Batch",
        description: "Items for the current iteration",
      },
      {
        id: "done",
        kind: "main",
        direction: "out",
        label: "Done",
        description: "Collected results after all iterations",
      },
    ],
    cardinality: "N-to-N",
    pairedItemPolicy: "identity1to1",
    pairedItemNotes:
      "Batch items retain original Items provenance; Done uses per-item continue occurrence sources",
    settings: {
      disabled: true,
      onError: false,
      retries: false,
      timeoutMs: false,
      alwaysOutputData: false,
      executeOnce: false,
      notes: true,
    },
    capabilities: ["disable", "notes"],
    params: [
      {
        name: "batchSize",
        displayName: "Batch size",
        type: "number",
        default: 1,
        min: 1,
        description:
          "How many items to process per iteration (integer ≥ 1). Topology: Items → Loop → Batch → body → Continue; Done → downstream.",
      },
    ],
    dirtyTriggers: ["params", "edges", "disabled"],
    edgeCases: [
      "V1: only sanctioned continue back-edges from batch body are valid cycles",
      "Nested Loop not supported in V1",
      "Wait inside Loop not supported",
      "Exactly one continue edge allowed",
      "Editor Run Step / Run To inside body unsupported — use Execute workflow or Run To downstream of Done",
    ],
  },

  // ---- PLACEHOLDERS ----
  noop: {
    type: "noop",
    version: 1,
    category: "Core",
    label: "No Operation",
    inputs: [mainIn()],
    outputs: [mainOut],
    cardinality: "N-to-N",
    pairedItemPolicy: "identity1to1",
    settings: { disabled: true, onError: false, retries: false, timeoutMs: false, alwaysOutputData: false, executeOnce: false, notes: true },
    capabilities: ["execute_step", "disable", "pin", "notes"],
    params: [],
    dirtyTriggers: ["edges", "pin", "disabled"],
    edgeCases: ["Reference passthrough node for pairedItem plumbing tests"],
  },

  integration: {
    type: "integration",
    version: 1,
    category: "Integrations",
    label: "Integration",
    inputs: [mainIn()],
    outputs: [mainOut],
    cardinality: "N-to-N",
    pairedItemPolicy: "identity1to1",
    settings: SETTINGS_ACTION,
    capabilities: ["notes"],
    params: [],
    dirtyTriggers: ["params", "edges"],
    edgeCases: ["Placeholder — 1:1 passthrough until specialized"],
  },

  // ---- AI ----
  ai: {
    type: "ai",
    version: 1,
    category: "AI",
    label: "AI",
    inputs: [mainIn()],
    outputs: [mainOut, errorOut],
    cardinality: "N-to-N",
    pairedItemPolicy: "identity1to1",
    settings: SETTINGS_ACTION,
    capabilities: CAP_ACTION,
    isSideEffecting: true,
    params: [
      { name: "model", displayName: "Model", type: "string" },
      { name: "prompt", displayName: "Prompt", type: "string" },
      { name: "temperature", displayName: "Temperature", type: "number", default: 0.7 },
      { name: "credentialId", displayName: "Credential", type: "credential" },
    ],
    dirtyTriggers: ["params", "edges", "pin", "disabled"],
    edgeCases: [
      "Non-deterministic — re-run yields different output; cache valid until param change",
      "Future: ai_languageModel typed sub-port on bot cluster",
    ],
  },

  bot: {
    type: "bot",
    version: 1,
    category: "AI",
    label: "AI Agent",
    inputs: [
      mainIn(),
      {
        id: "ai_languageModel",
        kind: "ai_languageModel",
        direction: "in",
        maxConnections: 1,
        required: true,
        label: "Chat Model",
      },
      {
        id: "ai_memory",
        kind: "ai_memory",
        direction: "in",
        maxConnections: 1,
        required: false,
        label: "Memory",
      },
      {
        id: "ai_tool",
        kind: "ai_tool",
        direction: "in",
        maxConnections: undefined,
        required: false,
        label: "Tool",
      },
    ],
    outputs: [mainOut, errorOut],
    cardinality: "N-to-N",
    pairedItemPolicy: "identity1to1",
    pairedItemNotes: "Sub-ports are config, not main item flow",
    settings: SETTINGS_ACTION,
    capabilities: CAP_ACTION,
    isSideEffecting: true,
    isStateful: true,
    stateScope: "node",
    params: [
      { name: "systemPrompt", displayName: "System Prompt", type: "string" },
      { name: "maxIterations", displayName: "Max Iterations", type: "number", default: 10 },
    ],
    dirtyTriggers: ["params", "edges", "pin", "disabled", "typedPorts"],
    edgeCases: [
      "Typed sub-port connections invalidate agent when model/memory/tool changes",
      "Memory is persistent across runs — not editor cache",
    ],
  },
};

// ---------------------------------------------------------------------------
// Query helpers — use these in inspector, engine, expression resolver
// ---------------------------------------------------------------------------

export const getNodeContract = (type: WorkflowNodeType): NodeContract =>
  NODE_CONTRACTS[type];

export const hasInputPanel = (type: WorkflowNodeType): boolean =>
  NODE_CONTRACTS[type].inputs.length > 0;

export const hasOutputPanel = (type: WorkflowNodeType): boolean =>
  NODE_CONTRACTS[type].outputs.length > 0 || Boolean(NODE_CONTRACTS[type].isTrigger);

export const isTriggerNode = (type: WorkflowNodeType): boolean =>
  Boolean(NODE_CONTRACTS[type].isTrigger);

export const getPairedItemPolicy = (type: WorkflowNodeType): PairedItemPolicy =>
  NODE_CONTRACTS[type].pairedItemPolicy;

export const getApplicableSettings = (type: WorkflowNodeType): NodeSettingsMatrix =>
  NODE_CONTRACTS[type].settings;

export const nodeSupportsCapability = (
  type: WorkflowNodeType,
  capability: NodeCapability
): boolean => NODE_CONTRACTS[type].capabilities.includes(capability);

export const getStaticOutputSchema = (
  type: WorkflowNodeType
): Record<string, string> | undefined => NODE_CONTRACTS[type].outputSchema;

export const getInputPortCount = (type: WorkflowNodeType): number =>
  NODE_CONTRACTS[type].inputs.filter((p) => p.direction === "in" && p.kind === "main").length;

export const getMainOutputHandles = (type: WorkflowNodeType): NodePortDef[] =>
  NODE_CONTRACTS[type].outputs.filter((p) => p.kind === "main" || p.kind === "true" || p.kind === "false");

/** Engine-level pairedItem auto-linking function names */
export const PAIRED_ITEM_LINKERS: Record<PairedItemPolicy, string> = {
  none: "noOp",
  identity1to1: "linkPositional",
  fanOut: "linkAllToSource",
  identityBySurvival: "linkByOriginalIndex",
  fanIn: "linkAllInputs",
  multiPort: "linkWithInputPort",
  routing: "linkRouted",
  manual: "requireExplicit",
};

/** Expression resolver error messages (match n8n semantics) */
export const EXPRESSION_ERRORS = {
  brokenThread: "Info for expression missing from previous node.",
  ambiguousThread: "Multiple matching items for expression.",
} as const;

// Apply canonical parameter schemas (Part 1 — schema-driven inspector).
// NODE_CONTRACTS literals may contain legacy inline params; they are always replaced here.
import {
  NODE_PARAMETER_SCHEMAS,
  NODE_PARAMETERS_PANEL,
  NODE_PLACEHOLDER_KIND,
} from "./nodeParameterSchemas";

for (const type of Object.keys(NODE_CONTRACTS) as WorkflowNodeType[]) {
  NODE_CONTRACTS[type].params = NODE_PARAMETER_SCHEMAS[type] ?? [];
  const panel = NODE_PARAMETERS_PANEL[type];
  if (panel) {
    NODE_CONTRACTS[type].parametersPanel = panel;
  }
  const placeholderKind = NODE_PLACEHOLDER_KIND[type];
  if (placeholderKind) {
    NODE_CONTRACTS[type].placeholderKind = placeholderKind;
  }
}
