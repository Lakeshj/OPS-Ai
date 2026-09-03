/**
 * Authoritative parameter definitions for all engine nodes.
 * Merged into NODE_CONTRACTS.params at module init (nodeContract.ts).
 *
 * Do NOT duplicate params, ports, settings, capabilities, or defaults in
 * NODE_CONTRACTS literals — those inline params are ignored after merge.
 * nodeRegistry.ts projects NODE_CONTRACTS; it is not a second definition system.
 */

import type { WorkflowNodeType } from "./types";
import { OPERATOR_LABELS } from "./types";
import type { ParamDescriptor } from "./nodeContract";

const operatorOptions = Object.entries(OPERATOR_LABELS).map(([value, name]) => ({
  name,
  value,
}));

const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"].map((m) => ({
  name: m,
  value: m,
}));

export const NODE_PARAMETER_SCHEMAS: Record<WorkflowNodeType, ParamDescriptor[]> =
  {
    trigger: [],

    schedule: [
      {
        name: "scheduleRules",
        displayName: "Trigger Rules",
        type: "fixedCollection",
        customRenderer: "scheduleRules",
        default: [],
      },
      {
        name: "timezone",
        displayName: "Timezone",
        type: "string",
        default: "UTC",
        placeholder: "UTC",
        expression: false,
      },
      {
        name: "cron",
        displayName: "Legacy cron",
        type: "hidden",
      },
    ],

    webhook: [
      { name: "webhookPath", displayName: "Path", type: "string", placeholder: "/hook" },
      {
        name: "method",
        displayName: "Method",
        type: "options",
        default: "POST",
        options: HTTP_METHODS,
      },
      {
        name: "responseMode",
        displayName: "Response mode",
        type: "options",
        default: "immediate",
        options: [
          { name: "Immediately", value: "immediate" },
          { name: "When last node finishes", value: "lastNode" },
          { name: "Respond node", value: "respondNode" },
        ],
      },
      {
        name: "credentialId",
        displayName: "Authentication",
        type: "credential",
        customRenderer: "credential",
      },
    ],

    ai: [
      {
        name: "provider",
        displayName: "Provider",
        type: "options",
        default: "openai",
        options: [
          { name: "OpenAI", value: "openai" },
          { name: "DeepSeek", value: "deepseek" },
          { name: "Gemini", value: "gemini" },
        ],
      },
      {
        name: "model",
        displayName: "Model",
        type: "string",
        placeholder: "gpt-4o-mini",
      },
      {
        name: "systemPrompt",
        displayName: "System prompt",
        type: "string",
        multiline: true,
        expression: true,
      },
      {
        name: "prompt",
        displayName: "User prompt",
        type: "string",
        multiline: true,
        default: "{{input}}",
        expression: true,
        required: true,
      },
      {
        name: "outputFormat",
        displayName: "Output format",
        type: "options",
        default: "text",
        options: [
          { name: "Text", value: "text" },
          { name: "JSON (structured)", value: "json" },
        ],
      },
      {
        name: "temperature",
        displayName: "Temperature",
        type: "number",
        default: 0.7,
        min: 0,
        max: 2,
      },
    ],

    bot: [
      {
        name: "assistantId",
        displayName: "Keyword Assistant",
        type: "string",
        customRenderer: "botAssistant",
        required: true,
      },
      {
        name: "systemPrompt",
        displayName: "Extra instructions",
        type: "string",
        multiline: true,
        expression: true,
      },
      {
        name: "prompt",
        displayName: "User prompt",
        type: "string",
        multiline: true,
        default: "{{input}}",
        expression: true,
        required: true,
      },
      {
        name: "outputFormat",
        displayName: "Output format",
        type: "options",
        default: "text",
        options: [
          { name: "Text", value: "text" },
          { name: "JSON (structured)", value: "json" },
        ],
      },
    ],

    http: [
      {
        name: "method",
        displayName: "Method",
        type: "options",
        default: "GET",
        options: HTTP_METHODS.filter((m) => m.value !== "PATCH"),
      },
      {
        name: "url",
        displayName: "URL",
        type: "string",
        required: true,
        expression: true,
        placeholder: "https://api.example.com/...",
      },
      {
        name: "body",
        displayName: "Body",
        type: "json",
        multiline: true,
        expression: true,
      },
      {
        name: "credentialId",
        displayName: "Authentication",
        type: "credential",
        customRenderer: "credential",
      },
      {
        name: "queryParams",
        displayName: "Query parameters",
        type: "fixedCollection",
        customRenderer: "queryParams",
        default: [],
        fields: [
          { name: "key", displayName: "Key", type: "string" },
          { name: "value", displayName: "Value", type: "string", expression: true },
        ],
      },
      {
        name: "pageParam",
        displayName: "Pagination",
        type: "string",
        customRenderer: "httpPagination",
      },
    ],

    condition: [
      {
        name: "left",
        displayName: "Left",
        type: "string",
        default: "{{input}}",
        expression: true,
        required: true,
      },
      {
        name: "operator",
        displayName: "Operator",
        type: "options",
        default: "equals",
        options: operatorOptions,
      },
      {
        name: "right",
        displayName: "Right",
        type: "string",
        expression: true,
        displayOptions: {
          hide: {
            operator: ["is_empty", "is_not_empty", "truthy"],
          },
        },
      },
    ],

    switch: [
      {
        name: "routingMode",
        displayName: "Routing",
        type: "options",
        default: "firstMatch",
        options: [
          { name: "First matching rule", value: "firstMatch" },
          { name: "All matching rules", value: "allMatches" },
        ],
      },
      {
        name: "rules",
        displayName: "Rules",
        type: "fixedCollection",
        default: [],
        fields: [
          {
            name: "label",
            displayName: "Label",
            type: "string",
            placeholder: "Rule 1",
          },
          {
            name: "left",
            displayName: "Value",
            type: "string",
            expression: true,
            default: "{{item}}",
          },
          {
            name: "operator",
            displayName: "Operator",
            type: "options",
            default: "equals",
            options: operatorOptions,
          },
          {
            name: "right",
            displayName: "Compare to",
            type: "string",
            expression: true,
            displayOptions: {
              hide: {
                operator: ["is_empty", "is_not_empty", "truthy"],
              },
            },
          },
        ],
      },
      {
        name: "enableFallback",
        displayName: "Enable fallback output",
        type: "boolean",
        default: true,
      },
    ],

    set: [
      {
        name: "mappings",
        displayName: "Fields to set",
        type: "fixedCollection",
        default: [],
        fields: [
          { name: "key", displayName: "Name", type: "string" },
          { name: "value", displayName: "Value", type: "string", expression: true },
        ],
      },
    ],

    splitOut: [
      {
        name: "fieldName",
        displayName: "Field to split (array)",
        type: "string",
        placeholder: "rows",
        expression: true,
      },
    ],

    filter: [
      {
        name: "fieldName",
        displayName: "Field",
        type: "string",
        placeholder: "clicks",
        expression: true,
      },
      {
        name: "operator",
        displayName: "Keep items where",
        type: "options",
        default: "is_not_empty",
        options: operatorOptions,
      },
      {
        name: "right",
        displayName: "Value",
        type: "string",
        expression: true,
        displayOptions: {
          hide: {
            operator: ["is_empty", "is_not_empty", "truthy"],
          },
        },
      },
    ],

    limit: [
      {
        name: "maxItems",
        displayName: "Max items",
        type: "number",
        default: 10,
        min: 1,
      },
      {
        name: "keep",
        displayName: "Keep",
        type: "options",
        default: "first",
        options: [
          { name: "First items", value: "first" },
          { name: "Last items", value: "last" },
        ],
      },
    ],

    sort: [
      {
        name: "fieldName",
        displayName: "Sort by field",
        type: "string",
        placeholder: "clicks",
        expression: true,
        required: true,
      },
      {
        name: "direction",
        displayName: "Direction",
        type: "options",
        default: "desc",
        options: [
          { name: "Descending (high to low)", value: "desc" },
          { name: "Ascending (low to high)", value: "asc" },
        ],
      },
    ],

    removeDuplicates: [
      {
        name: "fieldName",
        displayName: "Compare field (optional)",
        type: "string",
        placeholder: "page",
        expression: true,
      },
    ],

    aggregate: [
      {
        name: "operation",
        displayName: "Operation",
        type: "options",
        default: "count",
        options: [
          { name: "Count items", value: "count" },
          { name: "Sum", value: "sum" },
          { name: "Average", value: "avg" },
          { name: "Minimum", value: "min" },
          { name: "Maximum", value: "max" },
          { name: "Join into text", value: "concat" },
          { name: "Collect into a list", value: "list" },
        ],
      },
      {
        name: "fieldName",
        displayName: "Field",
        type: "string",
        expression: true,
        displayOptions: { hide: { operation: ["count"] } },
      },
      {
        name: "separator",
        displayName: "Separator",
        type: "string",
        default: ", ",
        displayOptions: { show: { operation: ["concat"] } },
      },
    ],

    merge: [
      {
        name: "mode",
        displayName: "Mode",
        type: "options",
        default: "append",
        options: [
          { name: "Append — all items from both inputs", value: "append" },
          { name: "Combine by Position", value: "combineByPosition" },
          { name: "Combine by Key", value: "combineByKey" },
          { name: "Combine — merge fields into one item (legacy)", value: "combine" },
        ],
      },
    ],

    code: [
      {
        name: "mode",
        displayName: "Mode",
        type: "options",
        default: "each",
        options: [
          { name: "Run once for all items", value: "all" },
          { name: "Run once for each item", value: "each" },
        ],
      },
      {
        name: "code",
        displayName: "JavaScript",
        type: "code",
        required: true,
        default:
          "// items = incoming rows, input = run input, steps = earlier outputs\nreturn items;",
      },
    ],

    document: [
      {
        name: "documentId",
        displayName: "Document",
        type: "string",
        customRenderer: "documentPicker",
        required: true,
      },
    ],

    spreadsheet: [
      {
        name: "documentId",
        displayName: "Spreadsheet file",
        type: "string",
        customRenderer: "spreadsheetPicker",
        required: true,
      },
      {
        name: "sheetName",
        displayName: "Sheet name",
        type: "string",
        placeholder: "Sheet1",
      },
      {
        name: "hasHeader",
        displayName: "First row is header",
        type: "boolean",
        default: true,
      },
      {
        name: "rowLimit",
        displayName: "Row limit",
        type: "number",
        min: 1,
      },
    ],

    email: [
      {
        name: "to",
        displayName: "To",
        type: "string",
        required: true,
        expression: true,
      },
      {
        name: "subject",
        displayName: "Subject",
        type: "string",
        required: true,
        expression: true,
      },
      {
        name: "emailBody",
        displayName: "Body",
        type: "string",
        multiline: true,
        expression: true,
        required: true,
      },
    ],

    result: [
      {
        name: "mapFrom",
        displayName: "Map from",
        type: "string",
        default: "{{input}}",
        expression: true,
      },
    ],

    wait: [
      {
        name: "resumeMode",
        displayName: "Resume mode",
        type: "options",
        default: "time",
        options: [
          { name: "Time", value: "time" },
          { name: "Manual", value: "manual" },
          { name: "External", value: "external" },
        ],
        description:
          "Time: wait until duration/datetime. Manual: authorized Resume. External: secure one-time token.",
      },
      {
        name: "waitAmount",
        displayName: "Wait for",
        type: "number",
        default: 5,
        min: 0,
        displayOptions: { show: { resumeMode: ["time"] } },
      },
      {
        name: "waitUnit",
        displayName: "Unit",
        type: "options",
        default: "minutes",
        options: [
          { name: "Seconds", value: "seconds" },
          { name: "Minutes", value: "minutes" },
          { name: "Hours", value: "hours" },
          { name: "Days", value: "days" },
        ],
        displayOptions: { show: { resumeMode: ["time"] } },
      },
      {
        name: "waitUntil",
        displayName: "Or wait until (ISO datetime)",
        type: "string",
        placeholder: "2026-09-02T15:00:00.000Z",
        description: "If set, overrides duration and waits until this absolute time.",
        displayOptions: { show: { resumeMode: ["time"] } },
      },
    ],

    loop: [
      {
        name: "batchSize",
        displayName: "Batch size",
        type: "number",
        default: 1,
        min: 1,
        description: "Items per iteration (Loop runtime ships in Part 9B).",
      },
    ],

    noop: [],

    integration: [],
  };

export const NODE_PARAMETERS_PANEL: Partial<
  Record<WorkflowNodeType, "standard" | "trigger" | "bot" | "placeholder">
> = {
  trigger: "trigger",
  schedule: "trigger",
  webhook: "trigger",
  integration: "placeholder",
  noop: "placeholder",
};

/** Contract-driven placeholder copy (avoids node-type switches in NodeInspector). */
export const NODE_PLACEHOLDER_KIND: Partial<
  Record<WorkflowNodeType, "stub" | "passthrough">
> = {
  integration: "stub",
  noop: "passthrough",
};
