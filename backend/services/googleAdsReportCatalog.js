/**
 * Shared Google Ads report definitions.
 * Native googleAds and Google Ads MCP performance tools both compile GAQL
 * from these objects. Native output shaping stays in workflowGoogleAds.service.js.
 */
const ADS_ROW_MAX = 10000;

const STATUS_ENUM = Object.freeze(["ENABLED", "PAUSED", "REMOVED"]);
const DEVICE_ENUM = Object.freeze(["MOBILE", "TABLET", "DESKTOP", "CONNECTED_TV", "OTHER"]);
const CONVERSION_ACTION_CATEGORY = Object.freeze([
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

/** Reports that exist only on Google Ads MCP. Native REPORTS stays the original seven. */
const MCP_ONLY_REPORTS = Object.freeze({
  ad_performance: {
    label: "Ad Performance",
    from: "ad_group_ad",
    select: [
      ...CUSTOMER_FIELDS,
      "campaign.id",
      "campaign.name",
      "ad_group.id",
      "ad_group.name",
      "ad_group_ad.ad.id",
      "ad_group_ad.status",
      "ad_group_ad.ad.type",
      "segments.date",
      ...TRAFFIC_METRICS,
    ],
    orderBy: "metrics.impressions DESC",
    traffic: true,
  },
  placement_performance: {
    label: "Placement Performance",
    from: "group_placement_view",
    select: [
      ...CUSTOMER_FIELDS,
      "campaign.id",
      "campaign.name",
      "ad_group.id",
      "ad_group.name",
      "group_placement_view.placement",
      "group_placement_view.display_name",
      "group_placement_view.placement_type",
      "group_placement_view.target_url",
      "segments.date",
      ...TRAFFIC_METRICS,
    ],
    orderBy: "metrics.impressions DESC",
    traffic: true,
  },
});

const PERFORMANCE_REPORTS = Object.freeze({
  ...REPORTS,
  ...MCP_ONLY_REPORTS,
});

const withReports = (spec, extra) =>
  Object.freeze({
    ...spec,
    reports: Object.freeze([...spec.reports, ...extra]),
  });

const PERFORMANCE_FILTER_DEFS = Object.freeze({
  ...FILTER_DEFS,
  campaignId: withReports(FILTER_DEFS.campaignId, ["ad_performance", "placement_performance"]),
  adGroupId: withReports(FILTER_DEFS.adGroupId, ["ad_performance", "placement_performance"]),
  adId: Object.freeze({
    reports: Object.freeze(["ad_performance"]),
    field: "ad_group_ad.ad.id",
    kind: "id",
  }),
  adStatus: Object.freeze({
    reports: Object.freeze(["ad_performance"]),
    field: "ad_group_ad.status",
    kind: "enum",
    values: STATUS_ENUM,
  }),
  placementContains: Object.freeze({
    reports: Object.freeze(["placement_performance"]),
    field: "group_placement_view.display_name",
    kind: "contains",
  }),
  conversionActionName: Object.freeze({
    reports: Object.freeze(["conversion_performance"]),
    field: "segments.conversion_action_name",
    kind: "exact",
  }),
  conversionActionCategory: Object.freeze({
    reports: Object.freeze(["conversion_performance"]),
    field: "segments.conversion_action_category",
    kind: "enum",
    values: CONVERSION_ACTION_CATEGORY,
  }),
});

const adsError = (message, code) => {
  const err = new Error(message);
  err.code = code;
  err.statusCode = 400;
  return err;
};

const escapeLike = (value) =>
  String(value)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");

const escapeGaqlString = (value) =>
  String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

const filterClause = (filterDefs, reportType, key, raw) => {
  const spec = filterDefs[key];
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
  if (spec.kind === "exact") {
    return `${spec.field} = '${escapeGaqlString(value)}'`;
  }
  return `${spec.field} LIKE '%${escapeLike(value)}%'`;
};

const compileReportQuery = ({
  reports,
  filterDefs,
  reportType,
  startDate,
  endDate,
  filters = {},
  limit,
}) => {
  const report = reports[reportType];
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
    const spec = filterDefs[key];
    if (!spec) {
      throw adsError(`Unknown filter ${key}.`, "GOOGLE_ADS_FILTER");
    }
    if (!spec.reports.includes(reportType)) continue;
    const clause = filterClause(filterDefs, reportType, key, raw);
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

const buildReportQuery = (args) =>
  compileReportQuery({
    reports: REPORTS,
    filterDefs: FILTER_DEFS,
    ...args,
  });

const buildPerformanceReportQuery = (args) =>
  compileReportQuery({
    reports: PERFORMANCE_REPORTS,
    filterDefs: PERFORMANCE_FILTER_DEFS,
    ...args,
  });

module.exports = {
  ADS_ROW_MAX,
  STATUS_ENUM,
  DEVICE_ENUM,
  CONVERSION_ACTION_CATEGORY,
  REPORTS,
  FILTER_DEFS,
  MCP_ONLY_REPORTS,
  PERFORMANCE_REPORTS,
  buildReportQuery,
  buildPerformanceReportQuery,
};
