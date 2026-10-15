/**
 * Read-only Meta Ads MCP executor.
 * Graph HTTP, version, and appsecret_proof are injected by the backend host.
 * Common tools (M5) are entity GETs. Performance tools (M6) reuse the shared
 * Insights runner from workflowMetaAds.service.js.
 */

const {
  COMMON_FIELDS,
  COMMON_RESOURCE,
  COMMON_EDGE,
  COMMON_TOOL_IDS,
  MAX_PAGES,
  PAGE_SIZE,
  buildEntityQuery,
  fieldsCsv,
  rowLimit,
} = require("./contracts/catalog");
const {
  PERFORMANCE_TOOL_IDS,
  buildPerformanceRequest,
} = require("./contracts/performance");

const createExecutor = (runtime = {}) => {
  const API_VERSION = runtime.apiVersion;
  const AppError = runtime.AppError;

  function metaError(message, code, statusCode = 400, details) {
    const err = new AppError(message, statusCode, code);
    if (details && typeof details === "object") err.details = details;
    return err;
  }

  function userFacingGraphError(err, context = {}) {
    const code = String(err?.code || "");
    const details = {
      httpStatus: err.statusCode || undefined,
      errorCode: code || undefined,
      graphCode: err.graphCode || err.details?.graphCode,
      graphSubcode: err.graphSubcode || err.details?.graphSubcode,
      resource: context.resource,
      tool: context.tool,
      adAccountId: context.adAccountId,
      level: context.level,
      breakdowns: Array.isArray(context.breakdowns) ? context.breakdowns.join(",") : context.breakdowns,
    };
    if (code === "META_TOKEN_INVALID" || code === "MCP_CREDENTIAL_UNAUTHORIZED") {
      return metaError("Authentication problem", code, err.statusCode || 401, details);
    }
    if (code === "META_PERMISSION_DENIED") {
      return metaError("Permission denied", code, err.statusCode || 403, details);
    }
    if (code === "META_ACCOUNT_RESTRICTED" || code === "META_AD_ACCOUNT_REQUIRED") {
      return metaError("Ad account unavailable", code, err.statusCode || 400, details);
    }
    if (code === "META_FILTER_INVALID") {
      return metaError(err.message || "Invalid status/filter", code, 400, details);
    }
    if (code === "META_DATE_WINDOW") {
      return metaError("Invalid date window", code, 400, details);
    }
    if (code === "META_BREAKDOWN_INVALID") {
      return metaError("Invalid breakdown", code, 400, details);
    }
    if (code === "META_RATE_LIMIT") {
      return metaError("Rate limit", code, 429, details);
    }
    if (code === "META_FIELD_UNSUPPORTED") {
      return metaError("Unsupported field/breakdown combination", code, 400, details);
    }
    if (code === "META_GRAPH_ERROR") {
      return metaError("Graph API error", code, err.statusCode || 400, details);
    }
    return metaError(err.message || "Graph API error", code || "MCP_EXECUTION_FAILED", err.statusCode || 400, details);
  }

  function mapMetaError(err, context = {}) {
    if (err instanceof AppError) {
      const code = String(err.code || "");
      if (code === "META_FILTER_INVALID" || code === "MCP_UNKNOWN_TOOL" || code === "MCP_CREDENTIAL_REQUIRED") {
        return err;
      }
      if (
        code === "META_TOKEN_INVALID" ||
        code === "META_PERMISSION_DENIED" ||
        code === "META_ACCOUNT_RESTRICTED" ||
        code === "META_AD_ACCOUNT_REQUIRED" ||
        code === "META_RATE_LIMIT" ||
        code === "META_FIELD_UNSUPPORTED" ||
        code === "META_DATE_WINDOW" ||
        code === "META_BREAKDOWN_INVALID" ||
        code === "META_GRAPH_ERROR"
      ) {
        return userFacingGraphError(err, context);
      }
      return err;
    }
    const code = String(err?.code || "");
    if (code === "META_CREDENTIAL_REQUIRED" || code === "GOOGLE_CREDENTIAL_REQUIRED") {
      return metaError("A Meta Ads credential is required.", "MCP_CREDENTIAL_REQUIRED");
    }
    if (code === "META_FILTER_INVALID") {
      return metaError(err.message || "Invalid status/filter", "META_FILTER_INVALID");
    }
    if (
      code === "META_TOKEN_INVALID" ||
      code === "META_PERMISSION_DENIED" ||
      /invalid.?token|OAuthException|190/i.test(String(err?.message || ""))
    ) {
      return userFacingGraphError(
        Object.assign(new Error(err.message || "Authentication problem"), {
          code: code === "META_PERMISSION_DENIED" ? "META_PERMISSION_DENIED" : "META_TOKEN_INVALID",
          statusCode: err.statusCode || 401,
        }),
        context
      );
    }
    if (code && code !== "MCP_EXECUTION_FAILED") {
      return userFacingGraphError(
        Object.assign(new Error(err.message || "Meta request failed."), {
          code,
          statusCode: err.statusCode || 400,
        }),
        context
      );
    }
    return metaError(err?.message || "Meta request failed.", "MCP_EXECUTION_FAILED");
  }

  function meta(tool, extra = {}) {
    return {
      provider: "meta_ads",
      tool,
      apiVersion: API_VERSION,
      ...extra,
    };
  }

  async function graphGet(spec, deps = {}, context = {}) {
    const request = deps.metaGraphRequest || runtime.metaGraphRequest;
    try {
      return await request({ ...spec, method: "GET" });
    } catch (err) {
      throw mapMetaError(err, context);
    }
  }

  function inheritedAdAccountId(input = {}) {
    const account = input.account && typeof input.account === "object" ? input.account : {};
    const normalize = runtime.normalizeAdAccountId;
    const raw = account.adAccountId;
    if (raw == null || String(raw).trim() === "") {
      throw metaError(
        "Select an Ad Account on the selected Meta Ads node.",
        "META_ADS_SOURCE_ACCOUNT"
      );
    }
    return normalize ? normalize(raw) : String(raw).trim().replace(/^act_/i, "");
  }

  function pickFields(row, fields) {
    const out = {};
    if (!row || typeof row !== "object" || Array.isArray(row)) return out;
    for (const field of fields) {
      if (!Object.prototype.hasOwnProperty.call(row, field)) continue;
      if (row[field] === undefined) continue;
      out[field] = row[field];
    }
    return out;
  }

  function presentRows(toolId, rows, { adAccountId, truncated }) {
    const fields = COMMON_FIELDS[toolId];
    const resource = COMMON_RESOURCE[toolId];
    return rows.map((row) => {
      const json = pickFields(row, fields);
      json._meta = meta(toolId, {
        resource,
        adAccountId,
        ...(truncated ? { truncated: true } : {}),
      });
      return json;
    });
  }

  /**
   * Cursor pagination via paging.cursors.after only.
   * paging.next is a has-more signal and must never be fetched.
   */
  async function collectEntityPages({ requestPage, maxRows, maxPages = MAX_PAGES }) {
    const rows = [];
    let after = "";
    let pages = 0;
    let truncated = false;
    while (rows.length < maxRows && pages < maxPages) {
      pages += 1;
      const body = await requestPage(after);
      const data = Array.isArray(body?.data) ? body.data : [];
      for (const row of data) {
        rows.push(row);
        if (rows.length >= maxRows) break;
      }
      const nextAfter = String(body?.paging?.cursors?.after || "");
      const listedMore = Boolean(body?.paging?.next);
      if (!nextAfter || data.length === 0) {
        if (listedMore) truncated = true;
        break;
      }
      after = nextAfter;
      if (rows.length >= maxRows || pages >= maxPages) {
        truncated = true;
        break;
      }
    }
    return { rows, truncated };
  }

  async function listAccessibleAdAccounts({ credentialId, workspaceId }, deps = {}) {
    const collectPages = deps.collectPages || runtime.collectPages;
    const presentAdAccount = deps.presentAdAccount || runtime.presentAdAccount;
    const rows = await collectPages({
      maxPages: 10,
      maxRows: 200,
      requestPage: (after) =>
        graphGet(
          {
            credentialId,
            workspaceId,
            path: "me/adaccounts",
            query: {
              fields: "id,account_id,name,account_status,currency,timezone_name",
              limit: 50,
              after: after || undefined,
            },
          },
          deps,
          { tool: "list_accessible_ad_accounts", resource: "ad_account" }
        ),
    });
    return rows.map((row) => {
      const presented = presentAdAccount(row);
      return {
        ...presented,
        _meta: meta("list_accessible_ad_accounts", { resource: "ad_account" }),
      };
    });
  }

  async function runAccountSummary(input, deps = {}) {
    const adAccountId = inheritedAdAccountId(input);
    const normalize = runtime.normalizeAdAccountId;
    const pathId = normalize ? `act_${normalize(adAccountId)}` : `act_${adAccountId}`;
    const body = await graphGet(
      {
        credentialId: input.credentialId,
        workspaceId: input.workspaceId,
        path: pathId,
        query: { fields: fieldsCsv("account_summary") },
      },
      deps,
      { tool: "account_summary", resource: "ad_account", adAccountId }
    );
    return presentRows("account_summary", [body], { adAccountId, truncated: false });
  }

  async function runEntityList(toolId, input, deps = {}) {
    const adAccountId = inheritedAdAccountId(input);
    const normalize = runtime.normalizeAdAccountId;
    const accountPath = normalize ? `act_${normalize(adAccountId)}` : `act_${adAccountId}`;
    const edge = COMMON_EDGE[toolId];
    const limit = rowLimit(input.params || {});
    const fetched = await collectEntityPages({
      maxRows: limit,
      maxPages: MAX_PAGES,
      requestPage: (after) => {
        let pageQuery;
        try {
          pageQuery = buildEntityQuery(toolId, input.params || {}, {
            pageSize: PAGE_SIZE,
            after,
          });
        } catch (err) {
          if (err instanceof AppError) throw err;
          throw metaError(err.message || "Invalid status/filter", err.code || "META_FILTER_INVALID");
        }
        return graphGet(
          {
            credentialId: input.credentialId,
            workspaceId: input.workspaceId,
            path: `${accountPath}/${edge}`,
            query: pageQuery,
          },
          deps,
          { tool: toolId, resource: COMMON_RESOURCE[toolId], adAccountId }
        );
      },
    });
    return presentRows(toolId, fetched.rows, {
      adAccountId,
      truncated: fetched.truncated,
    });
  }

  async function runPerformanceTool(toolId, input, deps = {}) {
    const adAccountId = inheritedAdAccountId(input);
    const run = deps.runInsightsReport || runtime.runInsightsReport;
    if (typeof run !== "function") {
      throw metaError("Meta Ads Insights is not available.", "MCP_EXECUTION_FAILED", 500);
    }
    let spec;
    try {
      spec = buildPerformanceRequest(toolId, input.params || {});
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw metaError(
        err.message || "Invalid status/filter",
        err.code || "META_FILTER_INVALID"
      );
    }
    try {
      const fetched = await run({
        credentialId: input.credentialId,
        workspaceId: input.workspaceId,
        adAccountId,
        reportType: spec.reportType,
        dateRange: spec.dateRange,
        customStartDate: spec.customStartDate,
        customEndDate: spec.customEndDate,
        filters: spec.filters,
        limit: spec.limit,
        returnAll: spec.returnAll,
        breakdowns: spec.breakdowns,
        extraFields: spec.extraFields,
        tool: spec.tool,
      });
      return Array.isArray(fetched?.rows) ? fetched.rows : [];
    } catch (err) {
      throw mapMetaError(err, {
        tool: toolId,
        resource: "insights",
        adAccountId,
        level: spec.level,
        breakdowns: spec.breakdowns,
      });
    }
  }

  async function executeMetaAdsMcpTool(input = {}, deps = {}) {
    const toolId = String(input.toolId || "");
    const credentialId = String(input.credentialId || "").trim();
    if (!credentialId) {
      throw metaError("A Meta Ads credential is required.", "MCP_CREDENTIAL_REQUIRED");
    }
    const args = {
      params: input.params || {},
      credentialId,
      workspaceId: input.workspaceId,
      account: input.account,
    };
    if (toolId === "list_accessible_ad_accounts") {
      return listAccessibleAdAccounts(args, deps);
    }
    if (toolId === "account_summary") {
      return runAccountSummary(args, deps);
    }
    if (COMMON_TOOL_IDS.includes(toolId)) {
      return runEntityList(toolId, args, deps);
    }
    if (PERFORMANCE_TOOL_IDS.includes(toolId)) {
      return runPerformanceTool(toolId, args, deps);
    }
    throw metaError(`Unknown Meta Ads MCP tool "${toolId}".`, "MCP_UNKNOWN_TOOL");
  }

  return {
    API_VERSION,
    executeMetaAdsMcpTool,
  };
};

module.exports = { createExecutor };
