import { format, formatDistanceToNow, isValid } from "date-fns";

/** Sidebar / list subtitle: "Last updated 3 days ago | Created 1 September" */
export function formatWorkflowListMeta(
  updatedAt?: string | null,
  createdAt?: string | null
): string {
  const parts: string[] = [];
  if (updatedAt) {
    const d = new Date(updatedAt);
    if (isValid(d)) {
      parts.push(
        `Last updated ${formatDistanceToNow(d, { addSuffix: true })}`
      );
    }
  }
  if (createdAt) {
    const d = new Date(createdAt);
    if (isValid(d)) {
      parts.push(`Created ${format(d, "d MMMM")}`);
    }
  }
  return parts.join(" | ");
}
