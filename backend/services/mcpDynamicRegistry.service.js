/**
 * Shared dynamic MCP tool registry.
 * Describes provider tools and delegates execution to an existing provider
 * executor. Does not store OAuth tokens or implement Google OAuth itself.
 *
 * Google Ads is a known provider with no tools yet.
 * GA4 candidates without a real executor stay implemented: false.
 */
const AppError = require("../utils/AppError");

const PROVIDERS = Object.freeze({
  google_analytics: {
    displayName: "Google Analytics",
    authType: "google_ga4",
    credentialType: "google_ga4",
  },
  google_search_console: {
    displayName: "Google Search Console",
    authType: "google_gsc",
    credentialType: "google_gsc",
  },
  google_ads: {
    displayName: "Google Ads",
    authType: "google_ads",
    credentialType: "google_ads",
  },
});

const SUPPORTED_FIELD_TYPES = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "date",
  "dateRange",
  "array",
  "enum",
]);

const SECRET_KEY_RE =
  /(access[_-]?token|refresh[_-]?token|client[_-]?secret|developer[_-]?token|api[_-]?key|^password$|^authorization$|^secret$|^token$)/i;

const SECRET_VALUE_RE = /ya29\.[A-Za-z0-9_\-]+|GOCSPX-[A-Za-z0-9_\-]+|Bearer\s+\S+/gi;

const objectSchema = (properties, required = []) => ({
  type: "object",
  properties,
  required,
});

const unavailableOutput = {
  type: "object",
  description:
    "No executor is registered. This tool does not produce WorkflowItems yet.",
  properties: {},
};

const ga4 = (tool) => ({
  provider: "google_analytics",
  authType: "google_ga4",
  access: "read",
  risk: "low",
  implemented: false,
  category: "reporting",
  outputSchema: unavailableOutput,
  ...tool,
});

const TOOLS = [
  ga4({
    id: "run_realtime_report",
    displayName: "Run Realtime Report",
    description:
      "GA4 realtime report. Registered only — OpsAi has no realtime executor yet.",
    inputSchema: objectSchema(
      {
        propertyId: {
          type: "string",
          title: "Property ID",
          description: "GA4 property id (numbers only).",
        },
        minutes: {
          type: "number",
          title: "Minutes",
          description: "Lookback window in minutes (1–29).",
          minimum: 1,
          maximum: 29,
        },
        dimension: {
          type: "string",
          title: "Dimension",
          description: "Optional realtime dimension.",
          enum: ["country", "city", "unifiedScreenName"],
        },
        returnPropertyQuota: {
          type: "boolean",
          title: "Return property quota",
          description: "Include property quota in the realtime response when execution exists.",
        },
      },
      ["propertyId"]
    ),
  }),
  ga4({
    id: "run_funnel_report",
    displayName: "Run Funnel Report",
    description:
      "GA4 funnel report. Registered only — OpsAi has no funnel executor yet.",
    inputSchema: objectSchema(
      {
        propertyId: {
          type: "string",
          title: "Property ID",
          description: "GA4 property id (numbers only).",
        },
        dateRange: {
          type: "dateRange",
          title: "Date range",
          description: "Funnel window.",
        },
        steps: {
          type: "array",
          title: "Steps",
          description: "Funnel step event names, one per line.",
          items: { type: "string" },
        },
      },
      ["propertyId", "dateRange"]
    ),
  }),
  ga4({
    id: "run_pivot_report",
    displayName: "Run Pivot Report",
    description: "GA4 pivot report. Registry-ready; execution is not available yet.",
    inputSchema: objectSchema(
      {
        propertyId: {
          type: "string",
          title: "Property ID",
          description: "GA4 property id (numbers only).",
        },
        startDate: {
          type: "date",
          title: "Start date",
          description: "Range start (YYYY-MM-DD).",
        },
        endDate: {
          type: "date",
          title: "End date",
          description: "Range end (YYYY-MM-DD).",
        },
      },
      ["propertyId", "startDate", "endDate"]
    ),
  }),
  ga4({
    id: "run_batch_reports",
    displayName: "Run Batch Reports",
    description: "GA4 batch reports. Registry-ready; execution is not available yet.",
    inputSchema: objectSchema(
      {
        propertyId: {
          type: "string",
          title: "Property ID",
          description: "GA4 property id (numbers only).",
        },
        requests: {
          type: "array",
          title: "Requests",
          description: "Report request labels. Execution is not available yet.",
          items: { type: "string" },
        },
      },
      ["propertyId"]
    ),
  }),
  ga4({
    id: "run_attribution_report",
    displayName: "Run Attribution Report",
    description:
      "GA4 attribution report. Registry-ready; execution is not available yet.",
    inputSchema: objectSchema(
      {
        propertyId: {
          type: "string",
          title: "Property ID",
          description: "GA4 property id (numbers only).",
        },
        dateRange: {
          type: "dateRange",
          title: "Date range",
          description: "Attribution window.",
        },
      },
      ["propertyId", "dateRange"]
    ),
  }),
  ga4({
    id: "compare_attribution_models",
    displayName: "Compare Attribution Models",
    description:
      "Compare GA4 attribution models. Registry-ready; execution is not available yet.",
    inputSchema: objectSchema(
      {
        propertyId: {
          type: "string",
          title: "Property ID",
          description: "GA4 property id (numbers only).",
        },
        dateRange: {
          type: "dateRange",
          title: "Date range",
          description: "Comparison window.",
        },
      },
      ["propertyId", "dateRange"]
    ),
  }),
  ga4({
    id: "list_audiences",
    displayName: "List Audiences",
    description: "List GA4 audiences. Registry-ready; execution is not available yet.",
    category: "configuration",
    inputSchema: objectSchema(
      {
        propertyId: {
          type: "string",
          title: "Property ID",
          description: "GA4 property id (numbers only).",
        },
      },
      ["propertyId"]
    ),
  }),
  ga4({
    id: "run_predictive_analysis",
    displayName: "Run Predictive Analysis",
    description:
      "GA4 predictive analysis. Registry-ready, medium risk, and not shown in the dynamic dropdown.",
    risk: "medium",
    inputSchema: objectSchema(
      {
        propertyId: {
          type: "string",
          title: "Property ID",
          description: "GA4 property id (numbers only).",
        },
      },
      ["propertyId"]
    ),
  }),
  ga4({
    id: "list_custom_dimensions",
    displayName: "List Custom Dimensions",
    description:
      "List GA4 custom dimensions. Registry-ready; execution is not available yet.",
    category: "configuration",
    inputSchema: objectSchema(
      {
        propertyId: {
          type: "string",
          title: "Property ID",
          description: "GA4 property id (numbers only).",
        },
      },
      ["propertyId"]
    ),
  }),
  ga4({
    id: "list_custom_metrics",
    displayName: "List Custom Metrics",
    description:
      "List GA4 custom metrics. Registry-ready; execution is not available yet.",
    category: "configuration",
    inputSchema: objectSchema(
      {
        propertyId: {
          type: "string",
          title: "Property ID",
          description: "GA4 property id (numbers only).",
        },
      },
      ["propertyId"]
    ),
  }),
  ga4({
    id: "list_conversion_events",
    displayName: "List Conversion Events",
    description:
      "List GA4 conversion events. Registry-ready; execution is not available yet.",
    category: "configuration",
    inputSchema: objectSchema(
      {
        propertyId: {
          type: "string",
          title: "Property ID",
          description: "GA4 property id (numbers only).",
        },
      },
      ["propertyId"]
    ),
  }),
  {
    provider: "google_search_console",
    id: "inspect_url_enhanced",
    displayName: "Inspect URL",
    description:
      "Detailed crawl and index status for a URL. Uses the existing GSC MCP executor.",
    category: "inspection",
    authType: "google_gsc",
    access: "read",
    risk: "low",
    implemented: true,
    executor: "gsc_mcp_host",
    inputSchema: objectSchema(
      {
        siteUrl: {
          type: "string",
          title: "Site URL",
          description: "Search Console property, such as sc-domain:example.com or https://example.com/.",
        },
        inspectionUrl: {
          type: "string",
          title: "Inspection URL",
          description: "Fully qualified URL to inspect.",
        },
        languageCode: {
          type: "string",
          title: "Language code",
          description: "Optional BCP-47 language code.",
        },
      },
      ["siteUrl", "inspectionUrl"]
    ),
    outputSchema: objectSchema({
      inspectionUrl: { type: "string", description: "Inspected URL." },
      indexStatus: { type: "string", description: "Index status when the executor returns one." },
    }),
  },
];

const byKey = new Map();
for (const tool of TOOLS) {
  const provider = PROVIDERS[tool.provider];
  if (!provider) {
    throw new Error(`Dynamic MCP registry has unknown provider ${tool.provider}`);
  }
  if (tool.authType !== provider.authType) {
    throw new Error(`Auth type mismatch for ${tool.provider}/${tool.id}`);
  }
  if (!["read", "write", "admin"].includes(tool.access)) {
    throw new Error(`Bad access for ${tool.id}`);
  }
  if (!["low", "medium", "high"].includes(tool.risk)) {
    throw new Error(`Bad risk for ${tool.id}`);
  }
  const key = `${tool.provider}/${tool.id}`;
  if (byKey.has(key)) throw new Error(`Duplicate dynamic MCP tool ${key}`);
  for (const field of describeInputFields(tool.inputSchema)) {
    if (!SUPPORTED_FIELD_TYPES.has(field.type)) {
      throw new Error(`Unsupported field type ${field.type} on ${key}`);
    }
  }
  byKey.set(key, tool);
}

function isDropdownVisible(tool) {
  return tool.access === "read" && tool.risk === "low";
}

function describeInputFields(schema) {
  const properties =
    schema && schema.properties && typeof schema.properties === "object"
      ? schema.properties
      : {};
  const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
  return Object.entries(properties).map(([name, spec]) => {
    const rawType = spec?.type || "string";
    const type = Array.isArray(spec?.enum) ? "enum" : rawType;
    return {
      name,
      title: spec?.title || name,
      type,
      description: spec?.description || "",
      required: required.has(name),
      enumValues: Array.isArray(spec?.enum) ? spec.enum.slice() : undefined,
      itemType: spec?.items?.type,
      minimum: spec?.minimum,
      maximum: spec?.maximum,
    };
  });
}

function publicTool(tool) {
  return {
    provider: tool.provider,
    id: tool.id,
    displayName: tool.displayName,
    description: tool.description,
    category: tool.category,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    authType: tool.authType,
    access: tool.access,
    risk: tool.risk,
    implemented: Boolean(tool.implemented),
  };
}

function assertKnownProvider(provider) {
  const id = String(provider || "").trim();
  if (!PROVIDERS[id]) {
    throw new AppError(
      "Unknown provider. Use google_analytics, google_search_console, or google_ads.",
      400,
      "MCP_UNKNOWN_PROVIDER"
    );
  }
  return id;
}

function listProviders() {
  return Object.entries(PROVIDERS).map(([id, meta]) => ({
    id,
    displayName: meta.displayName,
    authType: meta.authType,
    toolCount: TOOLS.filter(
      (tool) => tool.provider === id && isDropdownVisible(tool)
    ).length,
  }));
}

function listTools({ provider, exposure = "dropdown" } = {}) {
  const id = assertKnownProvider(provider);
  return TOOLS.filter((tool) => tool.provider === id)
    .filter((tool) => (exposure === "all" ? true : isDropdownVisible(tool)))
    .map(publicTool);
}

function getTool(provider, toolId) {
  const providerId = assertKnownProvider(provider);
  const id = String(toolId || "").trim();
  const tool = byKey.get(`${providerId}/${id}`);
  if (!tool) {
    throw new AppError(
      `Unknown tool "${id}" for ${providerId}.`,
      404,
      "MCP_UNKNOWN_TOOL"
    );
  }
  return tool;
}

function getToolDefinition(provider, toolId) {
  return publicTool(getTool(provider, toolId));
}

function sanitizeMessage(message) {
  const text = String(message || "Request failed").replace(SECRET_VALUE_RE, "[redacted]");
  if (SECRET_KEY_RE.test(text) && /token|secret/i.test(text)) {
    return "Request failed.";
  }
  return text.slice(0, 400);
}

function stripSecrets(value, depth = 0) {
  if (value == null || depth > 8) return value;
  if (Array.isArray(value)) return value.map((entry) => stripSecrets(entry, depth + 1));
  if (typeof value === "string") {
    return value.replace(SECRET_VALUE_RE, "[redacted]");
  }
  if (typeof value !== "object") return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY_RE.test(key)) continue;
    out[key] = stripSecrets(entry, depth + 1);
  }
  return out;
}

function sanitizeDynamicMcpNodeData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const next = {};
  for (const [key, value] of Object.entries(data)) {
    if (SECRET_KEY_RE.test(key)) continue;
    next[key] = key === "params" ? stripSecrets(value) : value;
  }
  return next;
}

function isBlank(value) {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function isDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function validateParams(tool, rawParams) {
  if (rawParams == null) rawParams = {};
  if (typeof rawParams !== "object" || Array.isArray(rawParams)) {
    throw new AppError("params must be an object.", 400, "MCP_INVALID_PARAMS");
  }
  const fields = describeInputFields(tool.inputSchema);
  const known = new Set(fields.map((field) => field.name));
  const errors = [];
  for (const key of Object.keys(rawParams)) {
    if (SECRET_KEY_RE.test(key)) {
      errors.push(`${key} is not allowed.`);
      continue;
    }
    if (!known.has(key)) errors.push(`Unknown parameter "${key}".`);
  }
  const normalized = {};
  for (const field of fields) {
    const value = rawParams[field.name];
    if (isBlank(value)) {
      if (field.required) errors.push(`${field.title} is required.`);
      continue;
    }
    if (field.type === "string" || field.type === "date") {
      if (typeof value !== "string") {
        errors.push(`${field.title} must be a string.`);
        continue;
      }
      if (field.type === "date" && !isDateString(value)) {
        errors.push(`${field.title} must be YYYY-MM-DD.`);
        continue;
      }
      normalized[field.name] = value.trim();
      continue;
    }
    if (field.type === "number" || field.type === "integer") {
      const num = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(num)) {
        errors.push(`${field.title} must be a number.`);
        continue;
      }
      if (field.minimum != null && num < field.minimum) {
        errors.push(`${field.title} must be at least ${field.minimum}.`);
        continue;
      }
      if (field.maximum != null && num > field.maximum) {
        errors.push(`${field.title} must be at most ${field.maximum}.`);
        continue;
      }
      normalized[field.name] = num;
      continue;
    }
    if (field.type === "boolean") {
      if (typeof value === "boolean") normalized[field.name] = value;
      else if (value === "true" || value === "false") normalized[field.name] = value === "true";
      else errors.push(`${field.title} must be true or false.`);
      continue;
    }
    if (field.type === "enum") {
      if (!field.enumValues.includes(value)) {
        errors.push(`${field.title} must be one of ${field.enumValues.join(", ")}.`);
        continue;
      }
      normalized[field.name] = value;
      continue;
    }
    if (field.type === "dateRange") {
      const start = value?.start ?? value?.startDate;
      const end = value?.end ?? value?.endDate;
      if (!isDateString(start) || !isDateString(end)) {
        errors.push(`${field.title} needs start and end as YYYY-MM-DD.`);
        continue;
      }
      normalized[field.name] = { start: start.trim(), end: end.trim() };
      continue;
    }
    if (field.type === "array") {
      if (!Array.isArray(value)) {
        errors.push(`${field.title} must be a list.`);
        continue;
      }
      normalized[field.name] = value.map((entry) =>
        typeof entry === "string" ? entry : stripSecrets(entry)
      );
    }
  }
  if (errors.length) {
    throw new AppError(errors[0], 400, "MCP_INVALID_PARAMS");
  }
  return normalized;
}

function rowsToWorkflowItems(data) {
  const rows = Array.isArray(data)
    ? data
    : data && Array.isArray(data.rows)
      ? data.rows
      : [data == null ? {} : data];
  return rows.map((row) => ({
    json: stripSecrets(
      row && typeof row === "object" && !Array.isArray(row) ? row : { value: row }
    ),
  }));
}

async function defaultExecuteGsc(args) {
  const host = require("./mcpPluginHost.service");
  return host.executeGscMcpTool(args);
}

async function executeTool(input = {}, deps = {}) {
  const tool = getTool(input.provider, input.toolId);
  if (!isDropdownVisible(tool)) {
    throw new AppError(
      "This tool is not available in the dynamic tool list.",
      400,
      "MCP_TOOL_GATED"
    );
  }
  const params = validateParams(tool, input.params || {});
  if (!tool.implemented) {
    throw new AppError(
      `${tool.displayName} is registered but not executable yet.`,
      400,
      "MCP_TOOL_UNAVAILABLE"
    );
  }
  if (tool.executor !== "gsc_mcp_host") {
    throw new AppError(
      `${tool.displayName} has no executor.`,
      400,
      "MCP_TOOL_UNAVAILABLE"
    );
  }
  const credentialId = String(input.credentialId || "").trim();
  if (!credentialId) {
    throw new AppError(
      "A Google Search Console credential is required.",
      400,
      "MCP_CREDENTIAL_REQUIRED"
    );
  }
  const run = deps.executeGscMcpTool || defaultExecuteGsc;
  let result;
  try {
    result = await run({
      toolId: tool.id,
      toolArgs: params,
      mode: "raw",
      credentialId,
      workspaceId: input.workspaceId,
      authUser: input.authUser,
    });
  } catch (err) {
    if (err instanceof AppError && String(err.code || "").startsWith("MCP_")) {
      if (err.code === "MCP_AUTH_REQUIRED") {
        throw new AppError(
          "Credential is missing or not authorized for this provider.",
          400,
          "MCP_CREDENTIAL_UNAUTHORIZED"
        );
      }
      throw err;
    }
    const message = sanitizeMessage(err?.message);
    if (/credential|unauthorized|not found|invalid_grant/i.test(message)) {
      throw new AppError(
        "Credential is missing or not authorized for this provider.",
        400,
        "MCP_CREDENTIAL_UNAUTHORIZED"
      );
    }
    throw new AppError(message || "Tool execution failed.", 400, "MCP_EXECUTION_FAILED");
  }
  if (!result || result.ok === false) {
    const message = sanitizeMessage(
      result?.error?.message || result?.error || "Tool execution failed."
    );
    const authFailure = /credential|unauthorized|auth/i.test(message);
    throw new AppError(
      authFailure
        ? "Credential is missing or not authorized for this provider."
        : message,
      400,
      authFailure ? "MCP_CREDENTIAL_UNAUTHORIZED" : "MCP_EXECUTION_FAILED"
    );
  }
  const data = result.data !== undefined ? result.data : result;
  return { items: rowsToWorkflowItems(data) };
}

function resolveParamTree(value, context, resolveExpression) {
  if (typeof value === "string") {
    if (value.includes("{{")) return resolveExpression(value, context);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => resolveParamTree(entry, context, resolveExpression));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SECRET_KEY_RE.test(key)) continue;
      out[key] = resolveParamTree(entry, context, resolveExpression);
    }
    return out;
  }
  return value;
}

async function executeDynamicMcpNode(node, context = {}) {
  const { resolveExpression } = require("./workflowNodes.service");
  const data = sanitizeDynamicMcpNodeData(node?.data || {});
  const params = resolveParamTree(data.params || {}, context, resolveExpression);
  const executed = await executeTool({
    provider: data.provider,
    toolId: data.toolId,
    params,
    credentialId: data.credentialId,
    inputItems: Array.isArray(context.inputItems) ? context.inputItems : [],
    workspaceId: context.workspaceId,
    authUser: context.authUser,
  });
  return {
    output: {
      provider: data.provider || "",
      toolId: data.toolId || "",
      itemCount: executed.items.length,
    },
    items: executed.items,
  };
}

module.exports = {
  PROVIDERS,
  SUPPORTED_FIELD_TYPES,
  describeInputFields,
  listProviders,
  listTools,
  getToolDefinition,
  executeTool,
  executeDynamicMcpNode,
  resolveParamTree,
  sanitizeDynamicMcpNodeData,
  stripSecrets,
  isDropdownVisible,
};
