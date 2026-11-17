/**
 * Thin Instagram MCP executor.
 * Graph HTTP, normalization, pagination, and metric validation stay in
 * backend Instagram services injected by the host.
 */

const { PluginError, ERROR } = require("./errors");
const { COMMON_TOOL_IDS, WRITE_TOOL_IDS } = require("./contracts/common");
const { PERFORMANCE_TOOL_IDS } = require("./contracts/performance");

const PAGING_URL_RE = /access_token=|appsecret_proof=/i;
const SECRET_KEY_RE =
  /(access[_-]?token|refresh[_-]?token|client[_-]?secret|app[_-]?secret|appsecret[_-]?(proof|time)|^password$|^authorization$|^secret$|^token$)/i;

const createExecutor = (runtime = {}) => {
  const AppError = runtime.AppError;

  function igError(message, code, status = 400) {
    if (AppError) return new AppError(message, status, code);
    return new PluginError(message, code, status);
  }

  function mapError(err, toolId) {
    if (AppError && err instanceof AppError) return err;
    if (err && err.name === "InstagramMcpPluginError") {
      return igError(err.message, err.code, err.statusCode || 400);
    }
    const code = err?.code || ERROR.MCP_EXECUTION_FAILED;
    const status = err?.statusCode || err?.status || 400;
    return igError(
      err?.message || `Instagram MCP tool "${toolId}" failed.`,
      code,
      status
    );
  }

  function stripSecrets(value, depth = 0) {
    if (value == null || depth > 8) return value;
    if (Array.isArray(value)) return value.map((entry) => stripSecrets(entry, depth + 1));
    if (typeof value === "string") {
      if (PAGING_URL_RE.test(value)) return "[redacted]";
      return value;
    }
    if (typeof value !== "object") return value;
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SECRET_KEY_RE.test(key)) continue;
      if (key === "paging" && entry && typeof entry === "object") {
        const paging = { ...entry };
        delete paging.next;
        delete paging.previous;
        out.paging = stripSecrets(paging, depth + 1);
        continue;
      }
      out[key] = stripSecrets(entry, depth + 1);
    }
    return out;
  }

  function wrapRows(toolId, instagramUserId, rows) {
    const list = Array.isArray(rows) ? rows : rows == null ? [] : [rows];
    return list.map((row) => {
      const base =
        row && typeof row === "object" && !Array.isArray(row)
          ? stripSecrets(row)
          : { value: row };
      const meta =
        base._meta && typeof base._meta === "object" ? { ...base._meta } : {};
      meta.provider = "instagram";
      meta.tool = toolId;
      if (instagramUserId) meta.instagramUserId = String(instagramUserId);
      return {
        ...base,
        provider: "instagram",
        tool: toolId,
        instagramUserId: String(instagramUserId || meta.instagramUserId || ""),
        _meta: meta,
      };
    });
  }

  function inheritedUserId(input) {
    return String(
      input?.account?.instagramUserId ||
        input?.instagramUserId ||
        input?.params?.instagramUserId ||
        ""
    ).trim();
  }

  async function runAccountSummary(input, deps = {}) {
    const run = deps.getProfile || runtime.getProfile;
    if (typeof run !== "function") {
      throw igError("Instagram profile read is not available.", "MCP_EXECUTION_FAILED", 500);
    }
    const profile = await run({
      credentialId: input.credentialId,
      workspaceId: input.workspaceId,
      instagramUserId: inheritedUserId(input),
    });
    return wrapRows("account_summary", inheritedUserId(input), [profile]);
  }

  async function runListMedia(input, deps = {}) {
    const run = deps.listMedia || runtime.listMedia;
    if (typeof run !== "function") {
      throw igError("Instagram media list is not available.", "MCP_EXECUTION_FAILED", 500);
    }
    const params = input.params || {};
    const limit = params.limit ?? params.maxItems;
    const fetched = await run({
      credentialId: input.credentialId,
      workspaceId: input.workspaceId,
      instagramUserId: inheritedUserId(input),
      limit,
      returnAll: false,
    });
    return wrapRows("list_media", inheritedUserId(input), fetched?.rows || []);
  }

  async function runMediaDetails(input, deps = {}) {
    const mediaId = String(input.params?.mediaId || "").trim();
    if (!mediaId) {
      throw igError("Enter a media id.", "INSTAGRAM_MEDIA_INVALID");
    }
    const run = deps.getMedia || runtime.getMedia;
    if (typeof run !== "function") {
      throw igError("Instagram media read is not available.", "MCP_EXECUTION_FAILED", 500);
    }
    const row = await run({
      credentialId: input.credentialId,
      workspaceId: input.workspaceId,
      instagramUserId: inheritedUserId(input),
      mediaId,
    });
    return wrapRows("media_details", inheritedUserId(input), [row]);
  }

  async function runComments(input, deps = {}) {
    const run = deps.listComments || runtime.listComments;
    if (typeof run !== "function") {
      throw igError("Instagram comments read is not available.", "MCP_EXECUTION_FAILED", 500);
    }
    const params = input.params || {};
    const mediaId = String(params.mediaId || "").trim();
    if (!mediaId) {
      throw igError("Enter a media id.", "INSTAGRAM_MEDIA_INVALID");
    }
    const fetched = await run({
      credentialId: input.credentialId,
      workspaceId: input.workspaceId,
      instagramUserId: inheritedUserId(input),
      cred: input.cred,
      mediaId,
      limit: params.maxItems ?? params.limit,
      returnAll: false,
    });
    return wrapRows("comments", inheritedUserId(input), fetched?.rows || []);
  }

  async function runAccountInsights(input, deps = {}) {
    const run = deps.runAccountInsights || runtime.runAccountInsights;
    if (typeof run !== "function") {
      throw igError("Instagram account insights are not available.", "MCP_EXECUTION_FAILED", 500);
    }
    const params = input.params || {};
    const fetched = await run({
      credentialId: input.credentialId,
      workspaceId: input.workspaceId,
      instagramUserId: inheritedUserId(input),
      cred: input.cred,
      data: {
        preset: params.preset,
        insightsPreset: params.preset,
        metrics: params.metrics,
        period: params.period,
        dateRange: params.dateRange,
        since: params.since,
        until: params.until,
        breakdown: params.breakdown,
        metricType: params.metricType,
      },
    });
    return wrapRows("account_insights", inheritedUserId(input), fetched?.rows || []);
  }

  async function runMediaInsights(input, deps = {}) {
    const run = deps.runMediaInsights || runtime.runMediaInsights;
    if (typeof run !== "function") {
      throw igError("Instagram media insights are not available.", "MCP_EXECUTION_FAILED", 500);
    }
    const params = input.params || {};
    const mediaId = String(params.mediaId || "").trim();
    if (!mediaId) {
      throw igError("Enter a media id.", "INSTAGRAM_MEDIA_INVALID");
    }
    const fetched = await run({
      credentialId: input.credentialId,
      workspaceId: input.workspaceId,
      instagramUserId: inheritedUserId(input),
      cred: input.cred,
      data: {
        mediaId,
        mediaType: params.mediaType,
        preset: params.preset,
        mediaInsightsPreset: params.preset,
        metrics: params.metrics,
      },
    });
    return wrapRows("media_insights", inheritedUserId(input), fetched?.rows || []);
  }

  async function executeInstagramMcpTool(input = {}, deps = {}) {
    const toolId = String(input.toolId || "");
    if (WRITE_TOOL_IDS.includes(toolId)) {
      throw igError(
        `Instagram MCP V1 does not expose write tool "${toolId}".`,
        ERROR.MCP_UNKNOWN_TOOL
      );
    }
    const credentialId = String(input.credentialId || "").trim();
    if (!credentialId) {
      throw igError("An Instagram credential is required.", ERROR.MCP_CREDENTIAL_REQUIRED);
    }
    const args = {
      params: input.params || {},
      credentialId,
      workspaceId: input.workspaceId,
      account: input.account,
      cred: input.cred,
      instagramUserId: inheritedUserId(input),
    };
    try {
      if (toolId === "account_summary") return runAccountSummary(args, deps);
      if (toolId === "list_media") return runListMedia(args, deps);
      if (toolId === "media_details") return runMediaDetails(args, deps);
      if (toolId === "comments") return runComments(args, deps);
      if (toolId === "account_insights") return runAccountInsights(args, deps);
      if (toolId === "media_insights") return runMediaInsights(args, deps);
      throw igError(`Unknown Instagram MCP tool "${toolId}".`, ERROR.MCP_UNKNOWN_TOOL);
    } catch (err) {
      throw mapError(err, toolId);
    }
  }

  return {
    COMMON_TOOL_IDS,
    PERFORMANCE_TOOL_IDS,
    WRITE_TOOL_IDS,
    executeInstagramMcpTool,
  };
};

module.exports = { createExecutor };
