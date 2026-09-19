const { executeWorkflowTool } = require("./workflowNode");

const MAX_RESULT_CHARS = 8000;

const truncate = (value) => {
  const text =
    typeof value === "string" ? value : JSON.stringify(value ?? null, null, 0);
  if (text.length <= MAX_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_RESULT_CHARS)}\n…[truncated]`;
};

/**
 * Build AI Agent tool descriptors from the plugin catalog.
 * Uses internal tool ids; descriptions prefer user-facing labels.
 */
const buildAiToolDescriptors = (catalog = [], binding = {}) =>
  (catalog || []).map((t) => ({
    kind: "AI_TOOL",
    toolKind: "gsc_mcp",
    name: `gsc_${t.id}`.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 64),
    description: t.discoveryOnly
      ? `${t.label || t.name}: discovery only — lists available GSC MCP capabilities.`
      : `${t.label || t.name}. ${t.description || ""}`.trim(),
    inputSchema: t.inputSchema || { type: "object", properties: {} },
    gscToolId: t.id,
    label: t.label || t.name,
    credentialId: binding.credentialId || null,
    defaultSiteUrl: binding.siteUrl || null,
  }));

const attachGscMcpExecutors = (descriptors, { client, authContext }) =>
  (descriptors || []).map((d) => {
    if (d.toolKind !== "gsc_mcp") return d;
    return {
      ...d,
      async execute(args = {}) {
        const toolArgs = {
          ...(args && typeof args === "object" ? args : {}),
        };
        if (!toolArgs.siteUrl && d.defaultSiteUrl) {
          toolArgs.siteUrl = d.defaultSiteUrl;
        }
        const result = await executeWorkflowTool({
          client,
          toolId: d.gscToolId,
          toolArgs,
          authContext: {
            ...authContext,
            credentialId: d.credentialId || authContext?.credentialId,
          },
        });
        if (!result.ok) {
          return truncate({
            ok: false,
            error: result.error,
          });
        }
        return truncate({ ok: true, toolId: result.toolId, data: result.data });
      },
    };
  });

module.exports = {
  buildAiToolDescriptors,
  attachGscMcpExecutors,
};
