/**
 * Read-only Google Ads MCP performance tools.
 * Native report types compile through the shared report catalog.
 * Date range is this tool's own preset, never the source node's report range.
 */

const {
  ADS_ROW_MAX,
  STATUS_ENUM,
  DEVICE_ENUM,
  CONVERSION_ACTION_CATEGORY,
  REPORTS,
  buildPerformanceReportQuery,
} = require("../../../../backend/services/googleAdsReportCatalog");
const { GA4_PRESETS, resolveDateRange } = require("../../../../backend/services/workflowGoogleDateRange");

const PERFORMANCE_TOOL_IDS = Object.freeze([
  "campaign_performance",
  "ad_group_performance",
  "ad_performance",
  "keyword_performance",
  "search_terms",
  "device_performance",
  "geographic_performance",
  "placement_performance",
  "conversion_performance",
]);

const STATUS_FILTER_KEY = Object.freeze({
  campaign_performance: "campaignStatus",
  ad_group_performance: "adGroupStatus",
  keyword_performance: "keywordStatus",
  device_performance: "campaignStatus",
  geographic_performance: "campaignStatus",
  conversion_performance: "campaignStatus",
  ad_performance: "adStatus",
});

const DATE_PRESET_LABELS = Object.freeze([
  "Today",
  "Yesterday",
  "Last 7 days",
  "Last 28 days",
  "Last 30 days",
  "Last calendar week",
  "Last calendar month",
  "Custom",
]);

const objectSchema = (properties, required = []) => ({
  type: "object",
  properties,
  required,
});

const limitField = {
  type: "integer",
  title: "Limit",
  description: "Maximum rows to return. Defaults to 100. Ignored when Return all is on.",
  minimum: 1,
  maximum: 10000,
};

const returnAllField = {
  type: "boolean",
  title: "Return all",
  description: "Page through results, up to 10000 rows.",
};

const dateFields = () => ({
  dateRange: {
    type: "string",
    title: "Date range",
    enum: GA4_PRESETS.slice(),
    enumNames: DATE_PRESET_LABELS.slice(),
    description: "Reporting window for this tool. Defaults to Last 7 days. Not taken from the Google Ads node.",
  },
  startDate: {
    type: "string",
    title: "Start date",
    description: "YYYY-MM-DD. Used when Date range is Custom.",
  },
  endDate: {
    type: "string",
    title: "End date",
    description: "YYYY-MM-DD. Used when Date range is Custom.",
  },
});

const campaignIdField = {
  type: "string",
  title: "Campaign ID",
  description: "Optional campaign filter.",
};

const adGroupIdField = {
  type: "string",
  title: "Ad group ID",
  description: "Optional ad group filter.",
};

const statusField = {
  type: "string",
  title: "Status",
  enum: STATUS_ENUM.slice(),
  enumNames: ["Enabled", "Paused", "Removed"],
  description: "Optional status filter.",
};

function present(value) {
  if (value == null) return false;
  const text = String(value).trim();
  return text !== "" && text.toLowerCase() !== "any";
}

function rowLimit(params) {
  const returnAll = params?.returnAll === true || params?.returnAll === "true";
  if (returnAll) return ADS_ROW_MAX;
  return Math.min(Math.max(Number(params?.limit) || 100, 1), ADS_ROW_MAX);
}

function filtersFor(toolId, params) {
  const filters = {};
  if (present(params.campaignId)) filters.campaignId = params.campaignId;
  if (present(params.adGroupId)) filters.adGroupId = params.adGroupId;
  if (present(params.adId)) filters.adId = params.adId;
  if (present(params.textContains)) filters.keywordText = params.textContains;
  if (present(params.searchTermContains)) filters.searchTerm = params.searchTermContains;
  if (present(params.device)) filters.device = params.device;
  if (present(params.placementContains)) filters.placementContains = params.placementContains;
  if (present(params.conversionActionName)) filters.conversionActionName = params.conversionActionName;
  if (present(params.conversionActionCategory)) {
    filters.conversionActionCategory = params.conversionActionCategory;
  }
  const statusKey = STATUS_FILTER_KEY[toolId];
  if (statusKey && present(params.status)) filters[statusKey] = params.status;
  return filters;
}

/**
 * Daily segmentation is the only combination these tools run.
 * Other segments stay unsupported until a later phase.
 */
function assertDailySegment(params) {
  const segment = params?.segment;
  if (segment == null || String(segment).trim() === "" || String(segment).trim() === "date") {
    return;
  }
  const err = new Error("Only daily date segmentation is available.");
  err.code = "GOOGLE_ADS_FILTER";
  throw err;
}

function buildPerformanceToolQuery(toolId, params = {}, options = {}) {
  if (!PERFORMANCE_TOOL_IDS.includes(toolId)) {
    const err = new Error(`Unknown Google Ads MCP tool "${toolId}".`);
    err.code = "MCP_UNKNOWN_TOOL";
    throw err;
  }
  assertDailySegment(params);
  const resolve = options.resolveDateRange || resolveDateRange;
  let range;
  try {
    range = resolve(params.dateRange || "last7days", {
      startDate: params.startDate,
      endDate: params.endDate,
      nowMs: options.nowMs,
    });
  } catch (err) {
    const wrapped = new Error(err instanceof Error ? err.message : "Date range is invalid.");
    wrapped.code = "GOOGLE_ADS_DATE";
    throw wrapped;
  }
  const built = buildPerformanceReportQuery({
    reportType: toolId,
    startDate: range.startDate,
    endDate: range.endDate,
    filters: filtersFor(toolId, params),
    limit: rowLimit(params),
  });
  return {
    resource: built.report.from,
    query: built.gaql,
    report: built.report,
    limit: built.limit,
    dateRange: {
      startDate: range.startDate,
      endDate: range.endDate,
    },
  };
}

function performanceToolDefinitions(provider) {
  const base = {
    provider: provider.id,
    authType: provider.authType,
    access: "read",
    risk: "low",
    implemented: true,
    executor: "google_ads_mcp",
    uiGroup: "performance",
  };
  const shared = {
    ...dateFields(),
    limit: limitField,
    returnAll: returnAllField,
  };
  return [
    {
      ...base,
      id: "campaign_performance",
      displayName: "Campaign Performance",
      description: "Campaign traffic and conversion metrics for this tool's date range.",
      category: "campaign",
      inputSchema: objectSchema({
        ...shared,
        campaignId: campaignIdField,
        status: statusField,
      }),
      outputSchema: objectSchema({
        campaign: { type: "object", description: "Campaign resource returned by Google Ads." },
        metrics: { type: "object", description: "Metrics returned by Google Ads." },
      }),
    },
    {
      ...base,
      id: "ad_group_performance",
      displayName: "Ad Group Performance",
      description: "Ad group traffic and conversion metrics for this tool's date range.",
      category: "ad_group",
      inputSchema: objectSchema({
        ...shared,
        campaignId: campaignIdField,
        adGroupId: adGroupIdField,
        status: statusField,
      }),
      outputSchema: objectSchema({
        ad_group: { type: "object", description: "Ad group resource returned by Google Ads." },
        metrics: { type: "object", description: "Metrics returned by Google Ads." },
      }),
    },
    {
      ...base,
      id: "ad_performance",
      displayName: "Ad Performance",
      description: "Ad traffic and conversion metrics. Creative fields stay on the Ads tool.",
      category: "ad",
      inputSchema: objectSchema({
        ...shared,
        campaignId: campaignIdField,
        adGroupId: adGroupIdField,
        adId: {
          type: "string",
          title: "Ad ID",
          description: "Optional. Limits the result to this ad.",
        },
        status: statusField,
      }),
      outputSchema: objectSchema({
        ad_group_ad: { type: "object", description: "Ad group ad resource returned by Google Ads." },
        metrics: { type: "object", description: "Metrics returned by Google Ads." },
      }),
    },
    {
      ...base,
      id: "keyword_performance",
      displayName: "Keyword Performance",
      description: "Keyword text, match type, status, and traffic metrics. Not search terms.",
      category: "keyword",
      inputSchema: objectSchema({
        ...shared,
        campaignId: campaignIdField,
        adGroupId: adGroupIdField,
        textContains: {
          type: "string",
          title: "Keyword contains",
          description: "Optional keyword text filter.",
        },
        status: statusField,
      }),
      outputSchema: objectSchema({
        ad_group_criterion: { type: "object", description: "Keyword criterion returned by Google Ads." },
        metrics: { type: "object", description: "Metrics returned by Google Ads." },
      }),
    },
    {
      ...base,
      id: "search_terms",
      displayName: "Search Terms",
      description: "Search terms people typed, with campaign and ad group context. Not keywords.",
      category: "search_term",
      inputSchema: objectSchema({
        ...shared,
        campaignId: campaignIdField,
        adGroupId: adGroupIdField,
        searchTermContains: {
          type: "string",
          title: "Search term contains",
          description: "Optional search term filter.",
        },
      }),
      outputSchema: objectSchema({
        search_term_view: { type: "object", description: "Search term returned by Google Ads." },
        metrics: { type: "object", description: "Metrics returned by Google Ads." },
      }),
    },
    {
      ...base,
      id: "device_performance",
      displayName: "Device Performance",
      description: "Campaign metrics split by the Google Ads device enum.",
      category: "device",
      inputSchema: objectSchema({
        ...shared,
        campaignId: campaignIdField,
        device: {
          type: "string",
          title: "Device",
          enum: DEVICE_ENUM.slice(),
          enumNames: ["Mobile", "Tablet", "Desktop", "Connected TV", "Other"],
          description: "Optional device filter.",
        },
      }),
      outputSchema: objectSchema({
        campaign: { type: "object", description: "Campaign resource returned by Google Ads." },
        segments: { type: "object", description: "Device segment returned by Google Ads." },
        metrics: { type: "object", description: "Metrics returned by Google Ads." },
      }),
    },
    {
      ...base,
      id: "geographic_performance",
      displayName: "Geographic Performance",
      description:
        "Geographic view metrics. Country criterion id and location type are returned as Google Ads sends them.",
      category: "geographic",
      inputSchema: objectSchema({
        ...shared,
        campaignId: campaignIdField,
      }),
      outputSchema: objectSchema({
        geographic_view: { type: "object", description: "Geographic view returned by Google Ads." },
        metrics: { type: "object", description: "Metrics returned by Google Ads." },
      }),
    },
    {
      ...base,
      id: "placement_performance",
      displayName: "Placement Performance",
      description: "Where ads were shown, from group placement view.",
      category: "placement",
      inputSchema: objectSchema({
        ...shared,
        campaignId: campaignIdField,
        adGroupId: adGroupIdField,
        placementContains: {
          type: "string",
          title: "Placement contains",
          description: "Optional. Matches the placement display name, such as a website domain or channel name.",
        },
      }),
      outputSchema: objectSchema({
        group_placement_view: {
          type: "object",
          description: "Group placement view returned by Google Ads.",
        },
        metrics: { type: "object", description: "Metrics returned by Google Ads." },
      }),
    },
    {
      ...base,
      id: "conversion_performance",
      displayName: "Conversion Performance",
      description: "Measured conversion performance. Conversion action settings stay on Conversion Actions.",
      category: "conversion",
      inputSchema: objectSchema({
        ...shared,
        campaignId: campaignIdField,
        conversionActionName: {
          type: "string",
          title: "Conversion action name",
          description: "Optional exact conversion action name.",
        },
        conversionActionCategory: {
          type: "string",
          title: "Conversion category",
          enum: CONVERSION_ACTION_CATEGORY.slice(),
          description: "Optional conversion action category.",
        },
      }),
      outputSchema: objectSchema({
        campaign: { type: "object", description: "Campaign resource returned by Google Ads." },
        segments: { type: "object", description: "Conversion segments returned by Google Ads." },
        metrics: { type: "object", description: "Conversion metrics returned by Google Ads." },
      }),
    },
  ];
}

module.exports = {
  PERFORMANCE_TOOL_IDS,
  REPORTS,
  buildPerformanceToolQuery,
  performanceToolDefinitions,
};
