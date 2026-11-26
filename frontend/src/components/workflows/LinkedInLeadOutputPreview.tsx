"use client";

import React from "react";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkflowItem } from "@/modules/workflows/types";
import {
  LINKEDIN_LEAD_LIST_PREVIEW_ROWS,
  type LinkedInLeadReadableBlock,
} from "@/modules/workflows/linkedinLeadOutputPresentation";
import { resolveOutputPresentation } from "@/modules/workflows/outputPresentation";

type Props = {
  items?: WorkflowItem[];
  value?: unknown;
  className?: string;
  showTechnicalHint?: boolean;
};

function buildCopyJson(items: WorkflowItem[] | undefined, value: unknown) {
  if (value != null && typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  if (Array.isArray(items) && items.length) {
    return JSON.stringify(
      items.map((row) => row?.json ?? row),
      null,
      2
    );
  }
  return "[]";
}

export function LinkedInLeadOutputPreview({
  items,
  value,
  className,
  showTechnicalHint = true,
}: Props) {
  const blocks = resolveBlocks(items, value);
  if (!blocks.length) return null;
  const block = blocks[0]!;
  const rows = block.listRows || [];
  const [expanded, setExpanded] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const needsCollapse = rows.length > LINKEDIN_LEAD_LIST_PREVIEW_ROWS;
  const visible =
    needsCollapse && !expanded
      ? rows.slice(0, LINKEDIN_LEAD_LIST_PREVIEW_ROWS)
      : rows;
  const hidden = Math.max(0, rows.length - LINKEDIN_LEAD_LIST_PREVIEW_ROWS);

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(buildCopyJson(items, value));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Clipboard not available");
    }
  };

  return (
    <div
      className={
        className ||
        "shrink-0 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2"
      }
      data-linkedin-lead-output-preview="true"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          LinkedIn Lead Discovery
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-[10px]"
          onClick={() => void copyJson()}
          title="Copy complete JSON output"
          data-linkedin-lead-copy-json="true"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy JSON"}
        </Button>
      </div>
      <div className="text-xs font-semibold text-foreground">{block.title}</div>
      <ul className="mt-2 divide-y divide-border/50 rounded-md border border-border/60">
        {visible.map((row) => (
          <li key={row.id} className="space-y-0.5 px-2.5 py-2">
            <div className="text-xs font-medium text-foreground">{row.title}</div>
            {row.subtitle ? (
              <div className="text-[10px] text-muted-foreground">{row.subtitle}</div>
            ) : null}
            {row.metaBits?.length ? (
              <div className="text-[10px] text-muted-foreground">
                {row.metaBits.join(" · ")}
              </div>
            ) : null}
            {row.permalink ? (
              <a
                href={row.permalink}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
              >
                Open post
              </a>
            ) : null}
          </li>
        ))}
      </ul>
      {needsCollapse ? (
        <button
          type="button"
          className="mt-2 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : `Show ${hidden} more`}
        </button>
      ) : null}
      {showTechnicalHint ? (
        <p className="mt-2 text-[10px] text-muted-foreground">
          Candidate opportunities only — not auto-qualified leads. Raw JSON remains available.
        </p>
      ) : null}
    </div>
  );
}

function resolveBlocks(
  items: WorkflowItem[] | undefined,
  value: unknown
): LinkedInLeadReadableBlock[] {
  if (value !== undefined) {
    const resolved = resolveOutputPresentation(value);
    if (
      resolved?.provider === "linkedin_lead_discovery" &&
      resolved.blocks?.length
    ) {
      return resolved.blocks;
    }
  }
  if (items?.length) {
    const fromItems = resolveOutputPresentation(items);
    if (
      fromItems?.provider === "linkedin_lead_discovery" &&
      fromItems.blocks?.length
    ) {
      return fromItems.blocks;
    }
  }
  return [];
}
