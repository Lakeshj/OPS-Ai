"use client";

import React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkflowItem } from "@/modules/workflows/types";
import {
  buildInstagramReadableBlock,
  type InstagramInsightBreakdownTable,
  type InstagramMediaListRow,
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

const BREAKDOWN_PREVIEW_ROWS = 15;

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
  const copyText = blocks.map((b) => b.text).filter(Boolean).join("\n\n");

  return (
    <div
      className={
        className ||
        "shrink-0 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2"
      }
      data-instagram-output-preview="true"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Instagram
        </div>
        {copyText ? <HumanCopyButton text={copyText} /> : null}
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

function HumanCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded border border-border/60 bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
      title="Copy human-readable insights"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function resolveBlocks(
  items: WorkflowItem[] | undefined,
  value: unknown
): InstagramReadableBlock[] {
  if (value !== undefined) {
    const resolved = resolveOutputPresentation(value);
    if (resolved?.provider === "instagram" && resolved.blocks?.length) {
      return resolved.blocks;
    }
  }
  if (items?.length) {
    const fromItems = resolveOutputPresentation(items);
    if (fromItems?.provider === "instagram" && fromItems.blocks?.length) {
      return fromItems.blocks;
    }
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
  if (block.layout === "media_list") {
    return <MediaListCard block={block} />;
  }
  if (block.layout === "insights") {
    const period = block.lines.find((l) => l.label === "Period")?.value;
    const timeframe = block.lines.find((l) => l.label === "Timeframe")?.value;
    const range = block.lines.find((l) => l.label === "Range")?.value;
    const hasBreakdown = Boolean(block.breakdownTables?.length);
    const hasStats = Boolean(block.stats?.length);
    return (
      <div className="space-y-3" data-instagram-insights-card="true">
        <div className="text-xs font-semibold text-foreground">{block.title}</div>
        {timeframe ? (
          <div className="text-[11px] text-muted-foreground">
            Timeframe: {timeframe}
          </div>
        ) : period ? (
          <div className="text-[11px] text-muted-foreground">
            Period: {period}
          </div>
        ) : range ? (
          <div className="text-[11px] text-muted-foreground">{range}</div>
        ) : null}
        {hasBreakdown
          ? block.breakdownTables!.map((table) => (
              <InsightBreakdownTableView
                key={`${table.metricLabel}-${table.breakdownKey}-${table.timeframeKey || ""}`}
                table={table}
              />
            ))
          : null}
        {hasStats ? <StatsRow stats={block.stats!} /> : null}
        {!hasBreakdown && !hasStats
          ? block.lines
              .filter(
                (l) =>
                  l.label !== "Period" &&
                  l.label !== "Range" &&
                  l.label !== "Timeframe"
              )
              .map((row) => (
                <div key={row.label}>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {row.label}
                  </div>
                  <div className="whitespace-pre-wrap text-xs text-foreground">
                    {row.value}
                  </div>
                </div>
              ))
          : null}
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

const MEDIA_LIST_PREVIEW_ROWS = 10;

function MediaListCard({ block }: { block: InstagramReadableBlock }) {
  const rows = block.mediaRows || [];
  const [expanded, setExpanded] = React.useState(false);
  const needsCollapse = rows.length > MEDIA_LIST_PREVIEW_ROWS;
  const visible =
    needsCollapse && !expanded
      ? rows.slice(0, MEDIA_LIST_PREVIEW_ROWS)
      : rows;
  const hiddenCount = Math.max(0, rows.length - MEDIA_LIST_PREVIEW_ROWS);

  return (
    <div className="space-y-2" data-instagram-media-list="true">
      <div className="text-xs font-semibold text-foreground">{block.title}</div>
      <ul className="divide-y divide-border/50 rounded-md border border-border/60">
        {visible.map((row) => (
          <li key={row.id}>
            <MediaListRowView row={row} />
          </li>
        ))}
      </ul>
      {needsCollapse ? (
        <button
          type="button"
          className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
          data-instagram-media-list-toggle="true"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : `Show ${hiddenCount} more`}
        </button>
      ) : null}
    </div>
  );
}

function MediaListRowView({ row }: { row: InstagramMediaListRow }) {
  const [expanded, setExpanded] = React.useState(false);
  const typeLabel = [row.mediaType, row.productType].filter(Boolean).join(" · ");
  const metaBits = [
    row.likeCount != null ? `${row.likeCount} likes` : null,
    row.commentsCount != null ? `${row.commentsCount} comments` : null,
    row.timestamp || null,
  ].filter(Boolean);
  const showExpand = Boolean(row.captionFull);

  return (
    <div className="flex gap-2.5 px-2 py-2" data-instagram-media-list-row={row.id}>
      {row.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={row.thumbnailUrl}
          alt=""
          className="h-12 w-12 shrink-0 rounded object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="h-12 w-12 shrink-0 rounded bg-muted" aria-hidden />
      )}
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {typeLabel ? (
            <span className="text-[11px] font-medium text-foreground">
              {typeLabel}
            </span>
          ) : (
            <span className="text-[11px] font-medium text-foreground">Media</span>
          )}
          {row.permalink ? (
            <a
              href={row.permalink}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            >
              Open
            </a>
          ) : null}
        </div>
        {metaBits.length ? (
          <div className="text-[10px] text-muted-foreground">
            {metaBits.join(" · ")}
          </div>
        ) : null}
        {row.captionPreview || row.captionFull ? (
          <div className="text-xs leading-snug text-foreground">
            <span className="whitespace-pre-wrap">
              {expanded && row.captionFull
                ? row.captionFull
                : row.captionPreview}
            </span>
            {showExpand ? (
              <button
                type="button"
                className="ml-1 text-[10px] text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? "Less" : "More"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
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

function InsightBreakdownTableView({
  table,
}: {
  table: InstagramInsightBreakdownTable;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const truncate =
    table.collapsible && table.rows.length > BREAKDOWN_PREVIEW_ROWS;
  const visible =
    truncate && !expanded
      ? table.rows.slice(0, BREAKDOWN_PREVIEW_ROWS)
      : table.rows;

  return (
    <div
      className="space-y-2"
      data-instagram-insights-breakdown={table.breakdownKey}
    >
      <div>
        <div className="text-xs font-medium text-foreground">
          {table.metricLabel}
        </div>
        <div className="text-[11px] text-muted-foreground">
          Breakdown: {table.breakdownLabel}
        </div>
        {table.timeframeLabel ? (
          <div className="text-[11px] text-muted-foreground">
            Timeframe: {table.timeframeLabel}
          </div>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-md border border-border/60">
        <div className="grid grid-cols-2 gap-0 border-b border-border/60 bg-muted/40 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <div>{table.breakdownLabel}</div>
          <div className="text-right">{table.valueColumnLabel}</div>
        </div>
        <ul className="divide-y divide-border/40">
          {visible.map((row) => (
            <li
              key={`${row.label}-${row.value}`}
              className="grid grid-cols-2 gap-0 px-2 py-1.5 text-xs text-foreground"
            >
              <span>{row.label}</span>
              <span className="text-right tabular-nums">{row.value}</span>
            </li>
          ))}
        </ul>
      </div>
      {truncate ? (
        <button
          type="button"
          className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Collapse" : "Show all"}
        </button>
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
