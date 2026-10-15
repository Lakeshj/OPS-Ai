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
} = require("./metaAdsReportCatalog");

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

const appSecretProof = (accessToken, nowMs = hooks.now()) => {
  const { appSecret } = appCredentials();
  if (!appSecret) {
    throw metaError(
      "Meta app credentials are not configured on the server.",
      "META_APP_NOT_CONFIGURED",
      500
    );
  }
  const appSecretTime = String(Math.floor(Number(nowMs) / 1000));
  const proof = crypto
    .createHmac("sha256", appSecret)
    .update(`${accessToken}|${appSecretTime}`)
    .digest("hex");
  return { appsecret_proof: proof, appsecret_time: appSecretTime };
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
  params.set("appsecret_time", proof.appsecret_time);
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

const sanitizeMetaAdsNodeData = (data) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const next = stripSecretKeys(data);
  if (next.adAccountId != null && String(next.adAccountId).trim()) {
    const text = String(next.adAccountId).trim().replace(/^act_/i, "");
    if (/^\d{1,20}$/.test(text)) next.adAccountId = text;
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

const executeMetaAdsNode = async (node, context) => {
  const data = sanitizeMetaAdsNodeData(node?.data || {});
  const resource = String(data.resource || "report");
  const operation = String(data.operation || "runReport");
  if (resource !== "report" || operation !== "runReport") {
    throw metaError("Meta Ads only runs read-only reports.", "META_PERMISSION_DENIED", 403);
  }
  const credentialId = String(data.credentialId || "").trim();
  if (!credentialId) {
    throw metaError("Connect a Meta Ads account first.", "META_CREDENTIAL_REQUIRED");
  }
  const itemsIn = Array.isArray(context?.inputItems)
    ? context.inputItems
    : Array.isArray(context?.items)
      ? context.items
      : [{ json: {} }];
  const first = itemsIn[0] || { json: {} };
  const adAccountId = normalizeAdAccountId(exprValue(data.adAccountId, context, first));
  const accountPath = adAccountPath(adAccountId);
  const account = await metaGraphRequest({
    credentialId,
    workspaceId: context?.workspaceId,
    path: accountPath,
    query: { fields: "id,account_id,name,account_status,currency,timezone_name" },
  });
  const report = reportFor(data.reportType);
  const range = resolveMetaDateRange({
    dateRange: exprValue(data.dateRange, context, first) || data.dateRange,
    customStartDate: exprValue(data.customStartDate, context, first),
    customEndDate: exprValue(data.customEndDate, context, first),
    timezone: account?.timezone_name,
    nowMs: hooks.now(),
  });
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
  });
  const provenance = {
    reportType: report.reportType,
    level: report.level,
    adAccountId,
    since: range.since,
    until: range.until,
    timezone: range.timezone,
  };
  const items = fetched.rows.map((row, index) => ({
    json: normalizeInsightsRow(row, provenance),
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
  assertUsableSecret,
  loadCredentialRow,
  sanitizeMetaAdsNodeData,
  normalizeInsightsRow,
  runMetaAdsInsights,
  executeMetaAdsNode,
};
