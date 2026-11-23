/**
 * Display-only Instagram Run Results / inspector shaping.
 * Never mutates WorkflowItem execution data.
 */

export type InstagramOutputMeta = {
  provider?: unknown;
  resource?: unknown;
  operation?: unknown;
  apiVersion?: unknown;
  instagramUserId?: unknown;
};

export type InstagramInsightBreakdownRow = {
  label: string;
  value: string;
};

export type InstagramInsightBreakdownTable = {
  metricLabel: string;
  breakdownKey: string;
  breakdownLabel: string;
  valueColumnLabel: string;
  timeframeKey?: string;
  timeframeLabel?: string;
  rows: InstagramInsightBreakdownRow[];
  /** City/country may truncate in UI; age/gender show all. */
  collapsible: boolean;
};

/** Compact row for Media → List (M8.14.1). */
export type InstagramMediaListRow = {
  id: string;
  thumbnailUrl?: string;
  mediaType?: string;
  productType?: string;
  captionPreview: string;
  /** Full caption when longer than preview — enables expand. */
  captionFull?: string;
  timestamp?: string;
  likeCount?: string;
  commentsCount?: string;
  permalink?: string;
};

export type InstagramReadableBlock = {
  title: string;
  layout:
    | "account"
    | "media"
    | "media_list"
    | "insights"
    | "comments"
    | "publish"
    | "generic";
  lines: Array<{ label: string; value: string }>;
  imageUrl?: string;
  /** Plain-text fallback for previews / copy / Run Results. */
  text: string;
  /** Account card header (display-only). */
  headerName?: string;
  headerUsername?: string;
  headerAccountType?: string;
  /** Compact stats row for account / insight cards. */
  stats?: Array<{ label: string; value: string }>;
  /** Demographic breakdown tables for Insights (primary human view). */
  breakdownTables?: InstagramInsightBreakdownTable[];
  /** Compact Media → List rows (one list presentation). */
  mediaRows?: InstagramMediaListRow[];
  /** list_media: more pages available via after cursor. */
  hasMore?: boolean;
  biography?: string;
};

const MEDIA_CAPTION_PREVIEW_LEN = 80;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** Table view hides these; JSON / Schema keep the full item. */
export const INSTAGRAM_TABLE_TECHNICAL_KEYS = Object.freeze([
  "id",
  "instagramUserId",
  "igId",
  "profilePictureUrl",
  "apiVersion",
]);

export function getInstagramMeta(
  json: Record<string, unknown> | null | undefined
): InstagramOutputMeta | null {
  const meta = asRecord(json?._meta);
  if (!meta) return null;
  if (String(meta.provider || "") !== "instagram") return null;
  return meta;
}

export function isInstagramOutputJson(
  json: Record<string, unknown> | null | undefined
): boolean {
  return Boolean(getInstagramMeta(json));
}

/** Allowlist https CDN hosts for profile / media thumbnails. */
export function isSafeInstagramImageUrl(url: unknown): url is string {
  const raw = String(url || "").trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === "instagram.com" ||
      host.endsWith(".instagram.com") ||
      host === "cdninstagram.com" ||
      host.endsWith(".cdninstagram.com") ||
      host === "fbcdn.net" ||
      host.endsWith(".fbcdn.net") ||
      host === "facebook.com" ||
      host.endsWith(".facebook.com") ||
      host.endsWith(".fbsbx.com")
    );
  } catch {
    return false;
  }
}

function str(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function formatAccountBlock(
  json: Record<string, unknown>
): InstagramReadableBlock {
  const headerName = str(json.name) || undefined;
  const username = str(json.username);
  const headerUsername = username ? `@${username}` : undefined;
  const headerAccountType = str(json.accountType) || undefined;
  const biography = str(json.biography) || undefined;
  const stats: Array<{ label: string; value: string }> = [];
  if (json.followersCount != null && json.followersCount !== "") {
    stats.push({ label: "Followers", value: String(json.followersCount) });
  }
  if (json.followsCount != null && json.followsCount !== "") {
    stats.push({ label: "Following", value: String(json.followsCount) });
  }
  if (json.mediaCount != null && json.mediaCount !== "") {
    stats.push({ label: "Media", value: String(json.mediaCount) });
  }

  const lines: Array<{ label: string; value: string }> = [];
  if (headerName) lines.push({ label: "Name", value: headerName });
  if (headerUsername) lines.push({ label: "Username", value: headerUsername });
  if (headerAccountType) {
    lines.push({ label: "Account Type", value: headerAccountType });
  }
  for (const stat of stats) lines.push(stat);
  if (str(json.website)) lines.push({ label: "Website", value: str(json.website) });
  if (biography) lines.push({ label: "Biography", value: biography });

  const imageUrl = isSafeInstagramImageUrl(json.profilePictureUrl)
    ? str(json.profilePictureUrl)
    : undefined;

  const textLines = [
    "Instagram Account",
    "",
    headerName || "",
    headerUsername || "",
    headerAccountType || "",
    "",
    ...stats.map((row) => `${row.label}: ${row.value}`),
    biography ? `\nBiography\n${biography}` : "",
  ].filter((line, index, arr) => !(line === "" && arr[index - 1] === ""));

  return {
    title: "Instagram Account",
    layout: "account",
    lines,
    imageUrl,
    text: textLines.join("\n").trimEnd(),
    headerName,
    headerUsername,
    headerAccountType,
    stats,
    biography,
  };
}

function formatMediaBlock(
  json: Record<string, unknown>,
  index?: number
): InstagramReadableBlock {
  const title =
    index == null ? "Instagram Media" : `Instagram Media ${index + 1}`;
  const lines: Array<{ label: string; value: string }> = [];
  if (str(json.mediaType) || str(json.media_type)) {
    lines.push({
      label: "Media type",
      value: str(json.mediaType || json.media_type),
    });
  }
  if (str(json.mediaProductType) || str(json.media_product_type)) {
    lines.push({
      label: "Product type",
      value: str(json.mediaProductType || json.media_product_type),
    });
  }
  if (str(json.caption)) lines.push({ label: "Caption", value: str(json.caption) });
  if (str(json.timestamp)) {
    lines.push({ label: "Timestamp", value: str(json.timestamp) });
  }
  if (str(json.permalink)) {
    lines.push({ label: "Permalink", value: str(json.permalink) });
  }
  if (str(json.username)) {
    lines.push({ label: "Username", value: `@${str(json.username)}` });
  }
  const imageUrl = isSafeInstagramImageUrl(
    json.thumbnailUrl || json.mediaUrl || json.thumbnail_url || json.media_url
  )
    ? str(
        json.thumbnailUrl ||
          json.mediaUrl ||
          json.thumbnail_url ||
          json.media_url
      )
    : undefined;
  return {
    title,
    layout: "media",
    lines,
    imageUrl,
    text: [title, "", ...lines.map((row) => `${row.label}\n${row.value}`)]
      .join("\n")
      .trimEnd(),
  };
}

function formatMediaTimestamp(raw: unknown): string {
  const value = str(raw);
  if (!value) return "";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return value.slice(0, 10);
  }
}

function truncateCaption(raw: unknown): {
  preview: string;
  full?: string;
} {
  const full = str(raw);
  if (!full) return { preview: "" };
  if (full.length <= MEDIA_CAPTION_PREVIEW_LEN) return { preview: full };
  const cut = full.slice(0, MEDIA_CAPTION_PREVIEW_LEN).replace(/\s+\S*$/, "");
  return {
    preview: `${cut || full.slice(0, MEDIA_CAPTION_PREVIEW_LEN)}…`,
    full,
  };
}

function toMediaListRow(json: Record<string, unknown>): InstagramMediaListRow | null {
  const id = str(json.mediaId || json.id);
  if (!id) return null;
  const mediaType = str(json.mediaType || json.media_type) || undefined;
  const productType =
    str(json.mediaProductType || json.media_product_type) || undefined;
  const caption = truncateCaption(json.caption);
  const thumbRaw =
    json.thumbnailUrl || json.mediaUrl || json.thumbnail_url || json.media_url;
  const thumbnailUrl = isSafeInstagramImageUrl(thumbRaw)
    ? str(thumbRaw)
    : undefined;
  const permalink = str(json.permalink) || undefined;
  const likeCount =
    json.likeCount != null && json.likeCount !== ""
      ? String(json.likeCount)
      : json.like_count != null && json.like_count !== ""
        ? String(json.like_count)
        : undefined;
  const commentsCount =
    json.commentsCount != null && json.commentsCount !== ""
      ? String(json.commentsCount)
      : json.comments_count != null && json.comments_count !== ""
        ? String(json.comments_count)
        : undefined;
  const timestamp = formatMediaTimestamp(json.timestamp) || undefined;
  return {
    id,
    thumbnailUrl,
    mediaType,
    productType,
    captionPreview: caption.preview,
    captionFull: caption.full,
    timestamp,
    likeCount,
    commentsCount,
    permalink,
  };
}

function isListMediaItem(json: Record<string, unknown>): boolean {
  const meta = getInstagramMeta(json);
  if (!meta) return false;
  const resource = String(meta.resource || "").toLowerCase();
  const operation = String(meta.operation || "").toLowerCase();
  return resource === "media" && operation === "list_media";
}

function listMediaHasMore(items: Record<string, unknown>[]): boolean {
  for (const row of items) {
    const meta = asRecord(row._meta);
    if (!meta) continue;
    if (meta.truncated === true) return true;
    const paging = asRecord(meta.paging);
    if (paging?.hasNext === true) return true;
  }
  return false;
}

/**
 * One compact list presentation for Media → List (display-only).
 * Does not mutate WorkflowItems.
 */
export function buildInstagramMediaListCollection(
  items: Record<string, unknown>[]
): InstagramReadableBlock | null {
  const rows = (items || []).filter(isListMediaItem);
  if (!rows.length) return null;
  const mediaRows = rows
    .map((row) => toMediaListRow(row))
    .filter(Boolean) as InstagramMediaListRow[];
  if (!mediaRows.length) return null;

  const hasMore = listMediaHasMore(rows);
  const title = hasMore
    ? `Instagram · ${mediaRows.length} media items · more available`
    : `Instagram · ${mediaRows.length} media items`;

  const textChunks: string[] = [title, ""];
  for (const row of mediaRows) {
    const typeBits = [row.mediaType, row.productType].filter(Boolean).join(" · ");
    const stats = [
      row.likeCount != null ? `${row.likeCount} likes` : null,
      row.commentsCount != null ? `${row.commentsCount} comments` : null,
      row.timestamp || null,
    ]
      .filter(Boolean)
      .join(" · ");
    textChunks.push(
      [typeBits || "Media", stats].filter(Boolean).join(" · ")
    );
    if (row.captionPreview) textChunks.push(row.captionPreview);
    if (row.permalink) textChunks.push(row.permalink);
    textChunks.push("");
  }

  return {
    title,
    layout: "media_list",
    lines: [{ label: "Count", value: String(mediaRows.length) }],
    mediaRows,
    hasMore,
    text: textChunks.join("\n").trimEnd(),
  };
}

function insightMetricLabel(json: Record<string, unknown>): string {
  return (
    str(json.title) ||
    str(json.metric || json.name)
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function titleCaseKey(raw: string): string {
  const key = str(raw).toLowerCase();
  if (key === "age") return "Age";
  if (key === "gender") return "Gender";
  if (key === "city") return "City";
  if (key === "country") return "Country";
  if (key === "follow_type") return "Follow type";
  if (!key) return "Breakdown";
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function demographicValueColumnLabel(metric: string): string {
  const key = str(metric).toLowerCase();
  if (key === "follower_demographics") return "Followers";
  if (key === "engaged_audience_demographics") return "Accounts";
  if (key === "reached_audience_demographics") return "Accounts";
  return "Value";
}

function formatAgeLabel(raw: string): string {
  const text = str(raw);
  // Prefer en-dash in human view: 13-17 → 13–17
  return text.replace(/(\d+)\s*-\s*(\d+)/g, "$1–$2").replace(/(\d+)\+$/g, "$1+");
}

/**
 * Flatten Meta `breakdownValues` into readable table rows (display-only).
 */
export function parseInsightBreakdownTable(
  json: Record<string, unknown>
): InstagramInsightBreakdownTable | null {
  const raw = json.breakdownValues;
  if (raw == null) return null;

  const metric = str(json.metric || json.name);
  const metricLabel = insightMetricLabel(json);
  const fallbackBreakdown = str(json.breakdown).toLowerCase();
  const buckets: Array<{
    dimensionKeys: string[];
    results: Array<Record<string, unknown>>;
  }> = [];

  const pushBucket = (entry: unknown) => {
    const obj = asRecord(entry);
    if (!obj) return;
    const dimensionKeys = Array.isArray(obj.dimension_keys)
      ? obj.dimension_keys.map((k) => String(k || "").trim()).filter(Boolean)
      : fallbackBreakdown
        ? [fallbackBreakdown]
        : [];
    const results = Array.isArray(obj.results)
      ? obj.results
          .map((r) => asRecord(r))
          .filter(Boolean) as Array<Record<string, unknown>>
      : [];
    buckets.push({ dimensionKeys, results });
  };

  if (Array.isArray(raw)) {
    raw.forEach(pushBucket);
  } else if (asRecord(raw)) {
    const obj = asRecord(raw)!;
    if (Array.isArray(obj.breakdowns)) {
      obj.breakdowns.forEach(pushBucket);
    } else if (Array.isArray(obj.results)) {
      pushBucket(obj);
    } else {
      // Plain map: { "18-24": 40, ... }
      for (const [key, value] of Object.entries(obj)) {
        if (value != null && typeof value === "object") continue;
        buckets.push({
          dimensionKeys: fallbackBreakdown ? [fallbackBreakdown] : ["value"],
          results: [{ dimension_values: [key], value }],
        });
      }
    }
  }

  const rows: InstagramInsightBreakdownRow[] = [];
  let breakdownKey = fallbackBreakdown;
  for (const bucket of buckets) {
    if (!breakdownKey && bucket.dimensionKeys[0]) {
      breakdownKey = bucket.dimensionKeys[0];
    }
    for (const result of bucket.results) {
      const dims = Array.isArray(result.dimension_values)
        ? result.dimension_values.map((d) => String(d ?? "").trim())
        : [];
      const labelRaw = dims[0] || "";
      if (!labelRaw && result.value == null) continue;
      const label =
        (breakdownKey || bucket.dimensionKeys[0] || "") === "age"
          ? formatAgeLabel(labelRaw)
          : labelRaw || "—";
      rows.push({
        label,
        value: result.value == null ? "—" : String(result.value),
      });
    }
  }

  if (!rows.length) return null;

  const key = breakdownKey || "breakdown";
  const timeframeKey = str(json.timeframe).toLowerCase() || undefined;
  const timeframeLabel = timeframeKey
    ? formatInsightTimeframeLabel(timeframeKey)
    : undefined;
  return {
    metricLabel,
    breakdownKey: key,
    breakdownLabel: titleCaseKey(key),
    valueColumnLabel: demographicValueColumnLabel(metric),
    timeframeKey,
    timeframeLabel,
    rows,
    collapsible: key === "city" || key === "country",
  };
}

function insightDisplayValue(json: Record<string, unknown>): string {
  if (str(json.unavailableReason)) return str(json.unavailableReason);
  if (String(json.status || "") === "unavailable") return "Not available";
  if (String(json.status || "") === "missing") return "Not available";
  if (json.value != null && typeof json.value !== "object") {
    return String(json.value);
  }
  // Breakdown metrics are rendered via breakdownTables — never "See breakdown".
  if (json.breakdownValues != null) {
    const table = parseInsightBreakdownTable(json);
    if (!table) {
      return "Demographic data is not available for this account or timeframe.";
    }
    return table.rows.map((r) => `${r.label}: ${r.value}`).join(", ");
  }
  return "Not available";
}

function formatPeriodLabel(period: string): string {
  const key = str(period).toLowerCase();
  if (key === "lifetime") return "Lifetime";
  if (key === "day") return "Day";
  if (key === "week") return "Week";
  if (key === "days_28") return "28 days";
  if (key === "total_over_range") return "Total over range";
  return titleCaseKey(key);
}

export function formatInsightTimeframeLabel(raw: unknown): string {
  const key = str(raw).toLowerCase();
  if (!key) return "";
  if (key === "this_week" || key === "thisweek") return "This week";
  if (key === "this_month" || key === "thismonth") return "This month";
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatInsightDateRange(items: Record<string, unknown>[]): string {
  const starts = items.map((row) => str(row.dateStart)).filter(Boolean);
  const ends = items.map((row) => str(row.dateEnd || row.endTime)).filter(Boolean);
  const start = starts[0];
  const end = ends[ends.length - 1] || ends[0];
  if (start && end) {
    const fmt = (iso: string) => {
      const ms = Date.parse(iso);
      if (!Number.isFinite(ms)) return iso;
      return new Date(ms).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    };
    return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
  }
  const period = str(items[0]?.period);
  return period ? `Period: ${period}` : "";
}

function formatInsightBlock(
  json: Record<string, unknown>
): InstagramReadableBlock {
  return (
    buildInstagramInsightsCollection([json]) || {
      title: "Instagram Insights",
      layout: "insights",
      lines: [],
      text: "Instagram Insights",
    }
  );
}

/**
 * One human-readable Insights card for a set of metric rows (display-only).
 */
export function buildInstagramInsightsCollection(
  items: Record<string, unknown>[]
): InstagramReadableBlock | null {
  const rows = (items || []).filter((row) => {
    const meta = getInstagramMeta(row);
    return (
      meta &&
      (String(meta.resource || "").toLowerCase() === "insights" ||
        String(meta.operation || "").toLowerCase().includes("insights"))
    );
  });
  if (!rows.length) return null;

  const demographicEmpty = rows.every(
    (row) =>
      String(row.status || "") === "unavailable" &&
      Boolean(str(row.unavailableReason))
  );
  if (demographicEmpty) {
    const message =
      str(rows[0].unavailableReason) ||
      "Demographic data is not available for this account or timeframe.";
    return {
      title: "Instagram Insights",
      layout: "insights",
      lines: [{ label: "Audience", value: message }],
      text: ["Instagram Insights", "", message].join("\n"),
    };
  }

  // Latest point per metric for time-series; preserve genuine zeros.
  const latestByMetric = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = str(row.metric || row.name);
    if (!key) continue;
    const prev = latestByMetric.get(key);
    if (!prev) {
      latestByMetric.set(key, row);
      continue;
    }
    const prevT = Date.parse(String(prev.endTime || prev.dateEnd || "")) || 0;
    const nextT = Date.parse(String(row.endTime || row.dateEnd || "")) || 0;
    if (nextT >= prevT) latestByMetric.set(key, row);
  }

  const stats: Array<{ label: string; value: string }> = [];
  const lines: Array<{ label: string; value: string }> = [];
  const breakdownTables: InstagramInsightBreakdownTable[] = [];
  const textChunks: string[] = ["Instagram Insights"];

  const firstRow = [...latestByMetric.values()][0];
  const period = str(firstRow?.period);
  const headerTimeframe = formatInsightTimeframeLabel(firstRow?.timeframe);
  const range = formatInsightDateRange(rows);
  // Demographic rows carry Timeframe on each metric section; Period=lifetime stays internal.
  if (headerTimeframe) {
    lines.push({ label: "Timeframe", value: headerTimeframe });
    textChunks.push(`Timeframe: ${headerTimeframe}`);
  } else if (period) {
    lines.push({ label: "Period", value: formatPeriodLabel(period) });
    textChunks.push(`Period: ${formatPeriodLabel(period)}`);
  } else if (range) {
    lines.push({ label: "Range", value: range });
    textChunks.push(range);
  }
  textChunks.push("");

  for (const row of latestByMetric.values()) {
    const table = parseInsightBreakdownTable(row);
    if (table) {
      breakdownTables.push(table);
      lines.push({
        label: table.metricLabel,
        value: table.timeframeLabel
          ? `Breakdown: ${table.breakdownLabel} · ${table.timeframeLabel}`
          : `Breakdown: ${table.breakdownLabel}`,
      });
      textChunks.push(table.metricLabel);
      textChunks.push(`Breakdown: ${table.breakdownLabel}`);
      if (table.timeframeLabel) {
        textChunks.push(`Timeframe: ${table.timeframeLabel}`);
      }
      textChunks.push("");
      for (const r of table.rows) {
        textChunks.push(`${r.label}: ${r.value}`);
      }
      textChunks.push("");
      continue;
    }

    if (row.breakdownValues != null) {
      const message =
        str(row.unavailableReason) ||
        "Demographic data is not available for this account or timeframe.";
      lines.push({ label: insightMetricLabel(row), value: message });
      textChunks.push(insightMetricLabel(row));
      textChunks.push(message);
      textChunks.push("");
      continue;
    }

    const label = insightMetricLabel(row);
    const value = insightDisplayValue(row);
    stats.push({ label, value });
    lines.push({ label, value });
    textChunks.push(`${label.padEnd(14)} ${value}`);
  }

  return {
    title: "Instagram Insights",
    layout: "insights",
    lines,
    stats: stats.length ? stats : undefined,
    breakdownTables: breakdownTables.length ? breakdownTables : undefined,
    text: textChunks.join("\n").trimEnd(),
  };
}

function formatCommentBlock(
  json: Record<string, unknown>
): InstagramReadableBlock {
  const lines: Array<{ label: string; value: string }> = [];
  const author = str(json.username || json.from || json.author);
  if (author) lines.push({ label: "Author", value: author.startsWith("@") ? author : `@${author}` });
  if (str(json.text) || str(json.message)) {
    lines.push({ label: "Text", value: str(json.text || json.message) });
  }
  if (str(json.timestamp)) {
    lines.push({ label: "Timestamp", value: str(json.timestamp) });
  }
  if (json.repliesCount != null) {
    lines.push({ label: "Replies", value: String(json.repliesCount) });
  }
  return {
    title: "Instagram Comment",
    layout: "comments",
    lines,
    text: ["Instagram Comment", "", ...lines.map((r) => `${r.label}\n${r.value}`)]
      .join("\n")
      .trimEnd(),
  };
}

function formatPublishBlock(
  json: Record<string, unknown>
): InstagramReadableBlock {
  const lines: Array<{ label: string; value: string }> = [];
  if (str(json.status) || str(json.publishStatus)) {
    lines.push({
      label: "Status",
      value: str(json.status || json.publishStatus),
    });
  }
  if (str(json.mediaId) || str(json.id)) {
    lines.push({ label: "Media ID", value: str(json.mediaId || json.id) });
  }
  if (str(json.containerId)) {
    lines.push({ label: "Container", value: str(json.containerId) });
  }
  if (str(json.permalink)) {
    lines.push({ label: "Permalink", value: str(json.permalink) });
  }
  return {
    title: "Instagram Publish",
    layout: "publish",
    lines,
    text: ["Instagram Publish", "", ...lines.map((r) => `${r.label}\n${r.value}`)]
      .join("\n")
      .trimEnd(),
  };
}

export function buildInstagramReadableBlock(
  json: Record<string, unknown> | null | undefined,
  index?: number
): InstagramReadableBlock | null {
  if (!json || !isInstagramOutputJson(json)) return null;
  const meta = getInstagramMeta(json)!;
  const resource = String(meta.resource || "").toLowerCase();
  const operation = String(meta.operation || "").toLowerCase();

  if (resource === "account" || operation === "get_profile") {
    return formatAccountBlock(json);
  }
  if (resource === "media" || operation.includes("media")) {
    return formatMediaBlock(json, index);
  }
  if (resource === "insights" || operation.includes("insights")) {
    return formatInsightBlock(json);
  }
  if (resource === "comments" || operation.includes("comment")) {
    return formatCommentBlock(json);
  }
  if (resource === "publish" || operation.includes("publish")) {
    return formatPublishBlock(json);
  }
  // Fallback: account-like if username present
  if (str(json.username) && (json.followersCount != null || str(json.name))) {
    return formatAccountBlock(json);
  }
  return null;
}

/** Compact Run Results one-liner. */
export function summarizeInstagramOutput(
  json: Record<string, unknown> | null | undefined
): string | null {
  if (!json || !isInstagramOutputJson(json)) return null;
  const meta = getInstagramMeta(json)!;
  const resource = String(meta.resource || "").toLowerCase();
  const username = str(json.username);
  if (resource === "account" || String(meta.operation) === "get_profile") {
    const parts = [
      username ? `@${username}` : null,
      json.followersCount != null ? `${json.followersCount} followers` : null,
      json.mediaCount != null ? `${json.mediaCount} media` : null,
    ].filter(Boolean);
    return parts.length ? `Instagram · ${parts.join(" · ")}` : "Instagram account";
  }
  if (resource === "media") {
    const caption = str(json.caption);
    const type = str(json.mediaType || json.media_type) || "media";
    return caption
      ? `Instagram media · ${type} · ${caption.slice(0, 48)}`
      : `Instagram media · ${type}`;
  }
  if (resource === "insights") {
    const metric = str(json.metric || json.name) || "insight";
    return `Instagram insights · ${metric}`;
  }
  if (resource === "comments") {
    return `Instagram comment${username ? ` · @${username}` : ""}`;
  }
  if (resource === "publish") {
    return `Instagram publish · ${str(json.status || json.publishStatus) || "done"}`;
  }
  return "Instagram";
}

/** Whether a table column should be omitted for Instagram primary view. */
export function shouldHideInstagramTableKey(
  json: Record<string, unknown>,
  key: string
): boolean {
  if (!isInstagramOutputJson(json)) return false;
  return INSTAGRAM_TABLE_TECHNICAL_KEYS.includes(key);
}
