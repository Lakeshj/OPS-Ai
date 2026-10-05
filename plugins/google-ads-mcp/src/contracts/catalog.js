/**
 * Read-only Common Google Ads MCP tools.
 * GAQL is server-owned. Parameters become validated filters only.
 */

const objectSchema = (properties, required = []) => ({
  type: "object",
  properties,
  required,
});

const ENTITY_STATUS = Object.freeze(["ENABLED", "PAUSED", "REMOVED"]);
const CONVERSION_STATUS = Object.freeze(["ENABLED", "REMOVED", "HIDDEN"]);
const CONVERSION_CATEGORY = Object.freeze([
  "DEFAULT",
  "PAGE_VIEW",
  "PURCHASE",
  "SIGNUP",
  "LEAD",
  "DOWNLOAD",
  "ADD_TO_CART",
  "BEGIN_CHECKOUT",
  "SUBSCRIBE_PAID",
  "PHONE_CALL_LEAD",
  "IMPORTED_LEAD",
  "SUBMIT_LEAD_FORM",
  "BOOK_APPOINTMENT",
  "REQUEST_QUOTE",
  "GET_DIRECTIONS",
  "OUTBOUND_CLICK",
  "CONTACT",
  "ENGAGEMENT",
  "STORE_VISIT",
  "STORE_SALE",
  "QUALIFIED_LEAD",
  "CONVERTED_LEAD",
]);
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
const RECOMMENDATION_TYPE = Object.freeze([
  "KEYWORD",
  "KEYWORD_MATCH_TYPE",
  "CAMPAIGN_BUDGET",
  "FORECASTING_CAMPAIGN_BUDGET",
  "MARGINAL_ROI_CAMPAIGN_BUDGET",
  "MOVE_UNUSED_BUDGET",
  "MAXIMIZE_CLICKS_OPT_IN",
  "MAXIMIZE_CONVERSIONS_OPT_IN",
  "MAXIMIZE_CONVERSION_VALUE_OPT_IN",
  "TARGET_CPA_OPT_IN",
  "ENHANCED_CPC_OPT_IN",
  "SEARCH_PARTNERS_OPT_IN",
  "SET_TARGET_CPA",
  "SET_TARGET_ROAS",
  "RAISE_TARGET_CPA",
  "RAISE_TARGET_CPA_BID_TOO_LOW",
  "LOWER_TARGET_ROAS",
  "FORECASTING_SET_TARGET_CPA",
  "FORECASTING_SET_TARGET_ROAS",
  "OPTIMIZE_AD_ROTATION",
  "USE_BROAD_MATCH_KEYWORD",
  "RESPONSIVE_SEARCH_AD",
  "RESPONSIVE_SEARCH_AD_ASSET",
  "RESPONSIVE_SEARCH_AD_IMPROVE_AD_STRENGTH",
  "TEXT_AD",
  "CALLOUT_ASSET",
  "SITELINK_ASSET",
  "CALL_ASSET",
  "LEAD_FORM_ASSET",
  "IMPROVE_PERFORMANCE_MAX_AD_STRENGTH",
  "PERFORMANCE_MAX_OPT_IN",
  "PERFORMANCE_MAX_FINAL_URL_OPT_IN",
  "UPGRADE_SMART_SHOPPING_CAMPAIGN_TO_PERFORMANCE_MAX",
  "UPGRADE_LOCAL_CAMPAIGN_TO_PERFORMANCE_MAX",
  "MIGRATE_DYNAMIC_SEARCH_ADS_CAMPAIGN_TO_PERFORMANCE_MAX",
  "IMPROVE_DEMAND_GEN_AD_STRENGTH",
  "IMPROVE_GOOGLE_TAG_COVERAGE",
  "REFRESH_CUSTOMER_MATCH_LIST",
  "DISPLAY_EXPANSION_OPT_IN",
  "SHOPPING_ADD_AGE_GROUP",
  "SHOPPING_ADD_COLOR",
  "SHOPPING_ADD_GENDER",
  "SHOPPING_ADD_GTIN",
  "SHOPPING_ADD_MORE_IDENTIFIERS",
  "SHOPPING_ADD_PRODUCTS_TO_CAMPAIGN",
  "SHOPPING_ADD_SIZE",
  "SHOPPING_FIX_DISAPPROVED_PRODUCTS",
]);

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

const COMMON_SELECT = Object.freeze({
  account_summary: [
    "customer.id",
    "customer.descriptive_name",
    "customer.currency_code",
    "customer.time_zone",
    "customer.manager",
    "customer.status",
  ],
  campaigns: [
    "campaign.id",
    "campaign.name",
    "campaign.status",
    "campaign.advertising_channel_type",
    "campaign.advertising_channel_sub_type",
    "campaign.start_date",
    "campaign.end_date",
    "campaign.serving_status",
    "campaign.bidding_strategy_type",
    "campaign.primary_status",
  ],
  ad_groups: [
    "campaign.id",
    "campaign.name",
    "ad_group.id",
    "ad_group.name",
    "ad_group.status",
    "ad_group.type",
  ],
  ads: [
    "campaign.id",
    "campaign.name",
    "ad_group.id",
    "ad_group.name",
    "ad_group_ad.ad.id",
    "ad_group_ad.status",
    "ad_group_ad.ad.type",
    "ad_group_ad.ad.name",
    "ad_group_ad.ad.final_urls",
    "ad_group_ad.policy_summary.approval_status",
    "ad_group_ad.policy_summary.review_status",
    "ad_group_ad.ad.responsive_search_ad.headlines",
    "ad_group_ad.ad.responsive_search_ad.descriptions",
  ],
  keywords: [
    "campaign.id",
    "campaign.name",
    "ad_group.id",
    "ad_group.name",
    "ad_group_criterion.criterion_id",
    "ad_group_criterion.keyword.text",
    "ad_group_criterion.keyword.match_type",
    "ad_group_criterion.status",
    "ad_group_criterion.negative",
    "ad_group_criterion.type",
  ],
  assets: [
    "asset.id",
    "asset.name",
    "asset.type",
    "asset.resource_name",
    "asset.text_asset.text",
    "asset.image_asset.full_size.url",
    "asset.youtube_video_asset.youtube_video_id",
    "asset.youtube_video_asset.youtube_video_title",
    "asset.callout_asset.callout_text",
    "asset.sitelink_asset.link_text",
    "asset.sitelink_asset.description1",
    "asset.sitelink_asset.description2",
    "asset.call_asset.phone_number",
    "asset.structured_snippet_asset.header",
  ],
  conversion_actions: [
    "conversion_action.id",
    "conversion_action.name",
    "conversion_action.category",
    "conversion_action.type",
    "conversion_action.status",
    "conversion_action.primary_for_goal",
    "conversion_action.counting_type",
    "conversion_action.include_in_conversions_metric",
  ],
  recommendations: [
    "recommendation.resource_name",
    "recommendation.type",
    "recommendation.campaign",
    "recommendation.ad_group",
    "recommendation.dismissed",
    "recommendation.impact.base_metrics.impressions",
    "recommendation.impact.base_metrics.clicks",
    "recommendation.impact.base_metrics.cost_micros",
    "recommendation.impact.potential_metrics.impressions",
    "recommendation.impact.potential_metrics.clicks",
    "recommendation.impact.potential_metrics.conversions",
    "campaign.id",
    "campaign.name",
  ],
});

const COMMON_RESOURCE = Object.freeze({
  account_summary: "customer",
  campaigns: "campaign",
  ad_groups: "ad_group",
  ads: "ad_group_ad",
  keywords: "ad_group_criterion",
  assets: "asset",
  conversion_actions: "conversion_action",
  recommendations: "recommendation",
});

const COMMON_TOOL_IDS = Object.freeze(Object.keys(COMMON_RESOURCE));

function catalogError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function escapeLike(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

function optionalId(params, name, label) {
  const raw = params?.[name];
  if (raw == null || String(raw).trim() === "") return "";
  const text = String(raw).trim();
  if (!/^\d{1,20}$/.test(text)) {
    throw catalogError(`${label} must be numeric.`, "GOOGLE_ADS_FILTER");
  }
  return text;
}

function optionalEnum(params, name, allowed, label) {
  const raw = params?.[name];
  if (raw == null || String(raw).trim() === "") return "";
  const picked = String(raw).trim().toUpperCase();
  if (!allowed.includes(picked)) {
    throw catalogError(
      `${label} must be one of ${allowed.join(", ")}.`,
      "GOOGLE_ADS_FILTER"
    );
  }
  return picked;
}

function optionalText(params, name, label) {
  const raw = params?.[name];
  if (raw == null || String(raw).trim() === "") return "";
  const text = String(raw).trim();
  if (text.length > 200) {
    throw catalogError(`${label} is too long.`, "GOOGLE_ADS_FILTER");
  }
  if (/[\r\n]/.test(text)) {
    throw catalogError(`${label} must be a single line.`, "GOOGLE_ADS_FILTER");
  }
  return text;
}

function compileQuery(resource, select, where, orderBy) {
  let query = `SELECT ${select.join(", ")} FROM ${resource}`;
  if (where.length) query += ` WHERE ${where.join(" AND ")}`;
  if (orderBy) query += ` ORDER BY ${orderBy}`;
  return query;
}

function buildCommonToolQuery(toolId, params = {}) {
  const resource = COMMON_RESOURCE[toolId];
  if (!resource) {
    throw catalogError(`Unknown Google Ads MCP tool "${toolId}".`, "MCP_UNKNOWN_TOOL");
  }
  const select = COMMON_SELECT[toolId];
  const where = [];
  let orderBy = "";

  if (toolId === "campaigns") {
    const campaignId = optionalId(params, "campaignId", "Campaign ID");
    const status = optionalEnum(params, "status", ENTITY_STATUS, "Status");
    if (campaignId) where.push(`campaign.id = ${campaignId}`);
    if (status) where.push(`campaign.status = ${status}`);
    orderBy = "campaign.id";
  } else if (toolId === "ad_groups") {
    const campaignId = optionalId(params, "campaignId", "Campaign ID");
    const adGroupId = optionalId(params, "adGroupId", "Ad group ID");
    const status = optionalEnum(params, "status", ENTITY_STATUS, "Status");
    if (campaignId) where.push(`campaign.id = ${campaignId}`);
    if (adGroupId) where.push(`ad_group.id = ${adGroupId}`);
    if (status) where.push(`ad_group.status = ${status}`);
    orderBy = "ad_group.id";
  } else if (toolId === "ads") {
    const campaignId = optionalId(params, "campaignId", "Campaign ID");
    const adGroupId = optionalId(params, "adGroupId", "Ad group ID");
    const adId = optionalId(params, "adId", "Ad ID");
    const status = optionalEnum(params, "status", ENTITY_STATUS, "Status");
    if (campaignId) where.push(`campaign.id = ${campaignId}`);
    if (adGroupId) where.push(`ad_group.id = ${adGroupId}`);
    if (adId) where.push(`ad_group_ad.ad.id = ${adId}`);
    if (status) where.push(`ad_group_ad.status = ${status}`);
    orderBy = "ad_group_ad.ad.id";
  } else if (toolId === "keywords") {
    const campaignId = optionalId(params, "campaignId", "Campaign ID");
    const adGroupId = optionalId(params, "adGroupId", "Ad group ID");
    const text = optionalText(params, "textContains", "Keyword contains");
    const status = optionalEnum(params, "status", ENTITY_STATUS, "Status");
    where.push("ad_group_criterion.type = KEYWORD");
    if (campaignId) where.push(`campaign.id = ${campaignId}`);
    if (adGroupId) where.push(`ad_group.id = ${adGroupId}`);
    if (text) where.push(`ad_group_criterion.keyword.text LIKE '%${escapeLike(text)}%'`);
    if (status) where.push(`ad_group_criterion.status = ${status}`);
    orderBy = "ad_group_criterion.criterion_id";
  } else if (toolId === "assets") {
    const assetType = optionalEnum(params, "assetType", ASSET_TYPE, "Asset type");
    if (assetType) where.push(`asset.type = ${assetType}`);
    orderBy = "asset.id";
  } else if (toolId === "conversion_actions") {
    const category = optionalEnum(params, "category", CONVERSION_CATEGORY, "Category");
    const status = optionalEnum(params, "status", CONVERSION_STATUS, "Status");
    if (category) where.push(`conversion_action.category = ${category}`);
    if (status) where.push(`conversion_action.status = ${status}`);
    orderBy = "conversion_action.id";
  } else if (toolId === "recommendations") {
    const recommendationType = optionalEnum(
      params,
      "recommendationType",
      RECOMMENDATION_TYPE,
      "Recommendation type"
    );
    const campaignId = optionalId(params, "campaignId", "Campaign ID");
    where.push("recommendation.dismissed = FALSE");
    if (recommendationType) where.push(`recommendation.type = ${recommendationType}`);
    if (campaignId) where.push(`campaign.id = ${campaignId}`);
    orderBy = "recommendation.type";
  }

  return {
    resource,
    query: compileQuery(resource, select, where, orderBy),
  };
}

const statusEnum = (values) => ({
  type: "string",
  title: "Status",
  enum: values.slice(),
  description: "Optional status filter.",
});

function commonToolDefinitions(provider) {
  const base = {
    provider: provider.id,
    authType: provider.authType,
    access: "read",
    risk: "low",
    implemented: true,
    executor: "google_ads_mcp",
    uiGroup: "common",
  };
  return [
    {
      ...base,
      id: "account_summary",
      displayName: "Account Summary",
      description: "Account identity for the Google Ads customer on the source node.",
      category: "account",
      inputSchema: objectSchema({}),
      outputSchema: objectSchema({
        customer: { type: "object", description: "Customer resource returned by Google Ads." },
      }),
    },
    {
      ...base,
      id: "campaigns",
      displayName: "Campaigns",
      description: "Campaign attributes. One row per campaign. No performance metrics.",
      category: "campaign",
      inputSchema: objectSchema({
        campaignId: {
          type: "string",
          title: "Campaign ID",
          description: "Optional. Limits the result to this campaign.",
        },
        status: statusEnum(ENTITY_STATUS),
        limit: limitField,
        returnAll: returnAllField,
      }),
      outputSchema: objectSchema({
        campaign: { type: "object", description: "Campaign resource returned by Google Ads." },
      }),
    },
    {
      ...base,
      id: "ad_groups",
      displayName: "Ad Groups",
      description: "Ad group attributes. One row per ad group. No performance metrics.",
      category: "ad_group",
      inputSchema: objectSchema({
        campaignId: {
          type: "string",
          title: "Campaign ID",
          description: "Optional campaign filter.",
        },
        adGroupId: {
          type: "string",
          title: "Ad group ID",
          description: "Optional. Limits the result to this ad group.",
        },
        status: statusEnum(ENTITY_STATUS),
        limit: limitField,
        returnAll: returnAllField,
      }),
      outputSchema: objectSchema({
        ad_group: { type: "object", description: "Ad group resource returned by Google Ads." },
      }),
    },
    {
      ...base,
      id: "ads",
      displayName: "Ads",
      description:
        "Ad attributes from ad group ads. Fields that do not apply to an ad type are omitted by Google Ads.",
      category: "ad",
      inputSchema: objectSchema({
        campaignId: {
          type: "string",
          title: "Campaign ID",
          description: "Optional campaign filter.",
        },
        adGroupId: {
          type: "string",
          title: "Ad group ID",
          description: "Optional ad group filter.",
        },
        adId: {
          type: "string",
          title: "Ad ID",
          description: "Optional. Limits the result to this ad.",
        },
        status: statusEnum(ENTITY_STATUS),
        limit: limitField,
        returnAll: returnAllField,
      }),
      outputSchema: objectSchema({
        ad_group_ad: { type: "object", description: "Ad group ad resource returned by Google Ads." },
      }),
    },
    {
      ...base,
      id: "keywords",
      displayName: "Keywords",
      description: "Ad group keyword criteria, including negatives. No performance metrics.",
      category: "keyword",
      inputSchema: objectSchema({
        campaignId: {
          type: "string",
          title: "Campaign ID",
          description: "Optional campaign filter.",
        },
        adGroupId: {
          type: "string",
          title: "Ad group ID",
          description: "Optional ad group filter.",
        },
        textContains: {
          type: "string",
          title: "Keyword contains",
          description: "Optional text match against the keyword.",
        },
        status: statusEnum(ENTITY_STATUS),
        limit: limitField,
        returnAll: returnAllField,
      }),
      outputSchema: objectSchema({
        ad_group_criterion: { type: "object", description: "Keyword criterion returned by Google Ads." },
      }),
    },
    {
      ...base,
      id: "assets",
      displayName: "Assets",
      description: "Asset catalog. Type-specific fields stay nested. No asset performance.",
      category: "asset",
      inputSchema: objectSchema({
        assetType: {
          type: "string",
          title: "Asset type",
          enum: ASSET_TYPE.slice(),
          description: "Optional asset type filter.",
        },
        limit: limitField,
        returnAll: returnAllField,
      }),
      outputSchema: objectSchema({
        asset: { type: "object", description: "Asset resource returned by Google Ads." },
      }),
    },
    {
      ...base,
      id: "conversion_actions",
      displayName: "Conversion Actions",
      description: "Conversion action catalog. No conversion performance metrics.",
      category: "conversion",
      inputSchema: objectSchema({
        category: {
          type: "string",
          title: "Category",
          enum: CONVERSION_CATEGORY.slice(),
          description: "Optional conversion category filter.",
        },
        status: statusEnum(CONVERSION_STATUS),
        limit: limitField,
        returnAll: returnAllField,
      }),
      outputSchema: objectSchema({
        conversion_action: {
          type: "object",
          description: "Conversion action resource returned by Google Ads.",
        },
      }),
    },
    {
      ...base,
      id: "recommendations",
      displayName: "Recommendations",
      description: "Available Google Ads recommendations that have not been dismissed. Read only.",
      category: "recommendation",
      inputSchema: objectSchema({
        recommendationType: {
          type: "string",
          title: "Recommendation type",
          enum: RECOMMENDATION_TYPE.slice(),
          description: "Optional recommendation type filter.",
        },
        campaignId: {
          type: "string",
          title: "Campaign ID",
          description: "Optional campaign filter.",
        },
        limit: limitField,
        returnAll: returnAllField,
      }),
      outputSchema: objectSchema({
        recommendation: { type: "object", description: "Recommendation resource returned by Google Ads." },
      }),
    },
  ];
}

module.exports = {
  COMMON_TOOL_IDS,
  COMMON_RESOURCE,
  COMMON_SELECT,
  ENTITY_STATUS,
  buildCommonToolQuery,
  commonToolDefinitions,
};
