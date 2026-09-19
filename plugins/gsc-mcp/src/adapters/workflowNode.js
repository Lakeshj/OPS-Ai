const { INTELLIGENCE_IDS, ACTION_IDS } = require("../registry/categories");
const { runIntelligence } = require("../intelligence");
const { runAction } = require("../actions");

const workflowToolOptions = (catalog = []) =>
  catalog.map((t) => ({
    name: t.label || `${t.category}: ${t.name}`,
    value: t.id,
  }));

/**
 * Execute a GSC MCP capability (Assistant / Agent / future intelligence nodes).
 * Not a user-facing canvas node — legacy `gscMcp` execution is refused by the host.
 */
const executeWorkflowTool = async ({
  client,
  toolId,
  toolArgs = {},
  authContext = {},
  mode = "raw",
}) => {
  const id = String(toolId || "").trim();
  if (!id) {
    return {
      ok: false,
      error: { code: "MCP_VALIDATION", message: "toolId is required" },
    };
  }

  if (INTELLIGENCE_IDS.includes(id) || String(mode).startsWith("intelligence:")) {
    const intelId = INTELLIGENCE_IDS.includes(id)
      ? id
      : String(mode).replace(/^intelligence:/, "");
    return runIntelligence(intelId, toolArgs);
  }
  if (ACTION_IDS.includes(id) || String(mode).startsWith("action:")) {
    const actionId = ACTION_IDS.includes(id)
      ? id
      : String(mode).replace(/^action:/, "");
    return runAction(actionId, toolArgs);
  }

  const result = await client.callTool(id, toolArgs, authContext);
  if (mode && String(mode).startsWith("intelligence:") && result.ok) {
    const intelId = String(mode).replace(/^intelligence:/, "");
    const rows =
      result.data?.rows ||
      result.data?.opportunities ||
      (Array.isArray(result.data) ? result.data : []);
    return runIntelligence(intelId, { ...toolArgs, rows });
  }
  if (mode && String(mode).startsWith("action:") && result.ok) {
    const actionId = String(mode).replace(/^action:/, "");
    const rows =
      result.data?.rows ||
      result.data?.opportunities ||
      (Array.isArray(result.data) ? result.data : []);
    return runAction(actionId, { ...toolArgs, rows });
  }
  return result;
};

const resultToWorkflowItems = (result) => {
  if (!result?.ok) {
    return {
      output: { ok: false, error: result?.error || { message: "failed" } },
      items: [],
    };
  }
  const data = result.data;
  let rows = [];

  // Meta / capabilities: keep as one object — never fan out tool-name strings.
  if (
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    (Array.isArray(data.tools) || data.auth != null) &&
    !Array.isArray(data.rows) &&
    !Array.isArray(data.sites) &&
    !Array.isArray(data.opportunities)
  ) {
    rows = [data];
  } else if (Array.isArray(data?.rows)) {
    rows = data.rows.map(normalizeAnalyticsRow);
  } else if (Array.isArray(data?.opportunities)) {
    rows = data.opportunities;
  } else if (Array.isArray(data?.sites)) {
    rows = data.sites;
  } else if (Array.isArray(data?.sitemap)) {
    rows = data.sitemap;
  } else if (Array.isArray(data)) {
    // Only treat as item rows when elements are objects (not bare strings).
    if (data.length && data.every((x) => typeof x === "string")) {
      rows = [{ tools: data, note: "Tool catalog (not analytics rows)" }];
    } else {
      rows = data;
    }
  } else if (data && typeof data === "object") {
    rows = [data];
  } else {
    rows = [{ value: data }];
  }

  return {
    output: {
      ok: true,
      toolId: result.toolId,
      warnings: result.warnings || [],
      itemCount: rows.length,
    },
    items: rows.map((row, index) => ({
      json: row && typeof row === "object" ? row : { value: row },
      pairedItem: { item: index },
    })),
  };
};

/** Flatten GSC analytics keys[] into Filter/Sort-friendly fields. */
const normalizeAnalyticsRow = (row) => {
  if (!row || typeof row !== "object") return { value: row };
  const keys = Array.isArray(row.keys) ? row.keys : null;
  if (!keys) return row;
  const out = { ...row };
  if (keys[0] != null && out.query == null && out.page == null) {
    // Heuristic: single key is usually query or page depending on request.
    out.query = keys[0];
    if (keys.length > 1) out.page = keys[1];
  }
  delete out.keys;
  return out;
};

module.exports = {
  workflowToolOptions,
  executeWorkflowTool,
  resultToWorkflowItems,
};
