"use client";

import React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkflowItem } from "@/modules/workflows/types";
import {
  META_ADS_LIST_PREVIEW_ROWS,
  buildMetaAdsReadableBlock,
  type MetaAdsListRow,
  type MetaAdsReadableBlock,
} from "@/modules/workflows/metaAdsOutputPresentation";
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
 * Human-readable Meta Ads preview. Raw JSON remains with the caller / JSON tab.
 * Display-only — does not mutate workflow output.
 */
export function MetaAdsOutputPreview({
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
      data-meta-ads-output-preview="true"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Meta Ads
        </div>
        {copyText ? <HumanCopyButton text={copyText} /> : null}
      </div>
      {!showList ? (
        <MetaAdsBlockView block={blocks[0]!} />
      ) : (
        <ul className="space-y-3">
          {blocks.map((block, i) => (
            <li
              key={i}
              className="border-t border-border/40 pt-2 first:border-0 first:pt-0"
            >
              <MetaAdsBlockView block={block} compact />
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
      title="Copy human-readable Meta Ads result"
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
): MetaAdsReadableBlock[] {
  if (value !== undefined) {
    const resolved = resolveOutputPresentation(value);
    if (resolved?.provider === "meta_ads" && resolved.blocks?.length) {
      return resolved.blocks;
    }
  }
  if (items?.length) {
    const fromItems = resolveOutputPresentation(items);
    if (fromItems?.provider === "meta_ads" && fromItems.blocks?.length) {
      return fromItems.blocks;
    }
    return items
      .map((item, index) =>
        buildMetaAdsReadableBlock(
          (item?.json || {}) as Record<string, unknown>,
          index
        )
      )
      .filter(Boolean) as MetaAdsReadableBlock[];
  }
  return [];
}

function MetaAdsBlockView({
  block,
  compact,
}: {
  block: MetaAdsReadableBlock;
  compact?: boolean;
}) {
  if (
    block.layout === "entity_list" ||
    block.layout === "delivery_list"
  ) {
    return <EntityListCard block={block} />;
  }
  if (block.layout === "insights") {
    return <InsightsCard block={block} />;
  }
  if (block.layout === "account" || block.layout === "entity") {
    return <EntityCard block={block} compact={compact} />;
  }
  return <EntityCard block={block} compact={compact} />;
}

function EntityCard({
  block,
  compact,
}: {
  block: MetaAdsReadableBlock;
  compact?: boolean;
}) {
  return (
    <div
      className={cn("space-y-2", compact && "space-y-1.5")}
      data-meta-ads-entity-card="true"
    >
      <div className="text-xs font-semibold text-foreground">{block.title}</div>
      {block.headerName ? (
        <div className="text-sm font-medium text-foreground">
          {block.headerName}
        </div>
      ) : null}
      {block.subtitle ? (
        <div className="text-[11px] text-muted-foreground">{block.subtitle}</div>
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

function EntityListCard({ block }: { block: MetaAdsReadableBlock }) {
  const rows = block.listRows || [];
  const [expanded, setExpanded] = React.useState(false);
  const needsCollapse = rows.length > META_ADS_LIST_PREVIEW_ROWS;
  const visible =
    needsCollapse && !expanded
      ? rows.slice(0, META_ADS_LIST_PREVIEW_ROWS)
      : rows;
  const hiddenCount = Math.max(0, rows.length - META_ADS_LIST_PREVIEW_ROWS);

  return (
    <div className="space-y-2" data-meta-ads-entity-list="true">
      <div className="text-xs font-semibold text-foreground">{block.title}</div>
      {block.subtitle ? (
        <div className="text-[11px] text-muted-foreground">{block.subtitle}</div>
      ) : null}
      <ul className="divide-y divide-border/50 rounded-md border border-border/60">
        {visible.map((row) => (
          <li key={row.id}>
            <ListRowView row={row} delivery={block.layout === "delivery_list"} />
          </li>
        ))}
      </ul>
      {needsCollapse ? (
        <button
          type="button"
          className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
          data-meta-ads-list-toggle="true"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : `Show ${hiddenCount} more`}
        </button>
      ) : null}
    </div>
  );
}

function ListRowView({
  row,
  delivery,
}: {
  row: MetaAdsListRow;
  delivery?: boolean;
}) {
  return (
    <div
      className="flex items-start justify-between gap-3 px-2.5 py-2"
      data-meta-ads-list-row={row.id}
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="text-xs font-medium text-foreground">{row.title}</div>
        {row.subtitle && !delivery ? (
          <div className="text-[10px] text-muted-foreground">{row.subtitle}</div>
        ) : null}
        {row.metaBits?.length && !delivery ? (
          <div className="text-[10px] text-muted-foreground">
            {row.metaBits.join(" · ")}
          </div>
        ) : null}
        {delivery && row.subtitle ? (
          <div className="text-[10px] text-muted-foreground">{row.subtitle}</div>
        ) : null}
      </div>
      {row.status ? (
        <div className="shrink-0 text-xs font-medium text-foreground">
          {row.status}
        </div>
      ) : null}
    </div>
  );
}

function InsightsCard({ block }: { block: MetaAdsReadableBlock }) {
  const rows = block.listRows || [];
  const [expanded, setExpanded] = React.useState(false);
  const needsCollapse = rows.length > META_ADS_LIST_PREVIEW_ROWS;
  const visible =
    needsCollapse && !expanded
      ? rows.slice(0, META_ADS_LIST_PREVIEW_ROWS)
      : rows;
  const hiddenCount = Math.max(0, rows.length - META_ADS_LIST_PREVIEW_ROWS);

  return (
    <div className="space-y-3" data-meta-ads-insights-card="true">
      <div className="text-xs font-semibold text-foreground">{block.title}</div>
      {block.subtitle ? (
        <div className="text-[11px] text-muted-foreground">{block.subtitle}</div>
      ) : null}
      {(block.metrics || block.lines).length ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          {(block.metrics || block.lines).map((row) => (
            <div key={row.label}>
              <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {row.label}
              </dt>
              <dd className="text-sm font-medium tabular-nums text-foreground">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {rows.length ? (
        <div className="space-y-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Rows
          </div>
          <ul className="divide-y divide-border/50 rounded-md border border-border/60">
            {visible.map((row) => (
              <li key={row.id}>
                <ListRowView row={row} />
              </li>
            ))}
          </ul>
          {needsCollapse ? (
            <button
              type="button"
              className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
              data-meta-ads-list-toggle="true"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Show less" : `Show ${hiddenCount} more`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
