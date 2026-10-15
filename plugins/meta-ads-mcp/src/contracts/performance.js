/**
 * Meta Ads MCP Performance + controlled breakdown tools (M6).
 * Insights semantics come from the shared Meta report catalog.
 * This file owns MCP schemas and frozen breakdown modes only.
 */

const {
  DATE_PRESETS,
  DEFAULT_DATE_RANGE,
  EFFECTIVE_STATUS,
  MAX_ROWS,
  reportFor,
  resolveDemographicBreakdowns,
  resolvePlacementBreakdowns,
  resolveScopeReport,
  validateBreakdowns,
  validateFilters,
} = require("../../../../backend/services/metaAdsReportCatalog");

const objectSchema = (properties, required = []) => ({
  type: "object",
  properties,
  required,
});

const PERFORMANCE_TOOL_IDS = Object.freeze([
  "account_performance",
  "campaign_performance",
  "ad_set_performance",
  "ad_performance",
  "demographic_performance",
  "geographic_performance",
  "device_performance",
  "placement_performance",
]);

const CORE_PERFORMANCE_TOOLS = Object.freeze([
  "account_performance",
  "campaign_performance",
  "ad_set_performance",
  "ad_performance",
]);

const BREAKDOWN_TOOLS = Object.freeze([
  "demographic_performance",
  "geographic_performance",
  "device_performance",
  "placement_performance",
]);

const SCOPE_ENUM = Object.freeze(["account", "campaign", "adset", "ad"]);

const limitField = {
  type: "integer",
  title: "Limit",
  description: "Maximum rows to return. Defaults to 100. Ignored when Return all is on.",
  minimum: 1,
  maximum: MAX_ROWS,
};

const returnAllField = {
  type: "boolean",
  title: "Return all",
  description: "Page through results, up to 2000 rows.",
};

const dateFields = () => ({
  dateRange: {
    type: "string",
    title: "Date range",
    enum: DATE_PRESETS.slice(),
    description:
      "Reporting window for this tool. Defaults to last 7 complete days in the ad account timezone. Not taken from the Meta Ads node.",
  },
  customSince: {
    type: "date",
    title: "Since",
    description: "YYYY-MM-DD. Used when Date range is custom.",
  },
  customUntil: {
    type: "date",
    title: "Until",
    description: "YYYY-MM-DD. Used when Date range is custom.",
  },
});

const campaignIdField = {
  type: "string",
  title: "Campaign ID",
  description: "Optional. Numeric Meta campaign id.",
};

const adSetIdField = {
  type: "string",
  title: "Ad Set ID",
  description: "Optional. Numeric Meta ad set id.",
};

const adIdField = {
  type: "string",
  title: "Ad ID",
  description: "Optional. Numeric Meta ad id.",
};

const statusEnum = (values) => ({
  type: "string",
  title: "Effective status",
  enum: values.slice(),
  description: "Optional effective status filter.",
});

const scopeField = {
  type: "string",
  title: "Scope",
  enum: SCOPE_ENUM.slice(),
  description: "Insights level. Defaults to the Meta Ads account.",
};

const present = (value) => value != null && String(value).trim() !== "";

function filtersFromParams(reportType, params = {}) {
  const filters = {};
  if (present(params.campaignId)) filters.campaignId = params.campaignId;
  if (present(params.adSetId)) filters.adSetId = params.adSetId;
  if (present(params.adId)) filters.adId = params.adId;
  if (present(params.effectiveStatus)) filters.effectiveStatus = params.effectiveStatus;
  return validateFilters(reportType, filters);
}

function coreReportType(toolId) {
  if (CORE_PERFORMANCE_TOOLS.includes(toolId)) return toolId;
  throw Object.assign(new Error(`Unknown Meta Ads MCP tool "${toolId}".`), {
    code: "MCP_UNKNOWN_TOOL",
  });
}

/**
 * Map MCP params onto the shared Insights runner. Does not call Graph.
 */
function buildPerformanceRequest(toolId, params = {}) {
  const id = String(toolId || "");
  if (!PERFORMANCE_TOOL_IDS.includes(id)) {
    throw Object.assign(new Error(`Unknown Meta Ads MCP tool "${id}".`), {
      code: "MCP_UNKNOWN_TOOL",
    });
  }

  let reportType;
  let breakdowns;
  if (CORE_PERFORMANCE_TOOLS.includes(id)) {
    reportType = coreReportType(id);
    breakdowns = undefined;
  } else {
    reportType = resolveScopeReport(params.scope || "account").reportType;
    if (id === "demographic_performance") {
      breakdowns = resolveDemographicBreakdowns(params.demographicMode || "age_and_gender");
    } else if (id === "geographic_performance") {
      breakdowns = validateBreakdowns(["country"]);
    } else if (id === "device_performance") {
      breakdowns = validateBreakdowns(["impression_device"]);
    } else if (id === "placement_performance") {
      breakdowns = resolvePlacementBreakdowns(params.placementBreakdown || "publisher_and_position");
    }
  }

  const report = reportFor(reportType);
  const filters = filtersFromParams(reportType, params);
  return {
    tool: id,
    reportType,
    level: report.level,
    filters,
    dateRange: present(params.dateRange) ? String(params.dateRange).trim() : DEFAULT_DATE_RANGE,
    customStartDate: present(params.customSince) ? String(params.customSince).trim() : undefined,
    customEndDate: present(params.customUntil) ? String(params.customUntil).trim() : undefined,
    limit: params.limit,
    returnAll: params.returnAll === true || params.returnAll === "true",
    breakdowns,
    extraFields: breakdowns ? breakdowns.slice() : undefined,
  };
}

function performanceToolDefinitions(provider) {
  const base = {
    provider: provider.id,
    authType: provider.authType,
    access: "read",
    risk: "low",
    implemented: true,
    executor: "meta_ads_mcp",
    uiGroup: "performance",
  };
  const dates = dateFields();
  const paging = { limit: limitField, returnAll: returnAllField };
  const insightsOut = objectSchema({
    impressions: { type: "number" },
    clicks: { type: "number" },
    spend: { type: "number" },
    actions: { type: "array" },
  });
  return [
    {
      ...base,
      id: "account_performance",
      displayName: "Account Performance",
      description: "Daily Meta Ads Insights at account level. Not taken from the native Meta Ads node dates.",
      category: "insights",
      inputSchema: objectSchema({ ...dates, ...paging }),
      outputSchema: insightsOut,
    },
    {
      ...base,
      id: "campaign_performance",
      displayName: "Campaign Performance",
      description: "Daily Meta Ads Insights at campaign level. One row per campaign per day.",
      category: "insights",
      inputSchema: objectSchema({
        ...dates,
        campaignId: campaignIdField,
        effectiveStatus: statusEnum(EFFECTIVE_STATUS.campaign),
        ...paging,
      }),
      outputSchema: insightsOut,
    },
    {
      ...base,
      id: "ad_set_performance",
      displayName: "Ad Set Performance",
      description: "Daily Meta Ads Insights at ad set level. Ad Sets, never Ad Groups.",
      category: "insights",
      inputSchema: objectSchema({
        ...dates,
        campaignId: campaignIdField,
        adSetId: adSetIdField,
        effectiveStatus: statusEnum(EFFECTIVE_STATUS.adset),
        ...paging,
      }),
      outputSchema: insightsOut,
    },
    {
      ...base,
      id: "ad_performance",
      displayName: "Ad Performance",
      description: "Daily Meta Ads Insights at ad level. One row per ad per day.",
      category: "insights",
      inputSchema: objectSchema({
        ...dates,
        campaignId: campaignIdField,
        adSetId: adSetIdField,
        adId: adIdField,
        effectiveStatus: statusEnum(EFFECTIVE_STATUS.ad),
        ...paging,
      }),
      outputSchema: insightsOut,
    },
    {
      ...base,
      id: "demographic_performance",
      displayName: "Demographic Performance",
      description: "Insights broken down by age and/or gender. Frozen demographic modes only.",
      category: "insights",
      inputSchema: objectSchema({
        ...dates,
        demographicMode: {
          type: "string",
          title: "Demographic",
          enum: ["age", "gender", "age_and_gender"],
          description: "Defaults to age and gender.",
        },
        scope: scopeField,
        campaignId: campaignIdField,
        adSetId: adSetIdField,
        adId: adIdField,
        effectiveStatus: statusEnum(EFFECTIVE_STATUS.ad),
        ...paging,
      }),
      outputSchema: insightsOut,
    },
    {
      ...base,
      id: "geographic_performance",
      displayName: "Geographic Performance",
      description: "Insights broken down by Meta country. Country codes are not translated.",
      category: "insights",
      inputSchema: objectSchema({
        ...dates,
        scope: scopeField,
        campaignId: campaignIdField,
        adSetId: adSetIdField,
        adId: adIdField,
        effectiveStatus: statusEnum(EFFECTIVE_STATUS.ad),
        ...paging,
      }),
      outputSchema: insightsOut,
    },
    {
      ...base,
      id: "device_performance",
      displayName: "Device Performance",
      description: "Insights broken down by Meta impression_device. Not Google Ads device segments.",
      category: "insights",
      inputSchema: objectSchema({
        ...dates,
        scope: scopeField,
        campaignId: campaignIdField,
        adSetId: adSetIdField,
        adId: adIdField,
        effectiveStatus: statusEnum(EFFECTIVE_STATUS.ad),
        ...paging,
      }),
      outputSchema: insightsOut,
    },
    {
      ...base,
      id: "placement_performance",
      displayName: "Placement Performance",
      description: "Insights broken down by publisher platform and/or platform position.",
      category: "insights",
      inputSchema: objectSchema({
        ...dates,
        placementBreakdown: {
          type: "string",
          title: "Placement",
          enum: ["publisher_platform", "platform_position", "publisher_and_position"],
          description: "Defaults to publisher platform and position.",
        },
        scope: scopeField,
        campaignId: campaignIdField,
        adSetId: adSetIdField,
        adId: adIdField,
        effectiveStatus: statusEnum(EFFECTIVE_STATUS.ad),
        ...paging,
      }),
      outputSchema: insightsOut,
    },
  ];
}

module.exports = {
  PERFORMANCE_TOOL_IDS,
  CORE_PERFORMANCE_TOOLS,
  BREAKDOWN_TOOLS,
  SCOPE_ENUM,
  buildPerformanceRequest,
  performanceToolDefinitions,
};
