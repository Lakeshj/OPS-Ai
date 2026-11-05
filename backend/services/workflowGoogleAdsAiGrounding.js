/**
 * Google Ads → AI grounding.
 * Applies only to Google Ads report rows. GA4 and GSC grounding stay on their own paths.
 *
 * Native campaign_performance (and other traffic reports) are daily because GAQL
 * selects segments.date. Canonical WorkflowItems stay daily. AI evidence may
 * period-aggregate to one row per entity with SUM spend/clicks/impressions and
 * recomputed CTR/CPC — never averages of daily ratios.
 */

const { majorUnits, asNumber } = require("./workflowGoogleAds.service");

const ADS_REPORT_TYPES = Object.freeze({
  campaign_performance: { title: "Campaign Performance", entity: "campaign" },
  ad_group_performance: { title: "Ad Group Performance", entity: "ad group" },
  keyword_performance: { title: "Keyword Performance", entity: "keyword" },
  search_terms: { title: "Search Terms", entity: "search term" },
  device_performance: { title: "Device Performance", entity: "device" },
  geographic_performance: { title: "Geographic Performance", entity: "geography" },
  conversion_performance: { title: "Conversion Performance", entity: "conversion" },
});

const PERIOD_AGGREGATE_REPORTS = Object.freeze(
  new Set([
    "campaign_performance",
    "ad_group_performance",
    "keyword_performance",
    "search_terms",
    "device_performance",
    "geographic_performance",
    "ad_performance",
    "placement_performance",
    "asset_performance",
  ])
);

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

/** Currency cost from flattened native row (prefers cost, else costMicros/1e6). */
const rowCurrencyCost = (row) => {
  const direct = asNumber(row?.cost);
  if (direct != null) return direct;
  return majorUnits(asNumber(row?.costMicros));
};

const rowCurrencyCpc = (row) => {
  const direct = asNumber(row?.averageCpc);
  if (direct != null) return direct;
  return majorUnits(asNumber(row?.averageCpcMicros ?? row?.averageCpc));
};

const formatCtrRatio = (ctr) => {
  const ratio = asNumber(ctr);
  if (ratio == null) return null;
  const pct = Number((ratio * 100).toFixed(6)).toString();
  return `${ratio} (ratio; ${pct}% when shown as percent)`;
};

const aggregationKey = (row, entity) => {
  if (entity === "keyword") {
    return [
      row.campaignId || "",
      row.adGroupId || "",
      row.keywordText || "",
      row.keywordMatchType || "",
    ].join("|");
  }
  if (entity === "search term") {
    return [row.campaignId || "", row.adGroupId || "", row.searchTerm || ""].join("|");
  }
  if (entity === "ad group") {
    return [row.campaignId || "", row.adGroupId || row.adGroupName || ""].join("|");
  }
  if (entity === "device") {
    return [row.campaignId || "", row.device || ""].join("|");
  }
  if (entity === "geography") {
    return [row.campaignId || "", row.countryCriterionId || "", row.locationType || ""].join("|");
  }
  if (entity === "ad") {
    return [row.campaignId || "", row.adGroupId || "", row.adId || ""].join("|");
  }
  return String(row.campaignId || row.campaignName || "");
};

/**
 * Period-aggregate daily native performance rows for AI evidence.
 * Does not mutate the input array/objects.
 */
const aggregateGoogleAdsPerformanceForAi = (rows) => {
  const list = Array.isArray(rows) ? rows.filter(isPlainObject) : [];
  if (!list.length) return [];
  const reportType = String(list[0].reportType || list[0]._meta?.report || "");
  const entity = reportMeta(list[0]).entity;
  const hasDates = list.some((row) => row.date != null && String(row.date).trim() !== "");
  const shouldAggregate =
    hasDates &&
    (PERIOD_AGGREGATE_REPORTS.has(reportType) ||
      (list[0].source === "google_ads" && list[0].impressions != null));
  if (!shouldAggregate) return list.map((row) => ({ ...row }));

  const groups = new Map();
  for (const row of list) {
    const key = aggregationKey(row, entity) || `row-${groups.size}`;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = {
        source: row.source || "google_ads",
        provider: row.provider || "google_ads",
        reportType: row.reportType || reportType || null,
        campaignId: row.campaignId ?? null,
        campaignName: row.campaignName ?? null,
        campaignStatus: row.campaignStatus ?? null,
        adGroupId: row.adGroupId ?? null,
        adGroupName: row.adGroupName ?? null,
        keywordText: row.keywordText ?? null,
        keywordMatchType: row.keywordMatchType ?? null,
        searchTerm: row.searchTerm ?? null,
        device: row.device ?? null,
        countryCriterionId: row.countryCriterionId ?? null,
        locationType: row.locationType ?? null,
        currencyCode: row.currencyCode ?? null,
        impressions: 0,
        clicks: 0,
        costMicros: 0,
        cost: 0,
        conversions: 0,
        conversionsValue: 0,
        dayCount: 0,
        _meta: row._meta ? { ...row._meta } : undefined,
        _aiAggregation: "period",
        reach: null,
      };
      groups.set(key, bucket);
    }
    const impressions = asNumber(row.impressions) || 0;
    const clicks = asNumber(row.clicks) || 0;
    const cost = rowCurrencyCost(row) || 0;
    const costMicros =
      asNumber(row.costMicros) != null
        ? asNumber(row.costMicros)
        : cost != null
          ? Math.round(cost * 1_000_000)
          : 0;
    bucket.impressions += impressions;
    bucket.clicks += clicks;
    bucket.cost += cost;
    bucket.costMicros += costMicros || 0;
    bucket.conversions += asNumber(row.conversions) || 0;
    bucket.conversionsValue += asNumber(row.conversionsValue) || 0;
    bucket.dayCount += 1;
    if (!bucket.campaignName && row.campaignName) bucket.campaignName = row.campaignName;
    if (!bucket.currencyCode && row.currencyCode) bucket.currencyCode = row.currencyCode;
  }

  return [...groups.values()].map((bucket) => {
    const impressions = bucket.impressions;
    const clicks = bucket.clicks;
    const cost = bucket.cost;
    const ctr = impressions > 0 ? clicks / impressions : null;
    const averageCpc = clicks > 0 ? cost / clicks : null;
    return {
      ...bucket,
      ctr,
      averageCpc,
      averageCpcMicros:
        averageCpc == null ? null : Math.round(averageCpc * 1_000_000),
      // Explicit: do not invent Leads from conversions.
      leads: null,
      reach: null,
    };
  });
};

const MONEY_RULES = [
  "Money fields:",
  "costMicros / metrics.costMicros are Google Ads micros.",
  "currency cost = costMicros / 1000000.",
  "Use Cost / cost (currency) for Spend. Never use costMicros as Spend.",
  "averageCpcMicros / metrics.averageCpc are micros; Average CPC currency = that value / 1000000.",
  "CTR on rows is Google's ratio (0.0396 means 3.96% when shown as a percent). Do not treat 0.0396 as 0.0396%.",
  "Reach is N/A unless a real reach field is present.",
  "campaign_performance.conversions means Conversions, not Leads.",
  "Never map conversions → leads for campaign_performance.",
  "Leads and CPL are N/A unless conversion-action data explicitly identifies a Lead action.",
  "If the user asks for Leads, say campaign performance contains Conversions but does not identify all conversions as Leads.",
].join("\n");

const PERIOD_RULES = [
  "Native/MCP campaign_performance GAQL includes segments.date, so runtime rows are one campaign per day.",
  "For period / monthly / last-month analysis, use the period-total evidence block only:",
  "group by campaignId; SUM cost, impressions, clicks, conversions, conversionsValue;",
  "CTR = total clicks / total impressions; CPC = total spend / total clicks.",
  "Do not sum CTR. Do not average daily CTR. Do not average daily CPC.",
  "Preserve currencyCode. Do not invent Reach.",
].join("\n");

/** Display-only flatten of nested MCP performance rows for period aggregation. */
const flattenMcpPerformanceRowForAggregation = (row) => {
  const campaign = isPlainObject(row.campaign) ? row.campaign : {};
  const adGroup = isPlainObject(row.adGroup)
    ? row.adGroup
    : isPlainObject(row.ad_group)
      ? row.ad_group
      : {};
  const metrics = isPlainObject(row.metrics) ? row.metrics : {};
  const segments = isPlainObject(row.segments) ? row.segments : {};
  const customer = isPlainObject(row.customer) ? row.customer : {};
  const tool = String(row._meta?.tool || "campaign_performance");
  const costMicros = asNumber(metrics.costMicros ?? metrics.cost_micros);
  const averageCpcMicros = asNumber(metrics.averageCpc ?? metrics.average_cpc);
  return {
    source: "google_ads",
    provider: "google_ads",
    reportType: tool,
    campaignId: campaign.id ?? null,
    campaignName: campaign.name ?? null,
    campaignStatus: campaign.status ?? null,
    adGroupId: adGroup.id ?? null,
    adGroupName: adGroup.name ?? null,
    keywordText: row.adGroupCriterion?.keyword?.text ?? row.keywordText ?? null,
    searchTerm: row.searchTermView?.searchTerm ?? row.searchTerm ?? null,
    device: segments.device ?? null,
    date: segments.date ?? null,
    impressions: asNumber(metrics.impressions),
    clicks: asNumber(metrics.clicks),
    ctr: asNumber(metrics.ctr),
    costMicros,
    cost: majorUnits(costMicros),
    averageCpc: majorUnits(averageCpcMicros),
    averageCpcMicros,
    conversions: asNumber(metrics.conversions),
    conversionsValue: asNumber(
      metrics.conversionsValue ?? metrics.conversions_value
    ),
    currencyCode: customer.currencyCode ?? customer.currency_code ?? null,
    _meta: row._meta ? { ...row._meta } : undefined,
  };
};

const mcpPerformanceHasDateSegments = (rows) =>
  rows.some((row) => {
    const date = row?.segments?.date ?? row?.date;
    return date != null && String(date).trim() !== "";
  });

const formatPeriodAggregatedReport = (list) => {
  const meta = reportMeta(list[0] || {});
  const lines = ["Google Ads Report", "", meta.title || "Campaign Performance", ""];
  lines.push(
    "Rows below are period totals (daily segments.date rows grouped by campaignId/entity).",
    "Spend = SUM(cost). Impressions = SUM. Clicks = SUM. Conversions = SUM.",
    "CTR = total clicks / total impressions. CPC = total spend / total clicks.",
    "Daily CTR/CPC were not averaged.",
    "Conversions are Conversions — not Leads. Leads/CPL = N/A without lead conversion-action data.",
    ""
  );
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
      if (key === "reach") {
        lines.push(`   - ${name}: N/A`);
        continue;
      }
      if (key === "leads") {
        lines.push(`   - ${name}: N/A (do not infer from conversions)`);
        continue;
      }
      if (key === "ctr") {
        const formatted = formatCtrRatio(row.ctr);
        if (formatted) lines.push(`   - ${name}: ${formatted}`);
        continue;
      }
      if (key === "cost") {
        const cost = rowCurrencyCost(row);
        if (cost != null) lines.push(`   - ${name}: ${cost}`);
        continue;
      }
      if (key === "averageCpc") {
        const cpc = rowCurrencyCpc(row);
        if (cpc != null) lines.push(`   - ${name}: ${cpc}`);
        continue;
      }
      if (key === "date" && row._aiAggregation === "period") continue;
      const value = show(row[key]);
      if (value == null) continue;
      lines.push(`   - ${name}: ${value}`);
    }
    if (asNumber(row.costMicros) != null) {
      lines.push(
        `   - Cost micros (not currency; Spend = costMicros/1000000): ${row.costMicros}`
      );
    }
    lines.push("");
  });
  return lines.join("\n").trimEnd();
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
  ["cost", "Cost (currency / Spend)"],
  ["averageCpc", "Average CPC (currency)"],
  ["conversions", "Conversions"],
  ["conversionsValue", "Conversion value"],
  ["allConversions", "All conversions"],
  ["allConversionsValue", "All conversions value"],
  ["reach", "Reach"],
  ["leads", "Leads"],
  ["dayCount", "Days in period"],
  ["date", "Date"],
  ["currencyCode", "Currency"],
];

const pushMoneyAwareLines = (lines, fieldPath, raw) => {
  // Nested MCP metrics.averageCpc / costMicros are API micros.
  if (/(^|\.)costMicros$/i.test(fieldPath)) {
    const cost = majorUnits(asNumber(raw));
    lines.push(`   - ${fieldPath} (micros, not currency): ${show(raw)}`);
    if (cost != null) {
      lines.push(`   - cost (currency = costMicros/1000000): ${cost}`);
    }
    return true;
  }
  if (/(^|\.)averageCpcMicros$/i.test(fieldPath) || /(^|\.)metrics\.averageCpc$/i.test(fieldPath)) {
    const cpc = majorUnits(asNumber(raw));
    lines.push(`   - ${fieldPath} (micros, not currency): ${show(raw)}`);
    if (cpc != null) {
      lines.push(`   - averageCpc (currency = ${fieldPath}/1000000): ${cpc}`);
    }
    return true;
  }
  if (/(^|\.)metrics\.ctr$/i.test(fieldPath) || fieldPath === "ctr") {
    const formatted = formatCtrRatio(raw);
    if (formatted) {
      lines.push(`   - ${fieldPath}: ${formatted}`);
      return true;
    }
  }
  return false;
};

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
      if (pushMoneyAwareLines(lines, fieldPath, value)) continue;
      const shown = show(value);
      if (shown != null) lines.push(`   - ${fieldPath}: ${shown}`);
    }
    lines.push("");
  });
  return lines.join("\n").trimEnd();
};

const formatGoogleAdsReport = (rows) => {
  const collected = collectRows(rows);
  if (!looksLikeGoogleAdsRows(collected)) return null;

  // MCP performance with segments.date → period-aggregate for AI evidence only.
  if (
    isMcpPerformanceRow(collected[0]) &&
    mcpPerformanceHasDateSegments(collected) &&
    PERIOD_AGGREGATE_REPORTS.has(String(collected[0]._meta?.tool || ""))
  ) {
    const flat = collected.map(flattenMcpPerformanceRowForAggregation);
    const list = aggregateGoogleAdsPerformanceForAi(flat);
    if (list[0]?._aiAggregation === "period") {
      return formatPeriodAggregatedReport(list);
    }
  }

  if (
    isMcpSearchRow(collected[0]) ||
    isMcpEntityRow(collected[0]) ||
    isMcpChangeRow(collected[0]) ||
    isMcpPerformanceRow(collected[0])
  ) {
    return formatActualFieldReport(collected);
  }
  const list = aggregateGoogleAdsPerformanceForAi(collected);
  if (list[0]?._aiAggregation === "period") {
    return formatPeriodAggregatedReport(list);
  }
  // Non-daily / already entity-level rows — still use shared field labels.
  const meta = reportMeta(list[0] || collected[0]);
  const lines = ["Google Ads Report", "", meta.title, ""];
  (list.length ? list : collected).forEach((row, index) => {
    const entity = reportMeta(row).entity;
    lines.push(`${index + 1}. ${headingFor(row, entity)}`);
    for (const [key, name] of FIELD_LINES) {
      if (key === "reach") {
        lines.push(`   - ${name}: N/A`);
        continue;
      }
      if (key === "leads") {
        lines.push(`   - ${name}: N/A (do not infer from conversions)`);
        continue;
      }
      if (key === "ctr") {
        const formatted = formatCtrRatio(row.ctr);
        if (formatted) lines.push(`   - ${name}: ${formatted}`);
        continue;
      }
      if (key === "cost") {
        const cost = rowCurrencyCost(row);
        if (cost != null) lines.push(`   - ${name}: ${cost}`);
        continue;
      }
      if (key === "averageCpc") {
        const cpc = rowCurrencyCpc(row);
        if (cpc != null) lines.push(`   - ${name}: ${cpc}`);
        continue;
      }
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
  const evidence = formatGoogleAdsReport(rows);
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
      "Nested Google Ads values stay nested in storage, but money in the evidence block is labeled.",
      MONEY_RULES,
      "If a field is absent, omit it.",
      "Do not invent fields.",
      "For Spend/CPC in answers, copy the currency lines from the evidence block, not micros.",
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
              PERIOD_RULES,
            ]
          : []),
      "",
      `Available fields: ${fields.join(", ")}`,
      "",
      "Evidence:",
      evidence || "(none)",
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
    MONEY_RULES,
    PERIOD_RULES,
    "Do not recalculate away from the evidence block totals.",
    "Copy Spend from Cost (currency / Spend), not from Cost micros.",
    "",
    `Available fields: ${fields.join(", ")}`,
    "",
    "Evidence:",
    evidence || "(none)",
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
  aggregateGoogleAdsPerformanceForAi,
  flattenMcpPerformanceRowForAggregation,
  rowCurrencyCost,
  majorUnits,
  formatCtrRatio,
};
