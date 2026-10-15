"use client";

import React, { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import type { WorkflowItem } from "@/modules/workflows/types";
import {
  INSPECTOR_ITEM_SPLIT_CLASS,
  INSPECTOR_PANE_SCROLL_CLASS,
  buildDisplayTable,
  canonicalJsonForView,
  formatCompactCell,
  inferSchemaKind,
  prettyJson,
  type SchemaKind,
  toCanonicalItems,
} from "@/modules/workflows/inspectorViewModel";
import { Check, ChevronDown, ChevronRight, Copy, Search } from "lucide-react";
import { toast } from "sonner";
import {
  looksLikeMarkdownProse,
  WorkflowProseContent,
} from "./WorkflowProseContent";

type ViewMode = "table" | "schema" | "json" | "binary";

type Props = {
  items?: WorkflowItem[] | unknown[];
  data?: unknown;
  emptyMessage?: string;
  className?: string;
  selectedItemIndex?: number;
  onSelectedItemIndexChange?: (index: number) => void;
  /** When true, only render canonical items — never handler summary metadata rows. */
  canonicalItemsOnly?: boolean;
};

type SpreadsheetPayload = {
  headers: unknown[];
  rows: unknown[];
};

type SchemaField = {
  key: string;
  value: unknown;
  type: SchemaKind;
  depth: number;
};

function ProseCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Clipboard not available");
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-6 gap-1 px-1.5 text-[10px]"
      onClick={() => void copy()}
      title="Copy preview"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

const COLUMN_LABELS: Record<string, string> = {
  query: "Top Queries",
  page: "Top Pages",
  clicks: "clicks",
  impressions: "impressions",
  ctr: "CTR",
  position: "Position",
};

const tableColumnLabel = (key: string) => COLUMN_LABELS[key] || key;

function isSpreadsheetPayload(value: unknown): value is SpreadsheetPayload {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as SpreadsheetPayload).headers) &&
    Array.isArray((value as SpreadsheetPayload).rows)
  );
}

function spreadsheetToItems(payload: SpreadsheetPayload): WorkflowItem[] {
  const headers = payload.headers.map((h) => String(h));
  return payload.rows.map((row) => {
    const json: Record<string, unknown> = {};
    if (Array.isArray(row)) {
      headers.forEach((header, index) => {
        json[header] = row[index];
      });
    } else if (row && typeof row === "object") {
      const record = row as Record<string, unknown>;
      for (const header of headers) {
        json[header] = record[header];
      }
    }
    return { json };
  });
}

function toWorkflowItem(item: unknown): WorkflowItem {
  if (item && typeof item === "object" && "json" in (item as object)) {
    const row = item as WorkflowItem;
    return {
      json: { ...((row.json || {}) as Record<string, unknown>) },
      ...(row.binary ? { binary: row.binary } : {}),
      ...(row.pairedItem != null ? { pairedItem: row.pairedItem } : {}),
    };
  }
  if (item && typeof item === "object" && !Array.isArray(item)) {
    return { json: { ...(item as Record<string, unknown>) } };
  }
  return { json: { value: item } };
}

function mergeEnvelope(
  item: WorkflowItem,
  envelope?: Record<string, unknown>
): WorkflowItem {
  if (!envelope) return item;
  return {
    ...item,
    json: { ...envelope, ...(item.json || {}) },
  };
}

function looksLikeNodeIdKey(key: string): boolean {
  return /^[a-zA-Z][\w-]*-\d+$/.test(key);
}

function isIncomingSnapshot(data: unknown): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const entries = Object.entries(data as Record<string, unknown>);
  if (entries.length === 0) return false;
  return entries.every(
    ([key, value]) =>
      looksLikeNodeIdKey(key) && value != null && typeof value === "object"
  );
}

function incomingSnapshotToItems(data: unknown): WorkflowItem[] | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const entries = Object.entries(data as Record<string, unknown>);
  if (entries.length === 0) return null;

  const looksLikeSnapshot = entries.every(
    ([, value]) => value != null && typeof value === "object"
  );
  if (!looksLikeSnapshot) return null;

  const rows: WorkflowItem[] = [];
  for (const [, value] of entries) {
    if (isSpreadsheetPayload(value)) {
      rows.push(...spreadsheetToItems(value));
      continue;
    }
    if (Array.isArray(value)) {
      for (const row of value) rows.push(toWorkflowItem(row));
      continue;
    }
    rows.push(toWorkflowItem(value));
  }
  return rows.length > 0 ? rows : null;
}

function normalizeItems(
  items?: unknown[],
  data?: unknown,
  options?: { canonicalItemsOnly?: boolean }
): WorkflowItem[] {
  if (options?.canonicalItemsOnly) {
    return toCanonicalItems(Array.isArray(items) ? items : []);
  }

  if (isSpreadsheetPayload(data)) {
    return spreadsheetToItems(data);
  }

  if (Array.isArray(items)) {
    if (items.length === 0) return [];
    if (isSpreadsheetPayload(data)) return spreadsheetToItems(data);
    const envelope =
      data &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      !isIncomingSnapshot(data)
        ? (data as Record<string, unknown>)
        : undefined;
    return items.map((item) => mergeEnvelope(toWorkflowItem(item), envelope));
  }

  const fromIncoming = incomingSnapshotToItems(data);
  if (fromIncoming) return fromIncoming;

  return toCanonicalItems(undefined, data);
}

function shouldHideNestedObjectColumn(
  rows: WorkflowItem[],
  column: "input" | "result"
): boolean {
  for (const row of rows) {
    const nested = row.json?.[column];
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) continue;
    const childKeys = Object.keys(nested as object);
    if (childKeys.length === 0) continue;
    if (childKeys.every((k) => k in (row.json || {}))) return true;
  }
  return false;
}

function shouldHideInputColumn(rows: WorkflowItem[]): boolean {
  return shouldHideNestedObjectColumn(rows, "input");
}

function shouldHideResultColumn(rows: WorkflowItem[]): boolean {
  return shouldHideNestedObjectColumn(rows, "result");
}

function formatCellValue(value: unknown, maxLen = 200): string {
  return formatCompactCell(value, { maxLen }).text;
}

function formatRatePercent(value: unknown): string | null {
  if (value == null || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return `${(num * 100).toFixed(2)}%`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function landingRowsOf(json: Record<string, unknown> | undefined): unknown[] | null {
  if (!json) return null;
  const direct = json.opportunities;
  const nested = asRecord(json.json)?.opportunities;
  const rows = Array.isArray(direct) ? direct : Array.isArray(nested) ? nested : null;
  if (!rows?.length) return null;
  const landing = rows.some((row) => {
    const obj = asRecord(row);
    return obj != null && (obj.landingPage != null || obj.pagePath != null);
  });
  return landing ? rows : null;
}

function detailRowsOf(json: Record<string, unknown>): unknown[] {
  if (Array.isArray(json.mcpOpportunityDetails)) return json.mcpOpportunityDetails;
  if (Array.isArray(json.enrichedOpportunities)) return json.enrichedOpportunities;
  return [];
}

/** Same landing report the Result node writes, for the output table and preview. */
function formatLandingReport(rows: unknown[], details: unknown[]): string {
  const byRank = new Map<number, Record<string, unknown>>();
  const byLanding = new Map<string, Record<string, unknown>>();
  for (const entry of details) {
    const d = asRecord(entry);
    if (!d) continue;
    if (d.rank != null) byRank.set(Number(d.rank), d);
    if (d.landingPage != null) byLanding.set(String(d.landingPage), d);
  }
  const lines = ["GA4 Intelligence Report", "", "Landing Underperformance Opportunities", ""];
  rows.forEach((row, idx) => {
    const obj = asRecord(row) || {};
    const rank = obj.rank != null ? Number(obj.rank) : idx + 1;
    const landingPage =
      obj.landingPage != null
        ? String(obj.landingPage)
        : obj.pagePath != null
          ? String(obj.pagePath)
          : "(unknown)";
    const mcp =
      (Number.isFinite(rank) ? byRank.get(rank) : undefined) ||
      byLanding.get(landingPage) ||
      null;
    const metrics = asRecord(mcp?.metrics);
    const sessions = obj.sessions ?? mcp?.sessions ?? metrics?.sessions;
    const engagementRate =
      obj.engagementRate ?? mcp?.engagementRate ?? metrics?.engagementRate;
    const bounceRate = obj.bounceRate ?? mcp?.bounceRate ?? metrics?.bounceRate;
    const score = obj.score ?? mcp?.score;
    const reason = obj.reason ?? mcp?.reason ?? null;
    const recommendation = obj.recommendation ?? mcp?.recommendation ?? null;
    lines.push(`${rank}. Landing Page: ${landingPage}`);
    if (sessions != null) lines.push(`   Sessions: ${sessions}`);
    if (engagementRate != null) {
      lines.push(`   Engagement Rate: ${formatRatePercent(engagementRate)}`);
    }
    if (bounceRate != null) lines.push(`   Bounce Rate: ${formatRatePercent(bounceRate)}`);
    if (score != null) lines.push(`   MCP Score: ${score}`);
    if (reason != null && String(reason).trim()) lines.push(`   Reason: ${reason}`);
    if (recommendation != null && String(recommendation).trim()) {
      lines.push(`   Recommendation: ${recommendation}`);
    }
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}

function looksLikeGoogleAdsOpportunity(row: unknown): boolean {
  const obj = asRecord(row);
  if (!obj) return false;
  const meta = asRecord(obj._meta);
  if (meta?.provider === "google_ads") return true;
  if (obj.source === "google_ads" || obj.provider === "google_ads") return true;
  if (obj.costMicros != null || obj.averageCpc != null || obj.keywordText != null || obj.searchTerm != null) {
    return true;
  }
  return obj.campaignId != null && (obj.impressions != null || obj.clicks != null || obj.cost != null);
}

function formatGoogleAdsOpportunityReport(rows: unknown[]): string {
  const lines = ["Google Ads Report", ""];
  rows.forEach((row, index) => {
    const obj = asRecord(row) || {};
    const name =
      obj.keywordText ?? obj.searchTerm ?? obj.adGroupName ?? obj.campaignName ?? obj.device ?? "Campaign";
    lines.push(`${index + 1}. ${String(name)}`);
    for (const [key, label] of [
      ["campaignId", "Campaign ID"],
      ["campaignStatus", "Status"],
      ["impressions", "Impressions"],
      ["clicks", "Clicks"],
      ["ctr", "CTR"],
      ["cost", "Cost"],
      ["averageCpc", "Average CPC"],
      ["conversions", "Conversions"],
      ["conversionsValue", "Conversion value"],
    ] as const) {
      const value = obj[key];
      if (value == null || value === "" || typeof value === "object") continue;
      lines.push(`   - ${label}: ${String(value)}`);
    }
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}

function readableReport(json: Record<string, unknown> | undefined): string | null {
  if (!json) return null;
  for (const key of ["result", "text", "message", "summary"]) {
    const v = json[key];
    if (typeof v === "string" && looksLikeMarkdownProse(v)) return v;
  }
  const direct = json.opportunities;
  const nested = asRecord(json.json)?.opportunities;
  const rows = Array.isArray(direct) ? direct : Array.isArray(nested) ? nested : null;
  if (rows?.length && rows.every(looksLikeGoogleAdsOpportunity)) {
    return formatGoogleAdsOpportunityReport(rows);
  }
  const landing = landingRowsOf(json);
  if (!landing) return null;
  return formatLandingReport(landing, detailRowsOf(json));
}

/** Long AI/Result prose fields shown as rendered markdown above the table. */
function extractProseField(json: Record<string, unknown> | undefined): string | null {
  return readableReport(json);
}

/** Show the landing report in the table instead of the raw opportunities array. */
function withReadableReport(row: WorkflowItem): WorkflowItem {
  const json = (row.json || {}) as Record<string, unknown>;
  if (typeof json.result === "string" && looksLikeMarkdownProse(json.result)) return row;
  const report = readableReport(json);
  if (!report) return row;
  return { ...row, json: { ...json, result: report } };
}

function flattenSchemaFields(
  obj: unknown,
  depth = 0,
  prefix = ""
): SchemaField[] {
  if (depth > 3) return [];
  if (obj == null) {
    return [{ key: prefix || "value", value: null, type: "null", depth }];
  }
  if (typeof obj !== "object") {
    return [
      {
        key: prefix || "value",
        value: obj,
        type: inferSchemaKind(obj),
        depth,
      },
    ];
  }
  if (Array.isArray(obj)) {
    return [
      {
        key: prefix || "items",
        value: obj,
        type: inferSchemaKind(obj),
        depth,
      },
    ];
  }

  const fields: SchemaField[] = [];
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const type = inferSchemaKind(val);
    if (type === "object" && val && !Array.isArray(val)) {
      const childKeys = Object.keys(val as object);
      const flatChildren = childKeys.every(
        (k) => typeof (val as Record<string, unknown>)[k] !== "object"
      );
      if (flatChildren && childKeys.length <= 6) {
        fields.push(...flattenSchemaFields(val, depth + 1, fullKey));
      } else {
        fields.push({ key: fullKey, value: val, type: "object", depth });
      }
    } else {
      fields.push({ key: fullKey, value: val, type, depth });
    }
  }
  return fields;
}

function typeBadge(type: SchemaKind): string {
  switch (type) {
    case "string":
      return "T";
    case "number":
      return "#";
    case "boolean":
      return "✓";
    case "object":
      return "{}";
    case "array":
    case "array<string>":
    case "array<number>":
    case "array<boolean>":
    case "array<object>":
    case "mixed":
      return "[]";
    default:
      return "·";
  }
}

function schemaKindLabel(type: SchemaKind): string {
  return type;
}

function TypeBadge({ type }: { type: SchemaKind }) {
  return (
    <span
      className={cn(
        "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded px-0.5 text-[9px] font-semibold",
        type === "string" && "bg-blue-500/15 text-blue-700 dark:text-blue-300",
        type === "number" && "bg-violet-500/15 text-violet-700 dark:text-violet-300",
        type === "boolean" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
        type === "object" && "bg-amber-500/15 text-amber-700 dark:text-amber-300",
        (type === "array" ||
          type === "array<string>" ||
          type === "array<number>" ||
          type === "array<boolean>" ||
          type === "array<object>" ||
          type === "mixed") &&
          "bg-orange-500/15 text-orange-700 dark:text-orange-300",
        type === "null" && "bg-muted text-muted-foreground"
      )}
    >
      {typeBadge(type)}
    </span>
  );
}

function SchemaFieldRow({ field }: { field: SchemaField }) {
  const [open, setOpen] = useState(false);
  const isNestedObject =
    field.type === "object" &&
    field.value &&
    typeof field.value === "object" &&
    !Array.isArray(field.value);

  if (isNestedObject) {
    const children = flattenSchemaFields(field.value, field.depth + 1);
    return (
      <div className="border-b border-border/50 last:border-0">
        <button
          type="button"
          className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/40"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
          <TypeBadge type="object" />
          <span className="text-[11px] font-medium text-foreground">{field.key}</span>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {schemaKindLabel(field.type)}
          </span>
        </button>
        {open && (
          <div className="border-t border-border/40 bg-muted/20 pl-4">
            {children.map((child) => (
              <SchemaFieldRow key={child.key} field={child} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 border-b border-border/50 px-2 py-1.5 last:border-0 hover:bg-muted/30">
      <TypeBadge type={field.type} />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium text-foreground">{field.key}</div>
        <div className="mt-0.5 break-words text-[11px] text-muted-foreground">
          <span className="mr-2 font-mono text-[10px] text-muted-foreground/80">
            {schemaKindLabel(field.type)}
          </span>
          {formatCellValue(field.value, 500) || "—"}
        </div>
      </div>
    </div>
  );
}

function SchemaView({ rows, query }: { rows: WorkflowItem[]; query: string }) {
  const q = query.trim().toLowerCase();
  const hideInput = shouldHideInputColumn(rows);
  const hideResult = shouldHideResultColumn(rows);

  return (
    <div className="h-full min-h-0 overflow-auto rounded-lg border bg-card">
      {rows.map((row, itemIndex) => {
        const fields = flattenSchemaFields(row.json).filter((f) => {
          if (hideInput && f.key === "input") return false;
          if (hideResult && (f.key === "result" || f.key.startsWith("result."))) {
            return false;
          }
          if (looksLikeNodeIdKey(f.key.split(".")[0])) return false;
          if (!q) return true;
          return (
            f.key.toLowerCase().includes(q) ||
            formatCellValue(f.value).toLowerCase().includes(q)
          );
        });
        if (fields.length === 0) return null;
        return (
          <div key={itemIndex} className={itemIndex > 0 ? "border-t" : ""}>
            {rows.length > 1 && (
              <div className="bg-muted/50 px-2 py-1 text-[10px] font-medium text-muted-foreground">
                Item {itemIndex}
              </div>
            )}
            {fields.map((field) => (
              <SchemaFieldRow key={`${itemIndex}-${field.key}`} field={field} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function TableCellValue({ value }: { value: unknown }) {
  const compact = formatCompactCell(value, { maxLen: 120 });
  if (
    compact.kind === "array<string>" &&
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 8
  ) {
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((entry, index) => (
          <span
            key={`${index}-${String(entry)}`}
            className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground"
          >
            {String(entry)}
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className="line-clamp-3 break-words" title={formatCompactCell(value, { maxLen: 4000 }).text}>
      {compact.text}
    </span>
  );
}

function TableView({
  rows,
  keys,
  query,
}: {
  rows: Record<string, unknown>[];
  keys: string[];
  query: string;
}) {
  const q = query.trim().toLowerCase();
  const filteredKeys = q
    ? keys.filter((k) => k.toLowerCase().includes(q))
    : keys;

  if (filteredKeys.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">
        {q
          ? "No fields match your search"
          : "No tabular fields — switch to JSON or Schema"}
      </p>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-auto rounded-lg border bg-card">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 z-10 border-b bg-muted/90 backdrop-blur-sm">
          <tr>
            <th className="w-10 whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">
              #
            </th>
            {filteredKeys.map((k) => (
              <th
                key={k}
                className="min-w-[4.5rem] max-w-[16rem] truncate px-3 py-2 text-left font-medium text-foreground"
              >
                {tableColumnLabel(k)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 100).map((row, i) => (
            <tr key={i} className="border-t border-border/50 transition-colors">
              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                {i}
              </td>
              {filteredKeys.map((k) => (
                <td
                  key={k}
                  className="min-w-[4.5rem] max-w-[16rem] px-3 py-2 align-top text-foreground"
                >
                  <TableCellValue value={row[k]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ItemDataViewer({
  items,
  data,
  emptyMessage = "No data yet",
  className,
  selectedItemIndex = 0,
  onSelectedItemIndexChange,
  canonicalItemsOnly = false,
}: Props) {
  const [mode, setMode] = useState<ViewMode>("table");
  const [query, setQuery] = useState("");
  const canonical = useMemo(
    () => normalizeItems(items, data, { canonicalItemsOnly }),
    [items, data, canonicalItemsOnly]
  );

  const splitItems = Boolean(
    canonical.length > 1 && onSelectedItemIndexChange
  );
  const selectedIndex = Math.min(
    Math.max(0, selectedItemIndex),
    Math.max(0, canonical.length - 1)
  );
  const viewItems = splitItems ? [canonical[selectedIndex]] : canonical;
  const displayTable = useMemo(() => {
    const source = (
      canonical.length > 1 && onSelectedItemIndexChange
        ? [canonical[Math.min(Math.max(0, selectedItemIndex), canonical.length - 1)]]
        : canonical
    ).map(withReadableReport);
    return buildDisplayTable(source);
  }, [canonical, onSelectedItemIndexChange, selectedItemIndex]);

  if (canonical.length === 0) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        {emptyMessage}
      </p>
    );
  }

  const jsonText = prettyJson(canonicalJsonForView(viewItems));
  const selectedRow = canonical[selectedIndex];
  const prosePreview = extractProseField(
    selectedRow?.json as Record<string, unknown> | undefined
  );

  const dataViewer = (
    <div
      className={cn(
        "flex min-h-0 flex-col gap-2 overflow-hidden",
        splitItems ? "min-h-[10rem]" : "flex-1"
      )}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative min-w-[120px] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search fields…"
            className="h-7 border-border/60 bg-muted/30 pl-7 text-[11px]"
          />
        </div>
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(v) => v && setMode(v as ViewMode)}
          className="shrink-0 rounded-md border border-border bg-muted/40 p-0.5"
        >
          {(
            [
              ["table", "Table"],
              ["schema", "Schema"],
              ["json", "JSON"],
              ["binary", "Binary"],
            ] as const
          ).map(([value, label]) => (
            <ToggleGroupItem
              key={value}
              value={value}
              className={cn(
                "h-6 rounded-sm px-2.5 text-[10px] font-medium transition-colors",
                "data-[state=off]:bg-transparent data-[state=off]:text-muted-foreground",
                "data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm",
                "data-[state=on]:ring-1 data-[state=on]:ring-border"
              )}
            >
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {canonical.length} item{canonical.length === 1 ? "" : "s"}
        </span>
      </div>

      <div
        data-inspector-region="item-data"
        className={cn(INSPECTOR_PANE_SCROLL_CLASS, "flex min-h-0 flex-1 flex-col gap-2")}
      >
        {prosePreview && (mode === "table" || mode === "schema") && (
          <div className="shrink-0 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Preview
              </div>
              <ProseCopyButton text={prosePreview} />
            </div>
            <WorkflowProseContent text={prosePreview} compact />
          </div>
        )}

        {mode === "json" && (
          <pre className="min-h-0 flex-1 overflow-auto rounded-lg border bg-muted/20 p-3 font-mono text-[11px] leading-relaxed text-foreground">
            {jsonText}
          </pre>
        )}

        {mode === "schema" && <SchemaView rows={viewItems} query={query} />}

        {mode === "binary" && (
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-muted/20 p-3 text-[11px]">
            {viewItems.some((r) => r.binary && Object.keys(r.binary).length > 0) ? (
              <ul className="space-y-1">
                {viewItems.map((row, i) =>
                  row.binary
                    ? Object.entries(row.binary).map(([key, val]) => (
                        <li key={`${i}-${key}`} className="font-mono">
                          item {splitItems ? selectedIndex : i}.{key}:{" "}
                          {typeof val === "object"
                            ? JSON.stringify(val).slice(0, 120)
                            : String(val)}
                        </li>
                      ))
                    : null
                )}
              </ul>
            ) : (
              <p className="text-muted-foreground">No binary data on these items</p>
            )}
          </div>
        )}

        {mode === "table" && (
          <TableView
            rows={displayTable.rows}
            keys={displayTable.columns}
            query={query}
          />
        )}
      </div>
    </div>
  );

  const itemSelector = splitItems ? (
    <div
      data-inspector-region="item-selector"
      className={cn(INSPECTOR_PANE_SCROLL_CLASS, "min-h-[6rem]")}
    >
      <div className="flex flex-wrap gap-1">
        {canonical.map((_, i) => (
          <button
            key={i}
            type="button"
            className={cn(
              "rounded border px-2 py-0.5 text-[10px] font-medium transition-colors",
              selectedIndex === i
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50"
            )}
            onClick={() => onSelectedItemIndexChange?.(i)}
          >
            Item {i + 1}
          </button>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <div
      className={cn(
        splitItems
          ? cn(INSPECTOR_ITEM_SPLIT_CLASS, "gap-2")
          : "flex min-h-0 flex-col gap-2",
        className
      )}
    >
      {itemSelector}
      {dataViewer}
    </div>
  );
}
