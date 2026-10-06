/**
 * Read-only asset performance and change history.
 *
 * Keyword Planner is not implemented in this catalog. See the plugin README.
 *
 * Asset metrics below are the intersection of the v25 field pages for
 * campaign_asset, ad_group_asset, and ad_group_ad_asset_view. Conversion-action
 * segments are omitted even where a page lists them.
 */

const { ADS_ROW_MAX } = require("../../../../backend/services/googleAdsReportCatalog");
const { GA4_PRESETS, resolveDateRange } = require("../../../../backend/services/workflowGoogleDateRange");

const ASSET_SCOPES = Object.freeze({
  campaign: "campaign_asset",
  ad_group: "ad_group_asset",
  ad: "ad_group_ad_asset_view",
});

const ASSET_TYPE = Object.freeze([
  "IMAGE",
  "TEXT",
  "YOUTUBE_VIDEO",
  "MEDIA_BUNDLE",
  "CALLOUT",
  "STRUCTURED_SNIPPET",
  "SITELINK",
  "CALL",
  "CALL_TO_ACTION",
  "LEAD_FORM",
  "PROMOTION",
  "PRICE",
  "MOBILE_APP",
  "PAGE_FEED",
  "LOCATION",
  "BUSINESS_MESSAGE",
  "APP_DEEP_LINK",
  "DEMAND_GEN_CAROUSEL_CARD",
]);

const CHANGE_RESOURCE_TYPES = Object.freeze([
  "AD",
  "AD_GROUP",
  "AD_GROUP_AD",
  "AD_GROUP_ASSET",
  "AD_GROUP_BID_MODIFIER",
  "AD_GROUP_CRITERION",
  "AD_GROUP_FEED",
  "ASSET",
  "ASSET_SET",
  "ASSET_SET_ASSET",
  "CAMPAIGN",
  "CAMPAIGN_ASSET",
  "CAMPAIGN_ASSET_SET",
  "CAMPAIGN_BUDGET",
  "CAMPAIGN_CRITERION",
  "CAMPAIGN_FEED",
  "CUSTOMER_ASSET",
  "FEED",
  "FEED_ITEM",
]);

const CHANGE_CLIENT_TYPES = Object.freeze([
  "GOOGLE_ADS_API",
  "GOOGLE_ADS_AUTOMATED_RULE",
  "GOOGLE_ADS_BULK_UPLOAD",
  "GOOGLE_ADS_EDITOR",
  "GOOGLE_ADS_MOBILE_APP",
  "GOOGLE_ADS_RECOMMENDATIONS",
  "GOOGLE_ADS_RECOMMENDATIONS_SUBSCRIPTION",
  "GOOGLE_ADS_SCRIPTS",
  "GOOGLE_ADS_WEB_CLIENT",
  "INTERNAL_TOOL",
  "OTHER",
  "SEARCH_ADS_360_POST",
  "SEARCH_ADS_360_SYNC",
]);

const CHANGE_HISTORY_DAYS = 30;

const ASSET_METRICS = Object.freeze([
  "metrics.impressions",
  "metrics.clicks",
  "metrics.ctr",
  "metrics.cost_micros",
  "metrics.average_cpc",
  "metrics.conversions",
  "metrics.conversions_value",
]);

const ASSET_SELECT = Object.freeze({
  campaign: [
    "customer.id",
    "customer.currency_code",
    "campaign.id",
    "campaign.name",
    "campaign_asset.resource_name",
    "campaign_asset.campaign",
    "campaign_asset.asset",
    "campaign_asset.field_type",
    "campaign_asset.status",
    "campaign_asset.primary_status",
    "asset.id",
    "asset.name",
    "asset.type",
    "segments.date",
    ...ASSET_METRICS,
  ],
  ad_group: [
    "customer.id",
    "customer.currency_code",
    "campaign.id",
    "campaign.name",
    "ad_group.id",
    "ad_group.name",
    "ad_group_asset.resource_name",
    "ad_group_asset.asset",
    "ad_group_asset.field_type",
    "ad_group_asset.status",
    "ad_group_asset.primary_status",
    "asset.id",
    "asset.name",
    "asset.type",
    "segments.date",
    ...ASSET_METRICS,
  ],
  ad: [
    "customer.id",
    "customer.currency_code",
    "campaign.id",
    "campaign.name",
    "ad_group.id",
    "ad_group.name",
    "ad_group_ad_asset_view.resource_name",
    "ad_group_ad_asset_view.ad_group_ad",
    "ad_group_ad_asset_view.asset",
    "ad_group_ad_asset_view.field_type",
    "ad_group_ad_asset_view.performance_label",
    "ad_group_ad_asset_view.enabled",
    "asset.id",
    "asset.name",
    "asset.type",
    "segments.date",
    ...ASSET_METRICS,
  ],
});

const CHANGE_SELECT = Object.freeze([
  "change_event.resource_name",
  "change_event.change_date_time",
  "change_event.change_resource_name",
  "change_event.change_resource_type",
  "change_event.resource_change_operation",
  "change_event.client_type",
  "change_event.user_email",
  "change_event.changed_fields",
  "change_event.old_resource",
  "change_event.new_resource",
  "change_event.campaign",
  "change_event.ad_group",
]);

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

const ASSET_PARAMS = new Set([
  "scope",
  "dateRange",
  "startDate",
  "endDate",
  "campaignId",
  "adGroupId",
  "assetId",
  "assetType",
  "limit",
  "returnAll",
]);

const CHANGE_PARAMS = new Set([
  "dateRange",
  "startDate",
  "endDate",
  "limit",
  "returnAll",
  "changeResourceType",
  "clientType",
  "userEmail",
  "campaignId",
  "adGroupId",
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

function queryError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function present(value) {
  if (value == null) return false;
  const text = String(value).trim();
  return text !== "" && text.toLowerCase() !== "any";
}

function rejectUnknown(params, allowed, label) {
  for (const key of Object.keys(params || {})) {
    if (!allowed.has(key)) {
      throw queryError(`${key} is not supported on ${label}.`, "GOOGLE_ADS_FILTER");
    }
  }
}

function optionalId(params, name, label) {
  if (!present(params?.[name])) return "";
  const text = String(params[name]).trim();
  if (!/^\d{1,20}$/.test(text)) {
    throw queryError(`${label} must be numeric.`, "GOOGLE_ADS_FILTER");
  }
  return text;
}

function optionalEnum(params, name, allowed, label) {
  if (!present(params?.[name])) return "";
  const picked = String(params[name]).trim().toUpperCase();
  if (!allowed.includes(picked)) {
    throw queryError(`${label} must be one of ${allowed.join(", ")}.`, "GOOGLE_ADS_FILTER");
  }
  return picked;
}

function optionalText(params, name, label) {
  if (!present(params?.[name])) return "";
  const text = String(params[name]).trim();
  if (text.length > 200 || /[\r\n]/.test(text)) {
    throw queryError(`${label} must be a single line of at most 200 characters.`, "GOOGLE_ADS_FILTER");
  }
  return text.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function rowLimit(params) {
  const returnAll = params?.returnAll === true || params?.returnAll === "true";
  if (returnAll) return ADS_ROW_MAX;
  return Math.min(Math.max(Number(params?.limit) || 100, 1), ADS_ROW_MAX);
}

function resolveRange(params, options) {
  const resolve = options.resolveDateRange || resolveDateRange;
  try {
    return resolve(params.dateRange || "last7days", {
      startDate: params.startDate,
      endDate: params.endDate,
      nowMs: options.nowMs,
    });
  } catch (err) {
    throw queryError(err instanceof Error ? err.message : "Date range is invalid.", "GOOGLE_ADS_DATE");
  }
}

function utcDay(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function isoFromUtc(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(iso, days) {
  return isoFromUtc(utcDay(iso) + days * 86400000);
}

function assertChangeWindow(range, nowMs) {
  const today = isoFromUtc(nowMs || Date.now());
  const oldest = addDays(today, -CHANGE_HISTORY_DAYS);
  const spanDays = (utcDay(range.endDate) - utcDay(range.startDate)) / 86400000;
  if (range.startDate < oldest) {
    throw queryError(
      `Google Ads change history only covers the past ${CHANGE_HISTORY_DAYS} days. The selected range ${range.startDate} to ${range.endDate} starts before ${oldest}. Choose a start date on or after ${oldest}. Older changes are not available, and this range was not shortened.`,
      "GOOGLE_ADS_CHANGE_WINDOW"
    );
  }
  if (spanDays > CHANGE_HISTORY_DAYS) {
    throw queryError(
      `Google Ads change history accepts a window of at most ${CHANGE_HISTORY_DAYS} days. The selected range ${range.startDate} to ${range.endDate} is longer than that. Narrow the date range. This range was not shortened.`,
      "GOOGLE_ADS_CHANGE_WINDOW"
    );
  }
}

function buildAssetPerformanceQuery(params = {}, options = {}) {
  rejectUnknown(params, ASSET_PARAMS, "asset performance");
  const scope = String(params.scope || "").trim();
  const resource = ASSET_SCOPES[scope];
  if (!resource) {
    throw queryError(
      "Asset performance scope must be campaign, ad_group, or ad.",
      "GOOGLE_ADS_FILTER"
    );
  }
  if (scope === "campaign" && present(params.adGroupId)) {
    throw queryError(
      "Ad group ID is not supported for campaign asset performance. Use ad group or ad scope.",
      "GOOGLE_ADS_FILTER"
    );
  }
  const range = resolveRange(params, options);
  const where = [`segments.date BETWEEN '${range.startDate}' AND '${range.endDate}'`];
  const campaignId = optionalId(params, "campaignId", "Campaign ID");
  const adGroupId = scope === "campaign" ? "" : optionalId(params, "adGroupId", "Ad group ID");
  const assetId = optionalId(params, "assetId", "Asset ID");
  const assetType = optionalEnum(params, "assetType", ASSET_TYPE, "Asset type");
  if (campaignId) where.push(`campaign.id = ${campaignId}`);
  if (adGroupId) where.push(`ad_group.id = ${adGroupId}`);
  if (assetId) where.push(`asset.id = ${assetId}`);
  if (assetType) where.push(`asset.type = ${assetType}`);
  const limit = rowLimit(params);
  return {
    resource,
    limit,
    dateRange: { startDate: range.startDate, endDate: range.endDate },
    query: [
      `SELECT ${ASSET_SELECT[scope].join(", ")}`,
      `FROM ${resource}`,
      `WHERE ${where.join(" AND ")}`,
      "ORDER BY segments.date, asset.id",
      `LIMIT ${limit}`,
    ].join("\n"),
  };
}

function buildChangeHistoryQuery(params = {}, options = {}) {
  rejectUnknown(params, CHANGE_PARAMS, "change history");
  const range = resolveRange(params, options);
  assertChangeWindow(range, options.nowMs);
  const where = [
    `change_event.change_date_time >= '${range.startDate}'`,
    `change_event.change_date_time < '${addDays(range.endDate, 1)}'`,
  ];
  const changeResourceType = optionalEnum(
    params,
    "changeResourceType",
    CHANGE_RESOURCE_TYPES,
    "Changed resource type"
  );
  const clientType = optionalEnum(params, "clientType", CHANGE_CLIENT_TYPES, "Client type");
  const userEmail = optionalText(params, "userEmail", "User email");
  const campaignId = optionalId(params, "campaignId", "Campaign ID");
  const adGroupId = optionalId(params, "adGroupId", "Ad group ID");
  if ((campaignId || adGroupId) && !/^\d{1,20}$/.test(String(options.customerId || ""))) {
    throw queryError(
      "A Customer ID from the Google Ads source is required to filter change history by campaign or ad group.",
      "GOOGLE_ADS_FILTER"
    );
  }
  if (changeResourceType) where.push(`change_event.change_resource_type = ${changeResourceType}`);
  if (clientType) where.push(`change_event.client_type = ${clientType}`);
  if (userEmail) where.push(`change_event.user_email = '${userEmail}'`);
  if (campaignId) {
    where.push(`change_event.campaign = 'customers/${options.customerId}/campaigns/${campaignId}'`);
  }
  if (adGroupId) {
    where.push(`change_event.ad_group = 'customers/${options.customerId}/adGroups/${adGroupId}'`);
  }
  const limit = rowLimit(params);
  return {
    resource: "change_event",
    limit,
    dateRange: { startDate: range.startDate, endDate: range.endDate },
    query: [
      `SELECT ${CHANGE_SELECT.join(", ")}`,
      "FROM change_event",
      `WHERE ${where.join(" AND ")}`,
      "ORDER BY change_event.change_date_time DESC",
      `LIMIT ${limit}`,
    ].join("\n"),
  };
}

function dateFields(description) {
  return {
    dateRange: {
      type: "string",
      title: "Date range",
      enum: GA4_PRESETS.slice(),
      enumNames: DATE_PRESET_LABELS.slice(),
      description,
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
  };
}

function assetPerformanceTool(provider) {
  return {
    provider: provider.id,
    id: "asset_performance",
    displayName: "Asset Performance",
    description:
      "Performance for assets linked to a campaign, an ad group, or an ad. Uses this tool's own date range.",
    category: "asset",
    authType: provider.authType,
    access: "read",
    risk: "low",
    implemented: true,
    executor: "google_ads_mcp",
    uiGroup: "performance",
    inputSchema: objectSchema(
      {
        scope: {
          type: "string",
          title: "Scope",
          enum: ["campaign", "ad_group", "ad"],
          enumNames: ["Campaign", "Ad group", "Ad"],
          description: "Campaign uses campaign_asset. Ad group uses ad_group_asset. Ad uses ad_group_ad_asset_view.",
        },
        ...dateFields("Reporting window for this tool. Defaults to Last 7 days. Not taken from the Google Ads node."),
        campaignId: {
          type: "string",
          title: "Campaign ID",
          description: "Optional campaign filter.",
        },
        adGroupId: {
          type: "string",
          title: "Ad group ID",
          description: "Optional. Supported for ad group and ad scopes. Campaign scope does not filter by ad group.",
        },
        assetId: {
          type: "string",
          title: "Asset ID",
          description: "Optional asset filter.",
        },
        assetType: {
          type: "string",
          title: "Asset type",
          enum: ASSET_TYPE.slice(),
          description: "Optional asset type.",
        },
        limit: limitField,
        returnAll: returnAllField,
      },
      ["scope"]
    ),
    outputSchema: objectSchema({
      asset: { type: "object", description: "Asset identity returned by Google Ads." },
      metrics: { type: "object", description: "Metrics compatible with the selected asset resource." },
    }),
  };
}

function changeHistoryTool(provider) {
  return {
    provider: provider.id,
    id: "change_history",
    displayName: "Change History",
    description:
      "Recent account changes from Google Ads change_event. Google Ads keeps about 30 days of this history and does not return older changes. This does not undo or edit anything. Google Ads Editor changes are not included.",
    category: "change",
    authType: provider.authType,
    access: "read",
    risk: "low",
    implemented: true,
    executor: "google_ads_mcp",
    uiGroup: "advanced",
    inputSchema: objectSchema({
      ...dateFields(
        "Change window for this tool. Defaults to Last 7 days. Google Ads only returns about the past 30 days, and the window itself can be at most 30 days."
      ),
      changeResourceType: {
        type: "string",
        title: "Changed resource type",
        enum: CHANGE_RESOURCE_TYPES.slice(),
        description: "Optional. Limits results to this change_event resource type.",
      },
      clientType: {
        type: "string",
        title: "Client type",
        enum: CHANGE_CLIENT_TYPES.slice(),
        description: "Optional. Limits results to the client that recorded the change.",
      },
      userEmail: {
        type: "string",
        title: "User email",
        description: "Optional exact email of the user who made the change, when Google Ads supplies it.",
      },
      campaignId: {
        type: "string",
        title: "Campaign ID",
        description: "Optional. Limits results to changes on this campaign.",
      },
      adGroupId: {
        type: "string",
        title: "Ad group ID",
        description: "Optional. Limits results to changes on this ad group.",
      },
      limit: limitField,
      returnAll: returnAllField,
    }),
    outputSchema: objectSchema({
      changeEvent: {
        type: "object",
        description: "Change event returned by Google Ads, including old and new resource values when Google supplies them.",
      },
    }),
  };
}

module.exports = {
  ASSET_SCOPES,
  ASSET_METRICS,
  CHANGE_HISTORY_DAYS,
  buildAssetPerformanceQuery,
  buildChangeHistoryQuery,
  assetPerformanceTool,
  changeHistoryTool,
};
