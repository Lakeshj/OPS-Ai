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

const reportMeta = (row) => {
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

const formatGoogleAdsReport = (rows) => {
  const list = collectRows(rows);
  if (!looksLikeGoogleAdsRows(list)) return null;
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
