/**
 * M8.16.2 — Safe Instagram MCP structural diagnostics (no Meta / Graph calls).
 *
 * Evaluates the SAME production paths the AI Agent uses:
 *   buildToolDescriptor → resolveAgentResources → catalog / source binding
 *
 * Never decrypts credentials or calls Instagram Graph.
 */

const {
  buildToolDescriptor,
  resolveAgentResources,
  namespacedMcpToolName,
} = require("./workflowAiResources.service");
const { getToolDefinition } = require("./mcpDynamicRegistry.service");
const {
  resolveInstagramSourceNode,
  listInstagramSourceNodes,
} = require("./workflowInstagramMcp.service");

const stripSecretsDeep = (value) => {
  const { stripSecrets } = require("./workflowAiResources.service");
  return stripSecrets(value);
};

/**
 * Diagnose one Instagram MCP node structurally.
 * @returns {object} safe diagnostic (no tokens/secrets)
 */
const diagnoseInstagramMcpNode = (mcpNode, definition = null) => {
  const data = mcpNode?.data || {};
  const nodeId = mcpNode?.id || null;
  const nodeType = mcpNode?.type || null;
  const toolId = String(data.toolId || "").trim() || null;
  const instagramSourceNodeId =
    String(data.instagramSourceNodeId || "").trim() || null;

  const out = {
    nodeId,
    nodeType,
    toolId,
    toolName: data.toolName || null,
    instagramSourceNodeId,
    sourceBindingValid: false,
    sourceNodeResolved: false,
    credentialConfigured: false,
    accountLabel: null,
    catalogKnown: false,
    descriptorPublished: false,
    publishedCapability: null,
    description: null,
    whenToUse: null,
    errors: [],
  };

  if (nodeType !== "instagramMcpTool") {
    out.errors.push({
      code: "NOT_INSTAGRAM_MCP",
      message: `Expected instagramMcpTool, got ${nodeType || "(missing)"}`,
    });
    return stripSecretsDeep(out);
  }

  if (!toolId) {
    out.errors.push({
      code: "TOOL_ID_REQUIRED",
      message: "Instagram MCP tool node requires a toolId.",
    });
    return stripSecretsDeep(out);
  }

  try {
    const catalog = getToolDefinition("instagram", toolId);
    out.catalogKnown = true;
    out.whenToUse = catalog.whenToUse || catalog.usage || null;
    out.description = catalog.description || null;
  } catch (err) {
    out.errors.push({
      code: "UNKNOWN_TOOL_ID",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const desc = buildToolDescriptor(mcpNode);
    out.descriptorPublished = true;
    out.publishedCapability = desc.name || null;
    out.description = desc.description || out.description;
    out.whenToUse = desc.whenToUse || out.whenToUse;
    // Fallback whenToUse from catalog (descriptor may omit it)
    if (!out.whenToUse && out.catalogKnown) {
      try {
        const catalog = getToolDefinition("instagram", toolId);
        out.whenToUse = catalog.whenToUse || null;
      } catch {
        /* already recorded */
      }
    }
  } catch (err) {
    out.errors.push({
      code: "DESCRIPTOR_FAILED",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  const context = { graph: { nodes } };
  try {
    const source = resolveInstagramSourceNode(mcpNode, context);
    out.sourceNodeResolved = true;
    out.sourceBindingValid = true;
    const srcData = source.data || {};
    out.credentialConfigured = Boolean(srcData.credentialId);
    out.accountLabel =
      srcData.username ||
      srcData.accountName ||
      (srcData.instagramUserId
        ? `igUser:${String(srcData.instagramUserId).slice(0, 8)}…`
        : null);
    out.nativeResource = srcData.resource || null;
    out.nativeOperation = srcData.operation || null;
    if (!out.credentialConfigured) {
      out.errors.push({
        code: "SOURCE_CREDENTIAL_MISSING",
        message:
          "Instagram source node has no credentialId — MCP execution would fail at account resolution (not at capability publication).",
      });
    }
  } catch (err) {
    out.sourceBindingValid = false;
    out.errors.push({
      code: err.code || "SOURCE_BINDING",
      message: err instanceof Error ? err.message : String(err),
    });
    // Still note if source id points at a node of wrong type
    if (instagramSourceNodeId) {
      const hit = nodes.find((n) => n.id === instagramSourceNodeId);
      out.sourceNodeResolved = Boolean(hit && hit.type === "instagram");
    }
  }

  // Explicit: native op must not redefine published capability
  out.nativeVsMcp = {
    nativeResource: out.nativeResource || null,
    nativeOperation: out.nativeOperation || null,
    mcpToolId: toolId,
    publishedCapability: out.publishedCapability,
    sameConcept:
      out.nativeOperation && toolId
        ? String(out.nativeOperation).includes(String(toolId)) ||
          String(toolId).includes(String(out.nativeOperation).replace(/^list_/, ""))
        : null,
    note: "Native resource/operation do not determine AI Agent MCP capability; toolId does.",
  };

  return stripSecretsDeep(out);
};

/**
 * Diagnose AI Agent tool checkpoints for Instagram MCP on a full definition.
 * No Meta calls.
 */
const diagnoseInstagramAgentGraph = (definition, agentNodeId = null) => {
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  const edges = Array.isArray(definition?.edges) ? definition.edges : [];
  const agents = nodes.filter((n) => n.type === "aiAgent");
  const agent =
    (agentNodeId && agents.find((a) => a.id === agentNodeId)) ||
    agents[0] ||
    null;

  const mcpNodes = nodes.filter((n) => n.type === "instagramMcpTool");
  const mcpDiagnostics = mcpNodes.map((n) =>
    diagnoseInstagramMcpNode(n, definition)
  );

  const result = {
    agentNodeId: agent?.id || null,
    mcpNodeCount: mcpNodes.length,
    mcpDiagnostics,
    toolEdgesFound: 0,
    toolNodesResolved: 0,
    toolsAvailable: [],
    toolEdgeSources: [],
    resolutionErrors: [],
    architecture: {
      oneMcpNodePerToolId: true,
      note: "Each instagramMcpTool node publishes exactly one toolId (e.g. list_media → instagram_list_media). A comments MCP node cannot satisfy a list_media Agent request.",
    },
  };

  if (!agent) {
    result.resolutionErrors.push({
      code: "NO_AI_AGENT",
      message: "No AI Agent node in this workflow definition.",
    });
    return stripSecretsDeep(result);
  }

  const toolEdges = edges.filter(
    (e) =>
      e.target === agent.id &&
      (String(e.targetHandle || "") === "tools" ||
        String(e.sourceHandle || "") === "tool")
  );
  result.toolEdgesFound = toolEdges.length;
  result.toolEdgeSources = toolEdges.map((e) => e.source);

  try {
    const resolved = resolveAgentResources({
      nodeId: agent.id,
      definition,
    });
    result.toolEdgesFound = resolved.diagnostics.toolEdgesFound;
    result.toolNodesResolved = resolved.diagnostics.toolNodesResolved;
    result.toolsAvailable = resolved.toolDescriptors.map((t) => ({
      name: t.name,
      nodeId: t.nodeId,
      igToolId: t.igToolId || null,
      description: t.description || null,
    }));
    result.resolutionErrors = resolved.diagnostics.toolResolutionErrors || [];
  } catch (err) {
    result.resolutionErrors.push({
      code: err.code || "RESOLVE_FAILED",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return stripSecretsDeep(result);
};

/** Expected public name for a catalog toolId. */
const expectedCapabilityName = (toolId, authorToolName = null) =>
  namespacedMcpToolName("instagram", toolId, authorToolName);

module.exports = {
  diagnoseInstagramMcpNode,
  diagnoseInstagramAgentGraph,
  expectedCapabilityName,
  listInstagramSourceNodes,
};
