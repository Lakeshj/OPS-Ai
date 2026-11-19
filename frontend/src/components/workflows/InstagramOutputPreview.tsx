"use client";

import React from "react";
import type { WorkflowItem } from "@/modules/workflows/types";
import {
  buildInstagramReadableBlock,
  isInstagramOutputJson,
} from "@/modules/workflows/instagramOutputPresentation";

type Props = {
  items: WorkflowItem[];
  className?: string;
};

/**
 * Human-readable Instagram inspector preview. Raw JSON remains in the JSON tab.
 */
export function InstagramOutputPreview({ items, className }: Props) {
  const blocks = items
    .map((item, index) => {
      const json = (item?.json || {}) as Record<string, unknown>;
      if (!isInstagramOutputJson(json)) return null;
      return buildInstagramReadableBlock(json, index);
    })
    .filter(Boolean);

  if (!blocks.length) return null;

  // Account get: one rich card. Multi media/insights: compact list.
  const primary = blocks[0]!;
  const showList = blocks.length > 1;

  return (
    <div
      className={
        className ||
        "shrink-0 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2"
      }
      data-instagram-output-preview="true"
    >
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Instagram
      </div>
      {!showList ? (
        <AccountOrSingleBlock block={primary} />
      ) : (
        <ul className="space-y-3">
          {blocks.map((block, i) => (
            <li key={i} className="border-t border-border/40 pt-2 first:border-0 first:pt-0">
              <AccountOrSingleBlock block={block!} compact />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[10px] text-muted-foreground">
        Technical fields and full payload are in the JSON tab.
      </p>
    </div>
  );
}

function AccountOrSingleBlock({
  block,
  compact,
}: {
  block: NonNullable<ReturnType<typeof buildInstagramReadableBlock>>;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "space-y-1.5" : "space-y-2"}>
      <div className="text-xs font-semibold text-foreground">{block.title}</div>
      {block.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={block.imageUrl}
          alt=""
          className={
            compact
              ? "h-12 w-12 rounded-full object-cover"
              : "h-16 w-16 rounded-full object-cover"
          }
          referrerPolicy="no-referrer"
        />
      ) : null}
      <dl className="space-y-1.5">
        {block.lines.map((row) => (
          <div key={row.label}>
            <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {row.label}
            </dt>
            <dd className="whitespace-pre-wrap text-xs text-foreground">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
