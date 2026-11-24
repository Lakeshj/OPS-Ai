"use client";

import React from "react";
import type { WorkflowItem } from "@/modules/workflows/types";
import {
  FACEBOOK_PAGE_LIST_PREVIEW_ROWS,
  buildFacebookPageReadableBlock,
  type FacebookPageReadableBlock,
} from "@/modules/workflows/facebookPageOutputPresentation";
import { resolveOutputPresentation } from "@/modules/workflows/outputPresentation";

type Props = {
  items?: WorkflowItem[];
  value?: unknown;
  className?: string;
  showTechnicalHint?: boolean;
};

export function FacebookPageOutputPreview({
  items,
  value,
  className,
  showTechnicalHint = true,
}: Props) {
  const blocks = resolveBlocks(items, value);
  if (!blocks.length) return null;

  return (
    <div
      className={
        className ||
        "shrink-0 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2"
      }
      data-facebook-page-output-preview="true"
    >
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Facebook Page
      </div>
      {blocks.length === 1 ? (
        <BlockView block={blocks[0]!} />
      ) : (
        <ul className="space-y-3">
          {blocks.map((block, i) => (
            <li key={i} className="border-t border-border/40 pt-2 first:border-0 first:pt-0">
              <BlockView block={block} />
            </li>
          ))}
        </ul>
      )}
      {showTechnicalHint ? (
        <p className="mt-2 text-[10px] text-muted-foreground">
          Technical fields and full payload are in JSON / Raw data.
        </p>
      ) : null}
    </div>
  );
}

function resolveBlocks(
  items: WorkflowItem[] | undefined,
  value: unknown
): FacebookPageReadableBlock[] {
  if (value !== undefined) {
    const resolved = resolveOutputPresentation(value);
    if (resolved?.provider === "facebook_page" && resolved.blocks?.length) {
      return resolved.blocks;
    }
  }
  if (items?.length) {
    const fromItems = resolveOutputPresentation(items);
    if (fromItems?.provider === "facebook_page" && fromItems.blocks?.length) {
      return fromItems.blocks;
    }
    return items
      .map((item, index) =>
        buildFacebookPageReadableBlock(
          (item?.json || {}) as Record<string, unknown>,
          index
        )
      )
      .filter(Boolean) as FacebookPageReadableBlock[];
  }
  return [];
}

function BlockView({ block }: { block: FacebookPageReadableBlock }) {
  const [expanded, setExpanded] = React.useState(false);
  const rows = block.listRows || [];
  const needsCollapse = rows.length > FACEBOOK_PAGE_LIST_PREVIEW_ROWS;
  const visible =
    needsCollapse && !expanded
      ? rows.slice(0, FACEBOOK_PAGE_LIST_PREVIEW_ROWS)
      : rows;
  const hidden = Math.max(0, rows.length - FACEBOOK_PAGE_LIST_PREVIEW_ROWS);

  if (block.layout === "post_list" || (block.layout === "comments" && rows.length)) {
    return (
      <div className="space-y-2">
        <div className="text-xs font-semibold text-foreground">{block.title}</div>
        <ul className="divide-y divide-border/50 rounded-md border border-border/60">
          {visible.map((row) => (
            <li key={row.id} className="flex gap-2.5 px-2.5 py-2">
              {row.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={row.thumbnailUrl}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : null}
              <div className="min-w-0 flex-1 space-y-0.5">
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
              </div>
            </li>
          ))}
        </ul>
        {needsCollapse ? (
          <button
            type="button"
            className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Show less" : `Show ${hidden} more`}
          </button>
        ) : null}
      </div>
    );
  }

  if (block.layout === "insights") {
    return (
      <div className="space-y-2">
        <div className="text-xs font-semibold text-foreground">{block.title}</div>
        {block.subtitle ? (
          <div className="text-[11px] text-muted-foreground">{block.subtitle}</div>
        ) : null}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          {(block.metrics || block.lines).map((row) => (
            <div key={row.label}>
              <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {row.label}
              </dt>
              <dd className="text-sm font-medium text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-foreground">{block.title}</div>
      {block.headerName ? (
        <div className="text-sm font-medium text-foreground">{block.headerName}</div>
      ) : null}
      {block.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={block.imageUrl}
          alt=""
          className="h-16 w-16 rounded object-cover"
          referrerPolicy="no-referrer"
        />
      ) : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {block.lines.map((row) => (
          <React.Fragment key={row.label}>
            <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {row.label}
            </dt>
            <dd className="text-xs text-foreground">{row.value}</dd>
          </React.Fragment>
        ))}
      </dl>
    </div>
  );
}
