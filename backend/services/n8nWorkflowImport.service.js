/**
 * Part 14D.4 — n8n → OpsAi workflow import migration (V1).
 *
 * Classify before map. Static preview only (no eval/vm/network).
 * Honesty over compatibility percentage.
 */

const crypto = require("crypto");

const SOURCE_CATEGORIES = Object.freeze({
  EXECUTION: "EXECUTION",
  AUXILIARY_AI_RESOURCE: "AUXILIARY_AI_RESOURCE",
  ANNOTATION: "ANNOTATION",
  UNSUPPORTED_EXECUTION: "UNSUPPORTED_EXECUTION",
});

const MIGRATION_STATUS = Object.freeze({
  SUPPORTED: "SUPPORTED",
  PARTIAL: "PARTIAL",
  UNSUPPORTED: "UNSUPPORTED",
  NEEDS_SETUP: "NEEDS_SETUP",
  NEEDS_REVIEW: "NEEDS_REVIEW",
  IGNORED_NON_RUNTIME: "IGNORED_NON_RUNTIME",
  NON_RUNTIME_ANNOTATION: "NON_RUNTIME_ANNOTATION",
  ANNOTATION_NOT_IMPORTED: "ANNOTATION_NOT_IMPORTED",
  AUTO_CONVERTED: "AUTO_CONVERTED",
  EXPRESSION_REVIEW_REQUIRED: "EXPRESSION_REVIEW_REQUIRED",
});

const REASONS = Object.freeze({
  ARBITRARY_CODE_NOT_PORTABLE: "ARBITRARY_CODE_NOT_PORTABLE",
  INTEGRATION_NOT_AVAILABLE: "INTEGRATION_NOT_AVAILABLE",
  STANDALONE_MODEL_INVOCATION_UNSUPPORTED: "STANDALONE_MODEL_INVOCATION_UNSUPPORTED",
  AI_AUXILIARY_MISCLASSIFICATION_FORBIDDEN: "AI_AUXILIARY_MISCLASSIFICATION_FORBIDDEN",
  CREDENTIAL_REQUIRES_RECONNECT: "CREDENTIAL_REQUIRES_RECONNECT",
  EXPRESSION_REVIEW_REQUIRED: "EXPRESSION_REVIEW_REQUIRED",
  N8N_IMPORTED_CODE_EXECUTION_FORBIDDEN: "N8N_IMPORTED_CODE_EXECUTION_FORBIDDEN",
  BINARY_PRODUCER_UNSUPPORTED: "BINARY_PRODUCER_UNSUPPORTED",
  SUBWORKFLOW_TARGET_REQUIRED: "SUBWORKFLOW_TARGET_REQUIRED",
  ERROR_WORKFLOW_TARGET_REQUIRED: "ERROR_WORKFLOW_TARGET_REQUIRED",
  FILTER_OPERATOR_NEEDS_REVIEW: "FILTER_OPERATOR_NEEDS_REVIEW",
  FILTER_BOOLEAN_GROUPING_NEEDS_REVIEW: "FILTER_BOOLEAN_GROUPING_NEEDS_REVIEW",
  FILTER_DISCARD_BRANCH_UNSUPPORTED: "FILTER_DISCARD_BRANCH_UNSUPPORTED",
  SWITCH_EXPRESSION_MODE_UNSUPPORTED: "SWITCH_EXPRESSION_MODE_UNSUPPORTED",
  WAIT_RESUME_MODE_NEEDS_REVIEW: "WAIT_RESUME_MODE_NEEDS_REVIEW",
  WEBHOOK_RESPONSE_MODE_NEEDS_REVIEW: "WEBHOOK_RESPONSE_MODE_NEEDS_REVIEW",
  AI_AUXILIARY_RESOURCE_UNSUPPORTED: "AI_AUXILIARY_RESOURCE_UNSUPPORTED",
});

const { legacyStableRuleId, SWITCH_FALLBACK_HANDLE } = require("./workflowDynamicPorts.service");

/** Verified OpsAi compareValues operators safe for n8n filter/IF/Switch single conditions. */
const N8N_OPERATOR_TO_OPSAI = Object.freeze({
  equals: "equals",
  notEquals: "not_equals",
  contains: "contains",
  notContains: "not_contains",
  gt: "gt",
  gte: "gte",
  lt: "lt",
  lte: "lte",
  larger: "gt",
  largerEqual: "gte",
  smaller: "lt",
  smallerEqual: "lte",
  empty: "is_empty",
  notEmpty: "is_not_empty",
  // exists / notExists / regex / startsWith / endsWith → NEEDS_REVIEW (no exact OpsAi twin)
});

const MERGE_PORT_BY_INDEX = Object.freeze({
  0: "input1",
  1: "input2",
});

const MERGE_PORT_IDS_ORDER = ["input1", "input2"];

const AI_CONN_TYPES = new Set([
  "ai_languageModel",
  "ai_tool",
  "ai_memory",
  "ai_embedding",
  "ai_vectorStore",
  "ai_outputParser",
  "ai_retriever",
  "ai_document",
  "ai_textSplitter",
]);

/** OpsAi catalog availability used by migration (honest V1). */
const OPSAI_AVAILABILITY = Object.freeze({
  schedule: true,
  http: true,
  merge: true,
  set: true,
  webhook: true,
  respondToWebhook: true,
  filter: true,
  condition: true,
  switch: true,
  wait: true,
  executeWorkflow: true,
  errorTrigger: true,
  aiAgent: true,
  aiChatModel: true,
  aiCalculatorTool: true,
  code: true, // exists, but n8n JS must NOT be mapped into it in V1
  gmail: false,
  googleAnalytics: false,
  standaloneOpenAiMessage: false,
  stickyNoteAnnotationUi: false,
});

const MAPPABLE_EXECUTION_TYPES = new Set([
  "n8n-nodes-base.scheduleTrigger",
  "n8n-nodes-base.manualTrigger",
  "n8n-nodes-base.httpRequest",
  "n8n-nodes-base.merge",
  "n8n-nodes-base.set",
  "n8n-nodes-base.webhook",
  "n8n-nodes-base.respondToWebhook",
  "n8n-nodes-base.if",
  "n8n-nodes-base.filter",
  "n8n-nodes-base.switch",
  "n8n-nodes-base.wait",
  "n8n-nodes-base.executeWorkflow",
  "n8n-nodes-base.errorTrigger",
  "@n8n/n8n-nodes-langchain.agent",
]);

const isOpenAiChatModelType = (type) =>
  type === "@n8n/n8n-nodes-langchain.lmChatOpenAi" ||
  /lmChatOpenAi/i.test(String(type || ""));

const isCalculatorToolType = (type) =>
  type === "@n8n/n8n-nodes-langchain.toolCalculator" ||
  /toolCalculator/i.test(String(type || ""));

const isAgentType = (type) =>
  type === "@n8n/n8n-nodes-langchain.agent" ||
  /n8n-nodes-langchain\.agent$/i.test(String(type || ""));

const stableNodeId = (sourceId) => {
  const raw = String(sourceId || "");
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
  const hash = crypto.createHash("sha1").update(raw).digest("hex").slice(0, 8);
  return `n8n_${cleaned || "node"}_${hash}`;
};

const detectFormat = (payload) => {
  const {
    detectWorkflowImportFormat,
  } = require("./opsaiWorkflowPortability.service");
  const d = detectWorkflowImportFormat(payload);
  if (d.format === "N8N") return { format: "n8n", confidence: d.confidence };
  if (d.format === "OPSAI_NATIVE") {
    return { format: "opsai-workflow", confidence: d.confidence };
  }
  return { format: "unknown", confidence: 0 };
};

const buildConnectionIndex = (source) => {
  /** @type {Map<string, {incoming: Array, outgoing: Array}>} */
  const byName = new Map();
  const ensure = (name) => {
    if (!byName.has(name)) byName.set(name, { incoming: [], outgoing: [] });
    return byName.get(name);
  };

  for (const node of source.nodes || []) {
    ensure(node.name);
  }

  for (const [srcName, outs] of Object.entries(source.connections || {})) {
    for (const [connType, ports] of Object.entries(outs || {})) {
      (ports || []).forEach((targets, outIndex) => {
        (targets || []).forEach((t) => {
          const edge = {
            sourceName: srcName,
            targetName: t.node,
            connectionType: connType,
            sourceOutputIndex: outIndex,
            targetInputIndex: typeof t.index === "number" ? t.index : 0,
            targetConnectionType: t.type || "main",
          };
          ensure(srcName).outgoing.push(edge);
          ensure(t.node).incoming.push(edge);
        });
      });
    }
  }
  return byName;
};

const isMainFlowParticipant = (connInfo) => {
  const edges = [...(connInfo?.incoming || []), ...(connInfo?.outgoing || [])];
  if (!edges.length) return false;
  return edges.some(
    (e) => e.connectionType === "main" || e.targetConnectionType === "main"
  );
};

const isAuxiliaryAiOnly = (connInfo) => {
  const edges = [...(connInfo?.incoming || []), ...(connInfo?.outgoing || [])];
  if (!edges.length) return false;
  const hasMain = edges.some(
    (e) => e.connectionType === "main" || e.targetConnectionType === "main"
  );
  if (hasMain) return false;
  return edges.every(
    (e) =>
      AI_CONN_TYPES.has(e.connectionType) ||
      AI_CONN_TYPES.has(e.targetConnectionType)
  );
};

/**
 * Semantic classification BEFORE type→OpsAi mapping.
 */
const classifySourceNode = (node, connInfo) => {
  const type = String(node.type || "");

  if (type === "n8n-nodes-base.stickyNote") {
    return {
      category: SOURCE_CATEGORIES.ANNOTATION,
      reason: "NON_RUNTIME_STICKY_NOTE",
    };
  }

  // Connection semantics override package name for AI-ish types.
  if (
    /langchain|openai|openAi|lmChat|agent|tool/i.test(type) &&
    isAuxiliaryAiOnly(connInfo)
  ) {
    return {
      category: SOURCE_CATEGORIES.AUXILIARY_AI_RESOURCE,
      reason: "AI_RESOURCE_CONNECTION",
    };
  }

  if (type === "n8n-nodes-base.code") {
    return {
      category: SOURCE_CATEGORIES.UNSUPPORTED_EXECUTION,
      reason: REASONS.ARBITRARY_CODE_NOT_PORTABLE,
    };
  }

  if (type === "n8n-nodes-base.gmail") {
    return {
      category: SOURCE_CATEGORIES.UNSUPPORTED_EXECUTION,
      reason: REASONS.INTEGRATION_NOT_AVAILABLE,
    };
  }

  if (type === "n8n-nodes-base.googleAnalytics") {
    return {
      category: SOURCE_CATEGORIES.UNSUPPORTED_EXECUTION,
      reason: REASONS.INTEGRATION_NOT_AVAILABLE,
    };
  }

  if (
    type === "@n8n/n8n-nodes-langchain.openAi" ||
    (/openAi|openai/i.test(type) &&
      !isOpenAiChatModelType(type) &&
      !isAgentType(type) &&
      isMainFlowParticipant(connInfo))
  ) {
    // Main-flow model invocation ≠ aiChatModel auxiliary.
    return {
      category: SOURCE_CATEGORIES.UNSUPPORTED_EXECUTION,
      reason: REASONS.STANDALONE_MODEL_INVOCATION_UNSUPPORTED,
    };
  }

  if (MAPPABLE_EXECUTION_TYPES.has(type) || isAgentType(type)) {
    return {
      category: SOURCE_CATEGORIES.EXECUTION,
      reason: "MAPPABLE_CORE",
    };
  }

  // Unknown execution-shaped node
  if (isMainFlowParticipant(connInfo) || !connInfo?.incoming?.length) {
    return {
      category: SOURCE_CATEGORIES.UNSUPPORTED_EXECUTION,
      reason: "UNKNOWN_OR_UNMAPPED_TYPE",
    };
  }

  return {
    category: SOURCE_CATEGORIES.UNSUPPORTED_EXECUTION,
    reason: "UNKNOWN_OR_UNMAPPED_TYPE",
  };
};

const stripExpressionPrefix = (value) => {
  if (typeof value !== "string") return value;
  if (value.startsWith("=")) return value.slice(1);
  return value;
};

/**
 * Classify n8n parameter expressions only (never Code-node JS).
 */
const classifyExpression = (raw, { nameToId } = {}) => {
  if (raw == null) return null;
  const text = String(raw);
  const expr = stripExpressionPrefix(text).trim();
  if (!expr.includes("{{") && !/\$[a-zA-Z]/.test(expr) && !expr.startsWith("=")) {
    return {
      status: MIGRATION_STATUS.AUTO_CONVERTED,
      source: text,
      converted: text,
      notes: [],
    };
  }

  const notes = [];
  let status = MIGRATION_STATUS.NEEDS_REVIEW;
  let converted = null;

  // Date / Luxon-style — OpsAi V1 has no proven $today.minus/.toFormat equivalent.
  if (
    /\$today\b|\$now\b|\.minus\s*\(|\.toFormat\s*\(/.test(expr)
  ) {
    return {
      status: MIGRATION_STATUS.EXPRESSION_REVIEW_REQUIRED,
      source: text,
      converted: null,
      notes: ["Date/time arithmetic not auto-converted; do not evaluate at import time"],
      reason: REASONS.EXPRESSION_REVIEW_REQUIRED,
    };
  }

  // Named-node / $items / $input — not blindly translated.
  if (/\$items\s*\(|\$input\.(first|all|item)\s*\(/.test(expr)) {
    return {
      status: MIGRATION_STATUS.UNSUPPORTED,
      source: text,
      converted: null,
      notes: ["Named-node or $input access is not auto-translated in V1"],
    };
  }

  // Simple $json.field → {{item.field}}
  const simpleJson = expr.match(
    /^\{\{\s*\$json\.([a-zA-Z_][\w.]*)\s*\}\}$/
  ) || expr.match(/^\$json\.([a-zA-Z_][\w.]*)$/);
  if (simpleJson) {
    converted = `{{item.${simpleJson[1]}}}`;
    status = MIGRATION_STATUS.AUTO_CONVERTED;
    notes.push("Simple current-item field");
    return { status, source: text, converted, notes };
  }

  // $json inside larger template
  if (/\$json\.[a-zA-Z_]/.test(expr) && !/\$items|\$input|\$now|\$today/.test(expr)) {
    converted = expr
      .replace(/\{\{\s*\$json\.([a-zA-Z_][\w.]*)\s*\}\}/g, "{{item.$1}}")
      .replace(/\$json\.([a-zA-Z_][\w.]*)/g, "{{item.$1}}");
    if (converted.includes("$")) {
      status = MIGRATION_STATUS.NEEDS_REVIEW;
      converted = null;
    } else {
      status = MIGRATION_STATUS.AUTO_CONVERTED;
    }
    return { status, source: text, converted, notes };
  }

  // Previous-node style — only if unambiguous mapping exists
  const named = expr.match(/\$\(["']([^"']+)["']\)/);
  if (named) {
    const id = nameToId?.get(named[1]);
    if (id) {
      return {
        status: MIGRATION_STATUS.NEEDS_REVIEW,
        source: text,
        converted: null,
        notes: [`Named node "${named[1]}" maps to ${id} but expression form needs review`],
      };
    }
    return {
      status: MIGRATION_STATUS.NEEDS_REVIEW,
      source: text,
      converted: null,
      notes: ["Ambiguous or unsupported named-node expression"],
    };
  }

  return {
    status: MIGRATION_STATUS.NEEDS_REVIEW,
    source: text,
    converted: null,
    notes: ["Complex expression not auto-converted"],
  };
};

const scanParametersForExpressions = (params, nameToId, out) => {
  const visit = (value, path) => {
    if (typeof value === "string") {
      const looksExpr =
        value.startsWith("=") ||
        /\{\{/.test(value) ||
        /\$json|\$now|\$today|\$input|\$items/.test(value);
      if (looksExpr) {
        out.push({
          path,
          ...classifyExpression(value, { nameToId }),
        });
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => visit(v, `${path}[${i}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        visit(v, path ? `${path}.${k}` : k);
      }
    }
  };
  visit(params, "");
};

const extractCredentialHints = (node) => {
  const creds = node.credentials;
  if (!creds || typeof creds !== "object") return [];
  const hints = [];
  for (const [credType, ref] of Object.entries(creds)) {
    hints.push({
      sourceCredentialType: credType,
      sourceDisplayName:
        ref && typeof ref === "object" ? String(ref.name || "") : "",
      // NEVER copy source credential id into OpsAi credentialId
      configuredAtSource: true,
      opsAiCredentialId: null,
      status: MIGRATION_STATUS.NEEDS_SETUP,
      reason: REASONS.CREDENTIAL_REQUIRES_RECONNECT,
    });
  }
  return hints;
};

const sanitizeCodePreview = (jsCode) => {
  if (typeof jsCode !== "string") return null;
  // Text-only; never execute. Bound size for report metadata.
  const max = 400;
  const trimmed = jsCode.length > max ? `${jsCode.slice(0, max)}…` : jsCode;
  return {
    length: jsCode.length,
    preview: trimmed,
    containsItemsRef: /\$items\s*\(/.test(jsCode),
    containsInputApi: /\$input\.(first|all)/.test(jsCode),
    containsBinary: /binary|Buffer|xlsx|zip/i.test(jsCode),
  };
};

const mapSchedule = (node) => {
  const rule = node.parameters?.rule?.interval?.[0] || {};
  const scheduleRule = {
    id: `rule_${stableNodeId(node.id).slice(-8)}`,
    triggerInterval: rule.field || "weeks",
    weeksInterval: 1,
    triggerAtDay: Array.isArray(rule.triggerAtDay) ? rule.triggerAtDay : [1],
    triggerAtHour: typeof rule.triggerAtHour === "number" ? rule.triggerAtHour : 7,
    triggerAtMinute: typeof rule.triggerAtMinute === "number" ? rule.triggerAtMinute : 0,
  };
  return {
    type: "schedule",
    data: {
      label: node.name,
      scheduleRules: [scheduleRule],
      timezone: "UTC",
      libraryId: "schedule-trigger",
      available: true,
    },
    status: MIGRATION_STATUS.SUPPORTED,
    reasons: [],
  };
};

const mapManualTrigger = (node) => ({
  type: "trigger",
  data: {
    label: node.name || "Manual Trigger",
    libraryId: "manual-trigger",
    available: true,
  },
  status: MIGRATION_STATUS.SUPPORTED,
  reasons: [],
});

const mapHttp = (node, expressionFindings) => {
  const p = node.parameters || {};
  const urlRaw = p.url || "";
  const bodyRaw = p.jsonBody || p.body || "";
  const urlExpr = classifyExpression(urlRaw);
  const bodyExpr =
    typeof bodyRaw === "string" && bodyRaw
      ? classifyExpression(bodyRaw)
      : null;

  if (urlExpr) expressionFindings.push({ nodeName: node.name, field: "url", ...urlExpr });
  if (bodyExpr) expressionFindings.push({ nodeName: node.name, field: "body", ...bodyExpr });

  const needsReview =
    (urlExpr && urlExpr.status !== MIGRATION_STATUS.AUTO_CONVERTED) ||
    (bodyExpr &&
      bodyExpr.status !== MIGRATION_STATUS.AUTO_CONVERTED &&
      bodyExpr.status !== undefined);

  const credentialHints = extractCredentialHints(node);

  return {
    type: "http",
    data: {
      label: node.name,
      method: p.method || "GET",
      url:
        urlExpr?.status === MIGRATION_STATUS.AUTO_CONVERTED && urlExpr.converted
          ? urlExpr.converted
          : stripExpressionPrefix(String(urlRaw || "")),
      body:
        bodyExpr?.status === MIGRATION_STATUS.AUTO_CONVERTED && bodyExpr.converted
          ? bodyExpr.converted
          : typeof bodyRaw === "string"
            ? stripExpressionPrefix(bodyRaw)
            : "",
      // Source credential id must NEVER become credentialId
      credentialId: undefined,
      credentialRequirement: credentialHints.length
        ? {
            type: "OAuth2",
            configuredAtSource: true,
            sourceDisplayName: credentialHints[0].sourceDisplayName || null,
          }
        : undefined,
      libraryId: "http-request",
      available: true,
      migrationNeedsReview: Boolean(needsReview),
    },
    status: credentialHints.length
      ? MIGRATION_STATUS.NEEDS_SETUP
      : needsReview
        ? MIGRATION_STATUS.PARTIAL
        : MIGRATION_STATUS.SUPPORTED,
    reasons: [
      ...(credentialHints.length ? [REASONS.CREDENTIAL_REQUIRES_RECONNECT] : []),
      ...(needsReview ? [REASONS.EXPRESSION_REVIEW_REQUIRED] : []),
    ],
    credentialHints,
  };
};

const mapMerge = (node) => ({
  type: "merge",
  data: {
    label: node.name,
    mode: "append",
    libraryId: "merge",
    available: true,
  },
  status: MIGRATION_STATUS.SUPPORTED,
  reasons: [],
});

const mapSet = (node) => {
  const assignments =
    node.parameters?.assignments?.assignments ||
    node.parameters?.assignments ||
    [];
  const list = Array.isArray(assignments) ? assignments : [];
  const includeOther =
    node.parameters?.includeOtherFields !== false &&
    node.parameters?.keepOnlySet !== true;

  const mappings = list
    .map((a) => ({
      key: String(a.name || a.key || ""),
      value: String(a.value ?? ""),
    }))
    .filter((m) => m.key);

  const hasExpr = mappings.some(
    (m) =>
      m.value.startsWith("=") ||
      /\$json|\$now|\$today|\$items|\$input/.test(m.value)
  );

  if (hasExpr) {
    return {
      type: "migrationUnsupported",
      data: {
        label: node.name,
        migrationStatus: MIGRATION_STATUS.NEEDS_REVIEW,
        migrationReason: REASONS.EXPRESSION_REVIEW_REQUIRED,
        sourceNodeType: node.type,
        sourceNodeVersion: node.typeVersion,
        available: false,
      },
      status: MIGRATION_STATUS.NEEDS_REVIEW,
      reasons: [REASONS.EXPRESSION_REVIEW_REQUIRED],
    };
  }

  return {
    type: "set",
    data: {
      label: node.name,
      mappings,
      keepOnlySet: !includeOther,
      libraryId: "edit-fields-set",
      available: true,
    },
    status: MIGRATION_STATUS.SUPPORTED,
    reasons: [],
  };
};

const mapUnsupportedPlaceholder = (node, classification, extra = {}) => {
  const codeMeta =
    node.type === "n8n-nodes-base.code"
      ? sanitizeCodePreview(node.parameters?.jsCode)
      : null;
  return {
    type: "migrationUnsupported",
    data: {
      label: node.name,
      migrationStatus: MIGRATION_STATUS.UNSUPPORTED,
      migrationReason: classification.reason,
      sourceNodeType: node.type,
      sourceNodeVersion: node.typeVersion,
      sourceNodeName: node.name,
      available: false,
      codeMeta,
      ...extra,
    },
    status: MIGRATION_STATUS.UNSUPPORTED,
    reasons: [classification.reason],
    credentialHints: extractCredentialHints(node),
  };
};

/** Extract a single verified n8n filter condition → OpsAi left/operator/right. */
const mapSingleFilterCondition = (cond) => {
  if (!cond || typeof cond !== "object") {
    return { ok: false, reason: REASONS.FILTER_OPERATOR_NEEDS_REVIEW };
  }
  const opObj = cond.operator || {};
  const operation = String(opObj.operation || "");
  const opsaiOp = N8N_OPERATOR_TO_OPSAI[operation];
  if (!opsaiOp) {
    return {
      ok: false,
      reason: REASONS.FILTER_OPERATOR_NEEDS_REVIEW,
      operation: operation || null,
    };
  }

  const leftRaw = stripExpressionPrefix(String(cond.leftValue ?? ""));
  const rightRaw = stripExpressionPrefix(String(cond.rightValue ?? ""));

  // Prefer field path for filter fieldName when $json.field
  const fieldMatch =
    leftRaw.match(/^\{\{\s*\$json\.([a-zA-Z_][\w.]*)\s*\}\}$/) ||
    leftRaw.match(/^\$json\.([a-zA-Z_][\w.]*)$/);

  let left = leftRaw;
  let fieldName = "";
  if (fieldMatch) {
    fieldName = fieldMatch[1];
    left = `{{item.${fieldMatch[1]}}}`;
  } else if (/\$json|\$items|\$input|\$now|\$today/.test(leftRaw)) {
    const expr = classifyExpression(cond.leftValue);
    if (expr?.status === MIGRATION_STATUS.AUTO_CONVERTED && expr.converted) {
      left = expr.converted;
    } else {
      return {
        ok: false,
        reason: REASONS.EXPRESSION_REVIEW_REQUIRED,
      };
    }
  }

  let right = rightRaw;
  if (/\$json|\$items|\$input|\$now|\$today/.test(rightRaw) || String(cond.rightValue || "").startsWith("=")) {
    const expr = classifyExpression(cond.rightValue);
    if (expr?.status === MIGRATION_STATUS.AUTO_CONVERTED && expr.converted) {
      right = expr.converted;
    } else if (/\$json|\$items|\$input|\$now|\$today/.test(rightRaw)) {
      return {
        ok: false,
        reason: REASONS.EXPRESSION_REVIEW_REQUIRED,
      };
    }
  }

  return { ok: true, left, right, operator: opsaiOp, fieldName };
};

const extractN8nConditionsBlock = (parameters) => {
  const block = parameters?.conditions;
  if (!block || typeof block !== "object") return null;
  return {
    combinator: String(block.combinator || "and").toLowerCase(),
    conditions: Array.isArray(block.conditions) ? block.conditions : [],
  };
};

const mapWebhook = (node) => {
  const p = node.parameters || {};
  const methodRaw = p.httpMethod || p.method || "POST";
  const method = Array.isArray(methodRaw)
    ? String(methodRaw[0] || "POST").toUpperCase()
    : String(methodRaw || "POST").toUpperCase();
  const path = String(p.path || "").replace(/^\//, "");
  const srcMode = String(p.responseMode || "onReceived");
  let responseMode = "immediate";
  const reasons = [];
  let status = MIGRATION_STATUS.SUPPORTED;

  if (srcMode === "responseNode") {
    responseMode = "respondNode";
  } else if (srcMode === "onReceived") {
    responseMode = "immediate";
  } else {
    // lastNode / streaming — no safe OpsAi twin
    status = MIGRATION_STATUS.NEEDS_REVIEW;
    reasons.push(REASONS.WEBHOOK_RESPONSE_MODE_NEEDS_REVIEW);
  }

  const credentialHints = extractCredentialHints(node);
  if (credentialHints.length) {
    status = MIGRATION_STATUS.NEEDS_SETUP;
    reasons.push(REASONS.CREDENTIAL_REQUIRES_RECONNECT);
  }

  return {
    type: "webhook",
    data: {
      label: node.name,
      webhookPath: path || "imported-webhook",
      method: ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)
        ? method
        : "POST",
      responseMode,
      // Never import source webhookId / registration / secrets
      credentialId: undefined,
      libraryId: "webhook",
      available: true,
      migrationNotes: {
        sourceWebhookIdIgnored: true,
        liveRegistrationIgnored: true,
        sourceResponseMode: srcMode,
      },
    },
    status,
    reasons,
    credentialHints,
  };
};

const mapRespondToWebhook = (node) => {
  const p = node.parameters || {};
  return {
    type: "respondToWebhook",
    data: {
      label: node.name,
      responseCode: Number(p.options?.responseCode || p.responseCode || 200) || 200,
      responseBody: typeof p.respondWith === "string" ? "" : String(p.responseBody || p.options?.responseData || ""),
      libraryId: "respond-to-webhook",
      available: true,
    },
    status: MIGRATION_STATUS.PARTIAL,
    reasons: ["RESPOND_TO_WEBHOOK_STATIC_CONFIG_ONLY"],
  };
};

const mapIfOrFilter = (node, { asFilter }) => {
  const block = extractN8nConditionsBlock(node.parameters);
  if (!block || !block.conditions.length) {
    return mapUnsupportedPlaceholder(node, {
      reason: REASONS.FILTER_OPERATOR_NEEDS_REVIEW,
    });
  }
  if (block.conditions.length > 1 || block.combinator === "or") {
    // OpsAi filter/condition runtimes are single-predicate in V1 (no boolean grouping).
    return {
      type: "migrationUnsupported",
      data: {
        label: node.name,
        migrationStatus: MIGRATION_STATUS.NEEDS_REVIEW,
        migrationReason: REASONS.FILTER_BOOLEAN_GROUPING_NEEDS_REVIEW,
        sourceNodeType: node.type,
        sourceNodeVersion: node.typeVersion,
        available: false,
      },
      status: MIGRATION_STATUS.NEEDS_REVIEW,
      reasons: [REASONS.FILTER_BOOLEAN_GROUPING_NEEDS_REVIEW],
    };
  }

  const mappedCond = mapSingleFilterCondition(block.conditions[0]);
  if (!mappedCond.ok) {
    return {
      type: "migrationUnsupported",
      data: {
        label: node.name,
        migrationStatus: MIGRATION_STATUS.NEEDS_REVIEW,
        migrationReason: mappedCond.reason,
        sourceNodeType: node.type,
        sourceNodeVersion: node.typeVersion,
        sourceOperator: mappedCond.operation || null,
        available: false,
      },
      status: MIGRATION_STATUS.NEEDS_REVIEW,
      reasons: [mappedCond.reason],
    };
  }

  if (asFilter) {
    return {
      type: "filter",
      data: {
        label: node.name,
        fieldName: mappedCond.fieldName || "",
        left: mappedCond.left,
        operator: mappedCond.operator,
        right: mappedCond.right,
        libraryId: "filter",
        available: true,
        migrationNotes: {
          discardedBranchNotImported: true,
        },
      },
      status: MIGRATION_STATUS.PARTIAL,
      reasons: [REASONS.FILTER_DISCARD_BRANCH_UNSUPPORTED],
      edgePolicy: { filterKeepOnlyIndex0: true },
    };
  }

  return {
    type: "condition",
    data: {
      label: node.name,
      left: mappedCond.left,
      operator: mappedCond.operator,
      right: mappedCond.right,
      libraryId: "if",
      available: true,
    },
    status: MIGRATION_STATUS.SUPPORTED,
    reasons: [],
    edgePolicy: { conditionTrueFalse: true },
  };
};

const mapSwitch = (node, opsNodeId) => {
  const p = node.parameters || {};
  const mode = String(p.mode || "rules");
  if (mode === "expression") {
    return mapUnsupportedPlaceholder(node, {
      reason: REASONS.SWITCH_EXPRESSION_MODE_UNSUPPORTED,
    });
  }

  const ruleValues = Array.isArray(p.rules?.values) ? p.rules.values : [];
  if (!ruleValues.length) {
    return mapUnsupportedPlaceholder(node, {
      reason: REASONS.FILTER_OPERATOR_NEEDS_REVIEW,
    });
  }

  const rules = [];
  const handlesByIndex = [];
  const reasons = [];
  let status = MIGRATION_STATUS.SUPPORTED;

  for (let i = 0; i < ruleValues.length; i += 1) {
    const rule = ruleValues[i];
    const condBlock = rule?.conditions;
    const conds = Array.isArray(condBlock?.conditions) ? condBlock.conditions : [];
    const combinator = String(condBlock?.combinator || "and").toLowerCase();
    if (conds.length !== 1 || combinator === "or") {
      status = MIGRATION_STATUS.NEEDS_REVIEW;
      reasons.push(REASONS.FILTER_BOOLEAN_GROUPING_NEEDS_REVIEW);
      return {
        type: "migrationUnsupported",
        data: {
          label: node.name,
          migrationStatus: MIGRATION_STATUS.NEEDS_REVIEW,
          migrationReason: REASONS.FILTER_BOOLEAN_GROUPING_NEEDS_REVIEW,
          sourceNodeType: node.type,
          sourceNodeVersion: node.typeVersion,
          available: false,
        },
        status: MIGRATION_STATUS.NEEDS_REVIEW,
        reasons: [REASONS.FILTER_BOOLEAN_GROUPING_NEEDS_REVIEW],
      };
    }
    const mappedCond = mapSingleFilterCondition(conds[0]);
    if (!mappedCond.ok) {
      return {
        type: "migrationUnsupported",
        data: {
          label: node.name,
          migrationStatus: MIGRATION_STATUS.NEEDS_REVIEW,
          migrationReason: mappedCond.reason,
          sourceNodeType: node.type,
          sourceNodeVersion: node.typeVersion,
          sourceOperator: mappedCond.operation || null,
          available: false,
        },
        status: MIGRATION_STATUS.NEEDS_REVIEW,
        reasons: [mappedCond.reason],
      };
    }
    const id = legacyStableRuleId(opsNodeId, i);
    rules.push({
      id,
      label: String(rule.outputKey || `Rule ${i + 1}`),
      left: mappedCond.left,
      operator: mappedCond.operator,
      right: mappedCond.right,
    });
    handlesByIndex.push(id);
  }

  const fallbackExtra = p.options?.fallbackOutput === "extra";
  const enableFallback = fallbackExtra;
  if (enableFallback) {
    handlesByIndex.push(SWITCH_FALLBACK_HANDLE);
  }

  return {
    type: "switch",
    data: {
      label: node.name,
      rules,
      enableFallback,
      routingMode: p.options?.allMatchingOutputs ? "allMatches" : "firstMatch",
      libraryId: "switch",
      available: true,
    },
    status,
    reasons,
    edgePolicy: { switchHandlesByIndex: handlesByIndex },
  };
};

const mapWait = (node) => {
  const p = node.parameters || {};
  const resume = String(p.resume || "timeInterval");
  // Never import resume tokens / waiting execution / resume URLs.
  if (resume === "timeInterval") {
    const unit = String(p.unit || "seconds").toLowerCase();
    const amount = Number(p.amount ?? 5);
    const safeUnit = ["seconds", "minutes", "hours", "days"].includes(unit)
      ? unit
      : "seconds";
    return {
      type: "wait",
      data: {
        label: node.name,
        resumeMode: "time",
        waitAmount: Number.isFinite(amount) ? amount : 5,
        waitUnit: safeUnit,
        libraryId: "wait",
        available: true,
        migrationNotes: {
          sourceRuntimeStateIgnored: true,
          resumeUrlIgnored: true,
        },
      },
      status: MIGRATION_STATUS.SUPPORTED,
      reasons: [],
    };
  }
  if (resume === "webhook") {
    return {
      type: "wait",
      data: {
        label: node.name,
        resumeMode: "external",
        libraryId: "wait",
        available: true,
        migrationNotes: {
          sourceRuntimeStateIgnored: true,
          resumeUrlIgnored: true,
          sourceResume: resume,
        },
      },
      status: MIGRATION_STATUS.PARTIAL,
      reasons: [REASONS.WAIT_RESUME_MODE_NEEDS_REVIEW],
    };
  }
  // specificTime / form — not safely equivalent without timezone/runtime state
  return {
    type: "migrationUnsupported",
    data: {
      label: node.name,
      migrationStatus: MIGRATION_STATUS.NEEDS_REVIEW,
      migrationReason: REASONS.WAIT_RESUME_MODE_NEEDS_REVIEW,
      sourceNodeType: node.type,
      sourceNodeVersion: node.typeVersion,
      sourceResume: resume,
      available: false,
    },
    status: MIGRATION_STATUS.NEEDS_REVIEW,
    reasons: [REASONS.WAIT_RESUME_MODE_NEEDS_REVIEW],
  };
};

const extractSourceWorkflowHint = (parameters) => {
  const raw = parameters?.workflowId;
  if (raw == null || raw === "") return { id: null, name: null };
  if (typeof raw === "object") {
    return {
      id: raw.value != null ? String(raw.value) : raw.id != null ? String(raw.id) : null,
      name: raw.cachedResultName || raw.name || null,
    };
  }
  return { id: String(raw), name: null };
};

const mapExecuteWorkflow = (node) => {
  const hint = extractSourceWorkflowHint(node.parameters || {});
  return {
    type: "executeWorkflow",
    data: {
      label: node.name,
      workflowId: null, // NEVER reuse n8n workflow ID
      unresolvedRequirement: REASONS.SUBWORKFLOW_TARGET_REQUIRED,
      sourceWorkflowHint: hint,
      libraryId: "execute-workflow",
      available: true,
    },
    status: MIGRATION_STATUS.NEEDS_SETUP,
    reasons: [REASONS.SUBWORKFLOW_TARGET_REQUIRED],
  };
};

const mapErrorTrigger = (node) => ({
  type: "errorTrigger",
  data: {
    label: node.name || "Error Trigger",
    libraryId: "error-trigger",
    available: true,
  },
  status: MIGRATION_STATUS.SUPPORTED,
  reasons: [],
});

const mapAiAgent = (node) => {
  const p = node.parameters || {};
  const textRaw = p.text || p.prompt || "";
  const textExpr = typeof textRaw === "string" ? classifyExpression(textRaw) : null;
  const prompt =
    textExpr?.status === MIGRATION_STATUS.AUTO_CONVERTED && textExpr.converted
      ? textExpr.converted
      : typeof textRaw === "string"
        ? stripExpressionPrefix(textRaw)
        : "";
  const system =
    typeof p.options?.systemMessage === "string"
      ? stripExpressionPrefix(p.options.systemMessage)
      : "";
  return {
    type: "aiAgent",
    data: {
      label: node.name,
      prompt: prompt || "{{item}}",
      systemInstruction: system,
      libraryId: "ai-agent",
      available: true,
    },
    status: MIGRATION_STATUS.PARTIAL,
    reasons: textExpr && textExpr.status !== MIGRATION_STATUS.AUTO_CONVERTED
      ? [REASONS.EXPRESSION_REVIEW_REQUIRED]
      : [],
  };
};

const mapAuxiliaryAiResource = (node) => {
  const type = String(node.type || "");
  const credentialHints = extractCredentialHints(node);

  if (isOpenAiChatModelType(type)) {
    const model =
      node.parameters?.model?.value ||
      node.parameters?.model ||
      "gpt-4o-mini";
    return {
      type: "aiChatModel",
      data: {
        label: node.name,
        provider: "openai",
        model: typeof model === "string" ? model : "gpt-4o-mini",
        credentialId: undefined,
        credentialRequirement: credentialHints.length
          ? {
              type: "openAiApi",
              configuredAtSource: true,
              sourceDisplayName: credentialHints[0].sourceDisplayName || null,
            }
          : undefined,
        libraryId: "ai-chat-model",
        available: true,
      },
      status: credentialHints.length
        ? MIGRATION_STATUS.NEEDS_SETUP
        : MIGRATION_STATUS.SUPPORTED,
      reasons: credentialHints.length
        ? [REASONS.CREDENTIAL_REQUIRES_RECONNECT]
        : [],
      credentialHints,
      edgePolicy: { aiResource: "model" },
    };
  }

  if (isCalculatorToolType(type)) {
    return {
      type: "aiCalculatorTool",
      data: {
        label: node.name,
        toolName: "calculator",
        description: "Add, subtract, multiply, or divide two numbers.",
        libraryId: "ai-calculator-tool",
        available: true,
      },
      status: MIGRATION_STATUS.SUPPORTED,
      reasons: [],
      edgePolicy: { aiResource: "tool" },
    };
  }

  return mapUnsupportedPlaceholder(node, {
    reason: REASONS.AI_AUXILIARY_RESOURCE_UNSUPPORTED,
  });
};

/**
 * Map only after classification. Never infer AI resource from package name alone.
 */
const mapClassifiedNode = (node, classification, expressionFindings, opsNodeId) => {
  if (classification.category === SOURCE_CATEGORIES.ANNOTATION) {
    return null;
  }

  if (classification.category === SOURCE_CATEGORIES.AUXILIARY_AI_RESOURCE) {
    return mapAuxiliaryAiResource(node);
  }

  if (classification.category === SOURCE_CATEGORIES.UNSUPPORTED_EXECUTION) {
    const placeholder = mapUnsupportedPlaceholder(node, classification);
    if (classification.reason === REASONS.STANDALONE_MODEL_INVOCATION_UNSUPPORTED) {
      placeholder.data.notMappedTo = "aiChatModel";
      placeholder.data.connectionSemantics = "main";
      placeholder.reasons.push(REASONS.AI_AUXILIARY_MISCLASSIFICATION_FORBIDDEN);
    }
    if (
      node.type === "n8n-nodes-base.code" &&
      placeholder.data.codeMeta?.containsBinary
    ) {
      placeholder.reasons.push(REASONS.BINARY_PRODUCER_UNSUPPORTED);
    }
    return placeholder;
  }

  // EXECUTION
  const type = String(node.type || "");
  switch (type) {
    case "n8n-nodes-base.scheduleTrigger":
      return mapSchedule(node);
    case "n8n-nodes-base.manualTrigger":
      return mapManualTrigger(node);
    case "n8n-nodes-base.httpRequest":
      return mapHttp(node, expressionFindings);
    case "n8n-nodes-base.merge":
      return mapMerge(node);
    case "n8n-nodes-base.set":
      return mapSet(node);
    case "n8n-nodes-base.webhook":
      return mapWebhook(node);
    case "n8n-nodes-base.respondToWebhook":
      return mapRespondToWebhook(node);
    case "n8n-nodes-base.if":
      return mapIfOrFilter(node, { asFilter: false });
    case "n8n-nodes-base.filter":
      return mapIfOrFilter(node, { asFilter: true });
    case "n8n-nodes-base.switch":
      return mapSwitch(node, opsNodeId);
    case "n8n-nodes-base.wait":
      return mapWait(node);
    case "n8n-nodes-base.executeWorkflow":
      return mapExecuteWorkflow(node);
    case "n8n-nodes-base.errorTrigger":
      return mapErrorTrigger(node);
    default:
      if (isAgentType(type)) return mapAiAgent(node);
      return mapUnsupportedPlaceholder(node, {
        reason: "UNKNOWN_OR_UNMAPPED_TYPE",
      });
  }
};

const buildEdges = (source, nameToMapped, mergePortNotes = []) => {
  const edges = [];
  let i = 0;
  /** @type {Map<string, Set<string>>} */
  const usedMergePorts = new Map();

  const claimMergePort = (targetId, preferredIndex, meta) => {
    const preferred =
      MERGE_PORT_BY_INDEX[preferredIndex] || `input${preferredIndex + 1}`;
    if (!usedMergePorts.has(targetId)) usedMergePorts.set(targetId, new Set());
    const used = usedMergePorts.get(targetId);
    if (!used.has(preferred)) {
      used.add(preferred);
      return preferred;
    }
    for (const alt of MERGE_PORT_IDS_ORDER) {
      if (!used.has(alt)) {
        used.add(alt);
        mergePortNotes.push({
          ...meta,
          preferredPort: preferred,
          assignedPort: alt,
          status: MIGRATION_STATUS.NEEDS_REVIEW,
          reason: "MERGE_PORT_COLLISION_REASSIGNED",
        });
        return alt;
      }
    }
    used.add(preferred);
    return preferred;
  };

  const resolveSourceHandle = (srcMapped, connType, outIndex) => {
    const policy = srcMapped.mapped?.edgePolicy || {};
    if (policy.conditionTrueFalse) {
      return outIndex === 0 ? "true" : "false";
    }
    if (Array.isArray(policy.switchHandlesByIndex)) {
      return policy.switchHandlesByIndex[outIndex] || undefined;
    }
    if (policy.filterKeepOnlyIndex0 && outIndex !== 0) {
      return null; // drop Discarded branch
    }
    if (connType === "ai_languageModel") return "model";
    if (connType === "ai_tool") return "tool";
    if (outIndex === 0) return undefined;
    return `out${outIndex}`;
  };

  const resolveTargetHandle = (tgtMapped, connType, targetIndex, meta) => {
    if (AI_CONN_TYPES.has(connType)) {
      if (connType === "ai_languageModel") return "model";
      if (connType === "ai_tool") return "tools";
      if (connType === "ai_memory") return "memory";
      return undefined;
    }
    if (tgtMapped.type === "merge") {
      return claimMergePort(tgtMapped.id, targetIndex, meta);
    }
    if (tgtMapped.type === "loop") {
      return targetIndex === 0 ? "items" : "continue";
    }
    return undefined;
  };

  for (const [srcName, outs] of Object.entries(source.connections || {})) {
    const srcMapped = nameToMapped.get(srcName);
    if (!srcMapped || srcMapped.skipExecution) continue;

    for (const [connType, ports] of Object.entries(outs || {})) {
      const isMain = connType === "main";
      const isAiAux = AI_CONN_TYPES.has(connType);
      // Main execution ≠ auxiliary. Only allow verified AI resource edges.
      if (!isMain && !isAiAux) continue;

      (ports || []).forEach((targets, outIndex) => {
        (targets || []).forEach((t) => {
          const tgtMapped = nameToMapped.get(t.node);
          if (!tgtMapped || tgtMapped.skipExecution) return;

          // Auxiliary AI edges only when both ends are mapped resources/agent.
          if (isAiAux) {
            const srcOk =
              srcMapped.type === "aiChatModel" ||
              srcMapped.type === "aiCalculatorTool";
            const tgtOk = tgtMapped.type === "aiAgent";
            if (!srcOk || !tgtOk) return;
          }

          const sourceHandle = resolveSourceHandle(srcMapped, connType, outIndex);
          if (sourceHandle === null) {
            mergePortNotes.push({
              sourceName: srcName,
              targetName: t.node,
              status: MIGRATION_STATUS.NEEDS_REVIEW,
              reason: REASONS.FILTER_DISCARD_BRANCH_UNSUPPORTED,
              sourceOutputIndex: outIndex,
            });
            return;
          }

          const targetIndex = typeof t.index === "number" ? t.index : 0;
          const targetHandle = resolveTargetHandle(tgtMapped, connType, targetIndex, {
            sourceName: srcName,
            targetName: t.node,
            sourceTargetInputIndex: targetIndex,
          });

          edges.push({
            id: `e_n8n_${i++}`,
            source: srcMapped.id,
            target: tgtMapped.id,
            ...(sourceHandle ? { sourceHandle } : {}),
            ...(targetHandle ? { targetHandle } : {}),
            data: {
              migration: {
                sourceConnectionType: connType,
                sourceOutputIndex: outIndex,
                sourceTargetInputIndex: targetIndex,
                targetHandle,
                connectionKind: isAiAux ? "auxiliary" : "execution",
              },
            },
          });
        });
      });
    }
  }
  return edges;
};

const collectDownstreamNames = (connIndex, startName) => {
  const seen = new Set();
  const queue = [startName];
  while (queue.length) {
    const name = queue.shift();
    const outs = connIndex.get(name)?.outgoing || [];
    for (const e of outs) {
      if (seen.has(e.targetName)) continue;
      seen.add(e.targetName);
      queue.push(e.targetName);
    }
  }
  seen.delete(startName);
  return [...seen];
};

/**
 * Static preview — never executes Code or evaluates expressions.
 */
const previewN8nImport = (payload, options = {}) => {
  const detection = detectFormat(payload);
  if (detection.format !== "n8n") {
    return {
      ok: false,
      format: detection.format,
      error: "Not an n8n workflow export",
      structureImportable: false,
      runtimeReady: false,
    };
  }

  const source = payload;
  const connIndex = buildConnectionIndex(source);
  const nodes = Array.isArray(source.nodes) ? source.nodes : [];
  const expressionFindings = [];
  const nodeReports = [];
  const annotations = [];
  const credentialSetup = [];
  const nameToMapped = new Map();
  const nameToId = new Map();

  // First pass: classify + map
  for (const node of nodes) {
    const connInfo = connIndex.get(node.name) || { incoming: [], outgoing: [] };
    const classification = classifySourceNode(node, connInfo);

    if (classification.category === SOURCE_CATEGORIES.ANNOTATION) {
      annotations.push({
        sourceNodeId: node.id,
        sourceNodeName: node.name,
        sourceNodeType: node.type,
        status: OPSAI_AVAILABILITY.stickyNoteAnnotationUi
          ? MIGRATION_STATUS.NON_RUNTIME_ANNOTATION
          : MIGRATION_STATUS.ANNOTATION_NOT_IMPORTED,
        contentPreview:
          typeof node.parameters?.content === "string"
            ? node.parameters.content.slice(0, 200)
            : null,
      });
      nodeReports.push({
        sourceNodeId: node.id,
        sourceNodeName: node.name,
        sourceNodeType: node.type,
        category: classification.category,
        status: MIGRATION_STATUS.IGNORED_NON_RUNTIME,
        reasons: ["NON_RUNTIME_STICKY_NOTE"],
        mappedType: null,
        blocksRuntime: false,
      });
      nameToMapped.set(node.name, {
        id: null,
        type: null,
        skipExecution: true,
        annotation: true,
      });
      continue;
    }

    const id = stableNodeId(node.id);
    const mapped = mapClassifiedNode(node, classification, expressionFindings, id);
    nameToId.set(node.name, id);

    // Parameter expression scan (never Code jsCode)
    if (node.type !== "n8n-nodes-base.code" && node.parameters) {
      const found = [];
      scanParametersForExpressions(node.parameters, nameToId, found);
      for (const f of found) {
        expressionFindings.push({ nodeName: node.name, ...f });
      }
    }

    const opsNode = {
      id,
      type: mapped.type,
      position: {
        x: Array.isArray(node.position) ? node.position[0] : 0,
        y: Array.isArray(node.position) ? node.position[1] : 0,
      },
      data: {
        ...mapped.data,
        nodeType: mapped.type,
        migration: {
          sourceNodeId: node.id,
          sourceNodeName: node.name,
          sourceNodeType: node.type,
          sourceNodeVersion: node.typeVersion,
          category: classification.category,
          status: mapped.status,
          reasons: mapped.reasons,
        },
      },
    };

    nameToMapped.set(node.name, {
      id,
      type: mapped.type,
      skipExecution: false,
      opsNode,
      mapped,
      classification,
    });

    if (mapped.credentialHints?.length) {
      for (const h of mapped.credentialHints) {
        credentialSetup.push({
          sourceNodeName: node.name,
          sourceNodeType: node.type,
          ...h,
        });
      }
    }

    const blocksRuntime =
      mapped.type === "migrationUnsupported" ||
      mapped.status === MIGRATION_STATUS.UNSUPPORTED ||
      mapped.status === MIGRATION_STATUS.NEEDS_SETUP;

    nodeReports.push({
      sourceNodeId: node.id,
      sourceNodeName: node.name,
      sourceNodeType: node.type,
      category: classification.category,
      status: mapped.status,
      reasons: mapped.reasons,
      mappedType: mapped.type,
      mappedNodeId: id,
      blocksRuntime,
      credentialHints: mapped.credentialHints || [],
    });
  }

  const definitionNodes = [];
  for (const entry of nameToMapped.values()) {
    if (entry.opsNode) definitionNodes.push(entry.opsNode);
  }

  const mergePortNotes = [];
  const edges = buildEdges(source, nameToMapped, mergePortNotes);

  // Fan-out check data for report
  const trigger = nodes.find((n) => n.type === "n8n-nodes-base.scheduleTrigger");
  const fanOutTargets = trigger
    ? (connIndex.get(trigger.name)?.outgoing || [])
        .filter((e) => e.connectionType === "main")
        .map((e) => e.targetName)
    : [];

  // Optional dependency impact for unsupported code producers
  const dependencyImpact = [];
  for (const rep of nodeReports) {
    if (
      rep.sourceNodeType === "n8n-nodes-base.code" &&
      rep.status === MIGRATION_STATUS.UNSUPPORTED
    ) {
      const downstream = collectDownstreamNames(connIndex, rep.sourceNodeName);
      if (downstream.length) {
        dependencyImpact.push({
          unsupportedNode: rep.sourceNodeName,
          reason: REASONS.ARBITRARY_CODE_NOT_PORTABLE,
          mayBlockDownstream: downstream.slice(0, 20),
        });
      }
    }
  }

  const converted = nodeReports.filter((r) =>
    [MIGRATION_STATUS.SUPPORTED, MIGRATION_STATUS.PARTIAL, MIGRATION_STATUS.NEEDS_SETUP].includes(
      r.status
    ) && r.mappedType && r.mappedType !== "migrationUnsupported"
  );
  const unsupported = nodeReports.filter(
    (r) =>
      r.status === MIGRATION_STATUS.UNSUPPORTED ||
      r.mappedType === "migrationUnsupported"
  );
  const needsSetup = nodeReports.filter((r) => r.status === MIGRATION_STATUS.NEEDS_SETUP);
  const needsReview = [
    ...nodeReports.filter((r) => r.status === MIGRATION_STATUS.NEEDS_REVIEW),
    ...expressionFindings.filter(
      (e) =>
        e.status === MIGRATION_STATUS.EXPRESSION_REVIEW_REQUIRED ||
        e.status === MIGRATION_STATUS.NEEDS_REVIEW ||
        e.status === MIGRATION_STATUS.UNSUPPORTED
    ),
  ];

  const runtimeBlockers = nodeReports
    .filter((r) => r.blocksRuntime)
    .map((r) => ({
      nodeName: r.sourceNodeName,
      reasons: r.reasons,
      mappedType: r.mappedType,
    }));

  const sourceErrorWorkflow =
    source.settings?.errorWorkflow ||
    source.settings?.errorWorkflowId ||
    null;
  let sourceErrorWorkflowHint = null;
  if (sourceErrorWorkflow) {
    sourceErrorWorkflowHint =
      typeof sourceErrorWorkflow === "object"
        ? {
            id: sourceErrorWorkflow.value || sourceErrorWorkflow.id || null,
            name: sourceErrorWorkflow.name || null,
          }
        : { id: String(sourceErrorWorkflow), name: null };
    runtimeBlockers.push({
      nodeName: "(workflow settings)",
      reasons: [REASONS.ERROR_WORKFLOW_TARGET_REQUIRED],
      mappedType: null,
    });
  }

  const runtimeReady =
    runtimeBlockers.length === 0 &&
    credentialSetup.length === 0 &&
    !expressionFindings.some(
      (e) => e.status === MIGRATION_STATUS.EXPRESSION_REVIEW_REQUIRED
    );

  const structuralCompatibility = definitionNodes.length > 0 && edges.length >= 0;
  const convertibleCount = nodeReports.filter(
    (r) => r.category !== SOURCE_CATEGORIES.ANNOTATION
  ).length;
  const convertedCount = converted.length;
  const nodeConversionCompatibility =
    convertibleCount === 0 ? 0 : convertedCount / convertibleCount;

  const definition = {
    version: 1,
    nodes: definitionNodes,
    edges,
    settings: {},
    migration: {
      sourceFormat: "n8n",
      sourceWorkflowName: source.name || null,
      importedAt: options.importedAt || null,
      structureImportable: true,
      runtimeReady: false, // always recompute below
      unresolvedRequirements: [],
    },
  };

  // Error Workflow setting: never reuse source workflow ID as OpsAi errorWorkflowId.
  if (sourceErrorWorkflowHint) {
    definition.migration.unresolvedRequirements.push({
      code: REASONS.ERROR_WORKFLOW_TARGET_REQUIRED,
      sourceErrorWorkflowHint,
    });
    definition.settings.errorWorkflowId = null;
    definition.settings.sourceErrorWorkflowHint = sourceErrorWorkflowHint;
  }

  for (const n of definitionNodes) {
    if (n.data?.unresolvedRequirement === REASONS.SUBWORKFLOW_TARGET_REQUIRED) {
      definition.migration.unresolvedRequirements.push({
        code: REASONS.SUBWORKFLOW_TARGET_REQUIRED,
        nodeId: n.id,
        sourceWorkflowHint: n.data.sourceWorkflowHint || null,
      });
    }
  }

  // Security: reject accidental executable Code with raw n8n JS
  const codeViolation = assertNoImportedCodeExecution(definition);
  if (codeViolation) {
    return {
      ok: false,
      format: "n8n",
      error: codeViolation.message,
      code: REASONS.N8N_IMPORTED_CODE_EXECUTION_FORBIDDEN,
      structureImportable: false,
      runtimeReady: false,
    };
  }

  definition.migration.runtimeReady = runtimeReady;

  const report = {
    format: "n8n",
    sourceWorkflowName: source.name || null,
    sourceNodeCount: nodes.length,
    sourceConnectionCount: countRawEdges(source),
    importedExecutionEdgeCount: edges.length,
    annotationCount: annotations.length,
    executionNodeCount: definitionNodes.length,
    mergePortNotes,
    structureImportable: true,
    runtimeReady,
    scores: {
      STRUCTURAL_COMPATIBILITY: structuralCompatibility,
      NODE_CONVERSION_COMPATIBILITY: Number(nodeConversionCompatibility.toFixed(4)),
      RUNTIME_READINESS: runtimeReady,
    },
    summary: {
      converted: converted.map((r) => ({
        name: r.sourceNodeName,
        mappedType: r.mappedType,
        status: r.status,
      })),
      needsSetup: credentialSetup.map((c) => ({
        nodeName: c.sourceNodeName,
        credentialType: c.sourceCredentialType,
        displayName: c.sourceDisplayName,
        reason: c.reason,
      })),
      unsupported: unsupported.map((r) => ({
        name: r.sourceNodeName,
        sourceType: r.sourceNodeType,
        reasons: r.reasons,
      })),
      needsReview: expressionFindings
        .filter(
          (e) =>
            e.status === MIGRATION_STATUS.EXPRESSION_REVIEW_REQUIRED ||
            e.status === MIGRATION_STATUS.NEEDS_REVIEW ||
            e.status === MIGRATION_STATUS.UNSUPPORTED
        )
        .map((e) => ({
          nodeName: e.nodeName,
          path: e.path || e.field,
          status: e.status,
          notes: e.notes,
        })),
      annotations: annotations.map((a) => ({
        name: a.sourceNodeName,
        status: a.status,
      })),
      runtimeReadiness: runtimeReady ? "ready" : "not_ready",
    },
    nodes: nodeReports,
    annotations,
    credentials: credentialSetup,
    expressions: expressionFindings,
    runtimeBlockers,
    dependencyImpact,
    fanOut: {
      triggerName: trigger?.name || null,
      targetNames: fanOutTargets,
      preserved: fanOutTargets.length > 1,
    },
    mergePortSamples: edges
      .filter((e) => e.targetHandle === "input1" || e.targetHandle === "input2")
      .map((e) => ({
        sourceId: e.source,
        targetId: e.target,
        targetHandle: e.targetHandle,
        sourceInputIndex: e.data?.migration?.sourceTargetInputIndex,
      })),
    authority: {
      sourceActiveIgnored: source.active === true,
      freshOpsAiStatus: "draft",
      sourceIdsNotReused: true,
      sourceHadWorkflowId: Boolean(source.id),
      sourceHadVersionId: Boolean(source.versionId),
    },
  };

  return {
    ok: true,
    format: "n8n",
    structureImportable: true,
    runtimeReady,
    definition,
    report,
    // Determinism helper
    fingerprint: hashPreview(definition, report),
  };
};

const countRawEdges = (source) => {
  let n = 0;
  for (const outs of Object.values(source.connections || {})) {
    for (const ports of Object.values(outs || {})) {
      (ports || []).forEach((targets) => {
        n += (targets || []).length;
      });
    }
  }
  return n;
};

const hashPreview = (definition, report) => {
  const payload = {
    nodes: (definition.nodes || []).map((n) => ({
      id: n.id,
      type: n.type,
      label: n.data?.label,
    })),
    edges: (definition.edges || []).map((e) => ({
      source: e.source,
      target: e.target,
      targetHandle: e.targetHandle || null,
      sourceHandle: e.sourceHandle || null,
    })),
    runtimeReady: report.runtimeReady,
    sourceNodeCount: report.sourceNodeCount,
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
};

/**
 * Fail closed if importer produces executable Code containing untrusted n8n JS.
 */
const assertNoImportedCodeExecution = (definition) => {
  for (const node of definition.nodes || []) {
    if (node.type !== "code") continue;
    const code = node.data?.code;
    const mig = node.data?.migration;
    if (
      mig?.sourceNodeType === "n8n-nodes-base.code" &&
      typeof code === "string" &&
      code.length > 0
    ) {
      return {
        message:
          "Imported n8n Code must not become an executable OpsAi Code node in V1",
        code: REASONS.N8N_IMPORTED_CODE_EXECUTION_FORBIDDEN,
        nodeId: node.id,
      };
    }
  }
  return null;
};

/**
 * Build draft-ready payload. Always inactive draft; ignore source active/ids.
 */
const buildDraftImport = (payload, { name } = {}) => {
  const preview = previewN8nImport(payload);
  if (!preview.ok) return preview;

  const workflowName =
    name ||
    (payload.name ? `${payload.name} (imported)` : "Imported n8n workflow");

  return {
    ...preview,
    draft: {
      name: workflowName,
      description: `Imported from n8n${payload.name ? `: ${payload.name}` : ""}`,
      status: "draft",
      definition: {
        ...preview.definition,
        migration: {
          ...preview.definition.migration,
          importedAsDraft: true,
          reportSummary: preview.report.summary,
        },
      },
    },
  };
};

/**
 * Activation / run gate for imported graphs with unresolved migration blockers.
 */
const getMigrationRuntimeBlockers = (definition) => {
  const blockers = [];
  for (const node of definition?.nodes || []) {
    if (node.type === "migrationUnsupported") {
      blockers.push({
        nodeId: node.id,
        nodeName: node.data?.label || node.id,
        reasons: [
          node.data?.migrationReason ||
            node.data?.migration?.reasons?.[0] ||
            "UNSUPPORTED",
        ],
      });
    }
    if (node.data?.credentialRequirement?.configuredAtSource && !node.data?.credentialId) {
      blockers.push({
        nodeId: node.id,
        nodeName: node.data?.label || node.id,
        reasons: [REASONS.CREDENTIAL_REQUIRES_RECONNECT],
      });
    }
    if (node.data?.unresolvedRequirement === REASONS.SUBWORKFLOW_TARGET_REQUIRED) {
      blockers.push({
        nodeId: node.id,
        nodeName: node.data?.label || node.id,
        reasons: [REASONS.SUBWORKFLOW_TARGET_REQUIRED],
      });
    }
  }
  if (definition?.settings?.sourceErrorWorkflowHint || 
      (definition?.migration?.unresolvedRequirements || []).some(
        (r) => r.code === REASONS.ERROR_WORKFLOW_TARGET_REQUIRED
      )) {
    blockers.push({
      nodeId: null,
      nodeName: "(workflow settings)",
      reasons: [REASONS.ERROR_WORKFLOW_TARGET_REQUIRED],
    });
  }
  if (definition?.migration?.runtimeReady === false) {
    // Ensure at least migration-level not-ready is visible
    if (!blockers.length) {
      blockers.push({
        nodeId: null,
        nodeName: null,
        reasons: ["MIGRATION_RUNTIME_NOT_READY"],
      });
    }
  }
  return blockers;
};

const assertMigrationRunnable = (definition) => {
  const violation = assertNoImportedCodeExecution(definition);
  if (violation) {
    const err = new Error(violation.message);
    err.code = REASONS.N8N_IMPORTED_CODE_EXECUTION_FORBIDDEN;
    err.statusCode = 400;
    throw err;
  }
  const blockers = getMigrationRuntimeBlockers(definition);
  if (blockers.length) {
    const err = new Error(
      `Imported workflow is not runtime-ready. Fix unsupported/setup nodes first: ${blockers
        .map((b) => b.nodeName || b.reasons.join(","))
        .filter(Boolean)
        .slice(0, 12)
        .join("; ")}`
    );
    err.code = "MIGRATION_RUNTIME_BLOCKED";
    err.statusCode = 400;
    err.details = { blockers };
    throw err;
  }
};

module.exports = {
  SOURCE_CATEGORIES,
  MIGRATION_STATUS,
  REASONS,
  OPSAI_AVAILABILITY,
  MERGE_PORT_BY_INDEX,
  detectFormat,
  classifySourceNode,
  classifyExpression,
  previewN8nImport,
  buildDraftImport,
  assertNoImportedCodeExecution,
  getMigrationRuntimeBlockers,
  assertMigrationRunnable,
  stableNodeId,
  extractCredentialHints,
};
