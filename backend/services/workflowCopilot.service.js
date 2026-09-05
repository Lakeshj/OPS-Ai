/**
 * Part 14A — Workflow Copilot foundation.
 *
 * Copilot inspects workflows and proposes constrained editor operations.
 * It does NOT run as a workflow, invent credentials, or mutate live state
 * without going through validate → preview → apply (client draft).
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const AppError = require("../utils/AppError");

const COPILOT_ERROR = Object.freeze({
  NODE_UNAVAILABLE: "COPILOT_NODE_UNAVAILABLE",
  UNKNOWN_PARAMETER: "COPILOT_UNKNOWN_PARAMETER",
  UNKNOWN_OPERATION: "COPILOT_UNKNOWN_OPERATION",
  MALFORMED_PLAN: "COPILOT_MALFORMED_PLAN",
  PLAN_STALE: "COPILOT_PLAN_STALE",
  PERSISTENT_ID_FORBIDDEN: "COPILOT_PERSISTENT_ID_FORBIDDEN",
  UNSUPPORTED_SETTING: "COPILOT_UNSUPPORTED_SETTING",
  CREDENTIAL_OP_FORBIDDEN: "COPILOT_CREDENTIAL_OP_FORBIDDEN",
  APPLY_INVALID: "COPILOT_APPLY_INVALID",
  TEMP_ID_UNKNOWN: "COPILOT_TEMP_ID_UNKNOWN",
});

const COPILOT_INTENTS = Object.freeze([
  "EXPLAIN",
  "BUILD",
  "MODIFY",
  "DEBUG",
  "FIX",
]);

/** Bounded context limits (exact V1 defaults). */
const CONTEXT_LIMITS = Object.freeze({
  MAX_NODES_DETAILED: 80,
  MAX_NEIGHBOR_HOPS: 1,
  MAX_PARAM_STRING: 500,
  MAX_PREVIEW_CHARS: 2000,
  MAX_PREVIEW_ITEMS: 5,
  MAX_TOOL_TRACE: 20,
  MAX_LINEAGE_CHILDREN: 3,
  MAX_VALIDATION_ISSUES: 50,
});

const SUPPORTED_OPERATIONS = Object.freeze([
  "addNode",
  "removeNode",
  "updateNodeParameters",
  "renameNode",
  "connectNodes",
  "disconnectEdge",
  "reconnectEdge",
  "setWorkflowSetting",
]);

const DESTRUCTIVE_OPS = new Set([
  "removeNode",
  "disconnectEdge",
  "reconnectEdge",
]);

const SAFE_WORKFLOW_SETTINGS = new Set(["errorWorkflowId"]);

const SECRET_KEY_RE =
  /^(api[_-]?key|password|secret|token|authorization|access[_-]?token|refresh[_-]?token|resume[_-]?token|external[_-]?token|wait[_-]?token|smtp[_-]?pass|client[_-]?secret)$/i;

const FORBIDDEN_PARAM_KEYS = new Set([
  "_internalSecret",
  "rawHandler",
  "executionState",
  "apiKey",
  "api_key",
  "password",
  "token",
  "secret",
  "authorization",
  "Authorization",
  "accessToken",
  "resumeToken",
  "externalToken",
  "waitToken",
  "smtpPassword",
  "clientSecret",
]);

/** User-facing parameter keys allowed per engine type (schema subset). */
const PARAM_ALLOWLIST = Object.freeze({
  trigger: ["label", "notes"],
  schedule: ["label", "notes", "timezone", "rules", "rule"],
  webhook: ["label", "notes", "path", "method", "responseMode", "secretConfigured"],
  set: ["label", "notes", "assignments", "keepOnlySet", "values"],
  http: [
    "label",
    "notes",
    "method",
    "url",
    "body",
    "pagination",
    "credentialId",
    "timeoutMs",
    "queryParams",
    "headers",
  ],
  filter: [
    "label",
    "notes",
    "conditions",
    "combinator",
    "fieldName",
    "left",
    "operator",
    "right",
  ],
  limit: ["label", "notes", "maxItems", "keep"],
  sort: ["label", "notes", "sortFields"],
  removeDuplicates: ["label", "notes", "compare", "fields"],
  aggregate: ["label", "notes", "aggregate", "fields"],
  merge: ["label", "notes", "mode", "mergeByFields"],
  switch: ["label", "notes", "rules", "fallbackOutput"],
  code: ["label", "notes", "jsCode", "code", "language", "mode", "timeoutMs"],
  condition: ["label", "notes", "conditions", "combinator"],
  splitOut: ["label", "notes", "fieldToSplitOut"],
  document: ["label", "notes", "documentId", "operation"],
  spreadsheet: ["label", "notes", "spreadsheetId", "operation"],
  email: ["label", "notes", "to", "subject", "text", "html", "credentialId"],
  result: ["label", "notes", "mapFrom"],
  wait: ["label", "notes", "resume", "amount", "unit", "dateTime"],
  loop: ["label", "notes", "batchSize"],
  noop: ["label", "notes"],
  integration: ["label", "notes"],
  ai: ["label", "notes", "prompt", "provider", "model", "credentialId"],
  bot: ["label", "notes", "assistantId", "prompt"],
  workflowTrigger: ["label", "notes"],
  executeWorkflow: ["label", "notes", "workflowId", "waitForCompletion", "mode"],
  errorTrigger: ["label", "notes"],
  aiAgent: ["label", "notes", "prompt", "systemMessage", "maxIterations"],
  aiChatModel: [
    "label",
    "notes",
    "provider",
    "model",
    "credentialId",
    "temperature",
  ],
  aiCalculatorTool: ["label", "notes", "toolName", "description"],
  aiHttpTool: [
    "label",
    "notes",
    "toolName",
    "description",
    "method",
    "url",
    "credentialId",
  ],
  respondToWebhook: [
    "label",
    "notes",
    "statusCode",
    "responseType",
    "body",
    "responseHeaders",
  ],
  aiModelProviderTest: ["label", "notes", "model"],
  aiToolProviderTest: ["label", "notes", "toolName"],
  aiMemoryProviderTest: ["label", "notes"],
  aiAgentTest: ["label", "notes"],
});

const REQUIRED_PARAMS = Object.freeze({
  http: ["url"],
  email: ["to"],
  executeWorkflow: ["workflowId"],
  aiHttpTool: ["url"],
});

let _libraryCache = null;

const loadNodeLibrary = () => {
  if (_libraryCache) return _libraryCache;
  const libraryPath = path.join(
    __dirname,
    "../../frontend/src/modules/workflows/nodeLibrary.json"
  );
  _libraryCache = JSON.parse(fs.readFileSync(libraryPath, "utf8"));
  return _libraryCache;
};

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

const nodeTypeOf = (node) => node?.type || node?.data?.nodeType || null;

const stableStringify = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
    .join(",")}}`;
};

const hashDefinition = (definition) =>
  crypto
    .createHash("sha256")
    .update(
      stableStringify({
        nodes: definition?.nodes || [],
        edges: definition?.edges || [],
        settings: definition?.settings || {},
      })
    )
    .digest("hex")
    .slice(0, 24);

const truncateString = (value, max = CONTEXT_LIMITS.MAX_PARAM_STRING) => {
  if (typeof value !== "string") return value;
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
};

const isSecretKey = (key) =>
  FORBIDDEN_PARAM_KEYS.has(key) || SECRET_KEY_RE.test(String(key || ""));

/**
 * Central sanitizer for node parameters / nested objects.
 * Credential refs become safe metadata only.
 */
const sanitizeValue = (value, keyHint = "") => {
  if (value == null) return value;
  if (isSecretKey(keyHint)) return "[REDACTED]";
  if (typeof value === "string") {
    if (/^Bearer\s+/i.test(value) || /^sk-[a-zA-Z0-9]/.test(value)) {
      return "[REDACTED]";
    }
    return truncateString(value);
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, CONTEXT_LIMITS.MAX_PREVIEW_ITEMS)
      .map((v) => sanitizeValue(v, keyHint));
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (isSecretKey(k)) {
      if (k === "credentialId" || /credential/i.test(k)) {
        out.credentialConfigured = Boolean(v);
        if (typeof v === "string" && v.length > 0) {
          out.credentialId = String(v).slice(0, 36);
        }
      } else {
        out[k] = "[REDACTED]";
      }
      continue;
    }
    if (k === "credentialId") {
      out.credentialConfigured = Boolean(v);
      if (typeof v === "string" && v) out.credentialId = String(v).slice(0, 36);
      continue;
    }
    out[k] = sanitizeValue(v, k);
  }
  return out;
};

const sanitizeNodeParameters = (data = {}) => {
  const skip = new Set([
    "runStatus",
    "runPreview",
    "pinnedOutput",
    "pinned",
    "cacheState",
  ]);
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (skip.has(k)) continue;
    if (k === "credentialId") {
      out.credentialConfigured = Boolean(v);
      if (typeof v === "string" && v) out.credentialId = String(v).slice(0, 36);
      continue;
    }
    if (isSecretKey(k)) {
      out[k] = "[REDACTED]";
      continue;
    }
    out[k] = sanitizeValue(v, k);
  }
  return out;
};

const getAvailableEngineTypes = () => {
  const catalog = loadNodeLibrary();
  const available = new Set();
  const soon = new Set();
  for (const entry of catalog.nodes || []) {
    if (entry.available && entry.engineType) {
      available.add(entry.engineType);
    } else if (!entry.available) {
      if (entry.engineType) soon.add(entry.engineType);
      soon.add(entry.id);
    }
  }
  return { available, soon, catalog };
};

const listSafeNodeContracts = () => {
  const { getPortContract } = require("./workflowConnection.service");
  const { getEngineContract } = require("../config/nodeContract");
  const { available, catalog } = getAvailableEngineTypes();
  const {
    ALLOWED_NODE_TYPES,
  } = require("../modules/workflows/workflows.service");

  const byEngine = new Map();
  for (const entry of catalog.nodes || []) {
    if (!entry.engineType) continue;
    if (!byEngine.has(entry.engineType)) {
      byEngine.set(entry.engineType, entry);
    }
  }

  const contracts = [];
  for (const nodeType of ALLOWED_NODE_TYPES) {
    const lib = byEngine.get(nodeType);
    const ports = getPortContract(nodeType);
    const engine = getEngineContract(nodeType);
    const isAvailable = available.has(nodeType);
    contracts.push({
      nodeType,
      displayName: lib?.name || nodeType,
      available: isAvailable,
      category: lib?.category || engine.category || "Core",
      ports: {
        inputs: (ports.inputs || []).map((p) => ({
          id: p.id,
          kind: p.kind,
          connectionKind: p.connectionKind,
          dataType: p.dataType,
          maxConnections: p.maxConnections,
          required: Boolean(p.required),
          label: p.label,
        })),
        outputs: (ports.outputs || []).map((p) => ({
          id: p.id,
          kind: p.kind,
          connectionKind: p.connectionKind,
          dataType: p.dataType,
          label: p.label,
        })),
      },
      requiredParameters: REQUIRED_PARAMS[nodeType] || [],
      parameterKeys: PARAM_ALLOWLIST[nodeType] || ["label", "notes"],
      dynamicPorts: Boolean(engine.dynamicOutputs),
      isAuxiliaryProvider: Boolean(engine.isAuxiliaryProvider),
      isTrigger: Boolean(engine.isTrigger),
      isTerminal: Boolean(engine.isTerminal),
    });
  }
  return contracts;
};

const assertAvailableNodeType = (nodeType) => {
  const { available } = getAvailableEngineTypes();
  const {
    ALLOWED_NODE_TYPES,
  } = require("../modules/workflows/workflows.service");
  if (!nodeType || typeof nodeType !== "string") {
    throw new AppError(
      "addNode requires nodeType",
      400,
      COPILOT_ERROR.MALFORMED_PLAN
    );
  }
  // Copilot may only propose library-available + engine-allowed types.
  if (!ALLOWED_NODE_TYPES.has(nodeType) || !available.has(nodeType)) {
    throw new AppError(
      `Node type "${nodeType}" is not available`,
      400,
      COPILOT_ERROR.NODE_UNAVAILABLE
    );
  }
};

const assertAllowedParameters = (nodeType, changes) => {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    throw new AppError(
      "parameter changes must be an object",
      400,
      COPILOT_ERROR.MALFORMED_PLAN
    );
  }
  const allow = new Set(PARAM_ALLOWLIST[nodeType] || ["label", "notes"]);
  for (const key of Object.keys(changes)) {
    if (FORBIDDEN_PARAM_KEYS.has(key) || isSecretKey(key)) {
      throw new AppError(
        `Parameter "${key}" is not allowed`,
        400,
        COPILOT_ERROR.UNKNOWN_PARAMETER
      );
    }
    if (!allow.has(key)) {
      throw new AppError(
        `Unknown parameter "${key}" for node type "${nodeType}"`,
        400,
        COPILOT_ERROR.UNKNOWN_PARAMETER
      );
    }
  }
};

const collectUnresolvedInputs = (definition, operations, intentHints = {}) => {
  const unresolved = [];
  const nodes = definition.nodes || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  for (const op of operations || []) {
    if (op.type === "addNode" || op.type === "updateNodeParameters") {
      const nodeId =
        op.type === "addNode"
          ? op._allocatedId || op.tempId
          : resolveNodeRef(op.nodeId, op._tempMap);
      const node = byId.get(nodeId);
      const type = op.nodeType || nodeTypeOf(node);
      const params = {
        ...(node?.data || {}),
        ...(op.parameters || op.changes || {}),
      };
      for (const req of REQUIRED_PARAMS[type] || []) {
        const val = params[req];
        if (val == null || val === "") {
          unresolved.push({
            nodeId,
            nodeType: type,
            field: req,
            message:
              req === "url"
                ? intentHints.crm
                  ? "CRM API URL"
                  : "API URL"
                : `Required field: ${req}`,
          });
        }
      }
      if (type === "http" || type === "email" || type === "aiChatModel") {
        if (!params.credentialId && intentHints.needsCredential) {
          unresolved.push({
            nodeId,
            nodeType: type,
            field: "credentialId",
            message: "Credential required (select explicitly)",
          });
        }
      }
    }
  }

  // Also scan resulting definition for http missing url
  for (const node of nodes) {
    const type = nodeTypeOf(node);
    for (const req of REQUIRED_PARAMS[type] || []) {
      const val = node.data?.[req];
      if (val == null || val === "") {
        const already = unresolved.some(
          (u) => u.nodeId === node.id && u.field === req
        );
        if (!already) {
          unresolved.push({
            nodeId: node.id,
            nodeType: type,
            field: req,
            message: req === "url" ? "API URL" : `Required field: ${req}`,
          });
        }
      }
    }
  }
  return unresolved;
};

const resolveNodeRef = (ref, tempMap = {}) => {
  if (ref == null) return ref;
  if (tempMap[ref]) return tempMap[ref];
  return ref;
};

const allocateNodeId = (nodeType, usedIds) => {
  let id;
  let n = 0;
  do {
    id = `${nodeType}-${Date.now()}-${n}-${crypto.randomBytes(3).toString("hex")}`;
    n += 1;
  } while (usedIds.has(id));
  usedIds.add(id);
  return id;
};

const classifyOperation = (op) => {
  if (!op || typeof op !== "object" || !op.type) {
    return { destructive: false, severity: "error" };
  }
  if (op.type === "updateNodeParameters") {
    const keys = Object.keys(op.changes || {});
    const major = keys.some((k) =>
      ["url", "workflowId", "jsCode", "body", "prompt"].includes(k)
    );
    return {
      destructive: major,
      severity: major ? "destructive" : "non-destructive",
    };
  }
  if (op.type === "setWorkflowSetting") {
    return { destructive: true, severity: "destructive" };
  }
  if (DESTRUCTIVE_OPS.has(op.type)) {
    return { destructive: true, severity: "destructive" };
  }
  return { destructive: false, severity: "non-destructive" };
};

/**
 * Pure apply of operations onto a cloned definition.
 * Allocates real IDs for addNode (model must not supply trusted persistent ids).
 */
const applyOperationsToDefinition = (definition, operations, options = {}) => {
  const next = cloneJson(definition || { version: 1, nodes: [], edges: [] });
  if (!Array.isArray(next.nodes)) next.nodes = [];
  if (!Array.isArray(next.edges)) next.edges = [];
  if (!next.settings || typeof next.settings !== "object") next.settings = {};

  const tempMap = { ...(options.tempMap || {}) };
  const usedIds = new Set(next.nodes.map((n) => n.id));
  const applied = [];

  if (!Array.isArray(operations)) {
    throw new AppError(
      "operations must be an array",
      400,
      COPILOT_ERROR.MALFORMED_PLAN
    );
  }

  for (const raw of operations) {
    if (!raw || typeof raw !== "object" || typeof raw.type !== "string") {
      throw new AppError(
        "Malformed operation",
        400,
        COPILOT_ERROR.MALFORMED_PLAN
      );
    }
    if (!SUPPORTED_OPERATIONS.includes(raw.type)) {
      throw new AppError(
        `Unknown or unsupported operation: ${raw.type}`,
        400,
        COPILOT_ERROR.UNKNOWN_OPERATION
      );
    }
    if (
      raw.type === "executeCode" ||
      raw.type === "sql" ||
      raw.type === "patchJson" ||
      raw.type === "eval" ||
      raw.type === "createCredential"
    ) {
      throw new AppError(
        `Unsupported operation: ${raw.type}`,
        400,
        COPILOT_ERROR.UNKNOWN_OPERATION
      );
    }

    const op = { ...raw, ...classifyOperation(raw) };

    switch (op.type) {
      case "addNode": {
        if (op.id || op.nodeId) {
          throw new AppError(
            "Model must not supply persistent node IDs; use tempId",
            400,
            COPILOT_ERROR.PERSISTENT_ID_FORBIDDEN
          );
        }
        assertAvailableNodeType(op.nodeType);
        if (!op.tempId || typeof op.tempId !== "string") {
          throw new AppError(
            "addNode requires tempId",
            400,
            COPILOT_ERROR.MALFORMED_PLAN
          );
        }
        if (tempMap[op.tempId]) {
          throw new AppError(
            `Duplicate tempId: ${op.tempId}`,
            400,
            COPILOT_ERROR.MALFORMED_PLAN
          );
        }
        const params = op.parameters || {};
        assertAllowedParameters(op.nodeType, params);
        const id = allocateNodeId(op.nodeType, usedIds);
        tempMap[op.tempId] = id;
        const position =
          op.positionHint &&
          typeof op.positionHint.x === "number" &&
          typeof op.positionHint.y === "number"
            ? { x: op.positionHint.x, y: op.positionHint.y }
            : {
                x: 120 + next.nodes.length * 40,
                y: 120 + (next.nodes.length % 5) * 80,
              };
        next.nodes.push({
          id,
          type: op.nodeType,
          position,
          data: {
            label: params.label || op.nodeType,
            nodeType: op.nodeType,
            ...params,
          },
        });
        applied.push({ ...op, _allocatedId: id });
        break;
      }
      case "removeNode": {
        const nodeId = resolveNodeRef(op.nodeId, tempMap);
        const beforeEdges = next.edges.filter(
          (e) => e.source === nodeId || e.target === nodeId
        );
        next.nodes = next.nodes.filter((n) => n.id !== nodeId);
        next.edges = next.edges.filter(
          (e) => e.source !== nodeId && e.target !== nodeId
        );
        usedIds.delete(nodeId);
        applied.push({
          ...op,
          nodeId,
          _removedEdges: beforeEdges.map((e) => e.id),
        });
        break;
      }
      case "updateNodeParameters": {
        const nodeId = resolveNodeRef(op.nodeId, tempMap);
        const node = next.nodes.find((n) => n.id === nodeId);
        if (!node) {
          throw new AppError(
            `Unknown node: ${nodeId}`,
            400,
            COPILOT_ERROR.MALFORMED_PLAN
          );
        }
        assertAllowedParameters(nodeTypeOf(node), op.changes || {});
        node.data = { ...(node.data || {}), ...(op.changes || {}) };
        applied.push({ ...op, nodeId });
        break;
      }
      case "renameNode": {
        const nodeId = resolveNodeRef(op.nodeId, tempMap);
        const node = next.nodes.find((n) => n.id === nodeId);
        if (!node) {
          throw new AppError(
            `Unknown node: ${nodeId}`,
            400,
            COPILOT_ERROR.MALFORMED_PLAN
          );
        }
        if (typeof op.label !== "string" || !op.label.trim()) {
          throw new AppError(
            "renameNode requires label",
            400,
            COPILOT_ERROR.MALFORMED_PLAN
          );
        }
        node.data = { ...(node.data || {}), label: op.label.trim() };
        applied.push({ ...op, nodeId });
        break;
      }
      case "connectNodes": {
        const source = resolveNodeRef(op.sourceNodeId, tempMap);
        const target = resolveNodeRef(op.targetNodeId, tempMap);
        if (!usedIds.has(source) && !next.nodes.some((n) => n.id === source)) {
          throw new AppError(
            `Unknown source node: ${op.sourceNodeId}`,
            400,
            COPILOT_ERROR.TEMP_ID_UNKNOWN
          );
        }
        if (!next.nodes.some((n) => n.id === target)) {
          throw new AppError(
            `Unknown target node: ${op.targetNodeId}`,
            400,
            COPILOT_ERROR.TEMP_ID_UNKNOWN
          );
        }
        const edgeId =
          op.edgeId ||
          `e-${crypto.randomBytes(4).toString("hex")}`;
        next.edges.push({
          id: edgeId,
          source,
          target,
          sourceHandle: op.sourceHandle ?? undefined,
          targetHandle: op.targetHandle ?? undefined,
        });
        applied.push({
          ...op,
          sourceNodeId: source,
          targetNodeId: target,
          edgeId,
        });
        break;
      }
      case "disconnectEdge": {
        const edgeId = op.edgeId;
        const before = next.edges.find((e) => e.id === edgeId);
        if (!before) {
          throw new AppError(
            `Unknown edge: ${edgeId}`,
            400,
            COPILOT_ERROR.MALFORMED_PLAN
          );
        }
        next.edges = next.edges.filter((e) => e.id !== edgeId);
        applied.push({ ...op, _removed: before });
        break;
      }
      case "reconnectEdge": {
        const edge = next.edges.find((e) => e.id === op.edgeId);
        if (!edge) {
          throw new AppError(
            `Unknown edge: ${op.edgeId}`,
            400,
            COPILOT_ERROR.MALFORMED_PLAN
          );
        }
        const previous = { ...edge };
        if (op.sourceNodeId != null) {
          edge.source = resolveNodeRef(op.sourceNodeId, tempMap);
        }
        if (op.targetNodeId != null) {
          edge.target = resolveNodeRef(op.targetNodeId, tempMap);
        }
        if ("sourceHandle" in op) edge.sourceHandle = op.sourceHandle;
        if ("targetHandle" in op) edge.targetHandle = op.targetHandle;
        applied.push({ ...op, _previous: previous });
        break;
      }
      case "setWorkflowSetting": {
        if (!SAFE_WORKFLOW_SETTINGS.has(op.key)) {
          throw new AppError(
            `Setting "${op.key}" is not allowed via Copilot`,
            400,
            COPILOT_ERROR.UNSUPPORTED_SETTING
          );
        }
        if (op.key === "errorWorkflowId") {
          const workflowId = options.workflowId || next.id || null;
          if (
            op.value != null &&
            workflowId != null &&
            String(op.value) === String(workflowId)
          ) {
            throw new AppError(
              "A workflow cannot use itself as its Error Workflow",
              400,
              "ERROR_WORKFLOW_SELF"
            );
          }
          if (op.value != null && options.errorTargetDefinitions) {
            const tgt = options.errorTargetDefinitions[String(op.value)];
            if (!tgt) {
              throw new AppError(
                "Error Workflow must belong to the same workspace",
                403,
                "FORBIDDEN"
              );
            }
            const {
              validateErrorWorkflow,
            } = require("./workflowErrorRouting.service");
            const callability = validateErrorWorkflow(tgt);
            if (!callability.valid) {
              throw new AppError(
                callability.errors[0] || "Error Workflow is not callable",
                400,
                "ERROR_WORKFLOW_NOT_CALLABLE"
              );
            }
          }
          next.settings.errorWorkflowId =
            op.value == null || op.value === "" ? null : String(op.value);
        }
        applied.push(op);
        break;
      }
      default:
        throw new AppError(
          `Unknown operation: ${op.type}`,
          400,
          COPILOT_ERROR.UNKNOWN_OPERATION
        );
    }
  }

  return { definition: next, tempMap, applied };
};

const runAuthoritativeValidation = (definition, options = {}) => {
  const issues = [];
  const {
    validateDefinition,
  } = require("../modules/workflows/workflows.service");
  try {
    validateDefinition(definition);
  } catch (err) {
    issues.push({
      code: err.code || "VALIDATION_ERROR",
      severity: "error",
      message: err.message,
      fixable: false,
    });
  }

  // Subworkflow callable when executeWorkflow nodes reference provided defs
  if (options.childDefinitions) {
    const {
      validateCallableWorkflow,
    } = require("./workflowSubworkflow.service");
    for (const node of definition.nodes || []) {
      if (nodeTypeOf(node) !== "executeWorkflow") continue;
      const childId = node.data?.workflowId;
      if (!childId) continue;
      const childDef = options.childDefinitions[String(childId)];
      if (!childDef) {
        issues.push({
          code: "SUBWORKFLOW_NOT_FOUND",
          severity: "error",
          nodeId: node.id,
          message: "Execute Workflow target not found in workspace",
          fixable: false,
        });
        continue;
      }
      const check = validateCallableWorkflow(childDef);
      if (!check.valid) {
        issues.push({
          code: "SUBWORKFLOW_ENTRY_REQUIRED",
          severity: "error",
          nodeId: node.id,
          message: check.errors[0],
          fixable: false,
        });
      }
    }
  }

  if (options.recursionCheck) {
    const chain = options.recursionCheck.chain || [];
    const selfId = options.recursionCheck.workflowId;
    for (const node of definition.nodes || []) {
      if (nodeTypeOf(node) !== "executeWorkflow") continue;
      const childId = node.data?.workflowId;
      if (!childId) continue;
      if (String(childId) === String(selfId) || chain.includes(String(childId))) {
        issues.push({
          code: "SUBWORKFLOW_RECURSION",
          severity: "error",
          nodeId: node.id,
          message: "Sub-workflow recursion is not allowed",
          fixable: false,
        });
      }
    }
  }

  return issues;
};

/**
 * Side-effect-free validation of a Copilot plan.
 */
const validateCopilotOperations = ({
  definition,
  operations,
  contracts: _contracts,
  workspace,
  workflowId,
  baseRevisionHash,
  intentHints,
} = {}) => {
  const base = cloneJson(definition || { version: 1, nodes: [], edges: [] });
  const liveHash = hashDefinition(base);
  if (baseRevisionHash != null && baseRevisionHash !== liveHash) {
    return {
      valid: false,
      resultingDefinition: base,
      issues: [
        {
          code: COPILOT_ERROR.PLAN_STALE,
          severity: "error",
          message: "Workflow changed since this Copilot plan was created",
          fixable: false,
        },
      ],
      warnings: [],
      revisionHash: liveHash,
      preview: null,
    };
  }

  let resultingDefinition = base;
  let applied = [];
  const issues = [];
  const warnings = [];

  try {
    const result = applyOperationsToDefinition(base, operations, {
      workflowId: workflowId || workspace?.workflowId,
      errorTargetDefinitions: workspace?.errorTargetDefinitions,
      tempMap: {},
    });
    resultingDefinition = result.definition;
    applied = result.applied;
  } catch (err) {
    return {
      valid: false,
      resultingDefinition: base,
      issues: [
        {
          code: err.code || COPILOT_ERROR.MALFORMED_PLAN,
          severity: "error",
          message: err.message,
          fixable: false,
        },
      ],
      warnings: [],
      revisionHash: liveHash,
      preview: null,
    };
  }

  const authIssues = runAuthoritativeValidation(resultingDefinition, {
    childDefinitions: workspace?.childDefinitions,
    recursionCheck: workspace?.recursionCheck,
  });
  issues.push(...authIssues);

  const unresolvedInputs = collectUnresolvedInputs(
    resultingDefinition,
    applied,
    intentHints || {}
  );
  const preview = buildPreview(base, resultingDefinition, applied, unresolvedInputs);

  return {
    valid: issues.filter((i) => i.severity === "error").length === 0,
    resultingDefinition,
    issues,
    warnings,
    unresolvedInputs,
    preview,
    revisionHash: liveHash,
    appliedOperations: applied,
  };
};

const diffWorkflowDefinitions = (before, after) => {
  const beforeNodes = new Map((before?.nodes || []).map((n) => [n.id, n]));
  const afterNodes = new Map((after?.nodes || []).map((n) => [n.id, n]));
  const beforeEdges = new Map((before?.edges || []).map((e) => [e.id, e]));
  const afterEdges = new Map((after?.edges || []).map((e) => [e.id, e]));

  const nodesAdded = [];
  const nodesRemoved = [];
  const nodesChanged = [];
  for (const [id, node] of afterNodes) {
    if (!beforeNodes.has(id)) nodesAdded.push({ id, type: nodeTypeOf(node), label: node.data?.label });
    else {
      const prev = beforeNodes.get(id);
      if (stableStringify(prev.data) !== stableStringify(node.data)) {
        nodesChanged.push({
          id,
          type: nodeTypeOf(node),
          label: node.data?.label,
        });
      }
    }
  }
  for (const [id, node] of beforeNodes) {
    if (!afterNodes.has(id)) {
      nodesRemoved.push({ id, type: nodeTypeOf(node), label: node.data?.label });
    }
  }

  const connectionsAdded = [];
  const connectionsRemoved = [];
  for (const [id, edge] of afterEdges) {
    if (!beforeEdges.has(id)) {
      connectionsAdded.push({
        id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle || null,
        targetHandle: edge.targetHandle || null,
      });
    }
  }
  for (const [id, edge] of beforeEdges) {
    if (!afterEdges.has(id)) {
      connectionsRemoved.push({
        id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle || null,
        targetHandle: edge.targetHandle || null,
      });
    }
  }

  return {
    nodesAdded,
    nodesRemoved,
    nodesChanged,
    connectionsAdded,
    connectionsRemoved,
  };
};

const buildPreview = (before, after, operations, unresolvedInputs) => {
  const diff = diffWorkflowDefinitions(before, after);
  const parts = [];
  for (const n of diff.nodesAdded) parts.push(`+ node ${n.label || n.type}`);
  for (const n of diff.nodesRemoved) parts.push(`- node ${n.label || n.type}`);
  for (const n of diff.nodesChanged) parts.push(`~ node ${n.label || n.id}`);
  for (const e of diff.connectionsAdded) {
    parts.push(
      `+ edge ${e.source}.${e.sourceHandle || "main"} → ${e.target}.${e.targetHandle || "main"}`
    );
  }
  for (const e of diff.connectionsRemoved) {
    parts.push(
      `- edge ${e.source}.${e.sourceHandle || "main"} → ${e.target}.${e.targetHandle || "main"}`
    );
  }
  return {
    summary: parts.join("; ") || "No structural changes",
    operations: (operations || []).map((op) => ({
      type: op.type,
      destructive: Boolean(op.destructive),
      severity: op.severity || classifyOperation(op).severity,
      nodeId: op.nodeId || op._allocatedId,
      edgeId: op.edgeId,
      removedEdges: op._removedEdges,
    })),
    ...diff,
    unresolvedInputs: unresolvedInputs || [],
  };
};

/**
 * Revalidate + return applied definition. Does NOT persist, execute, or activate.
 * Atomic: either full resulting definition or error (no half-apply returned).
 */
const applyCopilotOperations = ({
  definition,
  operations,
  workspace,
  workflowId,
  baseRevisionHash,
  intentHints,
} = {}) => {
  const validation = validateCopilotOperations({
    definition,
    operations,
    workspace,
    workflowId,
    baseRevisionHash,
    intentHints,
  });

  if (!validation.valid) {
    throw new AppError(
      validation.issues[0]?.message || "Copilot plan is invalid",
      400,
      validation.issues[0]?.code || COPILOT_ERROR.APPLY_INVALID
    );
  }

  // Second revalidation pass (stale / race protection already in validate)
  const recheck = validateCopilotOperations({
    definition,
    operations,
    workspace,
    workflowId,
    baseRevisionHash: validation.revisionHash,
    intentHints,
  });
  if (!recheck.valid) {
    throw new AppError(
      recheck.issues[0]?.message || "Copilot plan failed revalidation",
      400,
      recheck.issues[0]?.code || COPILOT_ERROR.APPLY_INVALID
    );
  }

  const newHash = hashDefinition(recheck.resultingDefinition);
  return {
    definition: recheck.resultingDefinition,
    preview: recheck.preview,
    unresolvedInputs: recheck.unresolvedInputs,
    revisionHash: newHash,
    baseRevisionHash: validation.revisionHash,
    source: "copilot",
    executed: false,
    activated: false,
    persisted: false,
    historyTransaction: true,
    changedNodeIds: [
      ...recheck.preview.nodesAdded.map((n) => n.id),
      ...recheck.preview.nodesRemoved.map((n) => n.id),
      ...recheck.preview.nodesChanged.map((n) => n.id),
    ],
    changedEdgeIds: [
      ...recheck.preview.connectionsAdded.map((e) => e.id),
      ...recheck.preview.connectionsRemoved.map((e) => e.id),
    ],
    invalidationHints: buildInvalidationHints(definition, recheck.preview),
  };
};

const buildInvalidationHints = (before, preview) => {
  const events = [];
  for (const n of preview.nodesChanged || []) {
    events.push({ type: "config_change", nodeId: n.id });
  }
  for (const e of preview.connectionsAdded || []) {
    events.push({ type: "edge_add", targetNodeId: e.target });
  }
  for (const e of preview.connectionsRemoved || []) {
    events.push({ type: "edge_remove", previousTarget: e.target });
  }
  for (const n of preview.nodesRemoved || []) {
    events.push({ type: "node_delete", nodeId: n.id });
  }
  for (const n of preview.nodesAdded || []) {
    events.push({ type: "node_insert", nodeId: n.id });
  }
  return events;
};

/**
 * Normalize diagnosis issues over existing validators (no huge lint framework).
 */
const diagnoseWorkflow = (definition, options = {}) => {
  const issues = [];
  const nodes = definition?.nodes || [];
  const edges = definition?.edges || [];

  const {
    validateDefinitionConnections,
    resolveAuxiliaryBindings,
  } = require("./workflowConnection.service");
  const connectionCheck = validateDefinitionConnections(definition);
  if (!connectionCheck.ok) {
    for (const msg of connectionCheck.errors || [connectionCheck.errors]) {
      issues.push({
        code: "INVALID_GRAPH_EDGE",
        severity: "error",
        message: typeof msg === "string" ? msg : String(msg),
        fixable: false,
      });
    }
  }

  try {
    const { buildGraph } = require("./workflowEngine.service");
    const {
      validateControlledCycles,
    } = require("./workflowLoopGraph.service");
    const cycleCheck = validateControlledCycles(buildGraph(definition));
    if (!cycleCheck.ok) {
      for (const msg of cycleCheck.errors || []) {
        issues.push({
          code: "INVALID_LOOP_TOPOLOGY",
          severity: "error",
          message: msg,
          fixable: false,
        });
      }
    }
  } catch (err) {
    issues.push({
      code: "VALIDATION_ERROR",
      severity: "error",
      message: err.message,
      fixable: false,
    });
  }

  const {
    validateWebhookRespondDefinition,
  } = require("./workflowWebhookRespond.service");
  const respondCheck = validateWebhookRespondDefinition(definition);
  if (!respondCheck.ok) {
    issues.push({
      code: respondCheck.code || "RESPOND_WEBHOOK_INVALID",
      severity: "error",
      message: respondCheck.message,
      fixable: false,
    });
  }

  const { AI_ERROR } = require("./workflowAiResources.service");
  for (const node of nodes) {
    const type = nodeTypeOf(node);
    if (type !== "aiAgent" && type !== "aiAgentTest") continue;
    const bindings = resolveAuxiliaryBindings({
      nodeId: node.id,
      definition,
    });
    if (!bindings.model || bindings.model.length === 0) {
      const modelCandidates = nodes.filter((n) => {
        const t = nodeTypeOf(n);
        return t === "aiChatModel" || t === "aiModelProviderTest";
      });
      const unconnected = modelCandidates.filter((m) => {
        const used = edges.some(
          (e) =>
            e.source === m.id &&
            (e.sourceHandle === "model" || e.targetHandle === "model")
        );
        return !used;
      });
      issues.push({
        code: AI_ERROR.MODEL_REQUIRED || "AI_MODEL_REQUIRED",
        severity: "error",
        nodeId: node.id,
        message: "AI Agent requires a Chat Model connection.",
        fixable: unconnected.length === 1,
        fixHint:
          unconnected.length === 1
            ? {
                type: "connectNodes",
                sourceNodeId: unconnected[0].id,
                sourceHandle: "model",
                targetNodeId: node.id,
                targetHandle: "model",
              }
            : null,
      });
    }
  }

  return {
    issues: issues.slice(0, CONTEXT_LIMITS.MAX_VALIDATION_ISSUES),
    configurationLooksValid: issues.filter((i) => i.severity === "error").length === 0,
    // Explicit: never claim runtime success
    runtimeSuccessGuaranteed: false,
  };
};

const neighborIds = (definition, seedIds, hops = 1) => {
  const edges = definition?.edges || [];
  let frontier = new Set(seedIds);
  const all = new Set(seedIds);
  for (let h = 0; h < hops; h += 1) {
    const next = new Set();
    for (const e of edges) {
      if (frontier.has(e.source) && !all.has(e.target)) {
        next.add(e.target);
        all.add(e.target);
      }
      if (frontier.has(e.target) && !all.has(e.source)) {
        next.add(e.source);
        all.add(e.source);
      }
    }
    frontier = next;
  }
  return all;
};

/**
 * Safe bounded Copilot context. Never includes decrypted secrets / resume tokens.
 */
const buildCopilotContext = ({
  workflow,
  definition,
  selectedNodeId,
  execution,
  validationIssues,
  intent = "EXPLAIN",
} = {}) => {
  const def = definition || workflow?.definition || { nodes: [], edges: [] };
  const nodes = Array.isArray(def.nodes) ? def.nodes : [];
  const edges = Array.isArray(def.edges) ? def.edges : [];

  const priority = new Set();
  if (selectedNodeId) priority.add(selectedNodeId);
  if (execution?.failedNodeId) priority.add(execution.failedNodeId);
  const neighborhood = neighborIds(
    def,
    [...priority],
    CONTEXT_LIMITS.MAX_NEIGHBOR_HOPS
  );

  const detailedBudget = CONTEXT_LIMITS.MAX_NODES_DETAILED;
  const detailedIds = new Set([...neighborhood]);
  for (const n of nodes) {
    if (detailedIds.size >= detailedBudget) break;
    detailedIds.add(n.id);
  }

  // Always retain selected/failed even under truncation
  if (selectedNodeId) detailedIds.add(selectedNodeId);
  if (execution?.failedNodeId) detailedIds.add(execution.failedNodeId);

  const skeleton = nodes.map((n) => ({
    id: n.id,
    type: nodeTypeOf(n),
    label: n.data?.label || nodeTypeOf(n),
  }));

  const detailedNodes = nodes
    .filter((n) => detailedIds.has(n.id))
    .map((n) => ({
      id: n.id,
      type: nodeTypeOf(n),
      label: n.data?.label || nodeTypeOf(n),
      parameters: sanitizeNodeParameters(n.data || {}),
      position: n.position
        ? { x: Number(n.position.x) || 0, y: Number(n.position.y) || 0 }
        : undefined,
    }));

  const safeEdges = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle || null,
    targetHandle: e.targetHandle || null,
  }));

  let selectedNode = null;
  if (selectedNodeId) {
    const n = nodes.find((x) => x.id === selectedNodeId);
    if (n) {
      selectedNode = {
        nodeId: n.id,
        nodeType: nodeTypeOf(n),
        parameters: sanitizeNodeParameters(n.data || {}),
        prioritized: true,
      };
    }
  }

  let safeExecution = null;
  if (execution) {
    safeExecution = {
      runId: execution.runId || null,
      status: execution.status || null,
      failedNodeId: execution.failedNodeId || null,
      failedExecutionIndex:
        execution.failedExecutionIndex != null
          ? Number(execution.failedExecutionIndex)
          : null,
      safeError: execution.safeError
        ? {
            code: execution.safeError.code || null,
            message: truncateString(
              String(execution.safeError.message || ""),
              500
            ),
          }
        : null,
      inputPreview: sanitizeValue(execution.inputPreview),
      outputPreview: sanitizeValue(execution.outputPreview),
      toolTrace: Array.isArray(execution.toolTrace)
        ? execution.toolTrace.slice(0, CONTEXT_LIMITS.MAX_TOOL_TRACE).map((t) =>
            sanitizeValue({
              name: t.name,
              status: t.status,
              errorCode: t.errorCode,
            })
          )
        : undefined,
      childLineage: Array.isArray(execution.childLineage)
        ? execution.childLineage
            .slice(0, CONTEXT_LIMITS.MAX_LINEAGE_CHILDREN)
            .map((c) => ({
              childRunId: c.childRunId || c.runId || null,
              childWorkflowName: c.childWorkflowName || c.name || null,
              status: c.status || null,
            }))
        : undefined,
      errorRouting: execution.errorRouting
        ? {
            handlerExists: Boolean(execution.errorRouting.handlerExists),
            handlerRunStatus: execution.errorRouting.handlerRunStatus || null,
            // Source failure is authoritative
            sourceStatus: execution.status || "failed",
          }
        : undefined,
    };

    // Strip any leaked tokens if caller accidentally passed them
    if (execution.resumeToken || execution.waitToken || execution.externalToken) {
      // intentionally omitted from safeExecution
    }
  }

  const contracts = listSafeNodeContracts();
  const diagnosis =
    validationIssues || diagnoseWorkflow(def).issues;

  return {
    intent: COPILOT_INTENTS.includes(intent) ? intent : "EXPLAIN",
    revisionHash: hashDefinition(def),
    limits: { ...CONTEXT_LIMITS },
    workflow: {
      id: workflow?.id || null,
      name: workflow?.name || null,
      active: Boolean(workflow?.active || workflow?.status === "active"),
      settings: {
        errorWorkflowId:
          def.settings?.errorWorkflowId ?? workflow?.errorWorkflowId ?? null,
      },
      nodeCount: nodes.length,
      edgeCount: edges.length,
      skeleton,
      nodes: detailedNodes,
      edges: safeEdges,
      truncated: nodes.length > detailedIds.size,
    },
    selectedNode,
    validationIssues: (diagnosis || []).slice(
      0,
      CONTEXT_LIMITS.MAX_VALIDATION_ISSUES
    ),
    execution: safeExecution,
    availableNodeTypes: contracts
      .filter((c) => c.available)
      .map((c) => c.nodeType),
    nodeContracts: contracts,
    notes: [
      "Static diagnosis does not guarantee runtime success.",
      "Copilot never executes or activates workflows.",
    ],
  };
};

const normalizePlan = (plan = {}) => {
  if (!plan || typeof plan !== "object") {
    throw new AppError("Invalid plan", 400, COPILOT_ERROR.MALFORMED_PLAN);
  }
  return {
    intent: COPILOT_INTENTS.includes(plan.intent) ? plan.intent : "MODIFY",
    summary: typeof plan.summary === "string" ? plan.summary : "",
    operations: Array.isArray(plan.operations) ? plan.operations : [],
    unresolvedInputs: Array.isArray(plan.unresolvedInputs)
      ? plan.unresolvedInputs
      : [],
    warnings: Array.isArray(plan.warnings) ? plan.warnings : [],
  };
};

module.exports = {
  COPILOT_ERROR,
  COPILOT_INTENTS,
  CONTEXT_LIMITS,
  SUPPORTED_OPERATIONS,
  SAFE_WORKFLOW_SETTINGS,
  hashDefinition,
  cloneJson,
  sanitizeNodeParameters,
  sanitizeValue,
  listSafeNodeContracts,
  getAvailableEngineTypes,
  applyOperationsToDefinition,
  validateCopilotOperations,
  applyCopilotOperations,
  buildPreview,
  diffWorkflowDefinitions,
  diagnoseWorkflow,
  buildCopilotContext,
  normalizePlan,
  collectUnresolvedInputs,
  classifyOperation,
  loadNodeLibrary,
};
