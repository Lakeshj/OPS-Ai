/**
 * M8.16 — Workflow Context Bridge (editor ↔ Workflow Copilot).
 *
 * Builds a sanitized, model-friendly WorkflowContext from the full graph
 * (never pruned). Separate from AI Agent runtime tools (Instagram MCP etc.).
 */

const {
  getAuxiliaryEdges,
  getEdgeConnectionMeta,
  CONNECTION_KIND,
  DATA_TYPE,
  nodeTypeOf,
} = require("./workflowConnection.service");
const {
  sanitizeNodeParameters,
  sanitizeValue,
  cloneJson,
  hashDefinition,
} = require("./workflowCopilot.service");
const { stripSecrets } = require("./workflowAiResources.service");

const SOURCE_BINDING_KEYS = Object.freeze([
  "instagramSourceNodeId",
  "googleAdsSourceNodeId",
  "metaAdsSourceNodeId",
  "ga4SourceNodeId",
  "gscSourceNodeId",
]);

const MAX_NODES_IN_PROMPT = 40;
const MAX_EDGES_IN_PROMPT = 60;
const MAX_RELATIONSHIPS = 80;

/**
 * Sanitize editor draft: strip secrets from every node.data, drop identity fields
 * from settings. Never trusts client credentials.
 */
const sanitizeEditorDefinition = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const def = cloneJson(raw);
  if (!Array.isArray(def.nodes) || !Array.isArray(def.edges)) return null;

  def.nodes = def.nodes.map((n) => {
    const data = sanitizeNodeParameters(n.data || {});
    // Drop any residual secret-looking values
    const cleaned = stripSecrets(data);
    return {
      id: String(n.id),
      type: nodeTypeOf(n),
      position: n.position
        ? { x: Number(n.position.x) || 0, y: Number(n.position.y) || 0 }
        : undefined,
      data: cleaned && typeof cleaned === "object" ? cleaned : {},
    };
  });

  def.edges = def.edges.map((e) => ({
    id: e.id != null ? String(e.id) : `${e.source}->${e.target}`,
    source: String(e.source),
    target: String(e.target),
    sourceHandle: e.sourceHandle != null ? String(e.sourceHandle) : null,
    targetHandle: e.targetHandle != null ? String(e.targetHandle) : null,
  }));

  if (def.settings && typeof def.settings === "object") {
    for (const k of [
      "workspaceId",
      "workspace_id",
      "ownerId",
      "owner_id",
      "createdBy",
      "created_by",
      "userId",
      "user_id",
      "tenantId",
      "organizationId",
      "accessToken",
      "refreshToken",
    ]) {
      delete def.settings[k];
    }
  }

  return def;
};

const compactNode = (node) => {
  const data = node.data || {};
  const params = sanitizeNodeParameters(data);
  const out = {
    id: node.id,
    type: nodeTypeOf(node),
    label: String(data.label || nodeTypeOf(node)),
  };
  if (params.resource) out.resource = params.resource;
  if (params.operation) out.operation = params.operation;
  if (params.toolId) out.toolId = params.toolId;
  if (params.credentialConfigured != null) {
    out.credentialConfigured = Boolean(params.credentialConfigured);
  }
  if (params.reportType) out.reportType = params.reportType;
  if (params.contextScope) out.contextScope = params.contextScope;
  // Safe account labels (never tokens)
  if (params.username) out.username = params.username;
  if (params.accountName) out.accountName = params.accountName;
  if (params.instagramUserId) out.instagramUserId = String(params.instagramUserId);
  if (params.customerId) out.customerId = String(params.customerId);
  if (params.adAccountId) out.adAccountId = String(params.adAccountId);
  for (const key of SOURCE_BINDING_KEYS) {
    if (params[key]) out[key] = String(params[key]);
  }
  return out;
};

const buildRelationships = (definition) => {
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const relationships = [];

  for (const edge of getAuxiliaryEdges(definition)) {
    const meta = getEdgeConnectionMeta(edge, byId);
    if (!meta.valid) continue;
    if (meta.dataType === DATA_TYPE.AI_TOOL) {
      relationships.push({
        type: "tool_binding",
        from: edge.source,
        to: edge.target,
        sourceHandle: edge.sourceHandle || "tool",
        targetHandle: edge.targetHandle || "tools",
      });
    } else if (meta.dataType === DATA_TYPE.AI_MODEL) {
      relationships.push({
        type: "model_binding",
        from: edge.source,
        to: edge.target,
        sourceHandle: edge.sourceHandle || "model",
        targetHandle: edge.targetHandle || "model",
      });
    } else if (meta.dataType === DATA_TYPE.AI_MEMORY) {
      relationships.push({
        type: "memory_binding",
        from: edge.source,
        to: edge.target,
      });
    }
  }

  for (const node of nodes) {
    const data = node.data || {};
    for (const key of SOURCE_BINDING_KEYS) {
      const src = String(data[key] || "").trim();
      if (!src) continue;
      relationships.push({
        type: "source_binding",
        from: node.id,
        to: src,
        bindingKey: key,
        sourcePresent: byId.has(src),
      });
    }
  }

  return relationships.slice(0, MAX_RELATIONSHIPS);
};

const extractAgentRunSummary = (stepOutput) => {
  if (!stepOutput || typeof stepOutput !== "object") return null;
  const meta = Array.isArray(stepOutput.agentMeta)
    ? stepOutput.agentMeta[0]
    : null;
  if (!meta || typeof meta !== "object") return null;
  return sanitizeValue({
    toolsAvailable: (meta.toolsAvailable || [])
      .map((t) => (typeof t === "string" ? t : t?.name))
      .filter(Boolean)
      .slice(0, 20),
    toolsRequested: meta.toolsRequested || [],
    toolsUsed: meta.toolsUsed || [],
    toolErrors: (meta.toolErrors || []).slice(0, 5),
    modelRequests: meta.modelRequests ?? null,
    groundingRetryTriggered: Boolean(meta.groundingRetryTriggered),
    groundingRetryReason: meta.groundingRetryReason || null,
    toolEdgesFound: meta.toolEdgesFound ?? null,
    toolNodesResolved: meta.toolNodesResolved ?? null,
  });
};

const compactExecutionSummary = ({ run, selectedNodeId, definition } = {}) => {
  if (!run) return null;
  const steps = run.steps || run.stepResults || {};
  let selectedSummary = null;
  if (selectedNodeId && steps[selectedNodeId]) {
    const step = steps[selectedNodeId];
    const node = (definition?.nodes || []).find((n) => n.id === selectedNodeId);
    selectedSummary = sanitizeValue({
      nodeId: selectedNodeId,
      nodeType: node ? nodeTypeOf(node) : null,
      status: step.status || null,
      agent: extractAgentRunSummary(step.output || step),
      rowCount:
        Array.isArray(step.items)
          ? step.items.length
          : Array.isArray(step.output?.items)
            ? step.output.items.length
            : null,
    });
  }

  // Also surface any AI Agent step summaries (bounded)
  const agentSummaries = [];
  for (const [nodeId, step] of Object.entries(steps)) {
    const node = (definition?.nodes || []).find((n) => n.id === nodeId);
    if (!node || nodeTypeOf(node) !== "aiAgent") continue;
    const agent = extractAgentRunSummary(step.output || step);
    if (!agent) continue;
    agentSummaries.push({
      nodeId,
      status: step.status || null,
      ...agent,
    });
    if (agentSummaries.length >= 3) break;
  }

  return sanitizeValue({
    runId: run.id || run.runId || null,
    status: run.status || null,
    selectedNode: selectedSummary,
    agents: agentSummaries,
    error: run.error
      ? String(run.error).slice(0, 400)
      : run.safeError?.message
        ? String(run.safeError.message).slice(0, 400)
        : null,
  });
};

/**
 * Build authoritative WorkflowContext for Copilot.
 */
const buildWorkflowContext = ({
  workflow = null,
  editorDefinition = null,
  persistedDefinition = null,
  selectedNodeId = null,
  latestExecution = null,
  workspaceId = null,
} = {}) => {
  const hasDraft =
    editorDefinition &&
    Array.isArray(editorDefinition.nodes) &&
    Array.isArray(editorDefinition.edges);
  const persistedRaw =
    persistedDefinition || workflow?.definition || { nodes: [], edges: [] };
  const draftSanitized = hasDraft
    ? sanitizeEditorDefinition(editorDefinition)
    : null;
  const persistedSanitized = sanitizeEditorDefinition(persistedRaw) || {
    version: 1,
    nodes: [],
    edges: [],
  };
  // Prefer editor draft when present; mark persisted when structurally identical.
  let contextSource = "persisted";
  let definition = persistedSanitized;
  if (draftSanitized) {
    definition = draftSanitized;
    const same =
      hashDefinition(draftSanitized) === hashDefinition(persistedSanitized);
    contextSource = same ? "persisted" : "editor_draft";
  }

  const nodes = definition.nodes.map(compactNode);
  const edges = definition.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    kind:
      getEdgeConnectionMeta(e, new Map(definition.nodes.map((n) => [n.id, n])))
        .connectionKind === CONNECTION_KIND.AUXILIARY
        ? "auxiliary"
        : "execution",
  }));
  const relationships = buildRelationships(definition);

  let selectedNode = null;
  if (selectedNodeId) {
    selectedNode = nodes.find((n) => n.id === selectedNodeId) || null;
  }

  const latestExecutionSummary = compactExecutionSummary({
    run: latestExecution,
    selectedNodeId,
    definition,
  });

  return {
    workflow: {
      id: workflow?.id || null,
      name: workflow?.name || null,
      status: workflow?.status || (workflow?.active ? "active" : null),
      workspaceId: workspaceId || workflow?.workspaceId || null,
    },
    contextSource,
    revisionHash: hashDefinition(definition),
    selectedNode,
    nodes,
    edges,
    relationships,
    latestExecution: latestExecutionSummary,
    counts: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      relationshipCount: relationships.length,
      latestRunAttached: Boolean(latestExecutionSummary?.runId),
    },
    // Keep sanitized definition for internal tools (not dumped wholesale into prompts)
    _definition: definition,
  };
};

/**
 * Compact text/JSON for model prompts — never the full raw definition.
 */
const formatWorkflowContextForPrompt = (ctx) => {
  if (!ctx) return null;
  const nodes = (ctx.nodes || []).slice(0, MAX_NODES_IN_PROMPT);
  const edges = (ctx.edges || []).slice(0, MAX_EDGES_IN_PROMPT);
  const relationships = (ctx.relationships || []).slice(0, MAX_RELATIONSHIPS);
  return {
    workflow: ctx.workflow,
    contextSource: ctx.contextSource,
    selectedNode: ctx.selectedNode,
    nodes,
    edges,
    relationships,
    latestExecution: ctx.latestExecution,
    counts: ctx.counts,
    notes: [
      "This is the current OpsAi workflow editor context.",
      "Use it when the user says this workflow / this node / this agent.",
      "Do not invent nodes or connections that are not listed.",
      "Auxiliary tool/model edges are not MAIN execution edges.",
      "Never ask the user for credentials or tokens.",
    ],
  };
};

/** Internal Copilot inspection tools (OpsAi app tools — not Instagram MCP). */
const INTERNAL_TOOL_DEFS = Object.freeze([
  {
    name: "workflow_get_context",
    description:
      "Return the compact current workflow context (nodes, edges, relationships, selected node).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "workflow_get_node",
    description:
      "Return safe details for one node by id (or the selected node if id omitted).",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "Node id to inspect." },
      },
    },
  },
  {
    name: "workflow_get_connections",
    description:
      "List MAIN and auxiliary connections for a node (or selected / entire workflow).",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
      },
    },
  },
  {
    name: "workflow_get_latest_run",
    description:
      "Return the compact latest execution summary attached to this Copilot turn.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "workflow_get_node_output_summary",
    description:
      "Return a safe output/run summary for a node from the latest execution (AI Agent meta, row counts).",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
      },
    },
  },
]);

const executeInternalWorkflowTool = (ctx, toolName, args = {}) => {
  if (!ctx) {
    return { ok: false, code: "NO_CONTEXT", message: "No workflow context loaded." };
  }
  const name = String(toolName || "");
  if (name === "workflow_get_context") {
    return { ok: true, data: formatWorkflowContextForPrompt(ctx) };
  }
  if (name === "workflow_get_node") {
    const id = String(args.nodeId || ctx.selectedNode?.id || "").trim();
    if (!id) {
      return {
        ok: false,
        code: "NODE_REQUIRED",
        message: "No nodeId and no selected node.",
      };
    }
    const node = (ctx.nodes || []).find((n) => n.id === id);
    if (!node) {
      return { ok: false, code: "NODE_NOT_FOUND", message: `Node ${id} not in context.` };
    }
    return { ok: true, data: node };
  }
  if (name === "workflow_get_connections") {
    const id = String(args.nodeId || ctx.selectedNode?.id || "").trim();
    const edges = ctx.edges || [];
    const relationships = ctx.relationships || [];
    if (!id) {
      return {
        ok: true,
        data: {
          edges,
          relationships,
        },
      };
    }
    return {
      ok: true,
      data: {
        nodeId: id,
        incoming: edges.filter((e) => e.target === id),
        outgoing: edges.filter((e) => e.source === id),
        relationships: relationships.filter(
          (r) => r.from === id || r.to === id
        ),
      },
    };
  }
  if (name === "workflow_get_latest_run") {
    return {
      ok: true,
      data: ctx.latestExecution || null,
      attached: Boolean(ctx.latestExecution?.runId),
    };
  }
  if (name === "workflow_get_node_output_summary") {
    const id = String(args.nodeId || ctx.selectedNode?.id || "").trim();
    if (!id) {
      return {
        ok: false,
        code: "NODE_REQUIRED",
        message: "No nodeId and no selected node.",
      };
    }
    const selected = ctx.latestExecution?.selectedNode;
    if (selected?.nodeId === id) {
      return { ok: true, data: selected };
    }
    const agent = (ctx.latestExecution?.agents || []).find((a) => a.nodeId === id);
    if (agent) return { ok: true, data: agent };
    return {
      ok: true,
      data: {
        nodeId: id,
        message: "No compact output summary available for this node in the latest run.",
      },
    };
  }
  return {
    ok: false,
    code: "UNKNOWN_TOOL",
    message: `Unknown internal tool: ${name}`,
  };
};

/**
 * Deterministic inspection brief for connection/debug questions.
 */
const buildInspectionBrief = (ctx, message = "") => {
  if (!ctx) return null;
  const msg = String(message || "");
  const wantsConnections =
    /\b(connected|connection|linked|wired|what.*(to|from)|tool edge|source)\b/i.test(
      msg
    );
  const wantsWhy =
    /\b(why|isn't|is not|not working|fail|broken|missing|getting)\b/i.test(msg);
  const wantsAccount =
    /\b(which|what).*(account|credential|instagram|ads|page)\b/i.test(msg);

  if (!wantsConnections && !wantsWhy && !wantsAccount) return null;

  const toolsUsed = [];
  const parts = [];

  if (wantsConnections || wantsWhy) {
    toolsUsed.push("workflow_get_connections");
    const focusId = ctx.selectedNode?.id || null;
    const conn = executeInternalWorkflowTool(ctx, "workflow_get_connections", {
      nodeId: focusId || undefined,
    });
    parts.push({ tool: "workflow_get_connections", result: conn });
  }
  if (wantsWhy || wantsAccount) {
    toolsUsed.push("workflow_get_latest_run");
    parts.push({
      tool: "workflow_get_latest_run",
      result: executeInternalWorkflowTool(ctx, "workflow_get_latest_run", {}),
    });
  }
  if (wantsAccount && ctx.selectedNode) {
    toolsUsed.push("workflow_get_node");
    parts.push({
      tool: "workflow_get_node",
      result: executeInternalWorkflowTool(ctx, "workflow_get_node", {
        nodeId: ctx.selectedNode.id,
      }),
    });
  }

  // Always include relationship snapshot for agent/MCP questions
  if (/\b(agent|mcp|instagram|tool)\b/i.test(msg)) {
    const rel = (ctx.relationships || []).filter((r) =>
      ["tool_binding", "source_binding", "model_binding"].includes(r.type)
    );
    parts.push({
      tool: "workflow_relationships_filter",
      result: { ok: true, data: rel },
    });
  }

  return {
    toolsUsed: [...new Set(toolsUsed)],
    findings: parts,
  };
};

const assertWorkflowWorkspaceAccess = (workflow, workspaceId) => {
  if (!workflow) return false;
  if (!workspaceId) return true;
  const wfWs = workflow.workspaceId || workflow.workspace_id;
  return !wfWs || String(wfWs) === String(workspaceId);
};

module.exports = {
  SOURCE_BINDING_KEYS,
  INTERNAL_TOOL_DEFS,
  sanitizeEditorDefinition,
  buildWorkflowContext,
  formatWorkflowContextForPrompt,
  buildRelationships,
  compactExecutionSummary,
  extractAgentRunSummary,
  executeInternalWorkflowTool,
  buildInspectionBrief,
  assertWorkflowWorkspaceAccess,
};
