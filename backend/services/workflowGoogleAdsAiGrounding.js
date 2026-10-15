/**
 * Google Ads → AI grounding.
 * Applies only to Google Ads report rows. GA4 and GSC grounding stay on their own paths.
 */

const ADS_REPORT_TYPES = Object.freeze({
  campaign_performance: { title: "Campaign Performance", entity: "campaign" },
  ad_group_performance: { title: "Ad Group Performance", entity: "ad group" },
  keyword_performance: { title: "Keyword Performance", entity: "keyword" },
  search_terms: { title: "Search Terms", entity: "search term" },
  device_performance: { title: "Device Performance", entity: "device" },
  geographic_performance: { title: "Geographic Performance", entity: "geography" },
  conversion_performance: { title: "Conversion Performance", entity: "conversion" },
});

const itemPayload = (item) => {
  if (item && typeof item === "object" && !Array.isArray(item) && "json" in item) {
    return item.json;
  }
  return item;
};

const isPlainObject = (value) =>
  value != null && typeof value === "object" && !Array.isArray(value);

const collectRows = (input) => {
  if (input == null) return [];
  if (Array.isArray(input)) return input.map(itemPayload).filter(isPlainObject);
  const payload = itemPayload(input);
  if (Array.isArray(payload)) return payload.map(itemPayload).filter(isPlainObject);
  if (isPlainObject(payload)) {
    if (Array.isArray(payload.items)) return payload.items.map(itemPayload).filter(isPlainObject);
    if (Array.isArray(payload.rows)) return payload.rows.map(itemPayload).filter(isPlainObject);
    if (Array.isArray(payload.opportunities)) {
      return payload.opportunities.map(itemPayload).filter(isPlainObject);
    }
    return [payload];
  }
  return [];
};

const looksLikeGoogleAdsRow = (row) => {
  if (!isPlainObject(row)) return false;
  if (row._meta && row._meta.provider && row._meta.provider !== "google_ads") {
    return false;
  }
  if (row._meta && row._meta.provider === "google_ads") return true;
  if (row.source === "google_ads" || row.provider === "google_ads") return true;
  if (Object.prototype.hasOwnProperty.call(ADS_REPORT_TYPES, String(row.reportType || ""))) {
    return true;
  }
  if (row.costMicros != null || row.averageCpcMicros != null || row.averageCpc != null) {
    return true;
  }
  if (row.keywordText != null || row.searchTerm != null) return true;
  if (
    row.campaignId != null &&
    (row.impressions != null || row.clicks != null || row.ctr != null || row.cost != null)
  ) {
    return true;
  }
  return false;
};

const looksLikeGoogleAdsRows = (rows) =>
  Array.isArray(rows) && rows.length > 0 && rows.every(looksLikeGoogleAdsRow);

const MCP_SEARCH_LABELS = Object.freeze({
  campaign: { title: "Campaign", entity: "campaign" },
  ad_group: { title: "Ad Group", entity: "ad group" },
  keyword: { title: "Keyword", entity: "keyword" },
  search_term: { title: "Search Term", entity: "search term" },
  device: { title: "Device", entity: "device" },
  geographic: { title: "Geographic", entity: "geographic" },
  conversion: { title: "Conversion", entity: "conversion" },
});

const MCP_ENTITY_LABELS = Object.freeze({
  account_summary: { title: "Google Ads Account Data", entity: "account", resource: "customer" },
  campaigns: { title: "Google Ads Campaign Data", entity: "campaign", resource: "campaign" },
  ad_groups: { title: "Google Ads Ad Group Data", entity: "ad group", resource: "ad_group" },
  ads: { title: "Google Ads Ad Data", entity: "ad", resource: "ad_group_ad" },
  keywords: { title: "Google Ads Keyword Data", entity: "keyword", resource: "ad_group_criterion" },
  assets: { title: "Google Ads Asset Data", entity: "asset", resource: "asset" },
  conversion_actions: {
    title: "Google Ads Conversion Action Data",
    entity: "conversion action",
    resource: "conversion_action",
  },
  recommendations: {
    title: "Google Ads Recommendations",
    entity: "recommendation",
    resource: "recommendation",
  },
});

const MCP_PERFORMANCE_LABELS = Object.freeze({
  campaign_performance: {
    title: "Google Ads Campaign Performance",
    entity: "campaign",
    resource: "campaign",
  },
  ad_group_performance: {
    title: "Google Ads Ad Group Performance",
    entity: "ad group",
    resource: "ad_group",
  },
  ad_performance: {
    title: "Google Ads Ad Performance",
    entity: "ad",
    resource: "ad_group_ad",
  },
  keyword_performance: {
    title: "Google Ads Keyword Performance",
    entity: "keyword",
    resource: "keyword_view",
  },
  search_terms: {
    title: "Google Ads Search Term Performance",
    entity: "search term",
    resource: "search_term_view",
  },
  device_performance: {
    title: "Google Ads Device Performance",
    entity: "device",
    resource: "campaign",
  },
  geographic_performance: {
    title: "Google Ads Geographic Performance",
    entity: "geography",
    resource: "geographic_view",
  },
  placement_performance: {
    title: "Google Ads Placement Performance",
    entity: "placement",
    resource: "group_placement_view",
  },
  conversion_performance: {
    title: "Google Ads Conversion Performance",
    entity: "conversion",
    resource: "campaign",
  },
  asset_performance: {
    title: "Google Ads Asset Performance",
    entity: "asset",
    resource: "asset",
  },
});

const isMcpSearchRow = (row) =>
  row?._meta?.provider === "google_ads" && row?._meta?.tool === "search";

const isMcpEntityRow = (row) =>
  row?._meta?.provider === "google_ads" &&
  Object.prototype.hasOwnProperty.call(MCP_ENTITY_LABELS, String(row?._meta?.tool || ""));

const isMcpPerformanceRow = (row) =>
  row?._meta?.provider === "google_ads" &&
  Object.prototype.hasOwnProperty.call(MCP_PERFORMANCE_LABELS, String(row?._meta?.tool || ""));

const isMcpChangeRow = (row) =>
  row?._meta?.provider === "google_ads" && row?._meta?.tool === "change_history";

const mcpSearchMeta = (row) => {
  const resource = String(row?._meta?.resource || "").trim();
  const key = resource.toLowerCase();
  if (!key || key === "search" || !/^[a-z][a-z0-9_]*$/.test(key)) {
    return {
      title: "Google Ads Search Results",
      entity: "search",
      resource: resource || "search",
    };
  }
  const known = MCP_SEARCH_LABELS[key];
  if (known) return { ...known, resource };
  const words = resource.split("_").filter(Boolean);
  const label = words.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  return {
    title: `Google Ads ${label} Data`,
    entity: words.join(" ").toLowerCase(),
    resource,
  };
};

const listActualFieldPaths = (value, prefix = "", out = []) => {
  if (!isPlainObject(value)) return out;
  for (const [key, child] of Object.entries(value)) {
    if (!prefix && key === "_meta") continue;
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(child)) {
      listActualFieldPaths(child, fieldPath, out);
      continue;
    }
    if (Array.isArray(child) || show(child) != null) out.push(fieldPath);
  }
  return out;
};

const valueAtPath = (row, fieldPath) =>
  fieldPath.split(".").reduce((current, key) => (current == null ? undefined : current[key]), row);

const reportMeta = (row) => {
  if (isMcpSearchRow(row)) return mcpSearchMeta(row);
  if (isMcpEntityRow(row)) return MCP_ENTITY_LABELS[row._meta.tool];
  if (isMcpChangeRow(row)) {
    return {
      title: "Google Ads Change History",
      entity: "change",
      resource: "change_event",
    };
  }
  if (isMcpPerformanceRow(row)) {
    const label = MCP_PERFORMANCE_LABELS[row._meta.tool];
    if (row._meta.tool === "asset_performance") {
      const resource = String(row._meta.resource || "").trim();
      return { ...label, resource: resource || label.resource };
    }
    return label;
  }
  const known = ADS_REPORT_TYPES[String(row?._meta?.report || row?.reportType || "")];
  if (known) return known;
  const resource = String(row?._meta?.resource || "");
  if (resource === "ad_group") return ADS_REPORT_TYPES.ad_group_performance;
  if (resource === "keyword") return ADS_REPORT_TYPES.keyword_performance;
  if (resource === "search_term") return ADS_REPORT_TYPES.search_terms;
  if (resource === "device") return ADS_REPORT_TYPES.device_performance;
  if (resource === "geographic") return ADS_REPORT_TYPES.geographic_performance;
  if (resource === "conversion") return ADS_REPORT_TYPES.conversion_performance;
  if (resource === "campaign") return ADS_REPORT_TYPES.campaign_performance;
  if (row?.searchTerm != null) return ADS_REPORT_TYPES.search_terms;
  if (row?.keywordText != null) return ADS_REPORT_TYPES.keyword_performance;
  if (row?.device != null) return ADS_REPORT_TYPES.device_performance;
  if (row?.countryCriterionId != null || row?.locationType != null) {
    return ADS_REPORT_TYPES.geographic_performance;
  }
  if (row?.conversionActionName != null && row?.impressions == null) {
    return ADS_REPORT_TYPES.conversion_performance;
  }
  if (row?.adGroupName != null || row?.adGroupId != null) {
    return ADS_REPORT_TYPES.ad_group_performance;
  }
  return ADS_REPORT_TYPES.campaign_performance;
};

const show = (value) => {
  if (value == null || value === "") return null;
  if (typeof value === "object") return null;
  return String(value);
};

const headingFor = (row, entity) => {
  if (entity === "keyword") return show(row.keywordText) || show(row.campaignName) || "Keyword";
  if (entity === "search term") return show(row.searchTerm) || "Search term";
  if (entity === "ad group") return show(row.adGroupName) || show(row.campaignName) || "Ad group";
  if (entity === "device") return show(row.device) || "Device";
  if (entity === "geography") return show(row.countryCriterionId) || "Location";
  if (entity === "conversion") return show(row.conversionActionName) || "Conversion";
  return show(row.campaignName) || "Campaign";
};

const FIELD_LINES = [
  ["campaignId", "Campaign ID"],
  ["campaignName", "Campaign"],
  ["campaignStatus", "Status"],
  ["adGroupId", "Ad group ID"],
  ["adGroupName", "Ad group"],
  ["adGroupStatus", "Ad group status"],
  ["keywordText", "Keyword"],
  ["keywordMatchType", "Match type"],
  ["keywordStatus", "Keyword status"],
  ["searchTerm", "Search term"],
  ["device", "Device"],
  ["countryCriterionId", "Country criterion ID"],
  ["locationType", "Location type"],
  ["conversionActionName", "Conversion action"],
  ["conversionActionCategory", "Conversion category"],
  ["impressions", "Impressions"],
  ["clicks", "Clicks"],
  ["ctr", "CTR"],
  ["costMicros", "Cost micros"],
  ["cost", "Cost"],
  ["averageCpcMicros", "Average CPC micros"],
  ["averageCpc", "Average CPC"],
  ["conversions", "Conversions"],
  ["conversionsValue", "Conversion value"],
  ["allConversions", "All conversions"],
  ["allConversionsValue", "All conversions value"],
  ["date", "Date"],
  ["currencyCode", "Currency"],
];

const formatActualFieldReport = (list) => {
  const meta = reportMeta(list[0]);
  const lines = ["Google Ads Report", "", meta.title, ""];
  list.forEach((row, index) => {
    const rowMeta = reportMeta(row);
    lines.push(`${index + 1}. ${rowMeta.title}`);
    for (const fieldPath of listActualFieldPaths(row)) {
      const value = valueAtPath(row, fieldPath);
      if (Array.isArray(value)) {
        lines.push(`   - ${fieldPath}: ${JSON.stringify(value)}`);
        continue;
      }
      const shown = show(value);
      if (shown != null) lines.push(`   - ${fieldPath}: ${shown}`);
    }
    lines.push("");
  });
  return lines.join("\n").trimEnd();
};

const formatGoogleAdsReport = (rows) => {
  const list = collectRows(rows);
  if (!looksLikeGoogleAdsRows(list)) return null;
  if (
    isMcpSearchRow(list[0]) ||
    isMcpEntityRow(list[0]) ||
    isMcpChangeRow(list[0]) ||
    isMcpPerformanceRow(list[0])
  ) {
    return formatActualFieldReport(list);
  }
  const meta = reportMeta(list[0]);
  const lines = ["Google Ads Report", "", meta.title, ""];
  list.forEach((row, index) => {
    const entity = reportMeta(row).entity;
    const label =
      entity === "campaign"
        ? "Campaign"
        : entity === "ad group"
          ? "Ad group"
          : entity === "keyword"
            ? "Keyword"
            : entity === "search term"
              ? "Search term"
              : entity === "device"
                ? "Device"
                : entity === "geography"
                  ? "Geography"
                  : "Conversion";
    lines.push(`${index + 1}. ${label}: ${headingFor(row, entity)}`);
    for (const [key, name] of FIELD_LINES) {
      if (key === "campaignName" && entity === "campaign") continue;
      if (key === "keywordText" && entity === "keyword") continue;
      if (key === "searchTerm" && entity === "search term") continue;
      if (key === "adGroupName" && entity === "ad group") continue;
      if (key === "device" && entity === "device") continue;
      const value = show(row[key]);
      if (value == null) continue;
      lines.push(`   - ${name}: ${value}`);
    }
    lines.push("");
  });
  return lines.join("\n").trimEnd();
};

const applyGoogleAdsAiGrounding = ({
  systemPrompt = "",
  userPrompt = "",
  input,
} = {}) => {
  const rows = collectRows(input);
  if (!looksLikeGoogleAdsRows(rows)) {
    return {
      grounded: false,
      groundingApplied: false,
      source: null,
      systemPrompt,
      userPrompt,
      userInstructions: String(systemPrompt || "").trim() || null,
    };
  }
  const meta = reportMeta(rows[0]);
  if (
    isMcpSearchRow(rows[0]) ||
    isMcpEntityRow(rows[0]) ||
    isMcpChangeRow(rows[0]) ||
    isMcpPerformanceRow(rows[0])
  ) {
    const fields = [...new Set(rows.flatMap((row) => listActualFieldPaths(row)))];
    const kind = isMcpSearchRow(rows[0])
      ? "search results"
      : isMcpChangeRow(rows[0])
        ? "account change records"
        : isMcpPerformanceRow(rows[0])
          ? "performance records"
          : "entity records";
    const rules = [
      "Google Ads evidence rules:",
      "source: google_ads",
      "provider: google_ads",
      `tool: ${rows[0]._meta.tool}`,
      `resource: ${meta.resource}`,
      `report: ${meta.title}`,
      `entity: ${meta.entity}`,
      "",
      `These rows are Google Ads ${kind}.`,
      `Describe them as ${meta.title}.`,
      "Use only fields present on the rows.",
      "Nested Google Ads values stay nested.",
      "Do not flatten these rows into the native Google Ads report schema.",
      "If a field is absent, omit it.",
      "Do not invent fields.",
      "Do not recalculate values that are present. Copy them from the rows.",
      ...(isMcpChangeRow(rows[0])
        ? [
            "These rows are account change history.",
            "Do not interpret a change event as performance data.",
            "When old and new resource values are present, keep them distinct.",
            "Do not invent a field-by-field diff when old or new resource data is absent.",
            "Do not claim a change caused a later metric movement.",
          ]
        : []),
      ...(isMcpPerformanceRow(rows[0]) && rows[0]._meta.tool === "asset_performance"
        ? [
            "Use the asset resource and fields on the rows.",
            "Do not invent creative text.",
          ]
        : isMcpPerformanceRow(rows[0])
          ? [
              "Do not rename a search term to a keyword.",
              "Do not describe geographic fields as page paths.",
            ]
          : []),
      "",
      `Available fields: ${fields.join(", ")}`,
    ].join("\n");
    const userInstructions = String(systemPrompt || "").trim() || null;
    const groundedSystem = [userInstructions, rules].filter(Boolean).join("\n\n");
    return {
      grounded: true,
      groundingApplied: true,
      source: "google_ads",
      provider: "google_ads",
      systemPrompt: groundedSystem,
      userPrompt: String(userPrompt || ""),
      userInstructions,
      reportType: rows[0]._meta?.report || rows[0].reportType || null,
      entity: meta.entity,
    };
  }
  const fields = [
    ...new Set(rows.flatMap((row) => Object.keys(row).filter((key) => show(row[key]) != null))),
  ];
  const rules = [
    "Google Ads evidence rules:",
    "source: google_ads",
    "provider: google_ads",
    `report: ${meta.title}`,
    `entity: ${meta.entity}`,
    "",
    "These rows are Google Ads report rows. Describe them as Google Ads data.",
    "Do not call this a GA4 Intelligence Report.",
    "Do not use landing_underperformance, landing pages, engagement rate, bounce rate,",
    "GA4 capability sections, GA4 MCP scores, or GA4 opportunity ranking.",
    "If a field is absent, omit it. Do not invent Landing Page: (unknown).",
    "Do not rename campaignName to landingPage.",
    "Never invent landingPage.",
    "Never invent sessions.",
    "Never invent engagementRate.",
    "Never invent bounceRate.",
    "Campaign rows use campaign vocabulary.",
    "Do not recalculate impressions, clicks, CTR, cost, CPC, conversions, or conversion value.",
    "Copy those values from the rows.",
    "",
    `Available fields: ${fields.join(", ")}`,
  ].join("\n");
  const userInstructions = String(systemPrompt || "").trim() || null;
  const groundedSystem = [userInstructions, rules].filter(Boolean).join("\n\n");
  return {
    grounded: true,
    groundingApplied: true,
    source: "google_ads",
    provider: "google_ads",
    systemPrompt: groundedSystem,
    userPrompt: String(userPrompt || ""),
    userInstructions,
    reportType: rows[0]._meta?.report || rows[0].reportType || null,
    entity: meta.entity,
  };
};

module.exports = {
  ADS_REPORT_TYPES,
  looksLikeGoogleAdsRow,
  looksLikeGoogleAdsRows,
  collectRows,
  formatGoogleAdsReport,
  applyGoogleAdsAiGrounding,
};
