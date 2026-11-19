"use client";

import React from "react";
import { cn } from "@/lib/utils";
import type { WorkflowItem } from "@/modules/workflows/types";
import {
  buildInstagramReadableBlock,
  type InstagramReadableBlock,
} from "@/modules/workflows/instagramOutputPresentation";
import { resolveOutputPresentation } from "@/modules/workflows/outputPresentation";

type Props = {
  items?: WorkflowItem[];
  /** Raw value when items are not pre-normalized (Result wrapper / Final Result). */
  value?: unknown;
  className?: string;
  /** Hide the "JSON tab" hint outside inspector contexts. */
  showTechnicalHint?: boolean;
};

/**
 * Human-readable Instagram preview. Raw JSON remains with the caller / JSON tab.
 */
export function InstagramOutputPreview({
  items,
  value,
  className,
  showTechnicalHint = true,
}: Props) {
  const blocks = resolveBlocks(items, value);
  if (!blocks.length) return null;

  const showList = blocks.length > 1;

  return (
    <div
      className={
        className ||
        "shrink-0 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2"
      }
      data-instagram-output-preview="true"
    >
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Instagram
      </div>
      {!showList ? (
        <InstagramBlockView block={blocks[0]!} />
      ) : (
        <ul className="space-y-3">
          {blocks.map((block, i) => (
            <li
              key={i}
              className="border-t border-border/40 pt-2 first:border-0 first:pt-0"
            >
              <InstagramBlockView block={block} compact />
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
): InstagramReadableBlock[] {
  if (value !== undefined) {
    const resolved = resolveOutputPresentation(value);
    if (resolved?.blocks?.length) return resolved.blocks;
  }
  if (items?.length) {
    const fromItems = resolveOutputPresentation(items);
    if (fromItems?.blocks?.length) return fromItems.blocks;
    // Direct WorkflowItem.json fallback
    return items
      .map((item, index) =>
        buildInstagramReadableBlock(
          (item?.json || {}) as Record<string, unknown>,
          index
        )
      )
      .filter(Boolean) as InstagramReadableBlock[];
  }
  return [];
}

function InstagramBlockView({
  block,
  compact,
}: {
  block: InstagramReadableBlock;
  compact?: boolean;
}) {
  if (block.layout === "account") {
    return <AccountCard block={block} compact={compact} />;
  }
  if (block.layout === "insights" && block.stats?.length) {
    const range = block.lines.find((l) => l.label === "Range")?.value;
    return (
      <div className="space-y-2">
        <div className="text-xs font-semibold text-foreground">{block.title}</div>
        {range ? (
          <div className="text-[11px] text-muted-foreground">{range}</div>
        ) : null}
        <StatsRow stats={block.stats} />
      </div>
    );
  }
  return (
    <div className={compact ? "space-y-1.5" : "space-y-2"}>
      <div className="text-xs font-semibold text-foreground">{block.title}</div>
      {block.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={block.imageUrl}
          alt=""
          className={cn(
            "rounded-md object-cover",
            compact ? "h-14 w-14" : "h-20 w-20"
          )}
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

function AccountCard({
  block,
  compact,
}: {
  block: InstagramReadableBlock;
  compact?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold text-foreground">{block.title}</div>
      <div className="flex items-start gap-3">
        {block.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={block.imageUrl}
            alt=""
            className={cn(
              "shrink-0 rounded-full object-cover",
              compact ? "h-12 w-12" : "h-14 w-14"
            )}
            referrerPolicy="no-referrer"
          />
        ) : (
          <div
            className={cn(
              "shrink-0 rounded-full bg-muted",
              compact ? "h-12 w-12" : "h-14 w-14"
            )}
            aria-hidden
          />
        )}
        <div className="min-w-0 space-y-0.5">
          {block.headerName ? (
            <div className="truncate text-sm font-medium text-foreground">
              {block.headerName}
            </div>
          ) : null}
          {block.headerUsername ? (
            <div className="truncate text-xs text-muted-foreground">
              {block.headerUsername}
            </div>
          ) : null}
          {block.headerAccountType ? (
            <div className="text-[11px] text-muted-foreground">
              {block.headerAccountType}
            </div>
          ) : null}
        </div>
      </div>
      {block.stats && block.stats.length > 0 ? (
        <StatsRow stats={block.stats} />
      ) : null}
      {block.biography ? (
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Biography
          </div>
          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-foreground">
            {block.biography}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function StatsRow({
  stats,
}: {
  stats: Array<{ label: string; value: string }>;
}) {
  return (
    <div
      className="grid gap-2"
      style={{
        gridTemplateColumns: `repeat(${Math.min(stats.length, 4)}, minmax(0, 1fr))`,
      }}
    >
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-md border border-border/60 bg-background/60 px-2 py-1.5"
        >
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {stat.label}
          </div>
          <div className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
            {stat.value}
          </div>
        </div>
      ))}
    </div>
  );
}
