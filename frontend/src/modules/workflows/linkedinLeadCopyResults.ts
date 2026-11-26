/**
 * M10.3.12 — Human-readable clipboard text for LinkedIn Lead Discovery.
 * Presentation / clipboard only. Does not alter execution JSON.
 */

import type { WorkflowItem } from "@/modules/workflows/types";
import {
  isLinkedInLeadOutputJson,
  getLinkedInLeadMeta,
} from "@/modules/workflows/linkedinLeadOutputPresentation";
import {
  asPresentationJson,
  resolveOutputPresentation,
} from "@/modules/workflows/outputPresentation";

/** Display labels for intent IDs (mirrors backend keywordLibrary; presentation only). */
const INTENT_LABELS: Record<string, string> = {
  looking_for: "Looking for",
  need: "Need",
  seeking: "Seeking",
  required: "Required",
  hiring: "Hiring",
  recommendations: "Recommendations",
  suggest: "Suggest",
  exploring: "Exploring",
  shortlisting: "Shortlisting",
  onboarding: "Onboarding",
  partner_needed: "Partner needed",
  agency_search: "Agency search",
  outsourcing: "Outsourcing",
  project_requirement: "Project requirement",
  request_for_proposal: "Request for proposal",
};

const DIVIDER = "=".repeat(72);
const SUB_DIVIDER = "-".repeat(72);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const clean = (value: unknown): string | null => {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const text = String(value).trim();
  return text ? text : null;
};

const stringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => clean(entry))
    .filter((entry): entry is string => Boolean(entry));
};

function intentLabels(ids: string[]): string[] {
  return ids.map((id) => INTENT_LABELS[id] || id);
}

/**
 * Canonical LinkedIn lead rows for clipboard.
 * Uses resolveOutputPresentation so we never concatenate items + result +
 * __callableReturnItems (which would duplicate the same execution data).
 */
export function resolveLinkedInLeadCopyItems(
  value: unknown,
  workflowItems?: WorkflowItem[]
): Record<string, unknown>[] {
  const fromValue = resolveOutputPresentation(value);
  if (
    fromValue?.provider === "linkedin_lead_discovery" &&
    fromValue.items.length
  ) {
    return fromValue.items;
  }

  if (workflowItems?.length) {
    const fromItems = resolveOutputPresentation(workflowItems);
    if (
      fromItems?.provider === "linkedin_lead_discovery" &&
      fromItems.items.length
    ) {
      return fromItems.items;
    }
    // Fallback: plain WorkflowItem[].json rows already filtered as leads.
    const jsons = workflowItems
      .map((row) => asPresentationJson(row) || asRecord(row?.json) || asRecord(row))
      .filter((row): row is Record<string, unknown> =>
        Boolean(row && isLinkedInLeadOutputJson(row))
      );
    if (jsons.length) return jsons;
  }

  return [];
}

function formatOneOpportunity(
  json: Record<string, unknown>,
  index: number
): string {
  const lines: string[] = [];
  lines.push(`Opportunity ${index}`);
  lines.push(SUB_DIVIDER);

  const author = asRecord(json.author);
  const authorName = clean(author?.name);
  if (authorName) lines.push(`Author: ${authorName}`);

  const company = clean(author?.company);
  if (company) lines.push(`Company: ${company}`);

  const headline = clean(author?.headline);
  if (headline) lines.push(`Headline: ${headline}`);

  const published = clean(json.publishedAt);
  if (published) lines.push(`Published: ${published}`);

  const categories = stringList(json.matchedCategories);
  if (categories.length) {
    lines.push(`Matched categories: ${categories.join(", ")}`);
  }

  const keywords = stringList(json.matchedKeywords);
  if (keywords.length) {
    lines.push(`Matched keywords: ${keywords.join(", ")}`);
  }

  const intents = intentLabels(stringList(json.matchedIntentIds));
  if (intents.length) {
    lines.push(`Matched intents: ${intents.join(", ")}`);
  }

  const engagement = asRecord(json.engagement);
  const likes = clean(engagement?.likes);
  const comments = clean(engagement?.comments);
  const reposts = clean(engagement?.reposts);
  if (likes != null) lines.push(`Likes: ${likes}`);
  if (comments != null) lines.push(`Comments: ${comments}`);
  if (reposts != null) lines.push(`Reposts: ${reposts}`);

  const postUrl = clean(json.sourcePostUrl);
  if (postUrl) lines.push(`Post URL: ${postUrl}`);

  const profileUrl = clean(author?.profileUrl);
  if (profileUrl) lines.push(`Author profile: ${profileUrl}`);

  const meta = getLinkedInLeadMeta(json);
  const provider =
    clean(json.dataProvider) ||
    clean(meta?.dataProvider) ||
    clean(meta?.provider);
  if (provider) lines.push(`Data provider: ${provider}`);

  // Preserve original post content and line breaks; do not truncate.
  const content =
    json.content == null ? null : String(json.content);
  if (content != null && content.length > 0) {
    lines.push("");
    lines.push("Post:");
    lines.push(content);
  }

  return lines.join("\n");
}

/**
 * Build plain-text clipboard payload for all LinkedIn lead results.
 */
export function formatLinkedInLeadHumanReadableCopy(
  value: unknown,
  workflowItems?: WorkflowItem[]
): string {
  const items = resolveLinkedInLeadCopyItems(value, workflowItems);
  const header = [
    "LinkedIn Lead Discovery Results",
    `${items.length} opportunit${items.length === 1 ? "y" : "ies"}`,
  ].join("\n");

  if (!items.length) {
    return `${header}\n\nNo candidate opportunities in this execution.`;
  }

  const bodies = items.map((row, i) => formatOneOpportunity(row, i + 1));
  return [header, "", DIVIDER, bodies.join(`\n${DIVIDER}\n`), DIVIDER].join(
    "\n"
  );
}

/** True when clipboard should use LinkedIn human-readable format. */
export function shouldCopyLinkedInLeadHumanReadable(value: unknown): boolean {
  return (
    resolveOutputPresentation(value)?.provider === "linkedin_lead_discovery"
  );
}
