/**
 * Display-only Meta Ads Run Results / inspector shaping (M8.18.1).
 * Never mutates WorkflowItem execution data.
 */

export type MetaAdsOutputMeta = {
  provider?: unknown;
  resource?: unknown;
  operation?: unknown;
  apiVersion?: unknown;
  adAccountId?: unknown;
  platformScope?: unknown;
};

export type MetaAdsListRow = {
  id: string;
  title: string;
  subtitle?: string;
  status?: string;
  metaBits?: string[];
};

export type MetaAdsReadableBlock = {
  title: string;
  layout:
    | "account"
    | "entity"
    | "entity_list"
    | "delivery_list"
    | "insights"
    | "generic";
  lines: Array<{ label: string; value: string }>;
  text: string;
  headerName?: string;
  subtitle?: string;
  stats?: Array<{ label: string; value: string }>;
  listRows?: MetaAdsListRow[];
  metrics?: Array<{ label: string; value: string }>;
};

const LIST_PREVIEW_ROWS = 10;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const str = (value: unknown): string => {
  if (value == null) return "";
  return String(value).trim();
};

const PLATFORM_LABELS: Record<string, string> = {
  all: "All Meta",
  facebook: "Facebook",
  instagram: "Instagram",
};

export function getMetaAdsMeta(
  json: Record<string, unknown> | null | undefined
): MetaAdsOutputMeta | null {
  const meta = asRecord(json?._meta);
  if (!meta) return null;
  if (String(meta.provider || "") !== "meta_ads") return null;
  return meta;
}

export function isMetaAdsOutputJson(
  json: Record<string, unknown> | null | undefined
): boolean {
  return Boolean(getMetaAdsMeta(json));
}

export function platformLabelFrom(json: Record<string, unknown>): string {
  const direct = str(json.platformLabel);
  if (direct) return direct;
  const scope = str(json.platformScope || getMetaAdsMeta(json)?.platformScope).toLowerCase();
  return PLATFORM_LABELS[scope] || PLATFORM_LABELS.all;
}

export function maskAdAccountId(raw: unknown): string {
  const text = str(raw).replace(/^act_/i, "");
  if (!text) return "";
  if (text.length <= 4) return text;
  return `•••${text.slice(-4)}`;
}

function formatNumber(value: unknown): string {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return str(value);
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatMoney(value: unknown): string {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return str(value);
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatRatio(value: unknown, suffix = ""): string {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return str(value);
  const body = n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return suffix ? `${body}${suffix}` : body;
}

function formatWhen(value: unknown): string {
  const text = str(value);
  if (!text) return "";
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return text;
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return text;
  }
}

function pushLine(
  lines: Array<{ label: string; value: string }>,
  label: string,
  value: unknown
) {
  const v = str(value);
  if (!v) return;
  lines.push({ label, value: v });
}

function resourceOf(json: Record<string, unknown>): string {
  return str(getMetaAdsMeta(json)?.resource).toLowerCase();
}

function operationOf(json: Record<string, unknown>): string {
  return str(getMetaAdsMeta(json)?.operation).toLowerCase();
}

function formatAccountBlock(
  json: Record<string, unknown>
): MetaAdsReadableBlock {
  const name = str(json.name) || "Ad Account";
  const status =
    str(json.accountStatusLabel) ||
    (json.accountStatus != null ? str(json.accountStatus) : "");
  const lines: Array<{ label: string; value: string }> = [];
  pushLine(lines, "Status", status);
  pushLine(lines, "Currency", json.currency);
  pushLine(lines, "Timezone", json.timezoneName);
  pushLine(lines, "Platform", platformLabelFrom(json));
  pushLine(
    lines,
    "Ad Account",
    maskAdAccountId(json.adAccountId || json.account_id || json.id)
  );

  const text = [
    "Meta Ads · Ad Account",
    "",
    name,
    "",
    ...lines.map((row) => `${row.label.padEnd(12)} ${row.value}`),
  ].join("\n");

  return {
    title: "Meta Ads · Ad Account",
    layout: "account",
    headerName: name,
    lines,
    text,
  };
}

function formatCampaignEntity(
  json: Record<string, unknown>,
  detailed: boolean
): MetaAdsReadableBlock {
  const presentation = asRecord(json.presentation);
  const name =
    str(presentation?.campaignName) || str(json.name) || "Campaign";
  const lines: Array<{ label: string; value: string }> = [];
  pushLine(
    lines,
    "Objective",
    str(json.objectiveLabel) || str(presentation?.objective) || json.objective
  );
  pushLine(lines, "Status", str(json.statusLabel) || json.configuredStatus || json.status);
  if (detailed) {
    pushLine(lines, "Effective Status", json.statusLabel || json.status);
    pushLine(lines, "Campaign ID", json.id);
    pushLine(lines, "Created", formatWhen(json.createdTime));
    pushLine(lines, "Updated", formatWhen(json.updatedTime));
  } else {
    pushLine(lines, "Effective Status", json.status);
  }
  pushLine(lines, "Platform", platformLabelFrom(json));
  if (json.spend != null) pushLine(lines, "Spend", formatMoney(json.spend));

  return {
    title: "Meta Ads · Campaign",
    layout: "entity",
    headerName: name,
    lines,
    text: [`Meta Ads · Campaign`, "", name, "", ...lines.map((l) => `${l.label}: ${l.value}`)].join(
      "\n"
    ),
  };
}

function formatAdSetEntity(
  json: Record<string, unknown>,
  detailed: boolean
): MetaAdsReadableBlock {
  const presentation = asRecord(json.presentation);
  const name = str(presentation?.adSetName) || str(json.name) || "Ad Set";
  const lines: Array<{ label: string; value: string }> = [];
  pushLine(lines, "Campaign ID", json.campaignId);
  pushLine(lines, "Status", str(json.statusLabel) || json.configuredStatus || json.status);
  pushLine(lines, "Effective Status", json.statusLabel || json.status);
  if (detailed) {
    pushLine(lines, "Ad Set ID", json.id);
    pushLine(lines, "Optimization", json.optimizationGoal);
    pushLine(lines, "Billing", json.billingEvent);
    if (json.dailyBudget != null) {
      pushLine(lines, "Daily Budget", formatMoney(json.dailyBudget));
    }
    if (json.lifetimeBudget != null) {
      pushLine(lines, "Lifetime Budget", formatMoney(json.lifetimeBudget));
    }
    pushLine(lines, "Start", formatWhen(json.startTime));
    pushLine(lines, "End", formatWhen(json.endTime));
  }
  pushLine(lines, "Platform", platformLabelFrom(json));

  return {
    title: "Meta Ads · Ad Set",
    layout: "entity",
    headerName: name,
    lines,
    text: [`Meta Ads · Ad Set`, "", name, "", ...lines.map((l) => `${l.label}: ${l.value}`)].join(
      "\n"
    ),
  };
}

function formatAdEntity(
  json: Record<string, unknown>,
  detailed: boolean
): MetaAdsReadableBlock {
  const presentation = asRecord(json.presentation);
  const name = str(presentation?.adName) || str(json.name) || "Ad";
  const lines: Array<{ label: string; value: string }> = [];
  pushLine(lines, "Campaign ID", json.campaignId);
  pushLine(lines, "Ad Set ID", json.adSetId);
  pushLine(lines, "Status", str(json.statusLabel) || json.configuredStatus || json.status);
  pushLine(lines, "Effective Status", json.statusLabel || json.status);
  if (detailed) {
    pushLine(lines, "Ad ID", json.id);
    if (json.issuesInfo != null) {
      const issues =
        typeof json.issuesInfo === "string"
          ? json.issuesInfo
          : JSON.stringify(json.issuesInfo);
      if (issues && issues !== "{}" && issues !== "null") {
        pushLine(lines, "Issues", issues);
      }
    }
  }
  pushLine(lines, "Platform", platformLabelFrom(json));

  return {
    title: "Meta Ads · Ad",
    layout: "entity",
    headerName: name,
    lines,
    text: [`Meta Ads · Ad`, "", name, "", ...lines.map((l) => `${l.label}: ${l.value}`)].join(
      "\n"
    ),
  };
}

function campaignListRow(json: Record<string, unknown>): MetaAdsListRow {
  const presentation = asRecord(json.presentation);
  const status =
    str(presentation?.status) ||
    str(json.statusLabel) ||
    str(json.status) ||
    undefined;
  const objective =
    str(json.objectiveLabel) ||
    str(presentation?.objective) ||
    str(json.objective) ||
    undefined;
  const bits = [
    objective,
    platformLabelFrom(json),
    json.spend != null ? `Spend ${formatMoney(json.spend)}` : null,
  ].filter(Boolean) as string[];
  return {
    id: str(json.id) || str(json.name) || Math.random().toString(36),
    title: str(presentation?.campaignName) || str(json.name) || "Campaign",
    subtitle: objective,
    status,
    metaBits: bits,
  };
}

function adSetListRow(json: Record<string, unknown>): MetaAdsListRow {
  const presentation = asRecord(json.presentation);
  const status =
    str(presentation?.status) ||
    str(json.statusLabel) ||
    str(json.status) ||
    undefined;
  const bits = [
    json.campaignId ? `Campaign ${str(json.campaignId)}` : null,
    platformLabelFrom(json),
  ].filter(Boolean) as string[];
  return {
    id: str(json.id) || str(json.name) || Math.random().toString(36),
    title: str(presentation?.adSetName) || str(json.name) || "Ad Set",
    subtitle: json.campaignId ? `Campaign ${str(json.campaignId)}` : undefined,
    status,
    metaBits: bits,
  };
}

function adListRow(json: Record<string, unknown>): MetaAdsListRow {
  const presentation = asRecord(json.presentation);
  const status =
    str(presentation?.status) ||
    str(json.statusLabel) ||
    str(json.status) ||
    undefined;
  const bits = [
    json.campaignId ? `Campaign ${str(json.campaignId)}` : null,
    json.adSetId ? `Ad Set ${str(json.adSetId)}` : null,
    platformLabelFrom(json),
  ].filter(Boolean) as string[];
  return {
    id: str(json.id) || str(json.name) || Math.random().toString(36),
    title: str(presentation?.adName) || str(json.name) || "Ad",
    subtitle: bits.slice(0, 2).join(" · ") || undefined,
    status,
    metaBits: bits,
  };
}

function accountListRow(json: Record<string, unknown>): MetaAdsListRow {
  const status = str(json.accountStatusLabel) || undefined;
  const bits = [
    json.currency ? str(json.currency) : null,
    json.timezoneName ? str(json.timezoneName) : null,
    platformLabelFrom(json),
  ].filter(Boolean) as string[];
  return {
    id: str(json.adAccountId) || str(json.id) || Math.random().toString(36),
    title: str(json.name) || "Ad Account",
    subtitle: maskAdAccountId(json.adAccountId || json.id) || undefined,
    status,
    metaBits: bits,
  };
}

function deliveryListRow(json: Record<string, unknown>): MetaAdsListRow {
  const level = str(json.deliveryLevel) || resourceOf(json) || "entity";
  const presentation = asRecord(json.presentation);
  const title =
    str(presentation?.campaignName) ||
    str(presentation?.adSetName) ||
    str(presentation?.adName) ||
    str(json.name) ||
    "Entity";
  const status =
    str(presentation?.status) ||
    str(json.statusLabel) ||
    str(json.status) ||
    undefined;
  return {
    id: str(json.id) || title,
    title,
    subtitle: level.charAt(0).toUpperCase() + level.slice(1),
    status,
    metaBits: [platformLabelFrom(json)].filter(Boolean),
  };
}

function buildEntityListBlock(
  items: Record<string, unknown>[],
  kind: "adAccount" | "campaign" | "adSet" | "ad" | "delivery"
): MetaAdsReadableBlock {
  const titles: Record<typeof kind, string> = {
    adAccount: "Meta Ads · Ad Accounts",
    campaign: "Meta Ads · Campaigns",
    adSet: "Meta Ads · Ad Sets",
    ad: "Meta Ads · Ads",
    delivery: "Meta Ads · Delivery",
  };
  const rowFn =
    kind === "adAccount"
      ? accountListRow
      : kind === "campaign"
        ? campaignListRow
        : kind === "adSet"
          ? adSetListRow
          : kind === "ad"
            ? adListRow
            : deliveryListRow;
  const listRows = items.map(rowFn);
  const layout = kind === "delivery" ? "delivery_list" : "entity_list";
  const textLines = [
    titles[kind],
    `${items.length} item${items.length === 1 ? "" : "s"}`,
    "",
    ...listRows.map((row) =>
      [row.title, row.status, row.subtitle].filter(Boolean).join(" · ")
    ),
  ];
  return {
    title: titles[kind],
    layout,
    lines: [{ label: "Count", value: String(items.length) }],
    listRows,
    text: textLines.join("\n"),
    subtitle: platformLabelFrom(items[0] || {}),
  };
}

function insightMetricsFromRow(
  json: Record<string, unknown>
): Array<{ label: string; value: string }> {
  const extracted = asRecord(json.extracted);
  const presentation = asRecord(json.presentation);
  const metrics: Array<{ label: string; value: string }> = [];
  const spend = presentation?.spend ?? json.spend;
  const impressions = presentation?.impressions ?? json.impressions;
  const clicks = presentation?.clicks ?? json.clicks;
  const leads = presentation?.leads ?? extracted?.leads;
  if (spend != null && spend !== "") {
    metrics.push({ label: "Spend", value: formatMoney(spend) });
  }
  if (impressions != null && impressions !== "") {
    metrics.push({ label: "Impressions", value: formatNumber(impressions) });
  }
  if (clicks != null && clicks !== "") {
    metrics.push({ label: "Clicks", value: formatNumber(clicks) });
  }
  if (json.reach != null && json.reach !== "") {
    metrics.push({ label: "Reach", value: formatNumber(json.reach) });
  }
  if (leads != null && leads !== "") {
    metrics.push({ label: "Leads", value: formatNumber(leads) });
  }
  if (extracted?.linkClicks != null) {
    metrics.push({
      label: "Link clicks",
      value: formatNumber(extracted.linkClicks),
    });
  }
  if (extracted?.landingPageViews != null) {
    metrics.push({
      label: "Landing page views",
      value: formatNumber(extracted.landingPageViews),
    });
  }
  if (extracted?.purchases != null) {
    metrics.push({
      label: "Purchases",
      value: formatNumber(extracted.purchases),
    });
  }
  if (extracted?.purchaseValue != null) {
    metrics.push({
      label: "Purchase value",
      value: formatMoney(extracted.purchaseValue),
    });
  }
  return metrics;
}

function formatInsightBlock(
  json: Record<string, unknown>
): MetaAdsReadableBlock {
  const presentation = asRecord(json.presentation);
  const title =
    str(presentation?.title) ||
    `Meta Ads · ${platformLabelFrom(json)}`;
  const subtitle =
    str(presentation?.subtitle) ||
    (() => {
      const meta = asRecord(json._meta);
      const range = asRecord(meta?.dateRange);
      if (range?.since && range?.until) {
        return `${str(range.since)} → ${str(range.until)}`;
      }
      return "";
    })();
  const metrics = insightMetricsFromRow(json);
  const lines = metrics.map((m) => ({ label: m.label, value: m.value }));
  pushLine(lines, "Platform", platformLabelFrom(json));
  if (presentation?.publisherPlatform) {
    pushLine(lines, "Publisher", presentation.publisherPlatform);
  } else if (json.publisher_platform) {
    pushLine(lines, "Publisher", json.publisher_platform);
  }

  return {
    title,
    layout: "insights",
    headerName: title,
    subtitle: subtitle || undefined,
    lines,
    metrics,
    text: [title, subtitle, "", ...metrics.map((m) => `${m.label}: ${m.value}`)]
      .filter(Boolean)
      .join("\n"),
  };
}

function buildInsightsCollection(
  items: Record<string, unknown>[],
  outputEnvelope?: Record<string, unknown> | null
): MetaAdsReadableBlock {
  const first = items[0] || {};
  const presentation =
    asRecord(outputEnvelope?.presentation) || asRecord(first.presentation);
  const metricsEnvelope = asRecord(outputEnvelope?.metrics);
  const totals = asRecord(metricsEnvelope?.totals);
  const ratios = asRecord(metricsEnvelope?.ratios);

  const title =
    str(presentation?.title) ||
    str(outputEnvelope?.platformLabel
      ? `Meta Ads · ${outputEnvelope.platformLabel}`
      : "") ||
    `Meta Ads · ${platformLabelFrom(first)}`;
  const subtitle =
    str(presentation?.subtitle) ||
    (outputEnvelope?.since && outputEnvelope?.until
      ? `${str(outputEnvelope.since)} → ${str(outputEnvelope.until)}`
      : "");

  const metrics: Array<{ label: string; value: string }> = [];
  if (totals) {
    if (totals.spend != null) metrics.push({ label: "Spend", value: formatMoney(totals.spend) });
    if (totals.impressions != null) {
      metrics.push({ label: "Impressions", value: formatNumber(totals.impressions) });
    }
    if (totals.clicks != null) {
      metrics.push({ label: "Clicks", value: formatNumber(totals.clicks) });
    }
    if (totals.leads != null) {
      metrics.push({ label: "Leads", value: formatNumber(totals.leads) });
    }
    if (totals.linkClicks != null) {
      metrics.push({ label: "Link clicks", value: formatNumber(totals.linkClicks) });
    }
    if (totals.landingPageViews != null) {
      metrics.push({
        label: "Landing page views",
        value: formatNumber(totals.landingPageViews),
      });
    }
    if (totals.purchases != null) {
      metrics.push({ label: "Purchases", value: formatNumber(totals.purchases) });
    }
    if (totals.purchaseValue != null) {
      metrics.push({
        label: "Purchase value",
        value: formatMoney(totals.purchaseValue),
      });
    }
  } else if (items.length === 1) {
    metrics.push(...insightMetricsFromRow(first));
  } else {
    // Display-only sum of additive fields when envelope summary is absent.
    let spend = 0;
    let impressions = 0;
    let clicks = 0;
    for (const row of items) {
      spend += Number(row.spend) || 0;
      impressions += Number(row.impressions) || 0;
      clicks += Number(row.clicks) || 0;
    }
    metrics.push({ label: "Spend", value: formatMoney(spend) });
    metrics.push({ label: "Impressions", value: formatNumber(impressions) });
    metrics.push({ label: "Clicks", value: formatNumber(clicks) });
    metrics.push({ label: "Rows", value: String(items.length) });
  }

  if (ratios?.cpl != null) {
    metrics.push({ label: "CPL", value: formatMoney(ratios.cpl) });
  }
  if (ratios?.cpc != null) {
    metrics.push({ label: "CPC", value: formatMoney(ratios.cpc) });
  }
  if (ratios?.cpm != null) {
    metrics.push({ label: "CPM", value: formatMoney(ratios.cpm) });
  }
  if (ratios?.ctr != null) {
    metrics.push({ label: "CTR", value: formatRatio(ratios.ctr, "%") });
  }
  if (ratios?.roas != null) {
    metrics.push({ label: "ROAS", value: formatRatio(ratios.roas) });
  }

  const listRows =
    items.length > 1
      ? items.map((row, index) => {
          const p = asRecord(row.presentation);
          const day =
            str(row.date_start) ||
            str(row.campaign_name) ||
            str(row.adset_name) ||
            str(row.ad_name) ||
            `Row ${index + 1}`;
          const bits = [
            row.spend != null ? `Spend ${formatMoney(row.spend)}` : null,
            row.impressions != null
              ? `Imp ${formatNumber(row.impressions)}`
              : null,
            row.clicks != null ? `Clicks ${formatNumber(row.clicks)}` : null,
            p?.publisherPlatform || row.publisher_platform
              ? str(p?.publisherPlatform || row.publisher_platform)
              : null,
          ].filter(Boolean) as string[];
          return {
            id: `${day}-${index}`,
            title: day,
            metaBits: bits,
          } satisfies MetaAdsListRow;
        })
      : undefined;

  return {
    title,
    layout: "insights",
    headerName: title,
    subtitle: subtitle || undefined,
    lines: metrics.map((m) => ({ label: m.label, value: m.value })),
    metrics,
    listRows,
    text: [
      title,
      subtitle,
      "",
      ...metrics.map((m) => `${m.label}: ${m.value}`),
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/**
 * Build a single Meta Ads readable block for one item.
 */
export function buildMetaAdsReadableBlock(
  json: Record<string, unknown>,
  index?: number
): MetaAdsReadableBlock | null {
  if (!isMetaAdsOutputJson(json)) return null;
  const resource = resourceOf(json);
  const operation = operationOf(json);

  if (resource === "adaccount") {
    return formatAccountBlock(json);
  }
  if (resource === "campaign") {
    return formatCampaignEntity(json, operation === "get");
  }
  if (resource === "adset") {
    return formatAdSetEntity(json, operation === "get");
  }
  if (resource === "ad") {
    return formatAdEntity(json, operation === "get");
  }
  if (resource === "delivery") {
    const row = deliveryListRow(json);
    return {
      title: "Meta Ads · Delivery",
      layout: "entity",
      headerName: row.title,
      lines: [
        ...(row.subtitle
          ? [{ label: "Level", value: row.subtitle }]
          : []),
        ...(row.status ? [{ label: "Status", value: row.status }] : []),
        { label: "Platform", value: platformLabelFrom(json) },
      ],
      text: ["Meta Ads · Delivery", row.title, row.status || ""]
        .filter(Boolean)
        .join("\n"),
    };
  }
  if (resource === "insights" || resource === "report") {
    return formatInsightBlock(json);
  }

  const title =
    index == null ? "Meta Ads" : `Meta Ads ${index + 1}`;
  return {
    title,
    layout: "generic",
    lines: Object.entries(json)
      .filter(([key]) => key !== "_meta" && key !== "presentation" && key !== "extracted")
      .filter(([, value]) => value != null && typeof value !== "object")
      .slice(0, 12)
      .map(([label, value]) => ({ label, value: str(value) })),
    text: title,
  };
}

/**
 * Preferred entry: resolve presentation for Meta Ads Native resources.
 * Display-only — does not change workflow output.
 */
export function resolveMetaAdsOutputPresentation(args: {
  resource?: string;
  operation?: string;
  items?: Record<string, unknown>[];
  output?: Record<string, unknown> | null;
}): { blocks: MetaAdsReadableBlock[]; summaryText: string } | null {
  const items = (args.items || []).filter((row) => isMetaAdsOutputJson(row));
  if (!items.length) return null;

  const resource = str(args.resource || resourceOf(items[0])).toLowerCase();
  const operation = str(args.operation || operationOf(items[0])).toLowerCase();
  const allSameResource = items.every(
    (row) => resourceOf(row) === resourceOf(items[0])
  );
  if (!allSameResource) {
    const blocks = items
      .map((row, index) => buildMetaAdsReadableBlock(row, index))
      .filter(Boolean) as MetaAdsReadableBlock[];
    if (!blocks.length) return null;
    return {
      blocks,
      summaryText: `Meta Ads · ${blocks.length} items`,
    };
  }

  const isList =
    operation === "list" ||
    operation === "listaccessible" ||
    operation === "liststatuses" ||
    items.length > 1;

  if (resource === "adaccount" && isList && items.length > 1) {
    const block = buildEntityListBlock(items, "adAccount");
    return { blocks: [block], summaryText: block.text };
  }
  if (resource === "campaign" && isList && operation !== "get") {
    const block = buildEntityListBlock(items, "campaign");
    return { blocks: [block], summaryText: block.text };
  }
  if (resource === "adset" && isList && operation !== "get") {
    const block = buildEntityListBlock(items, "adSet");
    return { blocks: [block], summaryText: block.text };
  }
  if (resource === "ad" && isList && operation !== "get") {
    const block = buildEntityListBlock(items, "ad");
    return { blocks: [block], summaryText: block.text };
  }
  if (resource === "delivery") {
    const block = buildEntityListBlock(items, "delivery");
    return { blocks: [block], summaryText: block.text };
  }
  if (resource === "insights" || resource === "report") {
    const block = buildInsightsCollection(items, args.output || null);
    return { blocks: [block], summaryText: block.text };
  }

  // Single get / account get
  if (items.length === 1) {
    const block = buildMetaAdsReadableBlock(items[0]);
    if (!block) return null;
    return { blocks: [block], summaryText: block.text };
  }

  const blocks = items
    .map((row, index) => buildMetaAdsReadableBlock(row, index))
    .filter(Boolean) as MetaAdsReadableBlock[];
  if (!blocks.length) return null;
  return {
    blocks,
    summaryText: `Meta Ads · ${blocks.length} items`,
  };
}

export function summarizeMetaAdsOutput(
  json: Record<string, unknown> | null | undefined
): string | null {
  if (!json || !isMetaAdsOutputJson(json)) return null;
  const resolved = resolveMetaAdsOutputPresentation({ items: [json] });
  return resolved?.summaryText || null;
}

export const META_ADS_LIST_PREVIEW_ROWS = LIST_PREVIEW_ROWS;
