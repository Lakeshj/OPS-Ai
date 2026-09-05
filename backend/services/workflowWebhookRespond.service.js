/**
 * Part 13B — Webhook Respond-to-Webhook validation + response channel.
 *
 * Respond mode runs synchronously in the HTTP request (bounded).
 * Durable Wait / Execute Workflow before Respond are rejected.
 * Express req/res are never serialized — only an ephemeral in-process channel.
 */

const {
  getExecutionEdges,
} = require("./workflowConnection.service");

const RESPOND_ERROR = Object.freeze({
  CONTEXT_REQUIRED: "RESPOND_WEBHOOK_CONTEXT_REQUIRED",
  ALREADY_SENT: "RESPOND_WEBHOOK_ALREADY_SENT",
  MODE_INVALID: "RESPOND_WEBHOOK_MODE_INVALID",
  RESPOND_REQUIRED: "RESPOND_WEBHOOK_REQUIRED",
  MULTIPLE_RESPOND: "RESPOND_WEBHOOK_MULTIPLE",
  WAIT_FORBIDDEN: "RESPOND_WEBHOOK_WAIT_FORBIDDEN",
  SUBWORKFLOW_FORBIDDEN: "RESPOND_WEBHOOK_SUBWORKFLOW_FORBIDDEN",
  LOOP_BODY_FORBIDDEN: "RESPOND_WEBHOOK_LOOP_BODY_FORBIDDEN",
  TIMEOUT: "RESPOND_WEBHOOK_TIMEOUT",
  NO_RESPONSE: "RESPOND_WEBHOOK_NO_RESPONSE",
});

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "host",
]);

const nodeTypeOf = (node) => node?.type || node?.data?.nodeType || null;

const getWebhookResponseMode = (node) => {
  const mode = String(node?.data?.responseMode || "immediate").trim();
  return mode || "immediate";
};

/** Build adjacency from execution edges only. */
const buildExecutionAdj = (definition) => {
  const adj = new Map();
  for (const n of definition.nodes || []) {
    adj.set(n.id, []);
  }
  for (const e of getExecutionEdges(definition)) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source).push(e.target);
  }
  return adj;
};

const reachableFrom = (adj, startId) => {
  const seen = new Set();
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of adj.get(id) || []) stack.push(next);
  }
  return seen;
};

const collectLoopBodyIds = (definition) => {
  const body = new Set();
  try {
    const { buildGraph } = require("./workflowEngine.service");
    const { analyzeLoopRegion, isLoopNode } = require("./workflowLoopGraph.service");
    const graph = buildGraph(definition);
    for (const n of graph.nodes || []) {
      if (!isLoopNode(n)) continue;
      const region = analyzeLoopRegion(graph, n.id);
      if (region?.ok && region.bodyNodes) {
        for (const id of region.bodyNodes) body.add(id);
      }
    }
  } catch {
    // ignore — validation still covers wait/subworkflow
  }
  return body;
};

/**
 * Validate Respond-to-Webhook mode for a definition.
 * @returns {{ ok: true } | { ok: false, code: string, message: string }}
 */
const validateWebhookRespondDefinition = (definition) => {
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  const webhookNodes = nodes.filter((n) => nodeTypeOf(n) === "webhook");

  for (const wh of webhookNodes) {
    const mode = getWebhookResponseMode(wh);
    if (mode === "lastNode") {
      return {
        ok: false,
        code: RESPOND_ERROR.MODE_INVALID,
        message:
          'Webhook response mode "When last node finishes" is not supported in V1. Use Immediately or Respond to Webhook.',
      };
    }
  }

  const respondModeWebhooks = webhookNodes.filter(
    (n) => getWebhookResponseMode(n) === "respondNode"
  );
  if (respondModeWebhooks.length === 0) {
    return { ok: true };
  }

  const adj = buildExecutionAdj(definition);
  const loopBodyIds = collectLoopBodyIds(definition);

  for (const wh of respondModeWebhooks) {
    const reach = reachableFrom(adj, wh.id);
    const respondNodes = nodes.filter(
      (n) => nodeTypeOf(n) === "respondToWebhook" && reach.has(n.id)
    );
    if (respondNodes.length === 0) {
      return {
        ok: false,
        code: RESPOND_ERROR.RESPOND_REQUIRED,
        message:
          "Respond to Webhook mode requires exactly one reachable Respond to Webhook node.",
      };
    }
    if (respondNodes.length > 1) {
      return {
        ok: false,
        code: RESPOND_ERROR.MULTIPLE_RESPOND,
        message:
          "Respond to Webhook mode allows only one reachable Respond to Webhook node in V1.",
      };
    }
    for (const n of nodes) {
      if (!reach.has(n.id)) continue;
      const t = nodeTypeOf(n);
      if (t === "wait") {
        return {
          ok: false,
          code: RESPOND_ERROR.WAIT_FORBIDDEN,
          message:
            "Respond to Webhook mode cannot include a Wait node on the webhook path.",
        };
      }
      if (t === "executeWorkflow") {
        return {
          ok: false,
          code: RESPOND_ERROR.SUBWORKFLOW_FORBIDDEN,
          message:
            "Respond to Webhook mode cannot include Execute Workflow on the webhook path.",
        };
      }
      if (t === "respondToWebhook" && loopBodyIds.has(n.id)) {
        return {
          ok: false,
          code: RESPOND_ERROR.LOOP_BODY_FORBIDDEN,
          message:
            "Respond to Webhook cannot be placed inside a Loop body in V1.",
        };
      }
    }
  }

  return { ok: true };
};

const createWebhookResponseChannel = () => {
  const state = {
    sent: false,
    statusCode: 200,
    body: null,
    headers: {},
    responseType: "json",
  };
  return {
    get sent() {
      return state.sent;
    },
    /** Snapshot safe for HTTP — never store on run. */
    snapshot() {
      if (!state.sent) return null;
      return {
        statusCode: state.statusCode,
        body: state.body,
        headers: { ...state.headers },
        responseType: state.responseType,
      };
    },
    send({ statusCode, body, headers, responseType }) {
      if (state.sent) {
        const err = new Error("Webhook response already sent.");
        err.code = RESPOND_ERROR.ALREADY_SENT;
        throw err;
      }
      state.sent = true;
      state.statusCode = statusCode;
      state.body = body;
      state.headers = headers || {};
      state.responseType = responseType || "json";
    },
  };
};

const validateStatusCode = (raw) => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 100 || n > 599) {
    const err = new Error(
      "Respond status code must be an integer from 100 to 599."
    );
    err.code = "RESPOND_WEBHOOK_STATUS_INVALID";
    throw err;
  }
  return n;
};

const sanitizeResponseHeaders = (rows) => {
  const headers = {};
  const list = Array.isArray(rows)
    ? rows
    : rows && typeof rows === "object"
      ? Object.entries(rows).map(([key, value]) => ({ key, value }))
      : [];
  for (const row of list) {
    const key = String(row?.key || "").trim();
    if (!key) continue;
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    if (/[\r\n]/.test(key) || /[\r\n]/.test(String(row?.value ?? ""))) {
      const err = new Error("Response headers must not contain CR/LF.");
      err.code = "RESPOND_WEBHOOK_HEADER_INVALID";
      throw err;
    }
    headers[key] = String(row?.value ?? "");
  }
  return headers;
};

module.exports = {
  RESPOND_ERROR,
  HOP_BY_HOP_HEADERS,
  getWebhookResponseMode,
  validateWebhookRespondDefinition,
  createWebhookResponseChannel,
  validateStatusCode,
  sanitizeResponseHeaders,
};
