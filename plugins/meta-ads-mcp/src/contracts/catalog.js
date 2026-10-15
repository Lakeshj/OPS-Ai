/**
 * Meta Ads MCP Common (M5) entity-read contracts.
 * Fields are conservative Graph v26.0 entity attributes — not Insights metrics.
 */

const objectSchema = (properties, required = []) => ({
  type: "object",
  properties,
  required,
});

const DEFAULT_LIMIT = 100;
const PAGE_SIZE = 100;
const MAX_ROWS = 2000;
const MAX_PAGES = 20;

const INSIGHTS_METRIC_FIELDS = Object.freeze([
  "impressions",
  "reach",
  "clicks",
  "ctr",
  "cpc",
  "cpm",
  "spend",
  "actions",
  "action_values",
  "cost_per_action_type",
  "frequency",
  "inline_link_clicks",
]);

const EFFECTIVE_STATUS = Object.freeze({
  campaign: Object.freeze([
    "ACTIVE",
    "PAUSED",
    "DELETED",
    "ARCHIVED",
    "IN_PROCESS",
    "WITH_ISSUES",
  ]),
  adset: Object.freeze([
    "ACTIVE",
    "PAUSED",
    "DELETED",
    "CAMPAIGN_PAUSED",
    "ARCHIVED",
    "IN_PROCESS",
    "WITH_ISSUES",
  ]),
  ad: Object.freeze([
    "ACTIVE",
    "PAUSED",
    "DELETED",
    "PENDING_REVIEW",
    "DISAPPROVED",
    "PREAPPROVED",
    "PENDING_BILLING_INFO",
    "CAMPAIGN_PAUSED",
    "ARCHIVED",
    "ADSET_PAUSED",
    "IN_PROCESS",
    "WITH_ISSUES",
  ]),
});

const COMMON_FIELDS = Object.freeze({
  account_summary: Object.freeze([
    "id",
    "account_id",
    "name",
    "account_status",
    "currency",
    "timezone_name",
  ]),
  campaigns: Object.freeze([
    "id",
    "name",
    "status",
    "effective_status",
    "objective",
    "buying_type",
    "start_time",
    "stop_time",
    "created_time",
    "updated_time",
  ]),
  ad_sets: Object.freeze([
    "id",
    "name",
    "campaign_id",
    "status",
    "effective_status",
    "start_time",
    "end_time",
    "created_time",
    "updated_time",
    "optimization_goal",
    "billing_event",
    "bid_strategy",
    "daily_budget",
    "lifetime_budget",
  ]),
  ads: Object.freeze([
    "id",
    "name",
    "campaign_id",
    "adset_id",
    "status",
    "effective_status",
    "creative",
    "created_time",
    "updated_time",
  ]),
  creatives: Object.freeze([
    "id",
    "name",
    "title",
    "body",
    "thumbnail_url",
    "object_story_spec",
    "status",
  ]),
});

const COMMON_RESOURCE = Object.freeze({
  account_summary: "ad_account",
  campaigns: "campaign",
  ad_sets: "adset",
  ads: "ad",
  creatives: "ad_creative",
});

const COMMON_EDGE = Object.freeze({
  account_summary: "",
  campaigns: "campaigns",
  ad_sets: "adsets",
  ads: "ads",
  creatives: "adcreatives",
});

const COMMON_TOOL_IDS = Object.freeze(Object.keys(COMMON_RESOURCE));

const ID_RE = /^\d{1,20}$/;

function catalogError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function optionalId(params, name) {
  const raw = params?.[name];
  if (raw == null || String(raw).trim() === "") return "";
  const text = String(raw).trim();
  if (!ID_RE.test(text)) {
    throw catalogError("Invalid entity ID", "META_FILTER_INVALID");
  }
  return text;
}

function optionalEnum(params, name, allowed) {
  const raw = params?.[name];
  if (raw == null || String(raw).trim() === "") return "";
  const picked = String(raw).trim().toUpperCase();
  if (!allowed.includes(picked)) {
    throw catalogError("Invalid status/filter", "META_FILTER_INVALID");
  }
  return picked;
}

function rowLimit(params = {}) {
  const returnAll = params.returnAll === true || params.returnAll === "true";
  if (returnAll) return MAX_ROWS;
  const n = Number(params.limit);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_ROWS);
}

function fieldsCsv(toolId) {
  return COMMON_FIELDS[toolId].join(",");
}

/**
 * Build Graph GET query for an account entity edge.
 * IDs use allowlisted filtering. effective_status uses the documented edge param.
 * Never accepts arbitrary filter JSON from the caller.
 */
function buildEntityQuery(toolId, params = {}, { pageSize = PAGE_SIZE, after = "" } = {}) {
  if (!COMMON_RESOURCE[toolId] || toolId === "account_summary") {
    throw catalogError(`Unknown Meta Ads MCP tool "${toolId}".`, "MCP_UNKNOWN_TOOL");
  }
  const query = {
    fields: fieldsCsv(toolId),
    limit: Math.min(Math.max(Number(pageSize) || PAGE_SIZE, 1), PAGE_SIZE),
  };
  if (after) query.after = String(after);

  const filtering = [];
  if (toolId === "campaigns") {
    const campaignId = optionalId(params, "campaignId");
    const status = optionalEnum(params, "effectiveStatus", EFFECTIVE_STATUS.campaign);
    if (campaignId) {
      filtering.push({ field: "id", operator: "EQUAL", value: campaignId });
    }
    if (status) query.effective_status = JSON.stringify([status]);
  } else if (toolId === "ad_sets") {
    const campaignId = optionalId(params, "campaignId");
    const adSetId = optionalId(params, "adSetId");
    const status = optionalEnum(params, "effectiveStatus", EFFECTIVE_STATUS.adset);
    if (campaignId) query.campaign_id = campaignId;
    if (adSetId) {
      filtering.push({ field: "id", operator: "EQUAL", value: adSetId });
    }
    if (status) query.effective_status = JSON.stringify([status]);
  } else if (toolId === "ads") {
    const campaignId = optionalId(params, "campaignId");
    const adSetId = optionalId(params, "adSetId");
    const adId = optionalId(params, "adId");
    const status = optionalEnum(params, "effectiveStatus", EFFECTIVE_STATUS.ad);
    if (campaignId) {
      filtering.push({ field: "campaign.id", operator: "EQUAL", value: campaignId });
    }
    if (adSetId) {
      filtering.push({ field: "adset.id", operator: "EQUAL", value: adSetId });
    }
    if (adId) {
      filtering.push({ field: "id", operator: "EQUAL", value: adId });
    }
    if (status) query.effective_status = JSON.stringify([status]);
  } else if (toolId === "creatives") {
    const creativeId = optionalId(params, "creativeId");
    if (creativeId) {
      filtering.push({ field: "id", operator: "EQUAL", value: creativeId });
    }
  }

  if (filtering.length) query.filtering = JSON.stringify(filtering);
  return query;
}

function assertNoInsightsFields(toolId) {
  const fields = COMMON_FIELDS[toolId] || [];
  for (const field of fields) {
    if (INSIGHTS_METRIC_FIELDS.includes(field)) {
      throw catalogError(`Insights metric ${field} is not allowed on Common tools.`, "META_FIELD_UNSUPPORTED");
    }
  }
}

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

const statusEnum = (values) => ({
  type: "string",
  title: "Effective status",
  enum: values.slice(),
  description: "Optional effective status filter.",
});

function commonToolDefinitions(provider) {
  const base = {
    provider: provider.id,
    authType: provider.authType,
    access: "read",
    risk: "low",
    implemented: true,
    executor: "meta_ads_mcp",
    uiGroup: "common",
  };
  return [
    {
      ...base,
      id: "account_summary",
      displayName: "Account Summary",
      description:
        "Configuration details for the Meta Ads account on the source node. Not a performance report.",
      category: "account",
      inputSchema: objectSchema({}),
      outputSchema: objectSchema({
        id: { type: "string" },
        account_id: { type: "string" },
        name: { type: "string" },
        account_status: { type: "integer" },
        currency: { type: "string" },
        timezone_name: { type: "string" },
      }),
    },
    {
      ...base,
      id: "campaigns",
      displayName: "Campaigns",
      description: "Campaign configuration. One row per campaign. No Insights metrics.",
      category: "campaign",
      inputSchema: objectSchema({
        campaignId: campaignIdField,
        effectiveStatus: statusEnum(EFFECTIVE_STATUS.campaign),
        limit: limitField,
        returnAll: returnAllField,
      }),
      outputSchema: objectSchema({
        id: { type: "string" },
        name: { type: "string" },
        status: { type: "string" },
        effective_status: { type: "string" },
      }),
    },
    {
      ...base,
      id: "ad_sets",
      displayName: "Ad Sets",
      description: "Ad set configuration. One row per ad set. No Insights metrics.",
      category: "adset",
      inputSchema: objectSchema({
        campaignId: campaignIdField,
        adSetId: adSetIdField,
        effectiveStatus: statusEnum(EFFECTIVE_STATUS.adset),
        limit: limitField,
        returnAll: returnAllField,
      }),
      outputSchema: objectSchema({
        id: { type: "string" },
        name: { type: "string" },
        campaign_id: { type: "string" },
      }),
    },
    {
      ...base,
      id: "ads",
      displayName: "Ads",
      description: "Ad configuration. One row per ad. Creative stays a nested Graph object.",
      category: "ad",
      inputSchema: objectSchema({
        campaignId: campaignIdField,
        adSetId: adSetIdField,
        adId: {
          type: "string",
          title: "Ad ID",
          description: "Optional. Numeric Meta ad id.",
        },
        effectiveStatus: statusEnum(EFFECTIVE_STATUS.ad),
        limit: limitField,
        returnAll: returnAllField,
      }),
      outputSchema: objectSchema({
        id: { type: "string" },
        name: { type: "string" },
        creative: { type: "object" },
      }),
    },
    {
      ...base,
      id: "creatives",
      displayName: "Creatives",
      description:
        "Ad creatives on the inherited Meta Ads account. Nested specs stay structured objects.",
      category: "ad_creative",
      inputSchema: objectSchema({
        creativeId: {
          type: "string",
          title: "Creative ID",
          description: "Optional. Numeric Meta creative id.",
        },
        limit: limitField,
        returnAll: returnAllField,
      }),
      outputSchema: objectSchema({
        id: { type: "string" },
        name: { type: "string" },
        object_story_spec: { type: "object" },
      }),
    },
  ];
}

module.exports = {
  DEFAULT_LIMIT,
  PAGE_SIZE,
  MAX_ROWS,
  MAX_PAGES,
  INSIGHTS_METRIC_FIELDS,
  EFFECTIVE_STATUS,
  COMMON_FIELDS,
  COMMON_RESOURCE,
  COMMON_EDGE,
  COMMON_TOOL_IDS,
  optionalId,
  optionalEnum,
  rowLimit,
  fieldsCsv,
  buildEntityQuery,
  assertNoInsightsFields,
  commonToolDefinitions,
  objectSchema,
};
