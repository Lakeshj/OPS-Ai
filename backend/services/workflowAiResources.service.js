/**
 * Part 12B — AI resource descriptors + resolution (model / tool).
 *
 * Descriptors are serializable. Runtime clients are ephemeral and never
 * persisted in runData, Wait snapshots, or editor sessions.
 */

const {
  resolveAuxiliaryBindings,
  getEdgeConnectionMeta,
  CONNECTION_KIND,
  DATA_TYPE,
  isAuxiliaryOnlyProvider,
  nodeTypeOf,
} = require("./workflowConnection.service");

const MAX_AGENT_TOOL_ROUNDS = 8;
const MAX_TOOL_RESULT_CHARS = 8000;
const DEFAULT_MODEL_TIMEOUT_MS = 60000;
const DEFAULT_TOOL_TIMEOUT_MS = 30000;

const AI_ERROR = Object.freeze({
  MODEL_REQUIRED: "AI_MODEL_REQUIRED",
  MEMORY_NOT_SUPPORTED: "AI_MEMORY_NOT_SUPPORTED",
  TOOL_NOT_FOUND: "AI_TOOL_NOT_FOUND",
  TOOL_CALL_INVALID: "AI_TOOL_CALL_INVALID",
  TOOL_ARGS_INVALID: "AI_TOOL_ARGS_INVALID",
  TOOL_SCHEMA_INVALID: "AI_TOOL_SCHEMA_INVALID",
  DUPLICATE_TOOL_NAME: "AI_DUPLICATE_TOOL_NAME",
  MAX_TOOL_ROUNDS: "AI_AGENT_MAX_TOOL_ROUNDS",
  MODEL_TIMEOUT: "AI_MODEL_TIMEOUT",
  TOOL_TIMEOUT: "AI_TOOL_TIMEOUT",
  TOOL_FAILED: "AI_TOOL_FAILED",
  PROVIDER_UNSUPPORTED: "AI_PROVIDER_UNSUPPORTED",
});

class AiRuntimeError extends Error {
  constructor(message, code, meta = {}) {
    super(message);
    this.name = "AiRuntimeError";
    this.code = code;
    this.meta = meta;
  }
}

const stripSecrets = (obj) => {
  if (!obj || typeof obj !== "object") return obj;
  const out = Array.isArray(obj) ? [...obj] : { ...obj };
  for (const key of Object.keys(out)) {
    const lower = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (
      lower.includes("secret") ||
      lower.includes("password") ||
      lower.includes("authorization") ||
      lower === "apikey" ||
      lower.includes("accesstoken") ||
      lower.includes("refreshtoken") ||
      lower.endsWith("token")
    ) {
      delete out[key];
    } else if (out[key] && typeof out[key] === "object") {
      out[key] = stripSecrets(out[key]);
    }
  }
  return out;
};

/** Serializable model descriptor — never includes decrypted credentials. */
const buildModelDescriptor = (node) => {
  const data = node.data || {};
  const type = nodeTypeOf(node);
  if (type === "aiModelProviderTest") {
    return {
      kind: DATA_TYPE.AI_MODEL,
      provider: "test",
      nodeId: node.id,
      config: stripSecrets({
        script: data.script || "echo",
        temperature: data.temperature,
        model: data.model || "deterministic-test-model",
      }),
      credentialRef: null,
    };
  }
  if (type === "aiChatModel") {
    return {
      kind: DATA_TYPE.AI_MODEL,
      provider: data.provider || "openai",
      nodeId: node.id,
      config: stripSecrets({
        model: data.model || "gpt-4o-mini",
        temperature: data.temperature ?? 0.4,
        maxTokens: data.maxTokens ?? 1200,
      }),
      credentialRef: data.credentialId ? { credentialId: data.credentialId } : null,
    };
  }
  throw new AiRuntimeError(
    `Unsupported model provider node type: ${type}`,
    AI_ERROR.PROVIDER_UNSUPPORTED,
    { nodeId: node.id, type }
  );
};

const defaultCalculatorSchema = () => ({
  type: "object",
  properties: {
    a: { type: "number" },
    b: { type: "number" },
    operation: {
      type: "string",
      enum: ["add", "subtract", "multiply", "divide"],
    },
  },
  required: ["a", "b", "operation"],
});

/**
 * Stable MCP tool name for the model: provider_toolId unless author set toolName.
 * Calculator/HTTP keep author names unchanged.
 */
const namespacedMcpToolName = (providerKey, toolId, authorName) => {
  const custom = String(authorName || "").trim();
  if (custom) {
    return custom.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  }
  const provider = String(providerKey || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  const id = String(toolId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_");
  const combined = provider ? `${provider}_${id}` : id;
  return combined.slice(0, 64) || id || "tool";
};

/** Catalog description + optional whenToUse / usage (generic for all MCP tools). */
const composeToolDescription = (catalog = {}, data = {}) => {
  if (data.description && String(data.description).trim()) {
    return String(data.description).trim();
  }
  const base = String(
    catalog.description || catalog.displayName || ""
  ).trim();
  const when = String(catalog.whenToUse || catalog.usage || "").trim();
  if (base && when) return `${base} ${when}`;
  return base || when || "Workflow tool.";
};

/** Serializable tool descriptor — execute is attached only at runtime. */
const buildToolDescriptor = (node) => {
  const data = node.data || {};
  const type = nodeTypeOf(node);
  if (type === "aiCalculatorTool" || type === "aiToolProviderTest") {
    const name = String(data.toolName || data.name || "calculator").trim();
    return {
      kind: DATA_TYPE.AI_TOOL,
      nodeId: node.id,
      name,
      description:
        data.description ||
        "Deterministic calculator: add/subtract/multiply/divide two numbers.",
      inputSchema:
        data.inputSchema && typeof data.inputSchema === "object"
          ? data.inputSchema
          : defaultCalculatorSchema(),
      toolKind: "calculator",
    };
  }
  if (type === "aiHttpTool") {
    const {
      validateHttpToolName,
      parseInputSchema,
    } = require("./workflowAiHttpTool.service");
    const name = validateHttpToolName(data.toolName || data.name || "http_tool");
    return {
      kind: DATA_TYPE.AI_TOOL,
      nodeId: node.id,
      name,
      description:
        data.description ||
        "Call a configured HTTP API. Arguments fill {{tool.*}} placeholders only.",
      inputSchema: parseInputSchema(data.inputSchema),
      toolKind: "http",
      // Author-fixed request config — never includes decrypted secrets
      httpConfig: stripSecrets({
        method: String(data.method || "GET").toUpperCase(),
        url: String(data.url || ""),
        credentialId: data.credentialId || null,
        headers: data.headers || [],
        queryParams: data.queryParams || [],
        body: data.body ?? null,
        timeoutMs: data.timeoutMs,
        failOnHttpError: data.failOnHttpError,
        rateLimitRetries: data.rateLimitRetries,
      }),
    };
  }
  if (type === "googleAdsMcpTool") {
    const registry = require("./mcpDynamicRegistry.service");
    const toolId = String(data.toolId || "").trim();
    if (!toolId) {
      throw new AiRuntimeError(
        "Google Ads MCP tool node requires a toolId.",
        AI_ERROR.TOOL_SCHEMA_INVALID,
        { nodeId: node.id }
      );
    }
    let catalog;
    try {
      catalog = registry.getToolDefinition("google_ads", toolId);
    } catch (err) {
      throw new AiRuntimeError(
        err instanceof Error ? err.message : `Unknown Google Ads MCP tool: ${toolId}`,
        AI_ERROR.TOOL_SCHEMA_INVALID,
        { nodeId: node.id, toolId }
      );
    }
    const name = namespacedMcpToolName("google_ads", toolId, data.toolName);
    const fixedParams =
      data.params && typeof data.params === "object" && !Array.isArray(data.params)
        ? stripSecrets({ ...data.params })
        : {};
    for (const key of ["credentialId", "customerId", "loginCustomerId"]) {
      delete fixedParams[key];
    }
    return {
      kind: DATA_TYPE.AI_TOOL,
      nodeId: node.id,
      name: name || toolId,
      displayName: catalog.displayName || toolId,
      description: composeToolDescription(catalog, data),
      inputSchema: stripGoogleAdsAccountFieldsFromSchema(catalog.inputSchema),
      toolKind: "google_ads_mcp",
      adsToolId: toolId,
      googleAdsSourceNodeId: String(data.googleAdsSourceNodeId || "").trim() || null,
      fixedParams,
    };
  }
  if (type === "instagramMcpTool") {
    const registry = require("./mcpDynamicRegistry.service");
    const toolId = String(data.toolId || "").trim();
    if (!toolId) {
      throw new AiRuntimeError(
        "Instagram MCP tool node requires a toolId.",
        AI_ERROR.TOOL_SCHEMA_INVALID,
        { nodeId: node.id }
      );
    }
    let catalog;
    try {
      catalog = registry.getToolDefinition("instagram", toolId);
    } catch (err) {
      throw new AiRuntimeError(
        err instanceof Error ? err.message : `Unknown Instagram MCP tool: ${toolId}`,
        AI_ERROR.TOOL_SCHEMA_INVALID,
        { nodeId: node.id, toolId }
      );
    }
    const name = namespacedMcpToolName("instagram", toolId, data.toolName);
    const fixedParams =
      data.params && typeof data.params === "object" && !Array.isArray(data.params)
        ? stripSecrets({ ...data.params })
        : {};
    for (const key of ["credentialId", "instagramUserId", "accessToken"]) {
      delete fixedParams[key];
    }
    return {
      kind: DATA_TYPE.AI_TOOL,
      nodeId: node.id,
      name: name || toolId,
      displayName: catalog.displayName || toolId,
      description: composeToolDescription(catalog, data),
      inputSchema: stripInstagramAccountFieldsFromSchema(catalog.inputSchema),
      toolKind: "instagram_mcp",
      igToolId: toolId,
      instagramSourceNodeId: String(data.instagramSourceNodeId || "").trim() || null,
      fixedParams,
    };
  }
  throw new AiRuntimeError(
    `Unsupported tool provider node type: ${type}`,
    AI_ERROR.PROVIDER_UNSUPPORTED,
    { nodeId: node.id, type }
  );
};

/** Account fields are inherited server-side — never expose to the model schema. */
const stripGoogleAdsAccountFieldsFromSchema = (schema) => {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { type: "object", properties: {} };
  }
  const properties = { ...(schema.properties || {}) };
  delete properties.credentialId;
  delete properties.customerId;
  delete properties.loginCustomerId;
  const required = Array.isArray(schema.required)
    ? schema.required.filter(
        (key) =>
          key !== "credentialId" &&
          key !== "customerId" &&
          key !== "loginCustomerId"
      )
    : [];
  return {
    ...schema,
    type: "object",
    properties,
    required,
  };
};

const stripInstagramAccountFieldsFromSchema = (schema) => {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { type: "object", properties: {} };
  }
  const properties = { ...(schema.properties || {}) };
  delete properties.credentialId;
  delete properties.instagramUserId;
  delete properties.accessToken;
  const required = Array.isArray(schema.required)
    ? schema.required.filter(
        (key) =>
          key !== "credentialId" &&
          key !== "instagramUserId" &&
          key !== "accessToken"
      )
    : [];
  return {
    ...schema,
    type: "object",
    properties,
    required,
  };
};

const validateToolSchema = (schema, toolName) => {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new AiRuntimeError(
      `Tool "${toolName}" has an invalid input schema.`,
      AI_ERROR.TOOL_SCHEMA_INVALID,
      { toolName }
    );
  }
  if (schema.type && schema.type !== "object") {
    throw new AiRuntimeError(
      `Tool "${toolName}" schema type must be object.`,
      AI_ERROR.TOOL_SCHEMA_INVALID,
      { toolName }
    );
  }
};

const validateToolArgs = (schema, args, toolName) => {
  if (args == null || typeof args !== "object" || Array.isArray(args)) {
    throw new AiRuntimeError(
      `Tool "${toolName}" arguments must be an object.`,
      AI_ERROR.TOOL_ARGS_INVALID,
      { toolName }
    );
  }
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (args[key] === undefined) {
      throw new AiRuntimeError(
        `Tool "${toolName}" missing required argument "${key}".`,
        AI_ERROR.TOOL_ARGS_INVALID,
        { toolName, key }
      );
    }
  }
  const props = schema.properties || {};
  for (const [key, value] of Object.entries(args)) {
    const prop = props[key];
    if (!prop) continue;
    const t = prop.type;
    if (t === "number" && typeof value !== "number") {
      throw new AiRuntimeError(
        `Tool "${toolName}" argument "${key}" must be a number.`,
        AI_ERROR.TOOL_ARGS_INVALID,
        { toolName, key }
      );
    }
    if (t === "string" && typeof value !== "string") {
      throw new AiRuntimeError(
        `Tool "${toolName}" argument "${key}" must be a string.`,
        AI_ERROR.TOOL_ARGS_INVALID,
        { toolName, key }
      );
    }
    if (t === "boolean" && typeof value !== "boolean") {
      throw new AiRuntimeError(
        `Tool "${toolName}" argument "${key}" must be a boolean.`,
        AI_ERROR.TOOL_ARGS_INVALID,
        { toolName, key }
      );
    }
    if (Array.isArray(prop.enum) && !prop.enum.includes(value)) {
      throw new AiRuntimeError(
        `Tool "${toolName}" argument "${key}" has an invalid value.`,
        AI_ERROR.TOOL_ARGS_INVALID,
        { toolName, key }
      );
    }
  }
};

const executeCalculator = async (args) => {
  const a = Number(args.a);
  const b = Number(args.b);
  const op = String(args.operation);
  let result;
  switch (op) {
    case "add":
      result = a + b;
      break;
    case "subtract":
      result = a - b;
      break;
    case "multiply":
      result = a * b;
      break;
    case "divide":
      if (b === 0) {
        throw new AiRuntimeError(
          "Division by zero",
          AI_ERROR.TOOL_FAILED,
          { toolName: "calculator" }
        );
      }
      result = a / b;
      break;
    default:
      throw new AiRuntimeError(
        `Unknown operation: ${op}`,
        AI_ERROR.TOOL_ARGS_INVALID,
        { toolName: "calculator" }
      );
  }
  return { ok: true, data: { result, a, b, operation: op } };
};

const normalizeToolResultForModel = (result) => {
  let payload = result;
  if (payload && typeof payload === "object" && payload.ok === true) {
    payload = payload.data !== undefined ? { ok: true, data: payload.data } : payload;
  }
  let text;
  try {
    text = typeof payload === "string" ? payload : JSON.stringify(payload);
  } catch {
    text = String(payload);
  }
  if (text.length > MAX_TOOL_RESULT_CHARS) {
    text = `${text.slice(0, MAX_TOOL_RESULT_CHARS)}…[truncated]`;
  }
  return text;
};

const withTimeout = async (promise, timeoutMs, code, label) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new AiRuntimeError(
              `${label} timed out after ${timeoutMs}ms`,
              code
            )
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/**
 * Deterministic test model adapter.
 * scripts:
 * - echo: returns user content
 * - calculator-demo: first turn tool-call calculator, second turn final answer
 * - multi-tool: two calculator calls then final
 * - force-unknown-tool: calls missing tool
 * - force-bad-args: calls calculator with bad args
 * - force-max-rounds: always requests another tool call
 * - timeout: hangs until timeout
 */
const createTestModelAdapter = (descriptor) => {
  const script = String(descriptor.config?.script || "echo");
  const stateByConversation = new Map();

  return {
    provider: "test",
    model: descriptor.config?.model || "deterministic-test-model",
    async invoke({ messages, tools, timeoutMs, signal, toolChoice }) {
      const timeout = timeoutMs || DEFAULT_MODEL_TIMEOUT_MS;
      if (script === "timeout") {
        return withTimeout(
          new Promise(() => {}),
          timeout,
          AI_ERROR.MODEL_TIMEOUT,
          "Model"
        );
      }
      if (signal?.aborted) {
        throw new AiRuntimeError("Model aborted", AI_ERROR.MODEL_TIMEOUT);
      }

      const key = messages.map((m) => m.role + ":" + String(m.content || "")).join("|");
      const turn = stateByConversation.get(key) || 0;
      // Use conversation length as turn proxy for multi-round
      const assistantTurns = messages.filter((m) => m.role === "assistant").length;
      const toolTurns = messages.filter((m) => m.role === "tool").length;
      const round = assistantTurns;
      const hasGroundingNudge = messages.some(
        (m) =>
          m.role === "user" &&
          /Relevant connected tools are available/i.test(String(m.content || ""))
      );

      const run = async () => {
        if (script === "echo") {
          const lastUser = [...messages].reverse().find((m) => m.role === "user");
          return {
            message: { role: "assistant", content: String(lastUser?.content || "") },
            toolCalls: [],
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            finishReason: "stop",
            requestDebug: {
              provider: "test",
              model: descriptor.config?.model || "deterministic-test-model",
              toolCount: Array.isArray(tools) ? tools.length : 0,
              toolNames: Array.isArray(tools)
                ? tools.map((t) => t.name).filter(Boolean)
                : [],
              toolChoice: toolChoice || "auto",
            },
          };
        }

        // M8.15.2: first turn skips tools with access-denial boilerplate; after
        // grounding nudge (+ optional tool_choice=required) calls a tool.
        if (script === "grounding-skip-then-tool") {
          if (!hasGroundingNudge && toolTurns === 0) {
            return {
              message: {
                role: "assistant",
                content:
                  "I would typically need access to your account data to answer that. If you have access, check your dashboard.",
              },
              toolCalls: [],
              usage: { inputTokens: 8, outputTokens: 20, totalTokens: 28 },
              finishReason: "stop",
              requestDebug: {
                provider: "test",
                toolChoice: toolChoice || "auto",
                toolCount: Array.isArray(tools) ? tools.length : 0,
                toolNames: (tools || []).map((t) => t.name),
              },
            };
          }
          if (toolTurns === 0) {
            const pick =
              (tools || []).find((t) => t.name === "calculator") ||
              (tools || [])[0];
            const toolName = pick?.name || "calculator";
            const args =
              toolName === "calculator"
                ? { a: 12, b: 30, operation: "add" }
                : { limit: 5 };
            return {
              message: { role: "assistant", content: null },
              toolCalls: [
                {
                  id: "call_ground_1",
                  name: toolName,
                  arguments: args,
                },
              ],
              usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
              finishReason: "tool_calls",
              requestDebug: {
                provider: "test",
                toolChoice: toolChoice || "auto",
                toolCount: Array.isArray(tools) ? tools.length : 0,
                toolNames: (tools || []).map((t) => t.name),
              },
            };
          }
          const lastTool = [...messages].reverse().find((m) => m.role === "tool");
          let detail = "connected tool data";
          try {
            const parsed = JSON.parse(String(lastTool?.content || "{}"));
            if (parsed?.ok === false) {
              return {
                message: {
                  role: "assistant",
                  content: `I couldn't retrieve the data because the connected tool returned an error: ${parsed.message || parsed.code || "unknown"}.`,
                },
                toolCalls: [],
                finishReason: "stop",
              };
            }
            detail =
              parsed?.data?.result != null
                ? String(parsed.data.result)
                : JSON.stringify(parsed).slice(0, 120);
          } catch {
            /* keep */
          }
          return {
            message: {
              role: "assistant",
              content: `Grounded summary from connected tools: ${detail}.`,
            },
            toolCalls: [],
            usage: { inputTokens: 12, outputTokens: 16, totalTokens: 28 },
            finishReason: "stop",
          };
        }

        if (script === "calculator-demo") {
          if (toolTurns === 0) {
            return {
              message: { role: "assistant", content: null },
              toolCalls: [
                {
                  id: "call_calc_1",
                  name: "calculator",
                  arguments: { a: 12, b: 30, operation: "add" },
                },
              ],
              usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
              finishReason: "tool_calls",
            };
          }
          const lastTool = [...messages].reverse().find((m) => m.role === "tool");
          let answer = "42";
          try {
            const parsed = JSON.parse(String(lastTool?.content || "{}"));
            answer = String(parsed?.data?.result ?? parsed?.result ?? "42");
          } catch {
            /* keep */
          }
          return {
            message: {
              role: "assistant",
              content: `The answer is ${answer}.`,
            },
            toolCalls: [],
            usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
            finishReason: "stop",
          };
        }

        if (script === "http-tool-demo") {
          const httpTool =
            (tools || []).find((t) => t.name === "lookup_customer") ||
            (tools || [])[0];
          const toolName = httpTool?.name || "lookup_customer";
          if (toolTurns === 0) {
            return {
              message: { role: "assistant", content: null },
              toolCalls: [
                {
                  id: "call_http_1",
                  name: toolName,
                  arguments: { id: "123" },
                },
              ],
              usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
              finishReason: "tool_calls",
            };
          }
          const lastTool = [...messages].reverse().find((m) => m.role === "tool");
          let summary = "Customer found";
          try {
            const parsed = JSON.parse(String(lastTool?.content || "{}"));
            const body = parsed?.data?.data ?? parsed?.data ?? parsed;
            summary =
              typeof body === "object"
                ? JSON.stringify(body)
                : String(body ?? summary);
          } catch {
            /* keep */
          }
          return {
            message: {
              role: "assistant",
              content: `Looked up customer 123: ${summary}`,
            },
            toolCalls: [],
            usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
            finishReason: "stop",
          };
        }

        if (script === "multi-tool") {
          if (toolTurns === 0) {
            return {
              message: { role: "assistant", content: null },
              toolCalls: [
                {
                  id: "call_a",
                  name: "calculator",
                  arguments: { a: 1, b: 2, operation: "add" },
                },
                {
                  id: "call_b",
                  name: "calculator",
                  arguments: { a: 3, b: 4, operation: "add" },
                },
              ],
              finishReason: "tool_calls",
            };
          }
          return {
            message: { role: "assistant", content: "Done with tools." },
            toolCalls: [],
            finishReason: "stop",
          };
        }

        // Two sequential model rounds that each request a tool call, then finalize.
        if (script === "sequential-tools") {
          if (toolTurns === 0) {
            return {
              message: { role: "assistant", content: null },
              toolCalls: [
                {
                  id: "call_seq_1",
                  name: "calculator",
                  arguments: { a: 2, b: 3, operation: "add" },
                },
              ],
              finishReason: "tool_calls",
            };
          }
          if (toolTurns === 1) {
            return {
              message: { role: "assistant", content: null },
              toolCalls: [
                {
                  id: "call_seq_2",
                  name: "calculator",
                  arguments: { a: 10, b: 5, operation: "subtract" },
                },
              ],
              finishReason: "tool_calls",
            };
          }
          return {
            message: {
              role: "assistant",
              content: "Completed two sequential tool rounds.",
            },
            toolCalls: [],
            finishReason: "stop",
          };
        }

        if (script === "force-unknown-tool") {
          return {
            message: { role: "assistant", content: null },
            toolCalls: [
              { id: "call_x", name: "foo", arguments: {} },
            ],
            finishReason: "tool_calls",
          };
        }

        if (script === "force-bad-args") {
          // M8.15: first turn requests bad args; after soft tool error, finalize.
          if (toolTurns === 0) {
            return {
              message: { role: "assistant", content: null },
              toolCalls: [
                {
                  id: "call_bad",
                  name: "calculator",
                  arguments: { a: "x", b: 1, operation: "add" },
                },
              ],
              finishReason: "tool_calls",
            };
          }
          const lastTool = [...messages].reverse().find((m) => m.role === "tool");
          let detail = "invalid arguments";
          try {
            const parsed = JSON.parse(String(lastTool?.content || "{}"));
            detail = String(parsed?.message || detail);
          } catch {
            /* keep */
          }
          return {
            message: {
              role: "assistant",
              content: `Tool call failed: ${detail}`,
            },
            toolCalls: [],
            finishReason: "stop",
          };
        }

        if (script === "tool-exec-fail") {
          if (toolTurns === 0) {
            return {
              message: { role: "assistant", content: null },
              toolCalls: [
                {
                  id: "call_fail_exec",
                  name: "calculator",
                  arguments: { a: 1, b: 0, operation: "divide" },
                },
              ],
              finishReason: "tool_calls",
            };
          }
          return {
            message: {
              role: "assistant",
              content: "The calculator tool failed (division by zero).",
            },
            toolCalls: [],
            finishReason: "stop",
          };
        }

        if (script === "instagram-list-media-demo") {
          const igTool =
            (tools || []).find((t) => String(t.name).includes("list_media")) ||
            (tools || [])[0];
          const toolName = igTool?.name || "instagram_list_media";
          if (toolTurns === 0) {
            return {
              message: { role: "assistant", content: null },
              toolCalls: [
                {
                  id: "call_ig_media",
                  name: toolName,
                  arguments: { limit: 5 },
                },
              ],
              finishReason: "tool_calls",
            };
          }
          const lastTool = [...messages].reverse().find((m) => m.role === "tool");
          let grounded = "No media returned.";
          try {
            const parsed = JSON.parse(String(lastTool?.content || "{}"));
            const rows = Array.isArray(parsed?.data) ? parsed.data : [];
            if (parsed?.ok === false) {
              grounded = `Could not load Instagram media: ${parsed.message || "error"}`;
            } else if (rows.length) {
              const top = rows
                .slice(0, 5)
                .map((row, i) => {
                  const likes = row.likeCount ?? row.like_count ?? 0;
                  const comments = row.commentsCount ?? row.comments_count ?? 0;
                  return `${i + 1}. ${row.mediaType || row.media_type || "post"} — ${likes} likes, ${comments} comments`;
                })
                .join("; ");
              grounded = `Recent Instagram posts: ${top}. Strongest engagement is among these live counts.`;
            }
          } catch {
            /* keep */
          }
          return {
            message: { role: "assistant", content: grounded },
            toolCalls: [],
            finishReason: "stop",
          };
        }

        if (script === "force-max-rounds") {
          return {
            message: { role: "assistant", content: null },
            toolCalls: [
              {
                id: `call_loop_${round}`,
                name: "calculator",
                arguments: { a: 1, b: 1, operation: "add" },
              },
            ],
            finishReason: "tool_calls",
          };
        }

        if (script === "fail") {
          throw new AiRuntimeError("Test model failed", AI_ERROR.TOOL_FAILED);
        }

        // default echo
        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        return {
          message: { role: "assistant", content: String(lastUser?.content || "") },
          toolCalls: [],
          finishReason: "stop",
        };
      };

      void tools;
      void stateByConversation;
      void turn;
      return withTimeout(run(), timeout, AI_ERROR.MODEL_TIMEOUT, "Model");
    },
  };
};

/** Minimal OpenAI-compatible adapter using existing getClientForProvider. */
const createOpenAiCompatAdapter = (descriptor) => {
  const { getClientForProvider } = require("../config/aiClients");
  const { withGenerationOptions } = require("../utils/openaiCompletionOptions");

  return {
    provider: descriptor.provider,
    model: descriptor.config?.model || "gpt-4o-mini",
    async invoke({
      messages,
      tools,
      timeoutMs,
      signal,
      responseFormat,
      toolChoice = null,
    }) {
      const timeout = timeoutMs || DEFAULT_MODEL_TIMEOUT_MS;
      const provider = descriptor.provider || "openai";
      const model = descriptor.config?.model || "gpt-4o-mini";
      const { client } = getClientForProvider(provider, model);

      const apiMessages = messages.map((m) => {
        if (m.role === "tool") {
          return {
            role: "tool",
            tool_call_id: m.toolCallId,
            content: String(m.content ?? ""),
          };
        }
        if (m.role === "assistant" && Array.isArray(m.toolCalls) && m.toolCalls.length) {
          return {
            role: "assistant",
            content: m.content || null,
            tool_calls: m.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function",
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments || {}),
              },
            })),
          };
        }
        return { role: m.role, content: m.content ?? "" };
      });

      const options = withGenerationOptions(model, {
        messages: apiMessages,
        temperature: descriptor.config?.temperature ?? 0.4,
        maxTokens: descriptor.config?.maxTokens ?? 1200,
      });

      if (Array.isArray(tools) && tools.length > 0) {
        options.tools = tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description || "",
            parameters: t.inputSchema || { type: "object", properties: {} },
          },
        }));
        // Default auto; grounding retry may pass "required".
        const choice = toolChoice == null ? "auto" : toolChoice;
        if (choice === "required" || choice === "auto" || choice === "none") {
          options.tool_choice = choice;
        } else if (choice && typeof choice === "object") {
          options.tool_choice = choice;
        } else if (typeof choice === "string" && choice.trim()) {
          // Named tool force (rare) — only when caller already resolved a single tool.
          options.tool_choice = {
            type: "function",
            function: { name: choice.trim() },
          };
        } else {
          options.tool_choice = "auto";
        }
      }

      // Optional JSON mode for product planners (Copilot). Ignored when tools present.
      if (
        responseFormat &&
        (!Array.isArray(tools) || tools.length === 0)
      ) {
        options.response_format =
          typeof responseFormat === "string"
            ? { type: responseFormat }
            : responseFormat;
      }

      const toolNames = Array.isArray(tools)
        ? tools.map((t) => String(t?.name || "").trim()).filter(Boolean)
        : [];
      // Safe request summary only — never log messages/body/secrets.
      const requestDebug = {
        provider,
        model,
        toolCount: toolNames.length,
        toolNames,
        toolChoice:
          options.tool_choice == null
            ? "auto"
            : typeof options.tool_choice === "string"
              ? options.tool_choice
              : "custom",
      };

      const parseCompletion = (completion) => {
        const choice = completion.choices?.[0];
        const msg = choice?.message || {};
        const toolCalls = Array.isArray(msg.tool_calls)
          ? msg.tool_calls.map((tc) => {
              let args = {};
              try {
                args = JSON.parse(tc.function?.arguments || "{}");
              } catch {
                args = {};
              }
              return {
                id: tc.id,
                name: tc.function?.name,
                arguments: args,
              };
            })
          : [];
        const usage = completion.usage
          ? {
              inputTokens: Number(completion.usage.prompt_tokens) || 0,
              cachedInputTokens:
                Number(
                  completion.usage.prompt_tokens_details?.cached_tokens
                ) || 0,
              outputTokens: Number(completion.usage.completion_tokens) || 0,
              totalTokens: Number(completion.usage.total_tokens) || 0,
            }
          : undefined;
        return {
          message: {
            role: "assistant",
            content: msg.content || (toolCalls.length ? null : ""),
          },
          toolCalls,
          usage,
          requestDebug,
          finishReason: choice?.finish_reason || (toolCalls.length ? "tool_calls" : "stop"),
          providerMetadata: { id: completion.id },
        };
      };

      const run = async () => {
        if (signal?.aborted) {
          throw new AiRuntimeError("Model aborted", AI_ERROR.MODEL_TIMEOUT);
        }
        try {
          const completion = await client.chat.completions.create(options);
          return parseCompletion(completion);
        } catch (err) {
          // Providers that reject tool_choice=required: retry once with auto.
          const msg = err instanceof Error ? err.message : String(err || "");
          if (
            options.tool_choice &&
            options.tool_choice !== "auto" &&
            /tool_choice|unsupported|invalid/i.test(msg)
          ) {
            const fallback = { ...options, tool_choice: "auto" };
            requestDebug.toolChoice = "auto";
            requestDebug.toolChoiceFallback = true;
            const completion = await client.chat.completions.create(fallback);
            return parseCompletion(completion);
          }
          throw err;
        }
      };

      return withTimeout(run(), timeout, AI_ERROR.MODEL_TIMEOUT, "Model");
    },
  };
};

const AI_MODEL_ADAPTERS = {
  test: createTestModelAdapter,
  openai: createOpenAiCompatAdapter,
  deepseek: createOpenAiCompatAdapter,
  gemini: createOpenAiCompatAdapter,
};

const instantiateModelRuntime = (descriptor) => {
  const factory = AI_MODEL_ADAPTERS[descriptor.provider];
  if (!factory) {
    throw new AiRuntimeError(
      `No model adapter for provider "${descriptor.provider}"`,
      AI_ERROR.PROVIDER_UNSUPPORTED,
      { provider: descriptor.provider }
    );
  }
  return factory(descriptor);
};

const attachToolExecutor = (descriptor) => {
  if (descriptor.toolKind === "calculator") {
    return {
      ...descriptor,
      async execute(args, _ctx) {
        return executeCalculator(args);
      },
    };
  }
  if (descriptor.toolKind === "http") {
    const { executeHttpTool } = require("./workflowAiHttpTool.service");
    const nodeData = {
      ...(descriptor.httpConfig || {}),
      toolName: descriptor.name,
      description: descriptor.description,
      inputSchema: descriptor.inputSchema,
    };
    return {
      ...descriptor,
      async execute(args, ctx) {
        // Re-assert author controls — ignore model-supplied overrides if present
        const safeArgs =
          args && typeof args === "object" && !Array.isArray(args)
            ? { ...args }
            : {};
        delete safeArgs.method;
        delete safeArgs.url;
        delete safeArgs.credentialId;
        delete safeArgs.headers;
        delete safeArgs.authorization;
        return executeHttpTool({
          nodeData,
          args: safeArgs,
          context: ctx || {},
        });
      },
    };
  }
  if (descriptor.toolKind === "gsc_mcp") {
    const host = require("./mcpPluginHost.service");
    return {
      ...descriptor,
      async execute(args, ctx) {
        const toolArgs =
          args && typeof args === "object" && !Array.isArray(args)
            ? { ...args }
            : {};
        if (!toolArgs.siteUrl && descriptor.defaultSiteUrl) {
          toolArgs.siteUrl = descriptor.defaultSiteUrl;
        }
        const result = await host.executeGscMcpTool({
          toolId: descriptor.gscToolId,
          toolArgs,
          mode: "raw",
          credentialId: descriptor.credentialId,
          workspaceId: ctx?.workspaceId || descriptor.workspaceId,
          authUser: ctx?.authUser,
        });
        const text = JSON.stringify(
          result.ok
            ? { ok: true, toolId: result.toolId, data: result.data }
            : { ok: false, error: result.error }
        );
        return text.length > MAX_TOOL_RESULT_CHARS
          ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n…[truncated]`
          : text;
      },
    };
  }
  if (descriptor.toolKind === "google_ads_mcp") {
    const registry = require("./mcpDynamicRegistry.service");
    return {
      ...descriptor,
      async execute(args, ctx) {
        const safeArgs =
          args && typeof args === "object" && !Array.isArray(args)
            ? { ...args }
            : {};
        delete safeArgs.credentialId;
        delete safeArgs.customerId;
        delete safeArgs.loginCustomerId;
        delete safeArgs.developerToken;
        delete safeArgs.accessToken;
        delete safeArgs.refreshToken;
        const result = await registry.executeGoogleAdsMcpNode(
          {
            id: descriptor.nodeId,
            type: "googleAdsMcpTool",
            data: {
              toolId: descriptor.adsToolId,
              ...(descriptor.googleAdsSourceNodeId
                ? { googleAdsSourceNodeId: descriptor.googleAdsSourceNodeId }
                : {}),
              params: {
                ...(descriptor.fixedParams || {}),
                ...safeArgs,
              },
            },
          },
          {
            graph: ctx?.graph || null,
            workspaceId: ctx?.workspaceId,
            authUser: ctx?.authUser,
            inputItems: [],
          }
        );
        const items = Array.isArray(result?.items) ? result.items : [];
        const payload = stripSecrets({
          ok: true,
          toolId: descriptor.adsToolId,
          itemCount: items.length,
          items: items.map((item) =>
            item && typeof item === "object" && item.json != null
              ? item.json
              : item
          ),
        });
        const text = JSON.stringify(payload);
        return text.length > MAX_TOOL_RESULT_CHARS
          ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n…[truncated]`
          : text;
      },
    };
  }
  if (descriptor.toolKind === "instagram_mcp") {
    const registry = require("./mcpDynamicRegistry.service");
    return {
      ...descriptor,
      async execute(args, ctx) {
        const safeArgs =
          args && typeof args === "object" && !Array.isArray(args)
            ? { ...args }
            : {};
        delete safeArgs.credentialId;
        delete safeArgs.instagramUserId;
        delete safeArgs.accessToken;
        delete safeArgs.refreshToken;
        const result = await registry.executeInstagramMcpNode(
          {
            id: descriptor.nodeId,
            type: "instagramMcpTool",
            data: {
              toolId: descriptor.igToolId,
              ...(descriptor.instagramSourceNodeId
                ? { instagramSourceNodeId: descriptor.instagramSourceNodeId }
                : {}),
              params: {
                ...(descriptor.fixedParams || {}),
                ...safeArgs,
              },
            },
          },
          {
            graph: ctx?.graph || null,
            workspaceId: ctx?.workspaceId,
            authUser: ctx?.authUser,
            inputItems: [],
          }
        );
        const items = Array.isArray(result?.items) ? result.items : [];
        const data = items.map((item) =>
          item && typeof item === "object" && item.json != null ? item.json : item
        );
        const payload = stripSecrets({
          ok: true,
          provider: "instagram",
          tool: descriptor.igToolId,
          instagramUserId:
            data[0]?.instagramUserId || data[0]?._meta?.instagramUserId || "",
          itemCount: items.length,
          data,
        });
        const text = JSON.stringify(payload);
        return text.length > MAX_TOOL_RESULT_CHARS
          ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n…[truncated]`
          : text;
      },
    };
  }
  throw new AiRuntimeError(
    `No tool executor for kind "${descriptor.toolKind}"`,
    AI_ERROR.PROVIDER_UNSUPPORTED
  );
};

/**
 * Count candidate tool edges targeting an Agent (typed tools handle OR
 * valid auxiliary AI_TOOL bindings). Used for Run Step diagnostics.
 */
const collectAgentToolEdgeDiagnostics = ({ nodeId, definition }) => {
  const edges = Array.isArray(definition?.edges) ? definition.edges : [];
  const byId = new Map((definition?.nodes || []).map((n) => [n.id, n]));
  const candidateEdges = edges.filter((e) => {
    if (e.target !== nodeId) return false;
    if (String(e.targetHandle || "") === "tools") return true;
    const meta = getEdgeConnectionMeta(e, byId);
    return (
      meta.connectionKind === CONNECTION_KIND.AUXILIARY &&
      meta.dataType === DATA_TYPE.AI_TOOL
    );
  });
  return {
    toolEdgesFound: candidateEdges.length,
    toolEdgeIds: candidateEdges.map((e) => e.id).filter(Boolean),
  };
};

/**
 * Resolve Agent auxiliary bindings into serializable descriptors + readiness.
 * Tool discovery always uses the workflow definition graph (auxiliary edges),
 * never MAIN execution order / previously-run steps.
 */
const resolveAgentResources = ({ nodeId, definition }) => {
  const bindings = resolveAuxiliaryBindings({ nodeId, definition });
  const byId = new Map(
    (definition.nodes || []).map((n) => [n.id, n])
  );
  const edgeDiag = collectAgentToolEdgeDiagnostics({ nodeId, definition });

  if (bindings.memory.length > 0) {
    throw new AiRuntimeError(
      "AI memory is not supported in Part 12B.",
      AI_ERROR.MEMORY_NOT_SUPPORTED,
      { nodeId }
    );
  }

  if (bindings.model.length === 0) {
    throw new AiRuntimeError(
      "AI Agent requires a Chat Model connection.",
      AI_ERROR.MODEL_REQUIRED,
      { nodeId }
    );
  }

  const modelNode = byId.get(bindings.model[0].sourceNodeId);
  if (!modelNode) {
    throw new AiRuntimeError(
      "Bound model node is missing.",
      AI_ERROR.MODEL_REQUIRED,
      { nodeId }
    );
  }
  const modelDescriptor = buildModelDescriptor(modelNode);

  const toolDescriptors = [];
  const toolResolutionErrors = [];
  const names = new Set();
  for (const b of bindings.tools) {
    const toolNode = byId.get(b.sourceNodeId);
    if (!toolNode) {
      toolResolutionErrors.push({
        nodeId: b.sourceNodeId,
        code: "TOOL_NODE_MISSING",
        message: `Tool node "${b.sourceNodeId}" is missing from the workflow graph.`,
      });
      continue;
    }
    try {
      const desc = buildToolDescriptor(toolNode);
      validateToolSchema(desc.inputSchema, desc.name);
      if (names.has(desc.name)) {
        throw new AiRuntimeError(
          `Duplicate tool name "${desc.name}".`,
          AI_ERROR.DUPLICATE_TOOL_NAME,
          { toolName: desc.name }
        );
      }
      names.add(desc.name);
      toolDescriptors.push(desc);
    } catch (err) {
      const code =
        err && typeof err === "object" && err.code
          ? String(err.code)
          : AI_ERROR.TOOL_SCHEMA_INVALID;
      const message = stripSecrets(
        err instanceof Error ? err.message : String(err || "Tool resolve failed")
      );
      // Soft-collect MCP bind/config gaps so Run Step can diagnose
      // toolEdgesFound vs toolNodesResolved. Hard schema/duplicate still throw.
      const softBind =
        /requires a toolId/i.test(message) ||
        /Unknown .+ MCP tool/i.test(message) ||
        /missing from the workflow graph/i.test(message);
      if (
        code === AI_ERROR.DUPLICATE_TOOL_NAME ||
        (code === AI_ERROR.TOOL_SCHEMA_INVALID && !softBind) ||
        code === AI_ERROR.PROVIDER_UNSUPPORTED
      ) {
        throw err;
      }
      toolResolutionErrors.push({
        nodeId: toolNode.id,
        code,
        message,
      });
    }
  }

  return {
    modelDescriptor,
    toolDescriptors,
    bindings,
    diagnostics: {
      toolEdgesFound: edgeDiag.toolEdgesFound,
      toolNodesResolved: toolDescriptors.length,
      toolEdgeIds: edgeDiag.toolEdgeIds,
      toolResolutionErrors,
      bindingToolCount: bindings.tools.length,
    },
  };
};

/**
 * Build ephemeral runtime clients from descriptors (not serializable).
 */
const materializeAgentRuntime = (resolved) => {
  const model = instantiateModelRuntime(resolved.modelDescriptor);
  const tools = resolved.toolDescriptors.map((d) => attachToolExecutor(d));
  const toolsByName = new Map(tools.map((t) => [t.name, t]));
  return { model, tools, toolsByName, modelDescriptor: resolved.modelDescriptor };
};

const assertNotProviderRunStep = (node) => {
  const type = nodeTypeOf(node);
  if (
    isAuxiliaryOnlyProvider(type) ||
    type === "aiChatModel" ||
    type === "aiCalculatorTool" ||
    type === "aiHttpTool"
  ) {
    const err = new AiRuntimeError(
      "This node provides an AI resource to an Agent and does not run by itself.",
      AI_ERROR.PROVIDER_UNSUPPORTED,
      { nodeType: type }
    );
    err.code = "AI_PROVIDER_NOT_EXECUTABLE";
    throw err;
  }
};

module.exports = {
  MAX_AGENT_TOOL_ROUNDS,
  MAX_TOOL_RESULT_CHARS,
  DEFAULT_MODEL_TIMEOUT_MS,
  DEFAULT_TOOL_TIMEOUT_MS,
  AI_ERROR,
  AiRuntimeError,
  stripSecrets,
  buildModelDescriptor,
  buildToolDescriptor,
  namespacedMcpToolName,
  composeToolDescription,
  validateToolSchema,
  validateToolArgs,
  normalizeToolResultForModel,
  executeCalculator,
  withTimeout,
  AI_MODEL_ADAPTERS,
  instantiateModelRuntime,
  resolveAgentResources,
  materializeAgentRuntime,
  assertNotProviderRunStep,
  createTestModelAdapter,
};
