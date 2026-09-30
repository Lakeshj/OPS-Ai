/**
 * Google Ads V1 — read-only reporting.
 * GAQL is built only from this module. The node never sends mutate requests.
 *
 * API: Google Ads API v21 GoogleAdsService.Search
 * https://googleads.googleapis.com/v21/customers/{customerId}/googleAds:search
 *
 * costMicros / averageCpcMicros are the API values (1 currency unit = 1_000_000 micros).
 * cost and averageCpc are those values divided by 1_000_000. ctr is the API ratio (0.1 = 10%).
 * currencyCode is copied from customer.currency_code when the API returns it.
 */
const { resolveDateRange } = require("./workflowGoogleDateRange");

const ADS_API_VERSION = "v21";
const ADS_ROW_MAX = 10000;
const ADS_PAGE_MAX = 40;
const CUSTOMER_ID_RE = /^\d{10}$/;

const STATUS_ENUM = ["ENABLED", "PAUSED", "REMOVED"];
const DEVICE_ENUM = ["MOBILE", "TABLET", "DESKTOP", "CONNECTED_TV", "OTHER"];

const TRAFFIC_METRICS = [
  "metrics.impressions",
  "metrics.clicks",
  "metrics.ctr",
  "metrics.cost_micros",
  "metrics.average_cpc",
  "metrics.conversions",
  "metrics.conversions_value",
];

const CONVERSION_METRICS = [
  "metrics.conversions",
  "metrics.conversions_value",
  "metrics.all_conversions",
  "metrics.all_conversions_value",
];

const CUSTOMER_FIELDS = ["customer.id", "customer.currency_code"];

const REPORTS = Object.freeze({
  campaign_performance: {
    label: "Campaign Performance",
    from: "campaign",
    select: [
      ...CUSTOMER_FIELDS,
      "campaign.id",
      "campaign.name",
      "campaign.status",
      "campaign.advertising_channel_type",
      "segments.date",
      ...TRAFFIC_METRICS,
    ],
    orderBy: "metrics.impressions DESC",
    traffic: true,
  },
  ad_group_performance: {
    label: "Ad Group Performance",
    from: "ad_group",
    select: [
      ...CUSTOMER_FIELDS,
      "campaign.id",
      "campaign.name",
      "ad_group.id",
      "ad_group.name",
      "ad_group.status",
      "segments.date",
      ...TRAFFIC_METRICS,
    ],
    orderBy: "metrics.impressions DESC",
    traffic: true,
  },
  keyword_performance: {
    label: "Keyword Performance",
    from: "keyword_view",
    select: [
      ...CUSTOMER_FIELDS,
      "campaign.id",
      "campaign.name",
      "ad_group.id",
      "ad_group.name",
      "ad_group_criterion.keyword.text",
      "ad_group_criterion.keyword.match_type",
      "ad_group_criterion.status",
      "segments.date",
      ...TRAFFIC_METRICS,
    ],
    orderBy: "metrics.impressions DESC",
    traffic: true,
  },
  search_terms: {
    label: "Search Terms",
    from: "search_term_view",
    select: [
      ...CUSTOMER_FIELDS,
      "search_term_view.search_term",
      "campaign.id",
      "campaign.name",
      "ad_group.id",
      "ad_group.name",
      "segments.date",
      ...TRAFFIC_METRICS,
    ],
    orderBy: "metrics.impressions DESC",
    traffic: true,
  },
  device_performance: {
    label: "Device Performance",
    from: "campaign",
    select: [
      ...CUSTOMER_FIELDS,
      "campaign.id",
      "campaign.name",
      "segments.device",
      "segments.date",
      ...TRAFFIC_METRICS,
    ],
    orderBy: "metrics.impressions DESC",
    traffic: true,
  },
  geographic_performance: {
    label: "Geographic Performance",
    from: "geographic_view",
    select: [
      ...CUSTOMER_FIELDS,
      "campaign.id",
      "campaign.name",
      "geographic_view.country_criterion_id",
      "geographic_view.location_type",
      "segments.date",
      ...TRAFFIC_METRICS,
    ],
    orderBy: "metrics.impressions DESC",
    traffic: true,
  },
  conversion_performance: {
    label: "Conversion Performance",
    from: "campaign",
    select: [
      ...CUSTOMER_FIELDS,
      "campaign.id",
      "campaign.name",
      "segments.conversion_action_name",
      "segments.conversion_action_category",
      "segments.date",
      ...CONVERSION_METRICS,
    ],
    orderBy: "metrics.conversions DESC",
    traffic: false,
  },
});

const FILTER_DEFS = Object.freeze({
  campaignStatus: {
    reports: [
      "campaign_performance",
      "ad_group_performance",
      "device_performance",
      "geographic_performance",
      "conversion_performance",
    ],
    field: "campaign.status",
    kind: "enum",
    values: STATUS_ENUM,
  },
  campaignId: {
    reports: [
      "campaign_performance",
      "ad_group_performance",
      "keyword_performance",
      "search_terms",
      "device_performance",
      "geographic_performance",
      "conversion_performance",
    ],
    field: "campaign.id",
    kind: "id",
  },
  campaignName: {
    reports: ["campaign_performance", "ad_group_performance", "device_performance"],
    field: "campaign.name",
    kind: "contains",
  },
  adGroupStatus: {
    reports: ["ad_group_performance", "keyword_performance"],
    field: "ad_group.status",
    kind: "enum",
    values: STATUS_ENUM,
  },
  adGroupId: {
    reports: ["ad_group_performance", "keyword_performance", "search_terms"],
    field: "ad_group.id",
    kind: "id",
  },
  keywordStatus: {
    reports: ["keyword_performance"],
    field: "ad_group_criterion.status",
    kind: "enum",
    values: STATUS_ENUM,
  },
  keywordText: {
    reports: ["keyword_performance"],
    field: "ad_group_criterion.keyword.text",
    kind: "contains",
  },
  searchTerm: {
    reports: ["search_terms"],
    field: "search_term_view.search_term",
    kind: "contains",
  },
  device: {
    reports: ["device_performance"],
    field: "segments.device",
    kind: "enum",
    values: DEVICE_ENUM,
  },
});

const SECRET_KEY_RE =
  /(access[_-]?token|refresh[_-]?token|client[_-]?secret|developer[_-]?token|api[_-]?key|^password$|^authorization$|^secret$|^token$)/i;

const adsError = (message, code) => {
  const err = new Error(message);
  err.code = code;
  err.statusCode = 400;
  return err;
};

const normalizeCustomerId = (value, label) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (!CUSTOMER_ID_RE.test(digits)) {
    throw adsError(
      `${label} must be a 10-digit Google Ads customer ID.`,
      "GOOGLE_ADS_CUSTOMER_INVALID"
    );
  }
  return digits;
};

const escapeLike = (value) =>
  String(value)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");

const filterClause = (reportType, key, raw) => {
  const spec = FILTER_DEFS[key];
  if (!spec || !spec.reports.includes(reportType)) {
    throw adsError(`Filter ${key} is not valid for this report.`, "GOOGLE_ADS_FILTER");
  }
  const value = String(raw || "").trim();
  if (!value || value.toLowerCase() === "any") return "";
  if (spec.kind === "enum") {
    const picked = value.toUpperCase();
    if (!spec.values.includes(picked)) {
      throw adsError(
        `${key} must be one of ${spec.values.join(", ")}.`,
        "GOOGLE_ADS_FILTER"
      );
    }
    return `${spec.field} = ${picked}`;
  }
  if (spec.kind === "id") {
    if (!/^\d+$/.test(value)) {
      throw adsError(`${key} must be numeric.`, "GOOGLE_ADS_FILTER");
    }
    return `${spec.field} = ${value}`;
  }
  return `${spec.field} LIKE '%${escapeLike(value)}%'`;
};

const buildReportQuery = ({
  reportType,
  startDate,
  endDate,
  filters = {},
  limit,
}) => {
  const report = REPORTS[reportType];
  if (!report) {
    throw adsError("Unknown Google Ads report.", "GOOGLE_ADS_REPORT");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw adsError("Date range must be YYYY-MM-DD.", "GOOGLE_ADS_DATE");
  }
  const cap = Math.min(Math.max(Number(limit) || 1, 1), ADS_ROW_MAX);
  const where = [`segments.date BETWEEN '${startDate}' AND '${endDate}'`];
  for (const [key, raw] of Object.entries(filters || {})) {
    if (raw == null || String(raw).trim() === "") continue;
    const spec = FILTER_DEFS[key];
    if (!spec) {
      throw adsError(`Unknown filter ${key}.`, "GOOGLE_ADS_FILTER");
    }
    if (!spec.reports.includes(reportType)) continue;
    const clause = filterClause(reportType, key, raw);
    if (clause) where.push(clause);
  }
  return {
    gaql: [
      `SELECT ${report.select.join(", ")}`,
      `FROM ${report.from}`,
      `WHERE ${where.join(" AND ")}`,
      `ORDER BY ${report.orderBy}`,
      `LIMIT ${cap}`,
    ].join("\n"),
    limit: cap,
    report,
  };
};

const asNumber = (value) => {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const majorUnits = (micros) => (micros == null ? null : micros / 1_000_000);

const normalizeAdsRow = (row, reportType) => {
  const report = REPORTS[reportType];
  const customer = row?.customer || {};
  const campaign = row?.campaign || {};
  const adGroup = row?.adGroup || {};
  const criterion = row?.adGroupCriterion || {};
  const keyword = criterion.keyword || {};
  const searchTerm = row?.searchTermView || {};
  const geo = row?.geographicView || {};
  const metrics = row?.metrics || {};
  const segments = row?.segments || {};
  const currency = customer.currencyCode ? String(customer.currencyCode) : null;
  const json = {
    customerId: customer.id != null ? String(customer.id) : null,
    currencyCode: currency,
    date: segments.date || null,
  };
  if (campaign.id != null) json.campaignId = String(campaign.id);
  if (campaign.name != null) json.campaignName = campaign.name;
  if (campaign.status != null) json.campaignStatus = campaign.status;
  if (campaign.advertisingChannelType != null) {
    json.advertisingChannelType = campaign.advertisingChannelType;
  }
  if (adGroup.id != null) json.adGroupId = String(adGroup.id);
  if (adGroup.name != null) json.adGroupName = adGroup.name;
  if (adGroup.status != null) json.adGroupStatus = adGroup.status;
  if (keyword.text != null) json.keywordText = keyword.text;
  if (keyword.matchType != null) json.keywordMatchType = keyword.matchType;
  if (criterion.status != null && reportType === "keyword_performance") {
    json.keywordStatus = criterion.status;
  }
  if (searchTerm.searchTerm != null) json.searchTerm = searchTerm.searchTerm;
  if (segments.device != null) json.device = segments.device;
  if (geo.countryCriterionId != null) {
    json.countryCriterionId = String(geo.countryCriterionId);
  }
  if (geo.locationType != null) json.locationType = geo.locationType;
  if (segments.conversionActionName != null) {
    json.conversionActionName = segments.conversionActionName;
  }
  if (segments.conversionActionCategory != null) {
    json.conversionActionCategory = segments.conversionActionCategory;
  }
  if (report?.traffic !== false) {
    json.impressions = asNumber(metrics.impressions);
    json.clicks = asNumber(metrics.clicks);
    json.ctr = asNumber(metrics.ctr);
    const costMicros = asNumber(metrics.costMicros);
    json.costMicros = costMicros;
    json.cost = majorUnits(costMicros);
    const averageCpcMicros = asNumber(metrics.averageCpc);
    json.averageCpcMicros = averageCpcMicros;
    json.averageCpc = majorUnits(averageCpcMicros);
  }
  json.conversions = asNumber(metrics.conversions);
  json.conversionsValue = asNumber(metrics.conversionsValue);
  if (report?.traffic === false) {
    json.allConversions = asNumber(metrics.allConversions);
    json.allConversionsValue = asNumber(metrics.allConversionsValue);
  }
  return json;
};

const sanitizeGoogleAdsNodeData = (data) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const next = {};
  for (const [key, value] of Object.entries(data)) {
    if (SECRET_KEY_RE.test(key)) continue;
    next[key] = value;
  }
  return next;
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runGoogleAdsReport = async (node, context, item, deps = {}) => {
  const data = sanitizeGoogleAdsNodeData(node?.data || {});
  const resource = String(data.resource || "report");
  const operation = String(data.operation || "runReport");
  if (resource !== "report" || operation !== "runReport") {
    throw adsError(
      "Google Ads V1 only runs read-only reports.",
      "GOOGLE_ADS_READ_ONLY"
    );
  }
  const credentialId = String(data.credentialId || "").trim();
  if (!credentialId) {
    throw adsError("Connect Google Ads to continue.", "GOOGLE_CREDENTIAL_REQUIRED");
  }
  const customerId = normalizeCustomerId(
    exprValue(data.customerId, context, item),
    "Customer ID"
  );
  const loginRaw = String(exprValue(data.loginCustomerId, context, item) || "").trim();
  const loginCustomerId = loginRaw
    ? normalizeCustomerId(loginRaw, "Login customer ID")
    : "";
  const reportType = String(data.reportType || "").trim();
  const range = resolveDateRange(data.dateRange || "last7days", {
    startDate: exprValue(data.startDate, context, item),
    endDate: exprValue(data.endDate, context, item),
  });
  const returnAll = data.returnAll === true || data.returnAll === "true";
  const limit = returnAll
    ? ADS_ROW_MAX
    : Math.min(Math.max(Number(data.limit) || 100, 1), ADS_ROW_MAX);
  const filters = {};
  for (const key of Object.keys(FILTER_DEFS)) {
    const raw = exprValue(data[key], context, item);
    if (raw != null && String(raw).trim() !== "") filters[key] = raw;
  }
  const built = buildReportQuery({
    reportType,
    startDate: range.startDate,
    endDate: range.endDate,
    filters,
    limit,
  });
  const request = deps.googleApiRequest || require("./googleOAuth.service").googleApiRequest;
  const headers = {};
  if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;
  const items = [];
  let pageToken = "";
  let pages = 0;
  let truncated = false;
  while (items.length < built.limit && pages < ADS_PAGE_MAX) {
    pages += 1;
    const body = { query: built.gaql };
    if (pageToken) body.pageToken = pageToken;
    let res;
    let attempt = 0;
    for (;;) {
      try {
        res = await request({
          credentialId,
          workspaceId: context?.workspaceId,
          requiredType: "google_ads",
          url: `https://googleads.googleapis.com/${ADS_API_VERSION}/customers/${customerId}/googleAds:search`,
          method: "POST",
          headers,
          body,
        });
        break;
      } catch (err) {
        const retryable =
          err?.retryable === true ||
          err?.code === "GOOGLE_QUOTA" ||
          err?.code === "GOOGLE_ADS_QUOTA";
        if (!retryable || attempt >= 2) throw err;
        attempt += 1;
        await sleep(deps.retryDelayMs != null ? deps.retryDelayMs : 200 * attempt);
      }
    }
    const results = Array.isArray(res?.body?.results) ? res.body.results : [];
    for (const row of results) {
      const json = normalizeAdsRow(row, reportType);
      if (!json.customerId) json.customerId = customerId;
      items.push({ json });
      if (items.length >= built.limit) break;
    }
    pageToken = String(res?.body?.nextPageToken || "");
    if (!pageToken) break;
    if (items.length >= built.limit) break;
  }
  if (pageToken && items.length >= built.limit) truncated = true;
  if (pages >= ADS_PAGE_MAX && pageToken) truncated = true;
  return {
    items,
    output: {
      reportType,
      customerId,
      rowCount: items.length,
      truncated,
      startDate: range.startDate,
      endDate: range.endDate,
    },
    resolved: {
      credentialId,
      reportType,
      customerId,
      loginCustomerId: loginCustomerId || null,
    },
  };
};

module.exports = {
  ADS_API_VERSION,
  ADS_ROW_MAX,
  REPORTS,
  FILTER_DEFS,
  buildReportQuery,
  normalizeAdsRow,
  normalizeCustomerId,
  runGoogleAdsReport,
  sanitizeGoogleAdsNodeData,
};
