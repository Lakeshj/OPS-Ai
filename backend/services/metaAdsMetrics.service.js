/**
 * Meta Ads metric helpers (Native presentation / KPI ratios).
 * Aggregate numerators/denominators — never average daily ratios.
 * Meta Ads domain only.
 */

const ACTION_ALIASES = Object.freeze({
  link_clicks: Object.freeze(["link_click", "inline_link_click"]),
  landing_page_views: Object.freeze([
    "landing_page_view",
    "omni_landing_page_view",
  ]),
  leads: Object.freeze([
    "lead",
    "onsite_conversion.lead_grouped",
    "offsite_conversion.fb_pixel_lead",
  ]),
  messaging_conversations: Object.freeze([
    "onsite_conversion.messaging_conversation_started_7d",
    "onsite_conversion.messaging_first_reply",
  ]),
  engagements: Object.freeze([
    "post_engagement",
    "page_engagement",
    "post_interaction_gross",
  ]),
  installs: Object.freeze([
    "mobile_app_install",
    "app_install",
    "omni_app_install",
  ]),
  purchases: Object.freeze([
    "purchase",
    "omni_purchase",
    "offsite_conversion.fb_pixel_purchase",
  ]),
});

const OBJECTIVE_LABELS = Object.freeze({
  OUTCOME_AWARENESS: "Awareness",
  OUTCOME_TRAFFIC: "Traffic",
  OUTCOME_ENGAGEMENT: "Engagement",
  OUTCOME_LEADS: "Leads",
  OUTCOME_APP_PROMOTION: "App Promotion",
  OUTCOME_SALES: "Sales",
  BRAND_AWARENESS: "Awareness",
  REACH: "Awareness",
  LINK_CLICKS: "Traffic",
  TRAFFIC: "Traffic",
  POST_ENGAGEMENT: "Engagement",
  ENGAGEMENT: "Engagement",
  MESSAGES: "Engagement",
  LEAD_GENERATION: "Leads",
  CONVERSIONS: "Sales",
  CATALOG_SALES: "Sales",
  APP_INSTALLS: "App Promotion",
});

const PLATFORM_SCOPES = Object.freeze(["all", "facebook", "instagram"]);

const PUBLISHER_PLATFORM_VALUES = Object.freeze({
  facebook: Object.freeze(["facebook"]),
  instagram: Object.freeze(["instagram"]),
});

const PLATFORM_LABELS = Object.freeze({
  all: "All Meta",
  facebook: "Facebook",
  instagram: "Instagram",
});

const normalizePlatformScope = (raw) => {
  const key = String(raw || "all")
    .trim()
    .toLowerCase();
  if (key === "fb") return "facebook";
  if (key === "ig") return "instagram";
  if (PLATFORM_SCOPES.includes(key)) return key;
  return "all";
};

const actionValue = (actions, aliases) => {
  if (!Array.isArray(actions)) return 0;
  let total = 0;
  const wanted = new Set(aliases);
  for (const entry of actions) {
    const type = String(entry?.action_type || "");
    if (!wanted.has(type)) continue;
    const n = Number(entry?.value);
    if (Number.isFinite(n)) total += n;
  }
  return total;
};

const actionValueFromRow = (row, key) => {
  const aliases = ACTION_ALIASES[key];
  if (!aliases) return 0;
  return actionValue(row?.actions, aliases);
};

const purchaseValueFromRow = (row) => {
  const list = row?.action_values;
  if (!Array.isArray(list)) return 0;
  let total = 0;
  for (const entry of list) {
    const type = String(entry?.action_type || "");
    if (!ACTION_ALIASES.purchases.includes(type)) continue;
    const n = Number(entry?.value);
    if (Number.isFinite(n)) total += n;
  }
  return total;
};

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const safeRatio = (numerator, denominator) => {
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return n / d;
};

/**
 * Sum raw metrics across rows, then derive ratios from aggregates.
 */
const aggregateInsightMetrics = (rows) => {
  const list = Array.isArray(rows) ? rows : [];
  const totals = {
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    linkClicks: 0,
    landingPageViews: 0,
    leads: 0,
    messagingConversations: 0,
    engagements: 0,
    installs: 0,
    purchases: 0,
    purchaseValue: 0,
    rowCount: list.length,
  };
  for (const row of list) {
    totals.spend += num(row.spend);
    totals.impressions += num(row.impressions);
    totals.clicks += num(row.clicks);
    totals.linkClicks +=
      num(row.inline_link_clicks) || actionValueFromRow(row, "link_clicks");
    totals.landingPageViews += actionValueFromRow(row, "landing_page_views");
    totals.leads += actionValueFromRow(row, "leads");
    totals.messagingConversations += actionValueFromRow(
      row,
      "messaging_conversations"
    );
    totals.engagements += actionValueFromRow(row, "engagements");
    totals.installs += actionValueFromRow(row, "installs");
    totals.purchases += actionValueFromRow(row, "purchases");
    totals.purchaseValue += purchaseValueFromRow(row);
  }
  // Reach is not additive across days/platforms — only keep a single-row value.
  totals.reach = list.length === 1 ? num(list[0].reach) : null;

  const ratios = {
    frequency:
      totals.reach == null ? null : safeRatio(totals.impressions, totals.reach),
    ctr: safeRatio(totals.clicks * 100, totals.impressions),
    cpc: safeRatio(totals.spend, totals.clicks),
    cpm: safeRatio(totals.spend * 1000, totals.impressions),
    cpl: safeRatio(totals.spend, totals.leads),
    cpi: safeRatio(totals.spend, totals.installs),
    costPerConversation: safeRatio(
      totals.spend,
      totals.messagingConversations
    ),
    costPerLpv: safeRatio(totals.spend, totals.landingPageViews),
    costPerEngagement: safeRatio(totals.spend, totals.engagements),
    costPerPurchase: safeRatio(totals.spend, totals.purchases),
    roas: safeRatio(totals.purchaseValue, totals.spend),
  };

  return { totals, ratios };
};

const objectiveLabel = (rawObjective) => {
  const key = String(rawObjective || "").trim();
  if (!key) return null;
  if (Object.prototype.hasOwnProperty.call(OBJECTIVE_LABELS, key)) {
    return OBJECTIVE_LABELS[key];
  }
  return key
    .replace(/^OUTCOME_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

const enrichInsightRowMetrics = (row) => {
  if (!row || typeof row !== "object") return row;
  const extracted = {
    linkClicks:
      num(row.inline_link_clicks) || actionValueFromRow(row, "link_clicks"),
    landingPageViews: actionValueFromRow(row, "landing_page_views"),
    leads: actionValueFromRow(row, "leads"),
    messagingConversations: actionValueFromRow(row, "messaging_conversations"),
    engagements: actionValueFromRow(row, "engagements"),
    installs: actionValueFromRow(row, "installs"),
    purchases: actionValueFromRow(row, "purchases"),
    purchaseValue: purchaseValueFromRow(row),
  };
  return {
    ...row,
    ...extracted,
  };
};

const filterRowsByPublisherPlatform = (rows, platformScope) => {
  const scope = normalizePlatformScope(platformScope);
  if (scope === "all") return Array.isArray(rows) ? rows.slice() : [];
  const allowed = new Set(PUBLISHER_PLATFORM_VALUES[scope] || []);
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const platform = String(
      row?.publisher_platform || row?.publisherPlatform || ""
    ).toLowerCase();
    return allowed.has(platform);
  });
};

module.exports = {
  ACTION_ALIASES,
  OBJECTIVE_LABELS,
  PLATFORM_SCOPES,
  PLATFORM_LABELS,
  PUBLISHER_PLATFORM_VALUES,
  normalizePlatformScope,
  actionValueFromRow,
  purchaseValueFromRow,
  aggregateInsightMetrics,
  objectiveLabel,
  enrichInsightRowMetrics,
  filterRowsByPublisherPlatform,
  safeRatio,
};
