/**
 * Display-only Facebook Page Run Results presentation (M9.1).
 * Never mutates WorkflowItem execution data.
 */

export type FacebookPageOutputMeta = {
  provider?: unknown;
  resource?: unknown;
  operation?: unknown;
  pageId?: unknown;
  apiVersion?: unknown;
};

export type FacebookPageListRow = {
  id: string;
  title: string;
  subtitle?: string;
  metaBits?: string[];
  thumbnailUrl?: string;
  permalink?: string;
};

export type FacebookPageReadableBlock = {
  title: string;
  layout: "page" | "post" | "post_list" | "comments" | "insights" | "publish" | "generic";
  lines: Array<{ label: string; value: string }>;
  text: string;
  headerName?: string;
  subtitle?: string;
  imageUrl?: string;
  stats?: Array<{ label: string; value: string }>;
  listRows?: FacebookPageListRow[];
  metrics?: Array<{ label: string; value: string }>;
};

const LIST_PREVIEW = 10;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const str = (value: unknown): string =>
  value == null ? "" : String(value).trim();

export function getFacebookPageMeta(
  json: Record<string, unknown> | null | undefined
): FacebookPageOutputMeta | null {
  const meta = asRecord(json?._meta);
  if (!meta) return null;
  if (String(meta.provider || "") !== "facebook_page") return null;
  return meta;
}

export function isFacebookPageOutputJson(
  json: Record<string, unknown> | null | undefined
): boolean {
  return Boolean(getFacebookPageMeta(json));
}

function resourceOf(json: Record<string, unknown>): string {
  return str(getFacebookPageMeta(json)?.resource).toLowerCase();
}

function operationOf(json: Record<string, unknown>): string {
  return str(getFacebookPageMeta(json)?.operation).toLowerCase();
}

function formatPageBlock(json: Record<string, unknown>): FacebookPageReadableBlock {
  const name = str(json.name) || "Facebook Page";
  const stats: Array<{ label: string; value: string }> = [];
  if (json.followersCount != null) {
    stats.push({ label: "Followers", value: String(json.followersCount) });
  } else if (json.fanCount != null) {
    stats.push({ label: "Fans", value: String(json.fanCount) });
  }
  const lines: Array<{ label: string; value: string }> = [];
  if (str(json.category)) lines.push({ label: "Category", value: str(json.category) });
  if (str(json.username)) lines.push({ label: "Username", value: `@${str(json.username)}` });
  if (str(json.link)) lines.push({ label: "Page", value: str(json.link) });
  if (str(json.about)) lines.push({ label: "About", value: str(json.about) });
  for (const s of stats) lines.push(s);

  return {
    title: "Facebook Page",
    layout: "page",
    headerName: name,
    lines,
    stats,
    imageUrl: str(json.pictureUrl) || undefined,
    text: ["Facebook Page", "", name, "", ...lines.map((l) => `${l.label}: ${l.value}`)].join(
      "\n"
    ),
  };
}

function formatPostBlock(json: Record<string, unknown>): FacebookPageReadableBlock {
  const message = str(json.message) || "(no message)";
  const lines: Array<{ label: string; value: string }> = [];
  if (json.createdTime) lines.push({ label: "Created", value: str(json.createdTime) });
  if (json.reactionsCount != null) {
    lines.push({ label: "Reactions", value: String(json.reactionsCount) });
  }
  if (json.commentsCount != null) {
    lines.push({ label: "Comments", value: String(json.commentsCount) });
  }
  if (json.shares != null) lines.push({ label: "Shares", value: String(json.shares) });
  if (str(json.permalinkUrl)) lines.push({ label: "Open", value: str(json.permalinkUrl) });

  return {
    title: "Facebook Post",
    layout: "post",
    headerName: message.slice(0, 120),
    lines,
    imageUrl: str(json.fullPicture) || undefined,
    text: ["Facebook Post", "", message, "", ...lines.map((l) => `${l.label}: ${l.value}`)].join(
      "\n"
    ),
  };
}

function postListRow(json: Record<string, unknown>): FacebookPageListRow {
  const message = str(json.message);
  return {
    id: str(json.postId) || str(json.id) || Math.random().toString(36),
    title: message.slice(0, 80) || "Post",
    subtitle: str(json.createdTime) || undefined,
    thumbnailUrl: str(json.fullPicture) || undefined,
    permalink: str(json.permalinkUrl) || undefined,
    metaBits: [
      json.reactionsCount != null ? `${json.reactionsCount} reactions` : null,
      json.commentsCount != null ? `${json.commentsCount} comments` : null,
      json.shares != null ? `${json.shares} shares` : null,
    ].filter(Boolean) as string[],
  };
}

function commentListRow(json: Record<string, unknown>): FacebookPageListRow {
  return {
    id: str(json.commentId) || Math.random().toString(36),
    title: str(json.message).slice(0, 100) || "Comment",
    subtitle: [str(json.fromName), str(json.createdTime)].filter(Boolean).join(" · ") || undefined,
    metaBits: [
      json.likeCount != null ? `${json.likeCount} likes` : null,
    ].filter(Boolean) as string[],
  };
}

function formatInsightsBlock(json: Record<string, unknown>): FacebookPageReadableBlock {
  const level = str(json.insightsLevel) || "page";
  const title =
    level === "post" ? "Facebook · Post Insights" : "Facebook · Page Insights";
  const available = json.available !== false;
  const metricsRaw = Array.isArray(json.metrics) ? json.metrics : [];
  const metrics = metricsRaw.map((entry) => {
    const row = asRecord(entry) || {};
    return {
      label: str(row.label) || str(row.metric) || "Metric",
      value:
        row.value != null && typeof row.value === "object"
          ? JSON.stringify(row.value)
          : str(row.value),
    };
  });
  const subtitle = str(json.period)
    ? `Period: ${str(json.period)}`
    : str(json.message) || undefined;

  if (!available) {
    return {
      title,
      layout: "insights",
      lines: [
        {
          label: "Status",
          value:
            str(json.message) ||
            "No eligible insight data for this Page/post and timeframe.",
        },
      ],
      metrics: [],
      subtitle,
      text: [title, "", str(json.message) || "No eligible insight data"].join("\n"),
    };
  }

  return {
    title,
    layout: "insights",
    lines: metrics,
    metrics,
    subtitle,
    text: [
      title,
      subtitle || "",
      "",
      ...metrics.map((m) => `${m.label}: ${m.value}`),
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export function buildFacebookPageReadableBlock(
  json: Record<string, unknown>,
  index?: number
): FacebookPageReadableBlock | null {
  if (!isFacebookPageOutputJson(json)) return null;
  const resource = resourceOf(json);
  if (resource === "page") return formatPageBlock(json);
  if (resource === "post") return formatPostBlock(json);
  if (resource === "comments") {
    const row = commentListRow(json);
    return {
      title: index == null ? "Facebook Comment" : `Facebook Comment ${index + 1}`,
      layout: "comments",
      headerName: row.title,
      lines: [
        ...(row.subtitle ? [{ label: "From", value: row.subtitle }] : []),
        ...((row.metaBits || []).map((bit) => ({ label: "Meta", value: bit })) as Array<{
          label: string;
          value: string;
        }>),
      ],
      text: ["Facebook Comment", row.title, row.subtitle || ""].filter(Boolean).join("\n"),
    };
  }
  if (resource === "insights") return formatInsightsBlock(json);
  if (resource === "publish") {
    return {
      title: "Facebook · Published",
      layout: "publish",
      headerName: str(json.postId) ? `Post ${str(json.postId)}` : "Published",
      lines: [
        ...(str(json.message) ? [{ label: "Message", value: str(json.message) }] : []),
        ...(str(json.link) ? [{ label: "Link", value: str(json.link) }] : []),
        ...(str(json.postId) ? [{ label: "Post ID", value: str(json.postId) }] : []),
      ],
      text: ["Facebook · Published", str(json.postId), str(json.message)]
        .filter(Boolean)
        .join("\n"),
    };
  }
  return {
    title: "Facebook Page",
    layout: "generic",
    lines: [],
    text: "Facebook Page",
  };
}

export function resolveFacebookPageOutputPresentation(args: {
  items?: Record<string, unknown>[];
}): { blocks: FacebookPageReadableBlock[]; summaryText: string } | null {
  const items = (args.items || []).filter((row) => isFacebookPageOutputJson(row));
  if (!items.length) return null;
  const resource = resourceOf(items[0]);
  const operation = operationOf(items[0]);

  if (resource === "post" && (operation === "list" || items.length > 1)) {
    const listRows = items.map(postListRow);
    const block: FacebookPageReadableBlock = {
      title: "Facebook · Posts",
      layout: "post_list",
      lines: [{ label: "Count", value: String(items.length) }],
      listRows,
      text: [
        "Facebook · Posts",
        `${items.length} posts`,
        "",
        ...listRows.map((r) => r.title),
      ].join("\n"),
    };
    return { blocks: [block], summaryText: block.text };
  }

  if (resource === "comments" && items.length >= 1) {
    const listRows = items.map(commentListRow);
    const block: FacebookPageReadableBlock = {
      title: "Facebook · Comments",
      layout: "comments",
      lines: [{ label: "Count", value: String(items.length) }],
      listRows,
      text: [
        "Facebook · Comments",
        `${items.length} comments`,
        "",
        ...listRows.map((r) => `${r.title} — ${r.subtitle || ""}`),
      ].join("\n"),
    };
    return { blocks: [block], summaryText: block.text };
  }

  if (items.length === 1) {
    const block = buildFacebookPageReadableBlock(items[0]);
    if (!block) return null;
    return { blocks: [block], summaryText: block.text };
  }

  const blocks = items
    .map((row, i) => buildFacebookPageReadableBlock(row, i))
    .filter(Boolean) as FacebookPageReadableBlock[];
  if (!blocks.length) return null;
  return {
    blocks,
    summaryText: `Facebook Page · ${blocks.length} items`,
  };
}

export const FACEBOOK_PAGE_LIST_PREVIEW_ROWS = LIST_PREVIEW;
