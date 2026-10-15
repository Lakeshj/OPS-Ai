/**
 * Google Ads V1 — read-only reporting.
 * GAQL definitions live in googleAdsReportCatalog.js. This module runs them.
 * The node never sends mutate requests.
 *
 * API: Google Ads API v25 (v25.2 is served on the /v25/ REST prefix).
 * https://googleads.googleapis.com/v25/customers/{customerId}/googleAds:search
 *
 * costMicros / averageCpcMicros are the API values (1 currency unit = 1_000_000 micros).
 * cost and averageCpc are those values divided by 1_000_000. ctr is the API ratio (0.1 = 10%).
 * currencyCode is copied from customer.currency_code when the API returns it.
 */
const { resolveDateRange } = require("./workflowGoogleDateRange");
const {
  GOOGLE_ADS_API_VERSION,
  annotateGoogleAdsError,
} = require("./googleOAuth.service");

const ADS_API_VERSION = GOOGLE_ADS_API_VERSION;
const {
  ADS_ROW_MAX,
  REPORTS,
  FILTER_DEFS,
  buildReportQuery,
} = require("./googleAdsReportCatalog");

const ADS_PAGE_MAX = 40;
const CUSTOMER_ID_RE = /^\d{10}$/;

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

const asNumber = (value) => {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const majorUnits = (micros) => (micros == null ? null : micros / 1_000_000);

const ADS_RESOURCE_BY_REPORT = Object.freeze({
  campaign_performance: "campaign",
  ad_group_performance: "ad_group",
  keyword_performance: "keyword",
  search_terms: "search_term",
  device_performance: "device",
  geographic_performance: "geographic",
  conversion_performance: "conversion",
});

const normalizeAdsRow = (row, reportType, provenance = {}) => {
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
    source: "google_ads",
    provider: "google_ads",
    reportType,
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
  const metaCustomerId = String(
    provenance.customerId || json.customerId || ""
  ).replace(/\D/g, "");
  json._meta = {
    provider: "google_ads",
    resource: ADS_RESOURCE_BY_REPORT[reportType] || "campaign",
    report: reportType,
    customerId: metaCustomerId,
    dateRange: {
      startDate: provenance.startDate ? String(provenance.startDate) : "",
      endDate: provenance.endDate ? String(provenance.endDate) : "",
    },
  };
  return json;
};

const blankLoginCustomerId = (value) => {
  const raw = String(value == null ? "" : value).trim();
  if (!raw || raw === "-" || /^null|undefined$/i.test(raw)) return true;
  return !/\d/.test(raw);
};

const normalizeOptionalLoginCustomerId = (value) => {
  if (blankLoginCustomerId(value)) return "";
  return normalizeCustomerId(value, "Login customer ID");
};

const sanitizeGoogleAdsNodeData = (data) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const next = {};
  for (const [key, value] of Object.entries(data)) {
    if (SECRET_KEY_RE.test(key)) continue;
    next[key] = value;
  }
  if (Object.prototype.hasOwnProperty.call(next, "loginCustomerId")) {
    next.loginCustomerId = blankLoginCustomerId(next.loginCustomerId)
      ? ""
      : String(next.loginCustomerId).trim();
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
  const loginCustomerId = normalizeOptionalLoginCustomerId(
    exprValue(data.loginCustomerId, context, item)
  );
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
  if (loginCustomerId) {
    headers["login-customer-id"] = loginCustomerId;
  }
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
        if (!retryable || attempt >= 2) {
          throw annotateGoogleAdsError(err, {
            reportType,
            apiVersion: ADS_API_VERSION,
            customerId,
            loginCustomerId,
          });
        }
        attempt += 1;
        await sleep(deps.retryDelayMs != null ? deps.retryDelayMs : 200 * attempt);
      }
    }
    const results = Array.isArray(res?.body?.results) ? res.body.results : [];
    for (const row of results) {
      const json = normalizeAdsRow(row, reportType, {
        customerId,
        startDate: range.startDate,
        endDate: range.endDate,
      });
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
  normalizeOptionalLoginCustomerId,
};
