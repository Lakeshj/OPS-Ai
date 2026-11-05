/**
 * Shared inspector presentation layer (INPUT / OUTPUT / pinned / Run Results).
 *
 * Execution data is canonical. Everything here is DISPLAY-ONLY and must not
 * mutate stored items, pinned data, or provider output.
 */

import type { WorkflowItem } from "./types";

/** Result node contract: mapped payload lives on `output.result` / `json.result`. */
export const RESULT_DISPLAY_PAYLOAD_KEY = "result";

export const INSPECTOR_CELL_MAX = 160;

export const INSPECTOR_ITEM_SPLIT_CLASS =
  "grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] overflow-hidden";

export const INSPECTOR_PANE_SCROLL_CLASS = "min-h-0 overflow-y-auto";

export type SchemaKind =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "object"
  | "array"
  | "array<string>"
  | "array<number>"
  | "array<boolean>"
  | "array<object>"
  | "mixed";

export type CompactCell = {
  kind: SchemaKind;
  text: string;
  truncated: boolean;
};

export type DisplayTable = {
  columns: string[];
  rows: Record<string, unknown>[];
  unwrappedResult: boolean;
};

export type InspectorView = {
  table: DisplayTable;
  jsonValue: unknown;
  json: string;
  schema: Record<string, SchemaKind>;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function cloneValue<T>(value: T): T {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      // fall through
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function workflowItemFromUnknown(item: unknown): WorkflowItem {
  if (item && typeof item === "object" && "json" in (item as object)) {
    const row = item as WorkflowItem;
    const json = isPlainObject(row.json)
      ? { ...row.json }
      : { value: row.json as unknown };
    return {
      json,
      ...(row.binary ? { binary: row.binary } : {}),
      ...(row.pairedItem != null ? { pairedItem: row.pairedItem } : {}),
    };
  }
  if (isPlainObject(item)) {
    return { json: { ...item } };
  }
  return { json: { value: item } };
}

export function toCanonicalItems(
  items?: unknown[] | null,
  data?: unknown
): WorkflowItem[] {
  if (Array.isArray(items)) {
    return items.map(workflowItemFromUnknown);
  }
  if (data == null) return [];
  if (Array.isArray(data)) return data.map(workflowItemFromUnknown);
  if (isPlainObject(data)) return [{ json: { ...data } }];
  return [{ json: { value: data } }];
}

export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return String(value);
  }
}

export function canonicalJsonForView(items: WorkflowItem[]): unknown {
  const canonical = toCanonicalItems(items);
  if (canonical.length === 0) return null;
  if (canonical.length === 1) return canonical[0].json ?? {};
  return canonical.map((item) => item.json ?? {});
}

export function inferSchemaKind(value: unknown): SchemaKind {
  if (value === null || value === undefined) return "null";
  const t = typeof value;
  if (t === "string") return "string";
  if (t === "number") return "number";
  if (t === "boolean") return "boolean";
  if (Array.isArray(value)) {
    if (value.length === 0) return "array";
    const kinds = new Set(value.map((entry) => inferSchemaKind(entry)));
    if (kinds.size === 1) {
      const only = [...kinds][0];
      if (only === "string") return "array<string>";
      if (only === "number") return "array<number>";
      if (only === "boolean") return "array<boolean>";
      if (only === "object") return "array<object>";
      return "array";
    }
    const objectish = [...kinds].every(
      (kind) => kind === "object" || kind === "null"
    );
    if (objectish) return "array<object>";
    return "mixed";
  }
  if (t === "object") return "object";
  return "string";
}

export function inferItemSchema(
  json: Record<string, unknown>
): Record<string, SchemaKind> {
  const schema: Record<string, SchemaKind> = {};
  for (const [key, value] of Object.entries(json || {})) {
    schema[key] = inferSchemaKind(value);
  }
  return schema;
}

/**
 * Parse a Result payload string for DISPLAY only.
 * Arbitrary user strings stay strings; only object/array JSON is accepted.
 */
export function parseResultPayloadForDisplay(value: unknown): {
  parsed: boolean;
  value: unknown;
} {
  if (typeof value !== "string") {
    return { parsed: false, value };
  }
  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) {
    return { parsed: false, value };
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object") {
      return { parsed: true, value: parsed };
    }
    return { parsed: false, value };
  } catch {
    return { parsed: false, value };
  }
}

/** Max scalar leaves promoted from one nested object (avoids column explosion). */
const MAX_PROMOTED_LEAVES_PER_OBJECT = 12;

/** Preferred Table column order for structured performance-style rows. */
const PREFERRED_DISPLAY_COLUMNS = [
  "Campaign Name",
  "Ad Group Name",
  "Keyword",
  "Date",
  "Spend",
  "Impressions",
  "Clicks",
  "CTR",
  "CPC",
  "Conversions",
  "Conversion Value",
  "Customer ID",
] as const;

/**
 * Well-known nested scalar paths → readable Table column keys.
 * Generic path map — not a provider-specific table component.
 */
const NESTED_LEAF_DISPLAY_KEYS: Record<string, string> = {
  "campaign.name": "Campaign Name",
  "adGroup.name": "Ad Group Name",
  "ad_group.name": "Ad Group Name",
  "segments.date": "Date",
  "customer.id": "Customer ID",
  "metrics.impressions": "Impressions",
  "metrics.clicks": "Clicks",
  "metrics.ctr": "CTR",
  "metrics.conversions": "Conversions",
  "metrics.conversionsValue": "Conversion Value",
  "metrics.conversions_value": "Conversion Value",
  "metrics.cost": "Spend",
  "metrics.averageCpc": "CPC",
  "metrics.average_cpc": "CPC",
  "metrics.costMicros": "Spend",
  "metrics.cost_micros": "Spend",
  "adGroupCriterion.keyword.text": "Keyword",
  "ad_group_criterion.keyword.text": "Keyword",
};

function isScalarLeaf(value: unknown): boolean {
  if (value === null) return true;
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean";
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** True when object is a shallow bag of scalars (safe to promote into columns). */
function isPromotableScalarObject(value: unknown): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > MAX_PROMOTED_LEAVES_PER_OBJECT) {
    return false;
  }
  return entries.every(([, child]) => child === undefined || isScalarLeaf(child));
}

function displayKeyForLeaf(parentKey: string, leafKey: string): string {
  const path = `${parentKey}.${leafKey}`;
  return NESTED_LEAF_DISPLAY_KEYS[path] || path;
}

function microsFieldToMajorUnits(parentKey: string, leafKey: string, value: unknown): unknown {
  const path = `${parentKey}.${leafKey}`;
  if (
    path !== "metrics.costMicros" &&
    path !== "metrics.cost_micros" &&
    path !== "metrics.averageCpc" &&
    path !== "metrics.average_cpc"
  ) {
    return value;
  }
  const micros = asFiniteNumber(value);
  if (micros == null) return value;
  return micros / 1_000_000;
}

/**
 * Display-only row shaping: promote useful nested scalars; keep unsafe nests compact.
 * Does not mutate the input object.
 */
export function flattenRowForDisplay(
  json: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(json)) {
    if (key === "_meta") {
      // Provenance stays in JSON/Schema; omit noisy envelope from Table.
      continue;
    }

    if (isPromotableScalarObject(value)) {
      for (const [leafKey, leafValue] of Object.entries(value)) {
        if (leafValue === undefined) continue;
        if (!isScalarLeaf(leafValue)) continue;
        const displayKey = displayKeyForLeaf(key, leafKey);
        if (Object.prototype.hasOwnProperty.call(out, displayKey)) continue;
        out[displayKey] = microsFieldToMajorUnits(key, leafKey, leafValue);
      }
      continue;
    }

    if (isPlainObject(value) || Array.isArray(value) || isScalarLeaf(value)) {
      out[key] = value;
    } else if (value !== undefined) {
      out[key] = value;
    }
  }

  // Flat native Ads rows: prefer major-unit Spend/CPC labels; hide raw micros in Table.
  if (
    Object.prototype.hasOwnProperty.call(out, "costMicros") &&
    !Object.prototype.hasOwnProperty.call(out, "Spend")
  ) {
    if (Object.prototype.hasOwnProperty.call(out, "cost")) {
      out.Spend = out.cost;
    } else {
      const micros = asFiniteNumber(out.costMicros);
      if (micros != null) out.Spend = micros / 1_000_000;
    }
  } else if (
    Object.prototype.hasOwnProperty.call(out, "cost") &&
    !Object.prototype.hasOwnProperty.call(out, "Spend")
  ) {
    out.Spend = out.cost;
  }
  if (Object.prototype.hasOwnProperty.call(out, "Spend")) {
    delete out.costMicros;
    if (Object.prototype.hasOwnProperty.call(out, "cost") && out.Spend === out.cost) {
      delete out.cost;
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(out, "averageCpc") &&
    !Object.prototype.hasOwnProperty.call(out, "CPC")
  ) {
    // Native flat averageCpc is already major currency units.
    out.CPC = out.averageCpc;
  }
  if (
    Object.prototype.hasOwnProperty.call(out, "CPC") &&
    Object.prototype.hasOwnProperty.call(out, "averageCpc") &&
    out.CPC === out.averageCpc
  ) {
    delete out.averageCpc;
  }

  return out;
}

function orderDisplayColumns(columns: string[]): string[] {
  const remaining = new Set(columns);
  const ordered: string[] = [];
  for (const preferred of PREFERRED_DISPLAY_COLUMNS) {
    if (!remaining.has(preferred)) continue;
    ordered.push(preferred);
    remaining.delete(preferred);
  }
  for (const key of columns) {
    if (!remaining.has(key)) continue;
    ordered.push(key);
    remaining.delete(key);
  }
  return ordered;
}

function collectColumns(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  const columns: string[] = [];
  for (const row of rows) {
    if (!isPlainObject(row)) continue;
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push(key);
    }
  }
  return orderDisplayColumns(columns);
}

function asDisplayRows(values: unknown[]): Record<string, unknown>[] | null {
  if (values.length === 0) return null;
  if (!values.every(isPlainObject)) return null;
  return values.map((row) => flattenRowForDisplay(row));
}

function tryUnwrapResultPayload(
  json: Record<string, unknown>
): DisplayTable | null {
  if (!Object.prototype.hasOwnProperty.call(json, RESULT_DISPLAY_PAYLOAD_KEY)) {
    return null;
  }
  let payload: unknown = json[RESULT_DISPLAY_PAYLOAD_KEY];
  if (typeof payload === "string") {
    const parsed = parseResultPayloadForDisplay(payload);
    if (!parsed.parsed) return null;
    payload = parsed.value;
  }
  if (!Array.isArray(payload)) return null;
  const rows = asDisplayRows(payload);
  if (!rows) return null;
  return {
    columns: collectColumns(rows),
    rows,
    unwrappedResult: true,
  };
}

export function buildDisplayTable(items: WorkflowItem[]): DisplayTable {
  const canonical = toCanonicalItems(items);
  if (canonical.length === 1) {
    const unwrapped = tryUnwrapResultPayload(canonical[0].json || {});
    if (unwrapped) return unwrapped;
  }

  const jsonRows = canonical.map((item) =>
    isPlainObject(item.json) ? item.json : { value: item.json }
  );
  const displayRows = jsonRows.map((json) => flattenRowForDisplay(json));
  const columns = collectColumns(displayRows);
  const rows = displayRows.map((json) => {
    const row: Record<string, unknown> = {};
    for (const column of columns) {
      row[column] = json[column];
    }
    return row;
  });
  return { columns, rows, unwrappedResult: false };
}

function truncateText(text: string, maxLen: number): { text: string; truncated: boolean } {
  if (text.length <= maxLen) return { text, truncated: false };
  return { text: `${text.slice(0, maxLen)}…`, truncated: true };
}

function compactObjectPreview(value: Record<string, unknown>): string {
  const keys = Object.keys(value);
  if (keys.length === 0) return "{}";
  const parts = keys.slice(0, 4).map((key) => {
    const entry = value[key];
    if (entry == null) return `${key}: null`;
    if (Array.isArray(entry)) return `${key}: [${entry.length}]`;
    if (typeof entry === "object") return `${key}: {…}`;
    if (typeof entry === "string") return `${key}: ${JSON.stringify(entry)}`;
    return `${key}: ${String(entry)}`;
  });
  const extra = keys.length > 4 ? ", …" : "";
  return `{ ${parts.join(", ")}${extra} }`;
}

export function formatCompactCell(
  value: unknown,
  options?: { maxLen?: number }
): CompactCell {
  const maxLen = options?.maxLen ?? INSPECTOR_CELL_MAX;
  const kind = inferSchemaKind(value);

  if (value === undefined) {
    return { kind: "null", text: "—", truncated: false };
  }
  if (value === null) {
    return { kind: "null", text: "null", truncated: false };
  }
  if (typeof value === "string") {
    const clipped = truncateText(value, maxLen);
    return { kind: "string", text: clipped.text, truncated: clipped.truncated };
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return { kind, text: String(value), truncated: false };
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return { kind: "array", text: "[0 items]", truncated: false };
    }
    if (kind === "array<string>") {
      const joined = value.map((entry) => String(entry)).join(" · ");
      if (value.length > 12 || joined.length > maxLen) {
        return { kind, text: `[${value.length} items]`, truncated: true };
      }
      return { kind, text: joined, truncated: false };
    }
    if (kind === "array<object>") {
      const noun = value.length === 1 ? "object" : "objects";
      return { kind, text: `${value.length} ${noun}`, truncated: false };
    }
    if (kind === "array<number>" || kind === "array<boolean>") {
      const joined = value.map((entry) => String(entry)).join(" · ");
      if (value.length > 12 || joined.length > maxLen) {
        return { kind, text: `[${value.length} items]`, truncated: true };
      }
      return { kind, text: joined, truncated: false };
    }
    return { kind, text: `[${value.length} items]`, truncated: false };
  }

  if (isPlainObject(value)) {
    const preview = compactObjectPreview(value);
    const clipped = truncateText(preview, maxLen);
    return { kind: "object", text: clipped.text, truncated: clipped.truncated };
  }

  const fallback = String(value);
  const clipped = truncateText(fallback, maxLen);
  return { kind, text: clipped.text, truncated: clipped.truncated };
}

export {
  EMPTY_TABLE_SORT,
  applyTableSort,
  ariaSortValue,
  cycleTableSort,
  tableSortDatasetKey,
  type TableSortState,
} from "./inspectorTableSort";

export function inspectItems(items: WorkflowItem[]): InspectorView {
  const canonical = toCanonicalItems(items);
  const jsonValue = canonicalJsonForView(canonical);
  const schemaSource =
    canonical.length === 1 && isPlainObject(canonical[0].json)
      ? canonical[0].json
      : isPlainObject(jsonValue)
        ? jsonValue
        : {};
  return {
    table: buildDisplayTable(canonical),
    jsonValue,
    json: prettyJson(jsonValue),
    schema: inferItemSchema(schemaSource),
  };
}
