/**
 * Display-only LinkedIn Lead Discovery Run Results (M10.1).
 */

export type LinkedInLeadReadableBlock = {
  title: string;
  layout: "lead_list" | "lead" | "generic";
  lines: Array<{ label: string; value: string }>;
  text: string;
  listRows?: Array<{
    id: string;
    title: string;
    subtitle?: string;
    metaBits?: string[];
    permalink?: string;
  }>;
};

const LIST_PREVIEW = 10;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const str = (value: unknown) => (value == null ? "" : String(value).trim());

export function getLinkedInLeadMeta(
  json: Record<string, unknown> | null | undefined
) {
  const meta = asRecord(json?._meta);
  if (!meta) return null;
  if (String(meta.provider || "") !== "linkedin_lead_discovery") return null;
  return meta;
}

export function isLinkedInLeadOutputJson(
  json: Record<string, unknown> | null | undefined
): boolean {
  return Boolean(getLinkedInLeadMeta(json));
}

function leadRow(json: Record<string, unknown>) {
  const content = str(json.content);
  const categories = Array.isArray(json.matchedCategories)
    ? json.matchedCategories.map(String)
    : [];
  const keywords = Array.isArray(json.matchedKeywords)
    ? json.matchedKeywords.map(String).slice(0, 3)
    : [];
  const author = asRecord(json.author);
  const engagement = asRecord(json.engagement);
  return {
    id: str(json.sourcePostId) || Math.random().toString(36),
    title: content.slice(0, 140) || "LinkedIn post",
    subtitle: [
      str(json.publishedAt),
      author?.name ? String(author.name) : null,
    ]
      .filter(Boolean)
      .join(" · "),
    metaBits: [
      categories[0] ? `Category: ${categories[0]}` : null,
      keywords.length ? `Keywords: ${keywords.join(", ")}` : null,
      engagement?.likes != null ? `${engagement.likes} likes` : null,
      engagement?.comments != null ? `${engagement.comments} comments` : null,
      str(json.dataProvider) ? `Provider: ${str(json.dataProvider)}` : null,
    ].filter(Boolean) as string[],
    permalink: str(json.sourcePostUrl) || undefined,
  };
}

export function buildLinkedInLeadReadableBlock(
  json: Record<string, unknown>
): LinkedInLeadReadableBlock | null {
  if (!isLinkedInLeadOutputJson(json)) return null;
  const row = leadRow(json);
  return {
    title: "LinkedIn Lead Discovery",
    layout: "lead",
    lines: [
      ...(row.subtitle ? [{ label: "Meta", value: row.subtitle }] : []),
      ...((row.metaBits || []).map((bit) => ({
        label: "Detail",
        value: bit,
      })) as Array<{ label: string; value: string }>),
    ],
    text: ["LinkedIn Lead Discovery", row.title, row.subtitle || ""]
      .filter(Boolean)
      .join("\n"),
  };
}

export function resolveLinkedInLeadOutputPresentation(args: {
  items?: Record<string, unknown>[];
}): { blocks: LinkedInLeadReadableBlock[]; summaryText: string } | null {
  const items = (args.items || []).filter((row) => isLinkedInLeadOutputJson(row));
  if (!items.length) return null;
  if (items.length >= 1) {
    const listRows = items.map(leadRow);
    const block: LinkedInLeadReadableBlock = {
      title: "LinkedIn · Lead Discovery",
      layout: "lead_list",
      lines: [{ label: "Count", value: String(items.length) }],
      listRows,
      text: [
        "LinkedIn · Lead Discovery",
        `${items.length} candidate opportunities`,
        "",
        ...listRows.map((r) => r.title),
      ].join("\n"),
    };
    return { blocks: [block], summaryText: block.text };
  }
  return null;
}

export const LINKEDIN_LEAD_LIST_PREVIEW_ROWS = LIST_PREVIEW;
