/**
 * Part 12B — AI resource descriptors + resolution (model / tool).
 *
 * Descriptors are serializable. Runtime clients are ephemeral and never
 * persisted in runData, Wait snapshots, or editor sessions.
 */

const {
  resolveAuxiliaryBindings,
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
    const lower = key.toLowerCase();
    if (
      lower.includes("secret") ||
      lower.includes("password") ||
      lower.includes("authorization") ||
      lower === "apikey" ||
      lower === "api_key" ||
      lower === "token"
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
  throw new AiRuntimeError(
    `Unsupported tool provider node type: ${type}`,
    AI_ERROR.PROVIDER_UNSUPPORTED,
    { nodeId: node.id, type }
  );
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
    async invoke({ messages, tools, timeoutMs, signal }) {
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

      const run = async () => {
        if (script === "echo") {
          const lastUser = [...messages].reverse().find((m) => m.role === "user");
          return {
            message: { role: "assistant", content: String(lastUser?.content || "") },
            toolCalls: [],
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
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
    async invoke({ messages, tools, timeoutMs, signal }) {
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
      }

      const run = async () => {
        if (signal?.aborted) {
          throw new AiRuntimeError("Model aborted", AI_ERROR.MODEL_TIMEOUT);
        }
        const completion = await client.chat.completions.create(options);
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
              inputTokens: completion.usage.prompt_tokens,
              outputTokens: completion.usage.completion_tokens,
              totalTokens: completion.usage.total_tokens,
            }
          : undefined;
        return {
          message: {
            role: "assistant",
            content: msg.content || (toolCalls.length ? null : ""),
          },
          toolCalls,
          usage,
          finishReason: choice?.finish_reason || (toolCalls.length ? "tool_calls" : "stop"),
          providerMetadata: { id: completion.id },
        };
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
  throw new AiRuntimeError(
    `No tool executor for kind "${descriptor.toolKind}"`,
    AI_ERROR.PROVIDER_UNSUPPORTED
  );
};

/**
 * Resolve Agent auxiliary bindings into serializable descriptors + readiness.
 */
const resolveAgentResources = ({ nodeId, definition }) => {
  const bindings = resolveAuxiliaryBindings({ nodeId, definition });
  const byId = new Map(
    (definition.nodes || []).map((n) => [n.id, n])
  );

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
  const names = new Set();
  for (const b of bindings.tools) {
    const toolNode = byId.get(b.sourceNodeId);
    if (!toolNode) continue;
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
  }

  return {
    modelDescriptor,
    toolDescriptors,
    bindings,
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
  if (isAuxiliaryOnlyProvider(type) || type === "aiChatModel" || type === "aiCalculatorTool") {
    const err = new AiRuntimeError(
      "This node provides an AI resource to another node.",
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
