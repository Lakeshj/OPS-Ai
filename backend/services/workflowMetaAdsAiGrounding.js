/**
 * Meta Ads → AI grounding.
 * Applies only to rows whose _meta.provider is "meta_ads". Google Ads, GA4 and
 * GSC grounding never run on these rows.
 *
 * Native Insights reports stay performance-labeled.
 * Common MCP entity tools stay configuration/entity-labeled.
 */

const { REPORTS } = require("./metaAdsReportCatalog");
const { collectRows } = require("./workflowGoogleAdsAiGrounding");

const isPlainObject = (value) =>
  value != null && typeof value === "object" && !Array.isArray(value);

const looksLikeMetaAdsRow = (row) =>
  isPlainObject(row) && isPlainObject(row._meta) && row._meta.provider === "meta_ads";

const looksLikeMetaAdsRows = (rows) =>
  Array.isArray(rows) && rows.length > 0 && rows.every(looksLikeMetaAdsRow);

const MCP_ENTITY_LABELS = Object.freeze({
  account_summary: { title: "Meta Ads Account", entity: "account", resource: "ad_account" },
  campaigns: { title: "Meta Ads Campaigns", entity: "campaign", resource: "campaign" },
  ad_sets: { title: "Meta Ads Ad Sets", entity: "ad set", resource: "adset" },
  ads: { title: "Meta Ads Ads", entity: "ad", resource: "ad" },
  creatives: { title: "Meta Ads Creatives", entity: "creative", resource: "ad_creative" },
  list_accessible_ad_accounts: {
    title: "Meta Ads Account",
    entity: "account",
    resource: "ad_account",
  },
});

const MCP_PERFORMANCE_LABELS = Object.freeze({
  account_performance: { title: "Meta Ads Account Performance", entity: "account" },
  campaign_performance: { title: "Meta Ads Campaign Performance", entity: "campaign" },
  ad_set_performance: { title: "Meta Ads Ad Set Performance", entity: "ad set" },
  ad_performance: { title: "Meta Ads Ad Performance", entity: "ad" },
  demographic_performance: { title: "Meta Ads Demographic Performance", entity: "demographic" },
  geographic_performance: { title: "Meta Ads Geographic Performance", entity: "geography" },
  device_performance: { title: "Meta Ads Device Performance", entity: "device" },
  placement_performance: { title: "Meta Ads Placement Performance", entity: "placement" },
});

const isMcpEntityRow = (row) =>
  looksLikeMetaAdsRow(row) &&
  Object.prototype.hasOwnProperty.call(MCP_ENTITY_LABELS, String(row?._meta?.tool || ""));

const isMcpPerformanceRow = (row) =>
  looksLikeMetaAdsRow(row) &&
  Object.prototype.hasOwnProperty.call(MCP_PERFORMANCE_LABELS, String(row?._meta?.tool || ""));

const reportInfo = (row) => {
  const key = String(row?._meta?.report || "");
  const report = Object.prototype.hasOwnProperty.call(REPORTS, key) ? REPORTS[key] : null;
  return {
    reportType: key || null,
    label: report ? report.label : "Meta Ads Performance",
    entity: report ? report.entity : "account",
    level: row?._meta?.level || (report ? report.level : null),
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
    if (Array.isArray(child) || (child != null && child !== "")) out.push(fieldPath);
  }
  return out;
};

const entityRules = (rows) => {
  const meta = rows[0]._meta;
  const label = MCP_ENTITY_LABELS[meta.tool];
  const fields = [...new Set(rows.flatMap((row) => listActualFieldPaths(row)))];
  return [
    "Meta Ads evidence rules:",
    "source: meta_ads",
    "provider: meta_ads",
    `tool: ${meta.tool}`,
    `resource: ${label.resource}`,
    `report: ${label.title}`,
    `entity: ${label.entity}`,
    `adAccountId: ${meta.adAccountId || ""}`,
    "",
    `These rows are Meta Ads entity records. Describe them as ${label.title}.`,
    "These are configuration and status fields, not Insights performance reports.",
    "Do not describe this output as Campaign Performance, Ad Set Performance, Ad Performance or Account Performance.",
    "Treat every row as Meta data only.",
    "Nested Graph objects stay nested. Do not flatten or stringify them.",
    "Ad sets are called Ad Sets. Never call them ad groups.",
    "This is not Google Ads data. Do not use Google Ads labels, Search Terms, Keywords, Quality Score or Google Ads report names.",
    "This is not GA4 or Search Console data. Do not call this a GA4 Intelligence Report.",
    "Do not use landing_underperformance, landing pages, sessions, engagementRate, bounce rate or GSC CTR Opportunities.",
    "If a field is absent, omit it. Do not invent fields.",
    "Do not invent impressions, reach, frequency, clicks, ctr, cpc, cpm, spend, actions, action_values or cost_per_action_type.",
    "",
    `Available fields: ${fields.join(", ")}`,
  ].join("\n");
};

const insightsRules = (rows) => {
  const meta = rows[0]._meta;
  const performance = isMcpPerformanceRow(rows[0]) ? MCP_PERFORMANCE_LABELS[meta.tool] : null;
  const info = performance
    ? { label: performance.title, entity: performance.entity, level: meta.level || null, reportType: meta.report || meta.tool }
    : reportInfo(rows[0]);
  const fields = [
    ...new Set(rows.flatMap((row) => Object.keys(row).filter((key) => key !== "_meta"))),
  ];
  const breakdownNote =
    Array.isArray(meta.breakdowns) && meta.breakdowns.length
      ? [
          `breakdowns: ${meta.breakdowns.join(", ")}`,
          "Breakdown rows are segmented performance for the same account or entity, not separate accounts or campaigns.",
        ]
      : [];
  return [
    "Meta Ads evidence rules:",
    "source: meta_ads",
    "provider: meta_ads",
    `report: ${info.label}`,
    `level: ${info.level || ""}`,
    `adAccountId: ${meta.adAccountId || ""}`,
    `dateRange: ${meta.dateRange?.since || ""} to ${meta.dateRange?.until || ""} (${meta.timezone || "ad account timezone"})`,
    ...breakdownNote,
    "",
    `These rows are Meta Ads Insights rows. Describe them as ${info.label}.`,
    "Treat every row as Meta data only.",
    "Each row is one day for one entity (date_start to date_stop). Do not invent totals that are not on the rows.",
    "clicks counts all clicks. inline_link_clicks counts link clicks. They are different metrics; never swap them.",
    "spend is in account_currency. Do not convert currencies. Do not assume USD.",
    "actions, action_values and cost_per_action_type are lists by action_type.",
    "Report each action_type separately. Do not sum different action types.",
    "Do not call an action a purchase or conversion unless its action_type says so.",
    "Do not invent conversions, revenue or ROAS fields.",
    "link_click is not a purchase.",
    "Ad sets are called Ad Sets. Never call them ad groups.",
    "This is not Google Ads data. Do not use Google Ads labels, Search Terms, Keywords, Quality Score or Google Ads report names.",
    "This is not GA4 or Search Console data. Do not call this a GA4 Intelligence Report.",
    "Do not use landing_underperformance, landing pages, sessions, engagementRate, bounce rate or GSC CTR Opportunities.",
    "If a field is absent, omit it. Do not invent fields.",
    "Do not recalculate impressions, reach, frequency, clicks, ctr, cpc, cpm or spend. Copy them from the rows.",
    "",
    `Available fields: ${fields.join(", ")}`,
  ].join("\n");
};

const applyMetaAdsAiGrounding = ({ systemPrompt = "", userPrompt = "", input } = {}) => {
  const rows = collectRows(input);
  const userInstructions = String(systemPrompt || "").trim() || null;
  if (!looksLikeMetaAdsRows(rows)) {
    return {
      grounded: false,
      groundingApplied: false,
      source: null,
      systemPrompt,
      userPrompt,
      userInstructions,
    };
  }
  const entity = isMcpEntityRow(rows[0]);
  const info = entity ? MCP_ENTITY_LABELS[rows[0]._meta.tool] : reportInfo(rows[0]);
  const rules = entity ? entityRules(rows) : insightsRules(rows);
  return {
    grounded: true,
    groundingApplied: true,
    source: "meta_ads",
    provider: "meta_ads",
    systemPrompt: [userInstructions, rules].filter(Boolean).join("\n\n"),
    userPrompt: String(userPrompt || ""),
    userInstructions,
    reportType: entity ? null : info.reportType,
    entity: info.entity,
  };
};

module.exports = {
  looksLikeMetaAdsRow,
  looksLikeMetaAdsRows,
  isMcpEntityRow,
  isMcpPerformanceRow,
  MCP_ENTITY_LABELS,
  MCP_PERFORMANCE_LABELS,
  applyMetaAdsAiGrounding,
};
