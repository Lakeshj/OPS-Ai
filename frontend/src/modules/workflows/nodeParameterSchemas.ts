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
          { name: "Using Respond to Webhook node", value: "respondNode" },
        ],
      },
      {
        name: "credentialId",
        displayName: "Authentication",
        type: "credential",
        customRenderer: "credential",
      },
    ],

    respondToWebhook: [
      {
        name: "statusCode",
        displayName: "Status code",
        type: "number",
        default: 200,
      },
      {
        name: "responseType",
        displayName: "Response type",
        type: "options",
        default: "json",
        options: [
          { name: "JSON", value: "json" },
          { name: "Text", value: "text" },
        ],
      },
      {
        name: "body",
        displayName: "Response body",
        type: "json",
        multiline: true,
        expression: true,
        default: '{\n  "ok": true\n}',
      },
      {
        name: "responseHeaders",
        displayName: "Headers",
        type: "fixedCollection",
        customRenderer: "queryParams",
        default: [],
        fields: [
          { name: "key", displayName: "Key", type: "string" },
          { name: "value", displayName: "Value", type: "string", expression: true },
        ],
      },
    ],

    workflowTrigger: [],

    errorTrigger: [],

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
        name: "httpAuth",
        displayName: "Authentication",
        type: "options",
        customRenderer: "httpAuth",
        default: "none",
      },
      {
        name: "httpAuthMode",
        displayName: "Authentication mode",
        type: "hidden",
        default: "none",
      },
      {
        name: "predefinedConnectionType",
        displayName: "Connection type",
        type: "hidden",
      },
      {
        name: "genericAuthType",
        displayName: "Authentication type",
        type: "hidden",
      },
      {
        name: "credentialId",
        displayName: "Connection",
        type: "hidden",
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

    executeWorkflow: [
      {
        name: "workflowId",
        displayName: "Workflow",
        type: "string",
        required: true,
        customRenderer: "workflowPicker",
      },
    ],

    loop: [
      {
        name: "batchSize",
        displayName: "Batch size",
        type: "number",
        default: 1,
        min: 1,
        description:
          "How many items to process per iteration (integer ≥ 1). Connect body output back to Continue.",
      },
    ],

    noop: [],

    integration: [],

    migrationUnsupported: [
      {
        name: "migrationReason",
        displayName: "Migration reason",
        type: "string",
      },
      {
        name: "sourceNodeType",
        displayName: "Source node type",
        type: "string",
      },
    ],

    aiModelProviderTest: [
      {
        name: "temperature",
        displayName: "Temperature",
        type: "number",
        default: 0.2,
      },
    ],
    aiToolProviderTest: [
      {
        name: "name",
        displayName: "Name",
        type: "string",
        default: "tool",
      },
    ],
    aiMemoryProviderTest: [
      {
        name: "sessionKey",
        displayName: "Session Key",
        type: "string",
      },
    ],
    aiAgentTest: [],

    aiAgent: [
      {
        name: "prompt",
        displayName: "Prompt",
        type: "string",
        expression: true,
        multiline: true,
        default: "{{item}}",
        description: "Resolved per input item via OpsAi expressions.",
      },
      {
        name: "systemInstruction",
        displayName: "System instruction",
        type: "string",
        expression: true,
        multiline: true,
        description: "Instructions that guide the Agent's behavior.",
      },
    ],

    aiChatModel: [
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
      { name: "model", displayName: "Model", type: "string", default: "gpt-4o-mini" },
      {
        name: "temperature",
        displayName: "Temperature",
        type: "number",
        default: 0.4,
      },
      {
        name: "maxTokens",
        displayName: "Max tokens",
        type: "number",
        default: 1200,
      },
    ],

    aiCalculatorTool: [
      {
        name: "toolNameNotice",
        displayName: "Tool name",
        type: "notice",
        description: "Tool name: calculator (fixed for this tool).",
      },
      {
        name: "toolName",
        displayName: "Tool name",
        type: "hidden",
        default: "calculator",
      },
      {
        name: "description",
        displayName: "Description",
        type: "string",
        default: "Add, subtract, multiply, or divide two numbers.",
      },
    ],

    aiHttpTool: [
      {
        name: "toolName",
        displayName: "Tool name",
        type: "string",
        required: true,
        default: "http_tool",
        placeholder: "lookup_customer",
        description: "Stable model-facing name (letters, numbers, underscore).",
      },
      {
        name: "description",
        displayName: "Description",
        type: "string",
        multiline: true,
        default: "Call a configured HTTP API.",
        description: "Tells the model when to use this tool.",
      },
      {
        name: "method",
        displayName: "Method",
        type: "options",
        default: "GET",
        options: HTTP_METHODS,
      },
      {
        name: "url",
        displayName: "URL",
        type: "string",
        required: true,
        placeholder: "https://api.example.com/customers/{{tool.id}}",
        description:
          "Author-configured URL. Use {{tool.argName}} for tool arguments only (not {{input}} / {{steps.*}}).",
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
          {
            name: "value",
            displayName: "Value",
            type: "string",
            placeholder: "{{tool.id}}",
          },
        ],
      },
      {
        name: "headers",
        displayName: "Headers",
        type: "fixedCollection",
        customRenderer: "queryParams",
        default: [],
        fields: [
          { name: "key", displayName: "Key", type: "string" },
          { name: "value", displayName: "Value", type: "string" },
        ],
      },
      {
        name: "body",
        displayName: "Body",
        type: "json",
        multiline: true,
        placeholder: '{"id":"{{tool.id}}"}',
      },
      {
        name: "inputSchema",
        displayName: "Input schema",
        type: "json",
        multiline: true,
        default:
          '{\n  "type": "object",\n  "properties": {\n    "id": { "type": "string" }\n  },\n  "required": ["id"]\n}',
        description: "Provider-independent JSON Schema (type: object).",
      },
      {
        name: "timeoutMs",
        displayName: "Timeout (ms)",
        type: "number",
        default: 30000,
      },
      {
        name: "toolArgNotice",
        displayName: "Tool arguments",
        type: "notice",
        description:
          "Map tool-call args with {{tool.field}}. Method, URL host, and credentials are fixed by this node — the model cannot override them.",
      },
    ],

    googleSearchConsole: [
      {
        name: "credentialId",
        displayName: "Google Search Console Account",
        type: "credential",
        customRenderer: "credential",
        required: true,
        credentialTypes: ["google_gsc"],
      },
      {
        name: "siteUrl",
        displayName: "Site / Property",
        type: "string",
        required: true,
        expression: true,
        customRenderer: "resourceLocator",
        locatorKind: "gscSites",
        locatorModes: ["account", "manual", "expression"],
        locatorModeField: "siteUrlMode",
        placeholder: "https://example.com/ or sc-domain:example.com",
      },
      {
        name: "operation",
        displayName: "Operation",
        type: "options",
        default: "getQueries",
        options: [
          { name: "Get Queries", value: "getQueries" },
          { name: "Get Pages", value: "getPages" },
        ],
      },
      {
        name: "dateRange",
        displayName: "Date range",
        type: "options",
        default: "last7days",
        options: [
          { name: "Today", value: "today" },
          { name: "Yesterday", value: "yesterday" },
          { name: "Last 7 days", value: "last7days" },
          { name: "Last 28 days", value: "last28days" },
          { name: "Last 30 days", value: "last30days" },
          { name: "Custom", value: "custom" },
        ],
      },
      {
        name: "startDate",
        displayName: "Start date",
        type: "string",
        expression: true,
        placeholder: "YYYY-MM-DD",
        displayOptions: { show: { dateRange: ["custom"] } },
      },
      {
        name: "endDate",
        displayName: "End date",
        type: "string",
        expression: true,
        placeholder: "YYYY-MM-DD",
        displayOptions: { show: { dateRange: ["custom"] } },
      },
      {
        name: "rowLimit",
        displayName: "Row limit",
        type: "number",
        default: 1000,
        max: 5000,
      },
      {
        name: "searchType",
        displayName: "Search type",
        type: "options",
        default: "web",
        options: [
          { name: "Web", value: "web" },
          { name: "Image", value: "image" },
          { name: "Video", value: "video" },
          { name: "News", value: "news" },
        ],
      },
      {
        name: "dataState",
        displayName: "Data state",
        type: "options",
        default: "final",
        options: [
          { name: "Final", value: "final" },
          { name: "All", value: "all" },
        ],
      },
    ],

    googleAnalytics: [
      {
        name: "credentialId",
        displayName: "Google Analytics Account",
        type: "credential",
        customRenderer: "credential",
        required: true,
        credentialTypes: ["google_ga4"],
      },
      {
        name: "propertyId",
        displayName: "Property",
        type: "string",
        required: true,
        expression: true,
        customRenderer: "resourceLocator",
        locatorKind: "ga4Properties",
        locatorModes: ["account", "manual", "expression"],
        locatorModeField: "propertyIdMode",
        locatorLabelField: "propertyDisplayName",
        placeholder: "123456789",
      },
      {
        name: "resource",
        displayName: "Resource",
        type: "options",
        default: "report",
        options: [{ name: "Report", value: "report" }],
      },
      {
        name: "operation",
        displayName: "Operation",
        type: "options",
        default: "get",
        options: [{ name: "Get", value: "get" }],
      },
      {
        name: "dateRange",
        displayName: "Date range",
        type: "options",
        default: "last7days",
        options: [
          { name: "Today", value: "today" },
          { name: "Yesterday", value: "yesterday" },
          { name: "Last 7 days", value: "last7days" },
          { name: "Last 28 days", value: "last28days" },
          { name: "Last 30 days", value: "last30days" },
          { name: "Last calendar week", value: "lastCalendarWeek" },
          { name: "Last calendar month", value: "lastCalendarMonth" },
          { name: "Custom", value: "custom" },
        ],
      },
      {
        name: "startDate",
        displayName: "Start date",
        type: "string",
        expression: true,
        displayOptions: { show: { dateRange: ["custom"] } },
      },
      {
        name: "endDate",
        displayName: "End date",
        type: "string",
        expression: true,
        displayOptions: { show: { dateRange: ["custom"] } },
      },
      {
        name: "metrics",
        displayName: "Metrics",
        type: "multiOptions",
        default: ["sessions", "totalUsers"],
        options: [
          { name: "Sessions", value: "sessions" },
          { name: "Total users", value: "totalUsers" },
          { name: "New users", value: "newUsers" },
          { name: "Active users", value: "activeUsers" },
          { name: "Views", value: "screenPageViews" },
          { name: "Event count", value: "eventCount" },
          { name: "Engagement duration", value: "userEngagementDuration" },
          { name: "Engagement rate", value: "engagementRate" },
        ],
      },
      {
        name: "dimensions",
        displayName: "Dimensions",
        type: "multiOptions",
        options: [
          { name: "Date", value: "date" },
          { name: "Country", value: "country" },
          { name: "City", value: "city" },
          { name: "Device", value: "deviceCategory" },
          { name: "Browser", value: "browser" },
          { name: "Source", value: "sessionSource" },
          { name: "Medium", value: "sessionMedium" },
          { name: "Source / medium", value: "sessionSourceMedium" },
          { name: "Page location", value: "pageLocation" },
          { name: "Page path", value: "pagePath" },
          { name: "Landing page", value: "landingPage" },
          { name: "Campaign", value: "sessionCampaignName" },
          { name: "Language", value: "language" },
        ],
      },
      {
        name: "limit",
        displayName: "Limit",
        type: "number",
        default: 100,
        displayOptions: { hide: { returnAll: [true] } },
      },
      {
        name: "returnAll",
        displayName: "Return all (bounded)",
        type: "boolean",
        default: false,
      },
      {
        name: "orderByField",
        displayName: "Order by",
        type: "string",
        placeholder: "sessions",
      },
      {
        name: "orderDirection",
        displayName: "Order direction",
        type: "options",
        default: "descending",
        options: [
          { name: "Descending", value: "descending" },
          { name: "Ascending", value: "ascending" },
        ],
      },
      {
        name: "dimensionFilter",
        displayName: "Dimension filter",
        type: "json",
        description: "Structured filter: { field, operator, value } — equals, contains, beginsWith, inList",
      },
      {
        name: "metricFilter",
        displayName: "Metric filter",
        type: "json",
        description: "Structured filter: { field, operator, value } — equals, gt, lt, between",
      },
    ],

    gmail: [
      {
        name: "credentialId",
        displayName: "Gmail Account",
        type: "credential",
        customRenderer: "credential",
        required: true,
        credentialTypes: ["google_gmail"],
      },
      {
        name: "resource",
        displayName: "Resource",
        type: "options",
        default: "message",
        options: [
          { name: "Message", value: "message" },
          { name: "Draft", value: "draft" },
          { name: "Label", value: "label" },
          { name: "Thread", value: "thread" },
        ],
      },
      {
        name: "operation",
        displayName: "Operation",
        type: "options",
        default: "send",
        options: [
          { name: "Send", value: "send", displayOptions: { show: { resource: ["message"] } } },
          { name: "Reply", value: "reply", displayOptions: { show: { resource: ["message", "thread"] } } },
          { name: "Get", value: "get", displayOptions: { show: { resource: ["message", "draft", "thread"] } } },
          { name: "Get All", value: "getAll", displayOptions: { show: { resource: ["message", "draft", "label", "thread"] } } },
          { name: "Delete", value: "delete", displayOptions: { show: { resource: ["message", "draft"] } } },
          { name: "Mark Read", value: "markRead", displayOptions: { show: { resource: ["message"] } } },
          { name: "Mark Unread", value: "markUnread", displayOptions: { show: { resource: ["message"] } } },
          { name: "Add Labels", value: "addLabels", displayOptions: { show: { resource: ["message", "thread"] } } },
          { name: "Remove Labels", value: "removeLabels", displayOptions: { show: { resource: ["message", "thread"] } } },
          { name: "Create", value: "create", displayOptions: { show: { resource: ["draft", "label"] } } },
          { name: "Trash", value: "trash", displayOptions: { show: { resource: ["thread"] } } },
          { name: "Untrash", value: "untrash", displayOptions: { show: { resource: ["thread"] } } },
        ],
      },
      {
        name: "to",
        displayName: "To",
        type: "string",
        expression: true,
        displayOptions: {
          show: { resource: ["message", "draft"], operation: ["send", "reply", "create"] },
        },
      },
      {
        name: "subject",
        displayName: "Subject",
        type: "string",
        expression: true,
        displayOptions: {
          show: { resource: ["message", "draft"], operation: ["send", "reply", "create"] },
        },
      },
      {
        name: "emailType",
        displayName: "Email type",
        type: "options",
        default: "text",
        options: [
          { name: "Text", value: "text" },
          { name: "HTML", value: "html" },
        ],
        displayOptions: { show: { resource: ["message"], operation: ["send", "reply"] } },
      },
      {
        name: "message",
        displayName: "Message",
        type: "string",
        multiline: true,
        expression: true,
        displayOptions: {
          show: { resource: ["message", "draft"], operation: ["send", "reply", "create"] },
        },
      },
      {
        name: "cc",
        displayName: "CC",
        type: "string",
        expression: true,
        displayOptions: { show: { resource: ["message"], operation: ["send"] } },
      },
      {
        name: "bcc",
        displayName: "BCC",
        type: "string",
        expression: true,
        displayOptions: { show: { resource: ["message"], operation: ["send"] } },
      },
      {
        name: "replyTo",
        displayName: "Reply To",
        type: "string",
        expression: true,
        displayOptions: { show: { resource: ["message"], operation: ["send"] } },
      },
      {
        name: "binaryProperty",
        displayName: "Attachment binary",
        type: "string",
        default: "data",
        displayOptions: { show: { resource: ["message"], operation: ["send"] } },
      },
      {
        name: "limit",
        displayName: "Limit",
        type: "number",
        default: 10,
        displayOptions: { show: { operation: ["getAll"] } },
      },
      {
        name: "returnAll",
        displayName: "Return all (bounded)",
        type: "boolean",
        default: false,
        displayOptions: { show: { operation: ["getAll"] } },
      },
      {
        name: "messageId",
        displayName: "Message ID",
        type: "string",
        expression: true,
        displayOptions: {
          show: {
            resource: ["message"],
            operation: ["reply", "get", "delete", "markRead", "markUnread", "addLabels", "removeLabels"],
          },
        },
      },
      {
        name: "threadId",
        displayName: "Thread ID",
        type: "string",
        expression: true,
        displayOptions: {
          show: {
            resource: ["thread"],
            operation: ["get", "reply", "trash", "untrash", "addLabels", "removeLabels"],
          },
        },
      },
      {
        name: "labelIds",
        displayName: "Labels",
        type: "string",
        expression: true,
        customRenderer: "resourceLocator",
        locatorKind: "gmailLabels",
        locatorModes: ["account", "manual", "expression"],
        locatorModeField: "labelIdsMode",
        locatorMulti: true,
        displayOptions: {
          show: {
            resource: ["message", "thread"],
            operation: ["addLabels", "removeLabels"],
          },
        },
      },
      {
        name: "senderName",
        displayName: "Sender name",
        type: "string",
        expression: true,
        displayOptions: { show: { resource: ["message"], operation: ["send"] } },
      },
      {
        name: "draftId",
        displayName: "Draft ID",
        type: "string",
        expression: true,
        displayOptions: {
          show: { resource: ["draft"], operation: ["get", "delete"] },
        },
      },
      {
        name: "labelName",
        displayName: "Label name",
        type: "string",
        expression: true,
        displayOptions: { show: { resource: ["label"], operation: ["create"] } },
      },
    ],

    gmailTrigger: [
      {
        name: "credentialId",
        displayName: "Gmail Account",
        type: "credential",
        customRenderer: "credential",
        required: true,
        credentialTypes: ["google_gmail"],
      },
      {
        name: "pollIntervalMs",
        displayName: "Poll interval (ms)",
        type: "number",
        default: 300000,
        min: 60000,
      },
      {
        name: "unreadOnly",
        displayName: "Unread only",
        type: "boolean",
        default: true,
      },
      { name: "gmailLabel", displayName: "Gmail label", type: "string", customRenderer: "resourceLocator", locatorKind: "gmailLabels", locatorModes: ["account", "manual", "expression"], locatorModeField: "gmailLabelMode" },
      { name: "from", displayName: "From", type: "string", expression: true },
      { name: "to", displayName: "To", type: "string", expression: true },
      { name: "subject", displayName: "Subject", type: "string", expression: true },
      { name: "query", displayName: "Gmail query", type: "string", expression: true },
    ],

    googleSheets: [
      {
        name: "credentialId",
        displayName: "Google Sheets Account",
        type: "credential",
        customRenderer: "credential",
        required: true,
        credentialTypes: ["google_sheets"],
      },
      {
        name: "operation",
        displayName: "Operation",
        type: "options",
        default: "readRows",
        options: [
          { name: "Get spreadsheet", value: "getSpreadsheet" },
          { name: "Read rows", value: "readRows" },
          { name: "Append rows", value: "appendRows" },
          { name: "Update rows", value: "updateRows" },
          { name: "Clear range", value: "clearRange" },
          { name: "Create spreadsheet", value: "createSpreadsheet" },
          { name: "Add sheet", value: "addSheet" },
        ],
      },
      {
        name: "spreadsheetId",
        displayName: "Spreadsheet",
        type: "string",
        required: true,
        expression: true,
        customRenderer: "resourceLocator",
        locatorKind: "spreadsheetId",
        locatorModes: ["manual", "expression"],
        locatorModeField: "spreadsheetIdMode",
        placeholder: "Spreadsheet ID or https://docs.google.com/spreadsheets/d/…",
        displayOptions: { hide: { operation: ["createSpreadsheet"] } },
      },
      {
        name: "sheetName",
        displayName: "Sheet / Tab",
        type: "string",
        expression: true,
        customRenderer: "resourceLocator",
        locatorKind: "sheetTabs",
        locatorModes: ["account", "manual", "expression"],
        locatorModeField: "sheetNameMode",
      },
      {
        name: "range",
        displayName: "Range",
        type: "string",
        default: "A:Z",
        expression: true,
        displayOptions: {
          show: { operation: ["readRows", "appendRows", "updateRows", "clearRange"] },
        },
      },
      {
        name: "hasHeaderRow",
        displayName: "Header row",
        type: "boolean",
        default: true,
      },
      {
        name: "valueInputMode",
        displayName: "Value input",
        type: "options",
        default: "USER_ENTERED",
        options: [
          { name: "USER_ENTERED", value: "USER_ENTERED" },
          { name: "RAW", value: "RAW" },
        ],
        displayOptions: { show: { operation: ["appendRows", "updateRows"] } },
      },
    ],

    aiGenerate: [
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
        required: true,
        expression: true,
        customRenderer: "resourceLocator",
        locatorKind: "aiModels",
        locatorModes: ["account", "manual", "expression"],
        locatorModeField: "modelMode",
      },
      {
        name: "systemPrompt",
        displayName: "System instructions",
        type: "string",
        multiline: true,
        expression: true,
      },
      {
        name: "prompt",
        displayName: "Prompt",
        type: "string",
        multiline: true,
        expression: true,
        required: true,
        default: "{{input}}",
      },
      {
        name: "temperature",
        displayName: "Temperature",
        type: "number",
        default: 0.4,
      },
      {
        name: "maxTokens",
        displayName: "Max output tokens",
        type: "number",
        default: 1200,
      },
      {
        name: "outputFormat",
        displayName: "Response format",
        type: "options",
        default: "text",
        options: [
          { name: "Text", value: "text" },
          { name: "JSON", value: "json" },
        ],
      },
    ],

    xlsxBuilder: [
      {
        name: "fileName",
        displayName: "File name",
        type: "string",
        default: "report.xlsx",
        expression: true,
      },
      {
        name: "binaryProperty",
        displayName: "Binary property",
        type: "string",
        default: "data",
      },
      {
        name: "sheets",
        displayName: "Sheets",
        type: "json",
        multiline: true,
        default: '[{"name":"Sheet1","headerRow":true}]',
        description: "Each sheet: name, headerRow, field/rowsField (array on input), optional columnOrder.",
      },
    ],
  };

export const NODE_PARAMETERS_PANEL: Partial<
  Record<WorkflowNodeType, "standard" | "trigger" | "bot" | "placeholder">
> = {
  trigger: "trigger",
  schedule: "trigger",
  webhook: "trigger",
  workflowTrigger: "trigger",
  errorTrigger: "trigger",
  gmailTrigger: "trigger",
  integration: "placeholder",
  noop: "placeholder",
  migrationUnsupported: "placeholder",
  aiModelProviderTest: "placeholder",
  aiToolProviderTest: "placeholder",
  aiMemoryProviderTest: "placeholder",
  aiAgentTest: "placeholder",
};

/** Contract-driven placeholder copy (avoids node-type switches in NodeInspector). */
export const NODE_PLACEHOLDER_KIND: Partial<
  Record<WorkflowNodeType, "stub" | "passthrough">
> = {
  integration: "stub",
  noop: "passthrough",
  migrationUnsupported: "stub",
  aiModelProviderTest: "stub",
  aiToolProviderTest: "stub",
  aiMemoryProviderTest: "stub",
  aiAgentTest: "stub",
};
