/**
 * Read-only Google Ads MCP executor.
 * Calls only listAccessibleCustomers, GoogleAdsFieldService.Search,
 * and GoogleAdsService.Search. The HTTP client and customer-id normalizer
 * are injected by the backend host from the shared Google Ads services.
 */

const { buildCommonToolQuery, COMMON_TOOL_IDS } = require("./contracts/catalog");
const { buildPerformanceToolQuery, PERFORMANCE_TOOL_IDS } = require("./contracts/performance");
const { buildAssetPerformanceQuery, buildChangeHistoryQuery } = require("./contracts/v2d");

const ADS_ROW_MAX = 10000;
const ADS_PAGE_MAX = 40;
const SEARCH_URL_SUFFIX = "/googleAds:search";
const FIELD_SELECT = [
  "name",
  "category",
  "data_type",
  "selectable",
  "filterable",
  "sortable",
  "is_repeated",
  "selectable_with",
  "attribute_resources",
  "metrics",
  "segments",
  "enum_values",
].join(", ");

const FIELD_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.]*$/;

const createExecutor = (runtime = {}) => {
  const ADS_API_VERSION = runtime.apiVersion;
  const AppError = runtime.AppError;
  const normalizeCustomerId = runtime.normalizeCustomerId;

  function adsError(message, code, statusCode = 400) {
    return new AppError(message, statusCode, code);
  }

  function mapAdsError(err) {
    if (err instanceof AppError) return err;
    const googleCode = String(err?.googleAds?.code || "");
    const blob = `${googleCode} ${err?.code || ""} ${err?.message || ""}`;
    if (/USER_PERMISSION_DENIED/.test(blob)) {
      return adsError(
        "This Google account cannot access that customer. Check the customer ID and login customer ID.",
        "USER_PERMISSION_DENIED"
      );
    }
    if (/CUSTOMER_NOT_ENABLED/.test(blob)) {
      return adsError("That Google Ads customer is not enabled.", "CUSTOMER_NOT_ENABLED");
    }
    if (err?.code === "GOOGLE_ADS_CUSTOMER_INVALID") {
      return adsError(
        err.message || "Customer ID must be a 10-digit Google Ads customer ID.",
        "GOOGLE_ADS_CUSTOMER_INVALID"
      );
    }
    if (
      err?.code === "GOOGLE_ADS_QUERY" ||
      /QUERY_ERROR|UNRECOGNIZED_FIELD|BAD_ENUM|queryError/i.test(blob)
    ) {
      return adsError(
        "Google Ads rejected the query. Check the GAQL and field names.",
        "GOOGLE_ADS_QUERY"
      );
    }
    if (err?.code === "GOOGLE_ADS_QUOTA" || /RESOURCE_EXHAUSTED|quotaError/i.test(blob)) {
      return adsError("Google Ads API quota exceeded. Try again later.", "GOOGLE_ADS_QUOTA", 429);
    }
    if (err?.code === "GOOGLE_CREDENTIAL_REQUIRED") {
      return adsError("A Google Ads credential is required.", "MCP_CREDENTIAL_REQUIRED");
    }
    if (
      err?.code === "GOOGLE_UNAUTHORIZED" ||
      err?.code === "GOOGLE_CREDENTIAL_TYPE" ||
      /invalid_grant|UNAUTHENTICATED/i.test(blob)
    ) {
      return adsError(
        "Google Ads credential is missing or not authorized.",
        "MCP_CREDENTIAL_UNAUTHORIZED"
      );
    }
    if (err?.code === "GOOGLE_ADS_DEVELOPER_TOKEN") {
      return adsError(
        "Google Ads developer token was rejected. Update it on the Google Ads credential.",
        "GOOGLE_ADS_DEVELOPER_TOKEN"
      );
    }
    return adsError("Google Ads request failed.", "MCP_EXECUTION_FAILED");
  }

  function assertSelectQuery(query) {
    const text = String(query || "").trim();
    if (!text) {
      throw adsError("GAQL query is required.", "GOOGLE_ADS_QUERY");
    }
    if (!/^SELECT\b/i.test(text)) {
      throw adsError(
        "Google Ads search accepts a read-only SELECT query only.",
        "GOOGLE_ADS_QUERY"
      );
    }
    if (/;\s*\S/.test(text)) {
      throw adsError("Google Ads search accepts a single SELECT query.", "GOOGLE_ADS_QUERY");
    }
    return text;
  }

  function resourceFromGaql(query) {
    const match = String(query || "").match(/\bFROM\s+([A-Za-z_][A-Za-z0-9_]*)/i);
    return match ? match[1] : "search";
  }

  function customerIdOrThrow(value, label) {
    try {
      return normalizeCustomerId(value, label);
    } catch (err) {
      throw mapAdsError(err);
    }
  }

  function optionalLoginCustomerId(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    return customerIdOrThrow(raw, "Login customer ID");
  }

  function meta(tool, extra = {}) {
    return {
      provider: "google_ads",
      tool,
      apiVersion: ADS_API_VERSION,
      ...extra,
    };
  }

  async function adsRequest(spec, deps) {
    const request = deps.googleApiRequest || runtime.googleApiRequest;
    const retryDelayMs = deps.retryDelayMs != null ? deps.retryDelayMs : 200;
    let attempt = 0;
    for (;;) {
      try {
        return await request(spec);
      } catch (err) {
        const retryable =
          err?.retryable === true ||
          err?.code === "GOOGLE_QUOTA" ||
          err?.code === "GOOGLE_ADS_QUOTA";
        if (!retryable || attempt >= 2) throw mapAdsError(err);
        attempt += 1;
        if (retryDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
        }
      }
    }
  }

  async function listAccessibleCustomers({ credentialId, workspaceId }, deps = {}) {
    const res = await adsRequest(
      {
        credentialId,
        workspaceId,
        requiredType: "google_ads",
        method: "GET",
        url: `https://googleads.googleapis.com/${ADS_API_VERSION}/customers:listAccessibleCustomers`,
      },
      deps
    );
    const names = Array.isArray(res?.body?.resourceNames) ? res.body.resourceNames : [];
    return names.map((resourceName) => {
      const text = String(resourceName || "");
      const match = text.match(/^customers\/(\d+)$/);
      const row = { customerResourceName: text };
      if (match) row.customerId = match[1];
      row._meta = meta("list_accessible_customers", {
        resource: "customer",
        ...(match ? { customerId: match[1] } : {}),
      });
      return row;
    });
  }

  function fieldServiceQuery(params) {
    const explicit = String(params.query || "").trim();
    if (explicit) return assertSelectQuery(explicit);
    const name = String(params.resourceOrField || "").trim();
    if (!name) {
      throw adsError(
        "Resource or field name is required, or provide a field-service SELECT query.",
        "GOOGLE_ADS_QUERY"
      );
    }
    if (!FIELD_NAME_RE.test(name)) {
      throw adsError(
        "Resource or field name is not a Google Ads field name.",
        "GOOGLE_ADS_QUERY"
      );
    }
    const escaped = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `SELECT ${FIELD_SELECT} WHERE name = "${escaped}"`;
  }

  async function getResourceMetadata({ params, credentialId, workspaceId }, deps = {}) {
    const query = fieldServiceQuery(params || {});
    const limit = Math.min(Math.max(Number(params?.limit) || 100, 1), ADS_ROW_MAX);
    const rows = [];
    let pageToken = "";
    let pages = 0;
    while (rows.length < limit && pages < ADS_PAGE_MAX) {
      pages += 1;
      const body = { query };
      if (pageToken) body.pageToken = pageToken;
      else body.pageSize = Math.min(limit, 10000);
      const res = await adsRequest(
        {
          credentialId,
          workspaceId,
          requiredType: "google_ads",
          method: "POST",
          url: `https://googleads.googleapis.com/${ADS_API_VERSION}/googleAdsFields:search`,
          body,
        },
        deps
      );
      const results = Array.isArray(res?.body?.results) ? res.body.results : [];
      for (const field of results) {
        if (!field || typeof field !== "object" || Array.isArray(field)) continue;
        rows.push({
          ...field,
          _meta: meta("get_resource_metadata", { resource: "metadata" }),
        });
        if (rows.length >= limit) break;
      }
      pageToken = String(res?.body?.nextPageToken || "");
      if (!pageToken) break;
    }
    return rows;
  }

  async function runCustomerSearch(
    {
      credentialId,
      workspaceId,
      customerId,
      loginCustomerId,
      query,
      limit,
      tool,
      resource,
      dateRange,
    },
    deps = {}
  ) {
    const rows = [];
    let pageToken = "";
    let pages = 0;
    while (rows.length < limit && pages < ADS_PAGE_MAX) {
      pages += 1;
      const body = { query };
      if (pageToken) body.pageToken = pageToken;
      const spec = {
        credentialId,
        workspaceId,
        requiredType: "google_ads",
        method: "POST",
        url: `https://googleads.googleapis.com/${ADS_API_VERSION}/customers/${customerId}${SEARCH_URL_SUFFIX}`,
        body,
      };
      if (loginCustomerId) spec.headers = { "login-customer-id": loginCustomerId };
      const res = await adsRequest(spec, deps);
      const results = Array.isArray(res?.body?.results) ? res.body.results : [];
      for (const result of results) {
        const row =
          result && typeof result === "object" && !Array.isArray(result)
            ? { ...result }
            : { value: result };
        row._meta = meta(tool, {
          resource,
          customerId,
          ...(dateRange ? { dateRange } : {}),
        });
        rows.push(row);
        if (rows.length >= limit) break;
      }
      pageToken = String(res?.body?.nextPageToken || "");
      if (!pageToken) break;
    }
    return rows;
  }

  async function searchAds({ params, credentialId, workspaceId }, deps = {}) {
    const customerId = customerIdOrThrow(params.customerId, "Customer ID");
    const loginCustomerId = optionalLoginCustomerId(params.loginCustomerId);
    const query = assertSelectQuery(params.query);
    const returnAll = params.returnAll === true;
    const limit = returnAll
      ? ADS_ROW_MAX
      : Math.min(Math.max(Number(params.limit) || 100, 1), ADS_ROW_MAX);
    let gaql = query;
    if (!returnAll && !/\bLIMIT\b/i.test(gaql)) {
      gaql = `${gaql}\nLIMIT ${limit}`;
    }
    return runCustomerSearch(
      {
        credentialId,
        workspaceId,
        customerId,
        loginCustomerId,
        query: gaql,
        limit,
        tool: "search",
        resource: resourceFromGaql(query),
      },
      deps
    );
  }

  function accountFromInput(input) {
    const account = input.account && typeof input.account === "object" ? input.account : {};
    const customerRaw = account.customerId;
    if (customerRaw == null || String(customerRaw).trim() === "") {
      throw adsError(
        "Configure a Customer ID on the selected Google Ads node.",
        "GOOGLE_ADS_SOURCE_CUSTOMER"
      );
    }
    return {
      customerId: customerIdOrThrow(customerRaw, "Customer ID"),
      loginCustomerId: optionalLoginCustomerId(account.loginCustomerId),
    };
  }

  async function runCommonTool(input, deps = {}) {
    const toolId = String(input.toolId || "");
    let built;
    try {
      built = buildCommonToolQuery(toolId, input.params || {});
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw adsError(err.message || "Google Ads filter is invalid.", err.code || "GOOGLE_ADS_FILTER");
    }
    assertSelectQuery(built.query);
    const account = accountFromInput(input);
    const returnAll = toolId !== "account_summary" && input.params?.returnAll === true;
    const limit =
      toolId === "account_summary"
        ? 1
        : returnAll
          ? ADS_ROW_MAX
          : Math.min(Math.max(Number(input.params?.limit) || 100, 1), ADS_ROW_MAX);
    let query = built.query;
    if (!returnAll && !/\bLIMIT\b/i.test(query)) {
      query = `${query}\nLIMIT ${limit}`;
    }
    return runCustomerSearch(
      {
        credentialId: input.credentialId,
        workspaceId: input.workspaceId,
        customerId: account.customerId,
        loginCustomerId: account.loginCustomerId,
        query,
        limit,
        tool: toolId,
        resource: built.resource,
      },
      deps
    );
  }

  async function runPerformanceTool(input, deps = {}) {
    const toolId = String(input.toolId || "");
    let built;
    try {
      built = buildPerformanceToolQuery(toolId, input.params || {});
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw adsError(
        err.message || "Google Ads report could not be built.",
        err.code || "GOOGLE_ADS_FILTER"
      );
    }
    assertSelectQuery(built.query);
    const account = accountFromInput(input);
    return runCustomerSearch(
      {
        credentialId: input.credentialId,
        workspaceId: input.workspaceId,
        customerId: account.customerId,
        loginCustomerId: account.loginCustomerId,
        query: built.query,
        limit: built.limit,
        tool: toolId,
        resource: built.resource,
        dateRange: built.dateRange,
      },
      deps
    );
  }

  async function executeGoogleAdsMcpTool(input = {}, deps = {}) {
    const toolId = String(input.toolId || "");
    const credentialId = String(input.credentialId || "").trim();
    if (!credentialId) {
      throw adsError("A Google Ads credential is required.", "MCP_CREDENTIAL_REQUIRED");
    }
    const args = {
      params: input.params || {},
      credentialId,
      workspaceId: input.workspaceId,
    };
    if (toolId === "list_accessible_customers") {
      return listAccessibleCustomers(args, deps);
    }
    if (toolId === "get_resource_metadata") {
      return getResourceMetadata(args, deps);
    }
    if (toolId === "search") {
      return searchAds(args, deps);
    }
    if (COMMON_TOOL_IDS.includes(toolId)) {
      return runCommonTool(
        {
          ...args,
          toolId,
          account: input.account,
        },
        deps
      );
    }
    if (toolId === "asset_performance" || toolId === "change_history") {
      const build = toolId === "asset_performance" ? buildAssetPerformanceQuery : buildChangeHistoryQuery;
      return runAccountQuery(
        {
          ...args,
          toolId,
          account: input.account,
        },
        deps,
        build
      );
    }
    if (PERFORMANCE_TOOL_IDS.includes(toolId)) {
      return runPerformanceTool(
        {
          ...args,
          toolId,
          account: input.account,
        },
        deps
      );
    }
    throw adsError(`Unknown Google Ads MCP tool "${toolId}".`, "MCP_UNKNOWN_TOOL");
  }

  async function runAccountQuery(input, deps, build) {
    const account = accountFromInput(input);
    let built;
    try {
      built = build(input.params || {}, { customerId: account.customerId });
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw adsError(
        err.message || "Google Ads query could not be built.",
        err.code || "GOOGLE_ADS_FILTER"
      );
    }
    assertSelectQuery(built.query);
    return runCustomerSearch(
      {
        credentialId: input.credentialId,
        workspaceId: input.workspaceId,
        customerId: account.customerId,
        loginCustomerId: account.loginCustomerId,
        query: built.query,
        limit: built.limit,
        tool: String(input.toolId || ""),
        resource: built.resource,
        dateRange: built.dateRange,
      },
      deps
    );
  }

  return {
    ADS_API_VERSION,
    SEARCH_URL_SUFFIX,
    assertSelectQuery,
    fieldServiceQuery,
    buildCommonToolQuery,
    buildPerformanceToolQuery,
    buildAssetPerformanceQuery,
    buildChangeHistoryQuery,
    executeGoogleAdsMcpTool,
  };
};

module.exports = { createExecutor, SEARCH_URL_SUFFIX };
