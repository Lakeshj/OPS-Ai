"use client";

import React, { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import type { WorkflowItem } from "@/modules/workflows/types";
import { ChevronDown, ChevronRight, Search } from "lucide-react";

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

type FieldType = "string" | "number" | "boolean" | "object" | "array" | "null";

type SchemaField = {
  key: string;
  value: unknown;
  type: FieldType;
  depth: number;
};

const COLUMN_PRIORITY = [
  "message",
  "timestamp",
  "Readable date",
  "Readable time",
  "Day of week",
  "Year",
  "Month",
  "Day of month",
  "Hour",
  "Minute",
  "Second",
  "Timezone",
  "triggered",
  "kind",
  "cron",
  "timezone",
  "documentId",
  "name",
  "rowCount",
  "sheet",
];

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

function inferType(value: unknown): FieldType {
  if (value == null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
}

function flattenItemJson(json: Record<string, unknown>): Record<string, unknown> {
  const out = { ...json };
  const input = out.input;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (!(key in out)) out[key] = value;
    }
  }
  return out;
}

function toWorkflowItem(item: unknown): WorkflowItem {
  if (item && typeof item === "object" && "json" in (item as object)) {
    const row = item as WorkflowItem;
    return {
      ...row,
      json: flattenItemJson((row.json || {}) as Record<string, unknown>),
    };
  }
  if (item && typeof item === "object" && !Array.isArray(item)) {
    return { json: flattenItemJson(item as Record<string, unknown>) };
  }
  return { json: { value: item } };
}

function mergeEnvelope(
  item: WorkflowItem,
  envelope?: Record<string, unknown>
): WorkflowItem {
  if (!envelope) return item;
  const flat = flattenItemJson(envelope);
  const merged = { ...flat, ...(item.json || {}) };
  for (const [key, value] of Object.entries(item.json || {})) {
    if (value !== undefined) merged[key] = value;
  }
  return { json: flattenItemJson(merged) };
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
    if (!Array.isArray(items)) return [];
    return items.map((item) => toWorkflowItem(item));
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
        ? flattenItemJson(data as Record<string, unknown>)
        : undefined;
    return items.map((item) => mergeEnvelope(toWorkflowItem(item), envelope));
  }

  const fromIncoming = incomingSnapshotToItems(data);
  if (fromIncoming) return fromIncoming;

  if (data == null) return [];
  if (Array.isArray(data)) {
    return data.map((row) => toWorkflowItem(row));
  }
  if (typeof data === "object") {
    return [toWorkflowItem(data)];
  }
  return [{ json: { value: data } }];
}

function shouldHideInputColumn(rows: WorkflowItem[]): boolean {
  for (const row of rows) {
    const input = row.json?.input;
    if (!input || typeof input !== "object" || Array.isArray(input)) continue;
    const childKeys = Object.keys(input as object);
    if (childKeys.length === 0) continue;
    if (childKeys.every((k) => k in (row.json || {}))) return true;
  }
  return false;
}

function sortTableKeys(keys: string[]): string[] {
  const priority = new Map(COLUMN_PRIORITY.map((k, i) => [k, i]));
  return [...keys].sort((a, b) => {
    const pa = priority.get(a) ?? 999;
    const pb = priority.get(b) ?? 999;
    if (pa !== pb) return pa - pb;
    return a.localeCompare(b);
  });
}

function collectTableKeys(rows: WorkflowItem[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row.json || {})) {
      if (key === "input" && shouldHideInputColumn(rows)) continue;
      if (looksLikeNodeIdKey(key)) continue;
      const val = (row.json || {})[key];
      if (val != null && typeof val === "object" && !Array.isArray(val)) continue;
      if (key === "rows" || key === "headers" || key === "text") continue;
      keys.add(key);
    }
  }
  return sortTableKeys([...keys]).slice(0, 32);
}

function formatCellValue(value: unknown, maxLen = 200): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    const text = JSON.stringify(value);
    return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
  } catch {
    return String(value);
  }
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
        type: inferType(obj),
        depth,
      },
    ];
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) {
      return [{ key: prefix || "items", value: [], type: "array", depth }];
    }
    if (obj.length === 1 && typeof obj[0] !== "object") {
      return [
        {
          key: prefix || "items",
          value: obj[0],
          type: inferType(obj[0]),
          depth,
        },
      ];
    }
    return [
      {
        key: prefix || "items",
        value: `${obj.length} items`,
        type: "array",
        depth,
      },
    ];
  }

  const fields: SchemaField[] = [];
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const type = inferType(val);
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

function typeBadge(type: FieldType): string {
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
      return "[]";
    default:
      return "·";
  }
}

function TypeBadge({ type }: { type: FieldType }) {
  return (
    <span
      className={cn(
        "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded px-0.5 text-[9px] font-semibold",
        type === "string" && "bg-blue-500/15 text-blue-700 dark:text-blue-300",
        type === "number" && "bg-violet-500/15 text-violet-700 dark:text-violet-300",
        type === "boolean" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
        type === "object" && "bg-amber-500/15 text-amber-700 dark:text-amber-300",
        type === "array" && "bg-orange-500/15 text-orange-700 dark:text-orange-300",
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
          <span className="ml-auto text-[10px] text-muted-foreground">object</span>
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
          {formatCellValue(field.value, 500) || "—"}
        </div>
      </div>
    </div>
  );
}

function SchemaView({ rows, query }: { rows: WorkflowItem[]; query: string }) {
  const q = query.trim().toLowerCase();
  const hideInput = shouldHideInputColumn(rows);

  return (
    <div className="max-h-[min(42vh,360px)] overflow-auto rounded-lg border bg-card">
      {rows.map((row, itemIndex) => {
        const fields = flattenSchemaFields(row.json).filter((f) => {
          if (hideInput && f.key === "input") return false;
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

function TableView({
  rows,
  keys,
  query,
  selectedItemIndex,
  onSelectedItemIndexChange,
}: {
  rows: WorkflowItem[];
  keys: string[];
  query: string;
  selectedItemIndex?: number;
  onSelectedItemIndexChange?: (index: number) => void;
}) {
  const q = query.trim().toLowerCase();
  const filteredKeys = q
    ? keys.filter((k) => k.toLowerCase().includes(q))
    : keys;

  if (filteredKeys.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">
        No fields match your search
      </p>
    );
  }

  return (
    <div className="max-h-[min(42vh,360px)] overflow-auto rounded-lg border bg-card">
      <table className="w-full min-w-max text-[11px]">
        <thead className="sticky top-0 z-10 border-b bg-muted/90 backdrop-blur-sm">
          <tr>
            <th className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">
              #
            </th>
            {filteredKeys.map((k) => (
              <th
                key={k}
                className="whitespace-nowrap px-3 py-2 text-left font-medium text-foreground"
              >
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 100).map((row, i) => (
            <tr
              key={i}
              className={cn(
                "border-t border-border/50 transition-colors",
                onSelectedItemIndexChange && "cursor-pointer hover:bg-muted/25",
                selectedItemIndex === i && "bg-primary/5"
              )}
              onClick={() => onSelectedItemIndexChange?.(i)}
            >
              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                {i}
              </td>
              {filteredKeys.map((k) => {
                const val = (row.json || {})[k];
                const text = formatCellValue(val, 120);
                return (
                  <td
                    key={k}
                    className="max-w-[240px] px-3 py-2 align-top text-foreground"
                    title={formatCellValue(val, 4000)}
                  >
                    <span className="line-clamp-3 break-words">{text}</span>
                  </td>
                );
              })}
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
  const rows = useMemo(
    () => normalizeItems(items, data, { canonicalItemsOnly }),
    [items, data, canonicalItemsOnly]
  );

  if (rows.length === 0) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        {emptyMessage}
      </p>
    );
  }

  const jsonText = JSON.stringify(
    rows.length === 1 ? rows[0].json : rows.map((r) => r.json),
    null,
    2
  );

  const tableKeys = collectTableKeys(rows);

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      {rows.length > 1 && onSelectedItemIndexChange && (
        <div className="flex flex-wrap gap-1">
          {rows.map((_, i) => (
            <button
              key={i}
              type="button"
              className={cn(
                "rounded border px-2 py-0.5 text-[10px] font-medium transition-colors",
                selectedItemIndex === i
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50"
              )}
              onClick={() => onSelectedItemIndexChange(i)}
            >
              Item {i + 1}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
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
          {rows.length} item{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      {mode === "json" && (
        <pre className="max-h-[min(42vh,360px)] overflow-auto rounded-lg border bg-muted/20 p-3 font-mono text-[11px] leading-relaxed text-foreground">
          {jsonText}
        </pre>
      )}

      {mode === "schema" && <SchemaView rows={rows} query={query} />}

      {mode === "binary" && (
        <div className="max-h-[min(42vh,360px)] overflow-auto rounded-lg border bg-muted/20 p-3 text-[11px]">
          {rows.some((r) => r.binary && Object.keys(r.binary).length > 0) ? (
            <ul className="space-y-1">
              {rows.map((row, i) =>
                row.binary
                  ? Object.entries(row.binary).map(([key, val]) => (
                      <li key={`${i}-${key}`} className="font-mono">
                        item {i}.{key}:{" "}
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
          rows={rows}
          keys={tableKeys}
          query={query}
          selectedItemIndex={selectedItemIndex}
          onSelectedItemIndexChange={onSelectedItemIndexChange}
        />
      )}
    </div>
  );
}
