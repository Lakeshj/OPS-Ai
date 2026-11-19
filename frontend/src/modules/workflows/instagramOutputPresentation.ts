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

export type InstagramReadableBlock = {
  title: string;
  layout: "account" | "media" | "insights" | "comments" | "publish" | "generic";
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
  biography?: string;
};

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

function insightMetricLabel(json: Record<string, unknown>): string {
  return (
    str(json.title) ||
    str(json.metric || json.name)
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function insightDisplayValue(json: Record<string, unknown>): string {
  if (str(json.unavailableReason)) return str(json.unavailableReason);
  if (String(json.status || "") === "unavailable") return "Not available";
  if (String(json.status || "") === "missing") return "Not available";
  if (json.value != null && typeof json.value !== "object") {
    return String(json.value);
  }
  if (json.breakdownValues != null) {
    return "See breakdown";
  }
  return "Not available";
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
      "Audience demographic data is not available for this account or selected timeframe.";
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
  for (const row of latestByMetric.values()) {
    const label = insightMetricLabel(row);
    const value = insightDisplayValue(row);
    stats.push({ label, value });
    lines.push({ label, value });
  }

  const range = formatInsightDateRange(rows);
  const title = range ? `Instagram Insights\n${range}` : "Instagram Insights";
  const textLines = [
    "Instagram Insights",
    ...(range ? [range, ""] : [""]),
    ...stats.map((s) => `${s.label.padEnd(14)} ${s.value}`),
  ];
  return {
    title: title.split("\n")[0],
    layout: "insights",
    lines: range
      ? [{ label: "Range", value: range }, ...lines]
      : lines,
    stats,
    text: textLines.join("\n").trimEnd(),
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
