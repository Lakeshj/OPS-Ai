/**
 * Meta Graph foundation for credentials, ad-account discovery, and native
 * Insights reports. Graph calls stay read-only.
 *
 * System-user tokens are a later advanced option. M2 uses user OAuth only.
 */

const crypto = require("crypto");
const AppError = require("../utils/AppError");
const { decryptSecret } = require("./secretBox.service");
const { pool } = require("../config/database");
const {
  API_VERSION,
  graphBaseUrl,
  appCredentials,
} = require("../config/metaGraph");
const {
  NUMERIC_FIELDS,
  ACTION_FIELDS,
  reportFor,
  fieldsFor,
  resolveMetaDateRange,
  buildInsightsQuery,
  rowLimits,
  entityRowLimits,
  ENTITY_FIELDS,
  deliveryStatusLabel,
  SCOPE_TO_REPORT,
} = require("./metaAdsReportCatalog");
const {
  PLATFORM_LABELS,
  normalizePlatformScope,
  aggregateInsightMetrics,
  objectiveLabel,
  enrichInsightRowMetrics,
  filterRowsByPublisherPlatform,
} = require("./metaAdsMetrics.service");

const ACCOUNT_STATUS = Object.freeze({
  1: "ACTIVE",
  2: "DISABLED",
  3: "UNSETTLED",
  7: "PENDING_RISK_REVIEW",
  8: "PENDING_SETTLEMENT",
  9: "IN_GRACE_PERIOD",
  100: "PENDING_CLOSURE",
  101: "CLOSED",
  201: "ANY_ACTIVE",
  202: "ANY_CLOSED",
});

const SECRET_QUERY_RE =
  /((?:access_token|appsecret_proof|client_secret|fb_exchange_token|code|authorization)=)[^&\s]+/gi;

const hooks = {
  transport: null,
  now: () => Date.now(),
  loadCredential: null,
};

const withMetaTestHooks = async (overrides, fn) => {
  const prev = { ...hooks };
  Object.assign(hooks, overrides || {});
  try {
    return await fn();
  } finally {
    Object.assign(hooks, prev);
  }
};

const metaError = (message, code, statusCode = 400) =>
  new AppError(message, statusCode, code);

const stripSecrets = (value) =>
  String(value || "")
    .replace(SECRET_QUERY_RE, "$1[redacted]")
    .replace(/EAA[A-Za-z0-9]+/g, "[redacted]")
    .slice(0, 400);

const accountStatusLabel = (status) => {
  const code = Number(status);
  if (!Number.isFinite(code)) return null;
  return Object.prototype.hasOwnProperty.call(ACCOUNT_STATUS, code)
    ? ACCOUNT_STATUS[code]
    : null;
};

const normalizeAdAccountId = (raw) => {
  const text = String(raw || "")
    .trim()
    .replace(/^act_/i, "");
  if (!/^\d{1,20}$/.test(text)) {
    throw metaError(
      "A numeric Meta ad account id is required.",
      "META_AD_ACCOUNT_REQUIRED"
    );
  }
  return text;
};

const adAccountPath = (raw) => `act_${normalizeAdAccountId(raw)}`;

/**
 * Meta appsecret_proof for Graph calls.
 * Use the classic untied proof (HMAC of access token only). Timed proofs
 * (`token|appsecret_time`) fail when the local clock is ahead of Meta
 * ("Invalid appsecret_time … future timestamp").
 */
const appSecretProof = (accessToken, _nowMs = hooks.now()) => {
  const { appSecret } = appCredentials();
  if (!appSecret) {
    throw metaError(
      "Meta app credentials are not configured on the server.",
      "META_APP_NOT_CONFIGURED",
      500
    );
  }
  const proof = crypto
    .createHmac("sha256", appSecret)
    .update(String(accessToken || ""))
    .digest("hex");
  return { appsecret_proof: proof };
};

const mapMetaError = (status, body) => {
  const error = body && typeof body === "object" ? body.error || body : {};
  const code = Number(error.code);
  const message = stripSecrets(error.message || error.error_user_msg || "");
  if (code === 190) {
    return metaError(
      "Meta login expired or was revoked. Reconnect Meta Ads.",
      "META_TOKEN_INVALID",
      401
    );
  }
  if (code === 2635) {
    return metaError(
      "Meta rejected the API version. OpsAi is pinned to the configured Graph version.",
      "META_API_VERSION"
    );
  }
  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return metaError(
      "Meta rate limit reached. Wait and try again.",
      "META_RATE_LIMIT",
      429
    );
  }
  if (code === 3018) {
    return metaError(
      "That Meta date range is outside the Insights lookback window.",
      "META_DATE_WINDOW"
    );
  }
  if (code === 10 || code === 200) {
    if (/disabled|restricted|closed/i.test(message)) {
      return metaError(
        "This Meta ad account is restricted.",
        "META_ACCOUNT_RESTRICTED"
      );
    }
    return metaError(
      "Meta denied this read. ads_read and ad-account access are required.",
      "META_PERMISSION_DENIED",
      403
    );
  }
  if (code === 100) {
    if (/permission|ads_read/i.test(message)) {
      return metaError(
        "Meta denied this read. ads_read is required.",
        "META_PERMISSION_DENIED",
        403
      );
    }
    if (/disabled|restricted|closed/i.test(message)) {
      return metaError(
        "This Meta ad account is restricted.",
        "META_ACCOUNT_RESTRICTED"
      );
    }
    if (/nonexisting field|unknown field|unsupported field/i.test(message)) {
      return metaError(
        "A requested Insights field is not supported.",
        "META_FIELD_UNSUPPORTED"
      );
    }
    if (/filtering field|invalid filter|filter is invalid/i.test(message)) {
      return metaError(
        "That Meta Ads filter is not valid for this report.",
        "META_FILTER_INVALID"
      );
    }
    return metaError(
      message || "Meta rejected a parameter on this request.",
      "META_GRAPH_ERROR"
    );
  }
  if (status === 401) {
    return metaError(
      "Meta login expired or was revoked. Reconnect Meta Ads.",
      "META_TOKEN_INVALID",
      401
    );
  }
  return metaError(message || "Meta request failed.", "META_GRAPH_ERROR", status || 400);
};

const defaultTransport = async (url, options) => {
  const res = await fetch(url, options);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: { message: "Meta returned a non-JSON response" } };
  }
  return { ok: res.ok, status: res.status, body };
};

const loadCredentialRow = async (credentialId, workspaceId) => {
  if (hooks.loadCredential) return hooks.loadCredential(credentialId, workspaceId);
  const [rows] = await pool.execute(
    `SELECT * FROM workflow_credentials WHERE id = ?`,
    [credentialId]
  );
  if (!rows.length) return null;
  if (workspaceId && rows[0].workspace_id !== workspaceId) return null;
  return {
    id: rows[0].id,
    type: rows[0].type,
    name: rows[0].name,
    workspaceId: rows[0].workspace_id,
    secret: decryptSecret(rows[0].secret_json) || {},
    config: (() => {
      try {
        return JSON.parse(rows[0].config_json || "{}");
      } catch {
        return {};
      }
    })(),
  };
};

const assertUsableSecret = (secret) => {
  const token = String(secret?.accessToken || "").trim();
  if (!token) {
    throw metaError(
      "Connect a Meta Ads account first.",
      "META_CREDENTIAL_REQUIRED"
    );
  }
  const expiresAt = secret.expiresAt ? Date.parse(secret.expiresAt) : NaN;
  if (Number.isFinite(expiresAt) && expiresAt <= hooks.now()) {
    throw metaError(
      "Meta login expired. Reconnect Meta Ads.",
      "META_TOKEN_INVALID",
      401
    );
  }
  return token;
};

const metaGraphRequest = async ({
  credentialId,
  workspaceId,
  accessToken,
  path,
  query = {},
  method = "GET",
}) => {
  if (String(method || "GET").toUpperCase() !== "GET") {
    throw metaError(
      "Meta write calls are not available.",
      "META_PERMISSION_DENIED",
      403
    );
  }
  let token = String(accessToken || "").trim();
  if (!token) {
    if (!credentialId) {
      throw metaError(
        "A Meta Ads credential is required.",
        "META_CREDENTIAL_REQUIRED"
      );
    }
    const cred = await loadCredentialRow(credentialId, workspaceId);
    if (!cred || cred.type !== "meta_ads") {
      throw metaError(
        "A Meta Ads credential is required.",
        "META_CREDENTIAL_REQUIRED"
      );
    }
    token = assertUsableSecret(cred.secret);
  }
  const proof = appSecretProof(token);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === "") continue;
    params.set(key, String(value));
  }
  params.set("access_token", token);
  params.set("appsecret_proof", proof.appsecret_proof);
  if (proof.appsecret_time) {
    params.set("appsecret_time", proof.appsecret_time);
  }
  const url = `${graphBaseUrl()}/${String(path || "").replace(/^\//, "")}?${params.toString()}`;
  const transport = hooks.transport || defaultTransport;
  let res;
  try {
    res = await transport(url, { method });
  } catch (err) {
    throw metaError(stripSecrets(err?.message) || "Meta request failed.", "META_GRAPH_ERROR");
  }
  if (!res?.ok) throw mapMetaError(res?.status, res?.body);
  return res.body;
};

const collectPages = async ({ requestPage, maxPages = 10, maxRows = 200 }) => {
  const rows = [];
  let after = "";
  let pages = 0;
  while (rows.length < maxRows && pages < maxPages) {
    pages += 1;
    const body = await requestPage(after);
    const data = Array.isArray(body?.data) ? body.data : [];
    for (const row of data) {
      rows.push(row);
      if (rows.length >= maxRows) break;
    }
    after = String(body?.paging?.cursors?.after || "");
    if (!after || data.length === 0) break;
  }
  return rows;
};

const SECRET_KEY_RE =
  /(access[_-]?token|refresh[_-]?token|client[_-]?secret|developer[_-]?token|api[_-]?key|app[_-]?secret|appsecret[_-]?(proof|time)|^password$|^authorization$|^secret$|^token$|^code$)/i;

const stripSecretKeys = (value) => {
  if (Array.isArray(value)) return value.map(stripSecretKeys);
  if (!value || typeof value !== "object") return value;
  const next = {};
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEY_RE.test(key)) continue;
    next[key] = stripSecretKeys(nested);
  }
  return next;
};

const RESOURCE_ALIASES = Object.freeze({
  report: "insights",
  ad_account: "adAccount",
  adaccount: "adAccount",
  account: "adAccount",
  campaigns: "campaign",
  ad_set: "adSet",
  adset: "adSet",
  ads: "ad",
  insight: "insights",
});

const normalizeResource = (raw) => {
  const key = String(raw || "insights").trim();
  const lower = key.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(RESOURCE_ALIASES, lower)) {
    return RESOURCE_ALIASES[lower];
  }
  if (
    ["adAccount", "campaign", "adSet", "ad", "insights", "delivery"].includes(key)
  ) {
    return key;
  }
  return key;
};

const sanitizeMetaAdsNodeData = (data) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const next = stripSecretKeys(data);
  if (next.adAccountId != null && String(next.adAccountId).trim()) {
    const text = String(next.adAccountId).trim().replace(/^act_/i, "");
    if (/^\d{1,20}$/.test(text)) next.adAccountId = text;
  }
  if (next.platformScope != null) {
    next.platformScope = normalizePlatformScope(next.platformScope);
  }
  if (next.resource != null) {
    const original = String(next.resource).trim();
    // Keep legacy "report" in sanitized node data for saved-workflow BC;
    // executeMetaAdsNode maps it to insights at runtime.
    if (original !== "report") {
      next.resource = normalizeResource(original);
    }
  }
  return next;
};

const asNumeric = (value) => {
  if (value == null || value === "") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const num = Number(value);
  return Number.isFinite(num) ? num : value;
};

const normalizeActionList = (list) => {
  if (!Array.isArray(list)) return list;
  return list.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const next = {};
    for (const [key, nested] of Object.entries(entry)) {
      next[key] = key === "value" ? asNumeric(nested) : nested;
    }
    return next;
  });
};

const normalizeInsightsRow = (row, provenance = {}) => {
  const fieldReportType = String(provenance.fieldReportType || provenance.reportType || "");
  const allowed = new Set(fieldsFor(fieldReportType));
  for (const extra of Array.isArray(provenance.extraFields) ? provenance.extraFields : []) {
    const name = String(extra || "").trim();
    if (name) allowed.add(name);
  }
  // Breakdown dimensions are returned by Meta when `breakdowns=` is set;
  // they must not be requested as Insights `fields`, but we keep them here.
  for (const breakdown of Array.isArray(provenance.breakdowns)
    ? provenance.breakdowns
    : []) {
    const name = String(breakdown || "").trim();
    if (name) allowed.add(name);
  }
  const json = {};
  for (const field of allowed) {
    if (row == null || !Object.prototype.hasOwnProperty.call(row, field)) continue;
    if (ACTION_FIELDS.includes(field)) {
      json[field] = normalizeActionList(row[field]);
      continue;
    }
    json[field] = NUMERIC_FIELDS.includes(field) ? asNumeric(row[field]) : row[field];
  }
  json._meta = {
    provider: "meta_ads",
    resource: "insights",
    report: String(provenance.report || provenance.reportType || ""),
    level: provenance.level || reportFor(fieldReportType).level,
    adAccountId: String(provenance.adAccountId || ""),
    apiVersion: API_VERSION,
    dateRange: {
      since: String(provenance.since || ""),
      until: String(provenance.until || ""),
    },
    timezone: String(provenance.timezone || ""),
  };
  if (provenance.tool) json._meta.tool = String(provenance.tool);
  if (Array.isArray(provenance.breakdowns) && provenance.breakdowns.length) {
    json._meta.breakdowns = provenance.breakdowns.slice();
  }
  if (provenance.truncated === true) json._meta.truncated = true;
  return json;
};

const exprValue = (value, context, item) => {
  if (value == null || typeof value !== "string" || !value.includes("{{")) return value;
  const { interpolate } = require("./workflowNodes.service");
  const payload =
    item && typeof item === "object" && item.json && typeof item.json === "object"
      ? item.json
      : item;
  return interpolate(value, {
    input: payload ?? context?.input,
    steps: context?.steps,
    item,
    items: context?.items,
  });
};

const collectInsightsRows = async ({
  credentialId,
  workspaceId,
  accountPath,
  reportType,
  since,
  until,
  filters,
  maxRows,
  maxPages,
  pageSize,
  returnAll,
  breakdowns,
  extraFields,
}) => {
  const rows = [];
  let after = "";
  let pages = 0;
  let more = false;
  while (rows.length < maxRows && pages < maxPages) {
    const remaining = maxRows - rows.length;
    const size = Math.min(pageSize, remaining);
    pages += 1;
    const body = await metaGraphRequest({
      credentialId,
      workspaceId,
      path: `${accountPath}/insights`,
      query: buildInsightsQuery({
        reportType,
        since,
        until,
        filters,
        pageSize: size,
        after,
        breakdowns,
        extraFields,
      }),
    });
    const data = Array.isArray(body?.data) ? body.data : [];
    for (const row of data) {
      rows.push(row);
      if (rows.length >= maxRows) break;
    }
    after = String(body?.paging?.cursors?.after || "");
    const listedMore = Boolean(body?.paging && Object.prototype.hasOwnProperty.call(body.paging, "next"));
    if (!after || data.length === 0) {
      more = false;
      break;
    }
    if (!returnAll && data.length < size) {
      more = false;
      break;
    }
    if (returnAll && !listedMore) {
      more = false;
      break;
    }
    more = true;
    if (rows.length >= maxRows) break;
  }
  const truncated = Boolean(more && (rows.length >= maxRows || pages >= maxPages));
  return { rows, truncated };
};

const runMetaAdsInsights = async ({
  credentialId,
  workspaceId,
  adAccountId,
  reportType,
  dateRange,
  customStartDate,
  customEndDate,
  filters,
  limit,
  returnAll,
  breakdowns,
  extraFields,
  tool,
} = {}) => {
  if (!String(credentialId || "").trim()) {
    throw metaError("Connect a Meta Ads account first.", "META_CREDENTIAL_REQUIRED");
  }
  const numericId = normalizeAdAccountId(adAccountId);
  const accountPath = adAccountPath(numericId);
  const account = await metaGraphRequest({
    credentialId,
    workspaceId,
    path: accountPath,
    query: { fields: "id,account_id,name,account_status,currency,timezone_name" },
  });
  const report = reportFor(reportType);
  const range = resolveMetaDateRange({
    dateRange,
    customStartDate,
    customEndDate,
    timezone: account?.timezone_name,
    nowMs: hooks.now(),
  });
  const limits = rowLimits({ limit, returnAll });
  const fetched = await collectInsightsRows({
    credentialId,
    workspaceId,
    accountPath,
    reportType: report.reportType,
    since: range.since,
    until: range.until,
    filters,
    maxRows: limits.maxRows,
    maxPages: limits.maxPages,
    pageSize: limits.pageSize,
    returnAll: limits.returnAll,
    breakdowns,
    extraFields,
  });
  const rows = fetched.rows.map((row) =>
    normalizeInsightsRow(row, {
      fieldReportType: report.reportType,
      reportType: report.reportType,
      report: tool || report.reportType,
      level: report.level,
      adAccountId: numericId,
      since: range.since,
      until: range.until,
      timezone: range.timezone,
      tool: tool || undefined,
      breakdowns,
      extraFields,
      truncated: fetched.truncated,
    })
  );
  return {
    rows,
    truncated: fetched.truncated,
    range,
    level: report.level,
    adAccountId: numericId,
  };
};

const resolveInsightsReportType = (data) => {
  if (data?.reportType) return String(data.reportType).trim();
  const level = String(data?.insightsLevel || data?.level || "campaign").trim();
  if (Object.prototype.hasOwnProperty.call(SCOPE_TO_REPORT, level)) {
    return SCOPE_TO_REPORT[level];
  }
  return "campaign_performance";
};

const resolvePlatformBreakdowns = (platformScope, platformBreakdown) => {
  const scope = normalizePlatformScope(platformScope);
  if (scope === "facebook" || scope === "instagram") {
    return ["publisher_platform"];
  }
  if (platformBreakdown === true || platformBreakdown === "true") {
    return ["publisher_platform"];
  }
  return undefined;
};

const dateRangeLabel = (preset, since, until) => {
  const map = {
    today: "Today",
    yesterday: "Yesterday",
    last7days: "Last 7 days",
    last14days: "Last 14 days",
    last30days: "Last 30 days",
    thisMonth: "This month",
    lastMonth: "Last month",
    custom: since && until ? `${since} → ${until}` : "Custom",
  };
  return map[String(preset || "")] || `${since || ""} → ${until || ""}`.trim();
};

const presentInsightSummary = ({
  rows,
  platformScope,
  range,
  reportType,
  adAccountId,
}) => {
  const scope = normalizePlatformScope(platformScope);
  const aggregated = aggregateInsightMetrics(rows);
  const { totals, ratios } = aggregated;
  return {
    title: `Meta Ads · ${PLATFORM_LABELS[scope] || "All Meta"}`,
    subtitle: dateRangeLabel(range?.preset, range?.since, range?.until),
    platformScope: scope,
    platformLabel: PLATFORM_LABELS[scope] || "All Meta",
    reportType: String(reportType || ""),
    adAccountId: String(adAccountId || ""),
    spend: totals.spend,
    impressions: totals.impressions,
    reach: totals.reach,
    clicks: totals.clicks,
    linkClicks: totals.linkClicks,
    landingPageViews: totals.landingPageViews,
    leads: totals.leads,
    messagingConversations: totals.messagingConversations,
    engagements: totals.engagements,
    installs: totals.installs,
    purchases: totals.purchases,
    purchaseValue: totals.purchaseValue,
    frequency: ratios.frequency,
    ctr: ratios.ctr,
    cpc: ratios.cpc,
    cpm: ratios.cpm,
    cpl: ratios.cpl,
    cpi: ratios.cpi,
    costPerConversation: ratios.costPerConversation,
    costPerLpv: ratios.costPerLpv,
    costPerEngagement: ratios.costPerEngagement,
    costPerPurchase: ratios.costPerPurchase,
    roas: ratios.roas,
    rowCount: totals.rowCount,
  };
};

const presentCampaignRow = (row, platformScope) => {
  const objective = row?.objective == null ? "" : String(row.objective);
  const status = row?.effective_status || row?.status || "";
  return {
    id: row?.id == null ? "" : String(row.id),
    name: row?.name == null ? "" : String(row.name),
    objective,
    objectiveLabel: objectiveLabel(objective),
    status: status ? String(status) : "",
    statusLabel: deliveryStatusLabel(status),
    configuredStatus: row?.status == null ? "" : String(row.status),
    createdTime: row?.created_time || null,
    updatedTime: row?.updated_time || null,
    platformScope: normalizePlatformScope(platformScope),
    platformLabel: PLATFORM_LABELS[normalizePlatformScope(platformScope)],
    presentation: {
      campaignName: row?.name == null ? "" : String(row.name),
      objective: objectiveLabel(objective) || objective,
      status: deliveryStatusLabel(status) || status,
      platformScope: PLATFORM_LABELS[normalizePlatformScope(platformScope)],
    },
  };
};

const presentAdSetRow = (row, platformScope) => {
  const status = row?.effective_status || row?.status || "";
  return {
    id: row?.id == null ? "" : String(row.id),
    name: row?.name == null ? "" : String(row.name),
    campaignId: row?.campaign_id == null ? "" : String(row.campaign_id),
    status: status ? String(status) : "",
    statusLabel: deliveryStatusLabel(status),
    configuredStatus: row?.status == null ? "" : String(row.status),
    optimizationGoal: row?.optimization_goal || null,
    billingEvent: row?.billing_event || null,
    dailyBudget: row?.daily_budget != null ? asNumeric(row.daily_budget) : null,
    lifetimeBudget:
      row?.lifetime_budget != null ? asNumeric(row.lifetime_budget) : null,
    startTime: row?.start_time || null,
    endTime: row?.end_time || null,
    platformScope: normalizePlatformScope(platformScope),
    presentation: {
      adSetName: row?.name == null ? "" : String(row.name),
      status: deliveryStatusLabel(status) || status,
      platformScope: PLATFORM_LABELS[normalizePlatformScope(platformScope)],
    },
  };
};

const presentAdRow = (row, platformScope) => {
  const status = row?.effective_status || row?.status || "";
  return {
    id: row?.id == null ? "" : String(row.id),
    name: row?.name == null ? "" : String(row.name),
    campaignId: row?.campaign_id == null ? "" : String(row.campaign_id),
    adSetId: row?.adset_id == null ? "" : String(row.adset_id),
    status: status ? String(status) : "",
    statusLabel: deliveryStatusLabel(status),
    configuredStatus: row?.status == null ? "" : String(row.status),
    issuesInfo: row?.issues_info || null,
    createdTime: row?.created_time || null,
    updatedTime: row?.updated_time || null,
    platformScope: normalizePlatformScope(platformScope),
    presentation: {
      adName: row?.name == null ? "" : String(row.name),
      status: deliveryStatusLabel(status) || status,
      platformScope: PLATFORM_LABELS[normalizePlatformScope(platformScope)],
    },
  };
};

const listOfFilterValues = (value) => {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const buildEntityFiltering = ({ effectiveStatus, objective, campaignId, adSetId }) => {
  const filtering = [];
  const statuses = listOfFilterValues(effectiveStatus).map((s) => s.toUpperCase());
  if (statuses.length) {
    filtering.push({
      field: "effective_status",
      operator: "IN",
      value: statuses,
    });
  }
  const objectives = listOfFilterValues(objective);
  if (objectives.length) {
    filtering.push({
      field: "objective",
      operator: "IN",
      value: objectives,
    });
  }
  const campaignIds = listOfFilterValues(campaignId);
  if (campaignIds.length) {
    filtering.push({
      field: "campaign.id",
      operator: "IN",
      value: campaignIds,
    });
  }
  const adSetIds = listOfFilterValues(adSetId);
  if (adSetIds.length) {
    filtering.push({
      field: "adset.id",
      operator: "IN",
      value: adSetIds,
    });
  }
  return filtering;
};

const collectEntityPages = async ({
  credentialId,
  workspaceId,
  path,
  fields,
  filtering,
  maxRows,
  maxPages,
  pageSize,
  returnAll,
  afterCursor,
}) => {
  const rows = [];
  let after = afterCursor ? String(afterCursor) : "";
  let pages = 0;
  let more = false;
  let nextAfter = "";
  while (rows.length < maxRows && pages < maxPages) {
    const remaining = maxRows - rows.length;
    const size = Math.min(pageSize, remaining);
    pages += 1;
    const query = {
      fields: Array.isArray(fields) ? fields.join(",") : String(fields || ""),
      limit: String(size),
    };
    if (filtering && filtering.length) {
      query.filtering = JSON.stringify(filtering);
    }
    if (after) query.after = after;
    const body = await metaGraphRequest({
      credentialId,
      workspaceId,
      path,
      query,
    });
    const data = Array.isArray(body?.data) ? body.data : [];
    for (const row of data) {
      rows.push(row);
      if (rows.length >= maxRows) break;
    }
    nextAfter = String(body?.paging?.cursors?.after || "");
    const listedMore = Boolean(
      body?.paging && Object.prototype.hasOwnProperty.call(body.paging, "next")
    );
    if (!nextAfter || data.length === 0) {
      more = false;
      break;
    }
    // Trust Meta's after/next cursor even when the page is shorter than limit.
    more = true;
    after = nextAfter;
    if (!returnAll) break;
    if (returnAll && !listedMore) {
      more = false;
      break;
    }
    if (rows.length >= maxRows) break;
  }
  // truncated = hit safety ceiling while more Graph pages remain.
  // hasMore = caller can continue with `after` (default bounded page or ceiling).
  const truncated = Boolean(
    more && (rows.length >= maxRows || (returnAll && pages >= maxPages))
  );
  return {
    rows,
    truncated,
    paging: {
      after: more ? nextAfter || null : null,
      hasMore: more,
    },
  };
};

const requireCredentialId = (data) => {
  const credentialId = String(data?.credentialId || "").trim();
  if (!credentialId) {
    throw metaError("Connect a Meta Ads account first.", "META_CREDENTIAL_REQUIRED");
  }
  return credentialId;
};

const executeAdAccount = async ({ data, context, first, platformScope }) => {
  const credentialId = requireCredentialId(data);
  const operation = String(data.operation || "get").trim();
  if (operation === "listAccessible" || operation === "list") {
    const limits = entityRowLimits({
      limit: data.limit,
      returnAll: data.returnAll,
    });
    const fetched = await collectEntityPages({
      credentialId,
      workspaceId: context?.workspaceId,
      path: "me/adaccounts",
      fields: ENTITY_FIELDS.adAccount,
      maxRows: limits.maxRows,
      maxPages: limits.maxPages,
      pageSize: limits.pageSize,
      returnAll: limits.returnAll,
      afterCursor: exprValue(data.after, context, first),
    });
    const items = fetched.rows.map((row, index) => ({
      json: {
        ...presentAdAccount(row),
        platformScope,
        platformLabel: PLATFORM_LABELS[platformScope],
        _meta: {
          provider: "meta_ads",
          resource: "adAccount",
          operation: "listAccessible",
          apiVersion: API_VERSION,
        },
      },
      pairedItem: { item: 0, inputItemIndex: index },
    }));
    return {
      items,
      output: {
        resource: "adAccount",
        operation: "listAccessible",
        platformScope,
        rowCount: items.length,
        truncated: fetched.truncated,
        paging: fetched.paging,
      },
    };
  }
  if (operation !== "get" && operation !== "getAccount") {
    throw metaError(
      "Ad Account supports Get Account and List Accessible Accounts.",
      "META_FIELD_UNSUPPORTED"
    );
  }
  const adAccountId = normalizeAdAccountId(
    exprValue(data.adAccountId, context, first)
  );
  const row = await metaGraphRequest({
    credentialId,
    workspaceId: context?.workspaceId,
    path: adAccountPath(adAccountId),
    query: { fields: ENTITY_FIELDS.adAccount.join(",") },
  });
  const presented = presentAdAccount(row);
  return {
    items: [
      {
        json: {
          ...presented,
          platformScope,
          platformLabel: PLATFORM_LABELS[platformScope],
          _meta: {
            provider: "meta_ads",
            resource: "adAccount",
            operation: "get",
            apiVersion: API_VERSION,
          },
        },
        pairedItem: { item: 0, inputItemIndex: 0 },
      },
    ],
    output: {
      resource: "adAccount",
      operation: "get",
      platformScope,
      adAccountId,
      rowCount: 1,
    },
  };
};

const executeEntityListGet = async ({
  data,
  context,
  first,
  platformScope,
  resource,
  listPath,
  fields,
  presentRow,
  idField,
}) => {
  const credentialId = requireCredentialId(data);
  const operation = String(data.operation || "list").trim();
  const adAccountId = normalizeAdAccountId(
    exprValue(data.adAccountId, context, first)
  );
  if (operation === "get") {
    const entityId = String(
      exprValue(data[idField], context, first) ||
        exprValue(data.entityId, context, first) ||
        ""
    ).trim();
    if (!/^\d{1,20}$/.test(entityId)) {
      throw metaError(
        `A numeric Meta ${resource} id is required.`,
        "META_FILTER_INVALID"
      );
    }
    const row = await metaGraphRequest({
      credentialId,
      workspaceId: context?.workspaceId,
      path: entityId,
      query: { fields: fields.join(",") },
    });
    const presented = presentRow(row, platformScope);
    return {
      items: [
        {
          json: {
            ...presented,
            _meta: {
              provider: "meta_ads",
              resource,
              operation: "get",
              adAccountId,
              apiVersion: API_VERSION,
              platformScope,
            },
          },
          pairedItem: { item: 0, inputItemIndex: 0 },
        },
      ],
      output: {
        resource,
        operation: "get",
        platformScope,
        adAccountId,
        rowCount: 1,
      },
    };
  }
  if (operation !== "list") {
    throw metaError(
      `${resource} supports List and Get only.`,
      "META_FIELD_UNSUPPORTED"
    );
  }
  const limits = entityRowLimits({
    limit: data.limit,
    returnAll: data.returnAll,
  });
  const filtering = buildEntityFiltering({
    effectiveStatus:
      exprValue(data.effectiveStatus, context, first) ||
      data.filters?.effectiveStatus,
    objective: exprValue(data.objective, context, first) || data.filters?.objective,
    campaignId:
      exprValue(data.campaignId, context, first) || data.filters?.campaignId,
    adSetId: exprValue(data.adSetId, context, first) || data.filters?.adSetId,
  });
  const fetched = await collectEntityPages({
    credentialId,
    workspaceId: context?.workspaceId,
    path: `${adAccountPath(adAccountId)}/${listPath}`,
    fields,
    filtering,
    maxRows: limits.maxRows,
    maxPages: limits.maxPages,
    pageSize: limits.pageSize,
    returnAll: limits.returnAll,
    afterCursor: exprValue(data.after, context, first),
  });
  const items = fetched.rows.map((row, index) => ({
    json: {
      ...presentRow(row, platformScope),
      _meta: {
        provider: "meta_ads",
        resource,
        operation: "list",
        adAccountId,
        apiVersion: API_VERSION,
        platformScope,
      },
    },
    pairedItem: { item: 0, inputItemIndex: index },
  }));
  return {
    items,
    output: {
      resource,
      operation: "list",
      platformScope,
      adAccountId,
      rowCount: items.length,
      truncated: fetched.truncated,
      paging: fetched.paging,
    },
  };
};

const executeDelivery = async ({ data, context, first, platformScope }) => {
  const level = String(
    exprValue(data.deliveryLevel, context, first) || data.deliveryLevel || "campaign"
  )
    .trim()
    .toLowerCase();
  const map = {
    campaign: {
      resource: "campaign",
      listPath: "campaigns",
      fields: ENTITY_FIELDS.campaign,
      presentRow: presentCampaignRow,
      idField: "campaignId",
    },
    adset: {
      resource: "adSet",
      listPath: "adsets",
      fields: ENTITY_FIELDS.adSet,
      presentRow: presentAdSetRow,
      idField: "adSetId",
    },
    ad_set: {
      resource: "adSet",
      listPath: "adsets",
      fields: ENTITY_FIELDS.adSet,
      presentRow: presentAdSetRow,
      idField: "adSetId",
    },
    ad: {
      resource: "ad",
      listPath: "ads",
      fields: ENTITY_FIELDS.ad,
      presentRow: presentAdRow,
      idField: "adId",
    },
  };
  const cfg = map[level];
  if (!cfg) {
    throw metaError(
      "Delivery level must be campaign, adset, or ad.",
      "META_FILTER_INVALID"
    );
  }
  return executeEntityListGet({
    data: { ...data, operation: "list" },
    context,
    first,
    platformScope,
    resource: "delivery",
    listPath: cfg.listPath,
    fields: cfg.fields,
    presentRow: (row, scope) => ({
      ...cfg.presentRow(row, scope),
      deliveryLevel: level === "ad_set" ? "adset" : level,
    }),
    idField: cfg.idField,
  });
};

const WRITE_OPERATIONS = new Set([
  "create",
  "update",
  "delete",
  "pause",
  "resume",
  "publish",
  "write",
]);

const executeInsights = async ({
  data,
  context,
  first,
  platformScope,
  legacyReport = false,
}) => {
  const credentialId = requireCredentialId(data);
  const adAccountId = normalizeAdAccountId(
    exprValue(data.adAccountId, context, first)
  );
  const accountPath = adAccountPath(adAccountId);
  const account = await metaGraphRequest({
    credentialId,
    workspaceId: context?.workspaceId,
    path: accountPath,
    query: {
      fields: "id,account_id,name,account_status,currency,timezone_name",
    },
  });
  const reportType = resolveInsightsReportType(data);
  const report = reportFor(reportType);
  const range = resolveMetaDateRange({
    dateRange: exprValue(data.dateRange, context, first) || data.dateRange,
    customStartDate: exprValue(data.customStartDate, context, first),
    customEndDate: exprValue(data.customEndDate, context, first),
    timezone: account?.timezone_name,
    nowMs: hooks.now(),
  });
  const breakdowns = legacyReport
    ? undefined
    : resolvePlatformBreakdowns(platformScope, data.platformBreakdown);
  const limits = rowLimits({ limit: data.limit, returnAll: data.returnAll });
  const fetched = await collectInsightsRows({
    credentialId,
    workspaceId: context?.workspaceId,
    accountPath,
    reportType: report.reportType,
    since: range.since,
    until: range.until,
    filters: data.filters,
    maxRows: limits.maxRows,
    maxPages: limits.maxPages,
    pageSize: limits.pageSize,
    returnAll: limits.returnAll,
    breakdowns,
    // Do not pass breakdown names as Insights fields — Meta rejects
    // publisher_platform (and peers) in the fields param.
  });
  let rawRows = fetched.rows;
  if (!legacyReport && (platformScope === "facebook" || platformScope === "instagram")) {
    rawRows = filterRowsByPublisherPlatform(rawRows, platformScope);
  }
  const provenance = {
    fieldReportType: report.reportType,
    reportType: report.reportType,
    level: report.level,
    adAccountId,
    since: range.since,
    until: range.until,
    timezone: range.timezone,
    breakdowns,
    truncated: fetched.truncated,
  };
  const normalized = rawRows.map((row) => normalizeInsightsRow(row, provenance));

  if (legacyReport) {
    const items = normalized.map((row, index) => ({
      json: row,
      pairedItem: { item: 0, inputItemIndex: index },
    }));
    return {
      items,
      output: {
        reportType: report.reportType,
        adAccountId,
        since: range.since,
        until: range.until,
        timezone: range.timezone,
        rowCount: items.length,
        truncated: fetched.truncated,
      },
    };
  }

  const enriched = normalized.map((row) => enrichInsightRowMetrics(row));
  const summary = presentInsightSummary({
    rows: enriched,
    platformScope,
    range,
    reportType: report.reportType,
    adAccountId,
  });
  const items = enriched.map((row, index) => {
    const {
      linkClicks,
      landingPageViews,
      leads,
      messagingConversations,
      engagements,
      installs,
      purchases,
      purchaseValue,
      ...base
    } = row;
    return {
      json: {
        ...base,
        objectiveLabel: objectiveLabel(row.objective || row.campaign_objective),
        platformScope,
        platformLabel: PLATFORM_LABELS[platformScope],
        extracted: {
          linkClicks,
          landingPageViews,
          leads,
          messagingConversations,
          engagements,
          installs,
          purchases,
          purchaseValue,
        },
        presentation: {
          title: summary.title,
          subtitle: summary.subtitle,
          spend: row.spend,
          impressions: row.impressions,
          clicks: row.clicks,
          leads,
          publisherPlatform: row.publisher_platform || null,
        },
      },
      pairedItem: { item: 0, inputItemIndex: index },
    };
  });
  return {
    items,
    output: {
      resource: "insights",
      operation: "runReport",
      reportType: report.reportType,
      adAccountId,
      platformScope,
      platformLabel: PLATFORM_LABELS[platformScope],
      since: range.since,
      until: range.until,
      timezone: range.timezone,
      rowCount: items.length,
      truncated: fetched.truncated,
      breakdowns: breakdowns || [],
      presentation: summary,
      metrics: {
        totals: {
          spend: summary.spend,
          impressions: summary.impressions,
          clicks: summary.clicks,
          linkClicks: summary.linkClicks,
          landingPageViews: summary.landingPageViews,
          leads: summary.leads,
          messagingConversations: summary.messagingConversations,
          engagements: summary.engagements,
          installs: summary.installs,
          purchases: summary.purchases,
          purchaseValue: summary.purchaseValue,
          reach: summary.reach,
        },
        ratios: {
          frequency: summary.frequency,
          ctr: summary.ctr,
          cpc: summary.cpc,
          cpm: summary.cpm,
          cpl: summary.cpl,
          cpi: summary.cpi,
          costPerConversation: summary.costPerConversation,
          costPerLpv: summary.costPerLpv,
          costPerEngagement: summary.costPerEngagement,
          costPerPurchase: summary.costPerPurchase,
          roas: summary.roas,
        },
      },
    },
  };
};

const executeMetaAdsNode = async (node, context) => {
  const rawResource = String(node?.data?.resource || "insights").trim();
  const legacyReport = rawResource === "report";
  const data = sanitizeMetaAdsNodeData(node?.data || {});
  const platformScope = normalizePlatformScope(data.platformScope);
  const resource = normalizeResource(data.resource || "insights");
  const operation = String(data.operation || "").trim().toLowerCase();
  if (WRITE_OPERATIONS.has(operation)) {
    throw metaError(
      "Meta Ads write calls are not available.",
      "META_PERMISSION_DENIED",
      403
    );
  }
  const itemsIn = Array.isArray(context?.inputItems)
    ? context.inputItems
    : Array.isArray(context?.items)
      ? context.items
      : [{ json: {} }];
  const first = itemsIn[0] || { json: {} };

  if (resource === "adAccount") {
    return executeAdAccount({ data, context, first, platformScope });
  }
  if (resource === "campaign") {
    return executeEntityListGet({
      data,
      context,
      first,
      platformScope,
      resource: "campaign",
      listPath: "campaigns",
      fields: ENTITY_FIELDS.campaign,
      presentRow: presentCampaignRow,
      idField: "campaignId",
    });
  }
  if (resource === "adSet") {
    return executeEntityListGet({
      data,
      context,
      first,
      platformScope,
      resource: "adSet",
      listPath: "adsets",
      fields: ENTITY_FIELDS.adSet,
      presentRow: presentAdSetRow,
      idField: "adSetId",
    });
  }
  if (resource === "ad") {
    return executeEntityListGet({
      data,
      context,
      first,
      platformScope,
      resource: "ad",
      listPath: "ads",
      fields: ENTITY_FIELDS.ad,
      presentRow: presentAdRow,
      idField: "adId",
    });
  }
  if (resource === "delivery") {
    return executeDelivery({ data, context, first, platformScope });
  }
  if (resource === "insights") {
    const op = String(data.operation || "runReport").trim();
    if (op !== "runReport" && op !== "get") {
      throw metaError(
        "Insights supports Run Report only.",
        "META_FIELD_UNSUPPORTED"
      );
    }
    return executeInsights({
      data,
      context,
      first,
      platformScope,
      legacyReport,
    });
  }
  throw metaError(
    "Unsupported Meta Ads resource.",
    "META_FIELD_UNSUPPORTED"
  );
};

const presentAdAccount = (row) => {
  const numericId = normalizeAdAccountId(row?.account_id || row?.id);
  const status = row?.account_status == null ? null : Number(row.account_status);
  return {
    adAccountId: numericId,
    apiId: adAccountPath(numericId),
    name: row?.name == null ? "" : String(row.name),
    currency: row?.currency == null ? "" : String(row.currency),
    timezoneName: row?.timezone_name == null ? "" : String(row.timezone_name),
    accountStatus: Number.isFinite(status) ? status : null,
    accountStatusLabel: accountStatusLabel(status),
  };
};

module.exports = {
  API_VERSION,
  ACCOUNT_STATUS,
  withMetaTestHooks,
  stripSecrets,
  accountStatusLabel,
  normalizeAdAccountId,
  adAccountPath,
  appSecretProof,
  mapMetaError,
  metaGraphRequest,
  collectPages,
  presentAdAccount,
  presentCampaignRow,
  presentAdSetRow,
  presentAdRow,
  assertUsableSecret,
  loadCredentialRow,
  sanitizeMetaAdsNodeData,
  normalizeInsightsRow,
  runMetaAdsInsights,
  executeMetaAdsNode,
  resolvePlatformBreakdowns,
  normalizeResource,
};
