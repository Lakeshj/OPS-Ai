/**
 * Inspector Table display sorting — presentation only.
 * Never mutates canonical WorkflowItems, JSON, Schema, pins, or runtime data.
 */

export type DisplayTableLike = {
  columns: string[];
  rows: Record<string, unknown>[];
  unwrappedResult?: boolean;
};

export type TableSortDirection = "asc" | "desc";

export type TableSortState = {
  columnKey: string | null;
  direction: TableSortDirection | null;
};

export const EMPTY_TABLE_SORT: TableSortState = Object.freeze({
  columnKey: null,
  direction: null,
});

const NUMERIC_STRING_RE = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}(?:[Tt ][\d:.+-]+Z?)?$/;

type SortKind = "number" | "date" | "boolean" | "string" | "array" | "object" | "other";

const KIND_RANK: Record<SortKind, number> = {
  number: 1,
  date: 2,
  boolean: 3,
  string: 4,
  array: 5,
  object: 6,
  other: 7,
};

export function isTableSortMissing(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

export function toTableSortNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!NUMERIC_STRING_RE.test(trimmed)) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function isIsoDateSortValue(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!ISO_DATE_RE.test(trimmed)) return false;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function presentValues(rows: Record<string, unknown>[], columnKey: string): unknown[] {
  const out: unknown[] = [];
  for (const row of rows) {
    const value = row[columnKey];
    if (!isTableSortMissing(value)) out.push(value);
  }
  return out;
}

export function detectColumnSortKind(
  rows: Record<string, unknown>[],
  columnKey: string
): SortKind | "mixed" {
  const values = presentValues(rows, columnKey);
  if (values.length === 0) return "other";
  if (values.every((value) => typeof value === "boolean")) return "boolean";
  if (values.every((value) => toTableSortNumber(value) != null)) return "number";
  if (values.every((value) => isIsoDateSortValue(value))) return "date";
  const kinds = new Set(values.map((value) => classifyValue(value, "mixed")));
  return kinds.size === 1 ? [...kinds][0] : "mixed";
}

function classifyValue(value: unknown, columnKind: SortKind | "mixed"): SortKind {
  if (columnKind === "number" && toTableSortNumber(value) != null) return "number";
  if (columnKind === "date" && isIsoDateSortValue(value)) return "date";
  if (columnKind === "boolean" && typeof value === "boolean") return "boolean";
  if (typeof value === "number" && Number.isFinite(value)) return "number";
  if (typeof value === "boolean") return "boolean";
  if (isIsoDateSortValue(value)) return "date";
  if (typeof value === "string") return "string";
  if (Array.isArray(value)) return "array";
  if (isPlainObject(value)) return "object";
  return "other";
}

function presentationKey(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    const inner = value
      .map((entry) => {
        if (entry == null) return "null";
        if (typeof entry !== "object") return String(entry);
        if (Array.isArray(entry)) return `[${entry.length}]`;
        return Object.keys(entry as object)
          .sort()
          .join(",");
      })
      .join("\u0000");
    return `${value.length}:${inner}`;
  }
  if (typeof value === "object") {
    return Object.keys(value as object)
      .sort()
      .map((key) => `${key}:${String((value as Record<string, unknown>)[key])}`)
      .join(";");
  }
  return String(value);
}

function compareSameKind(left: unknown, right: unknown, kind: SortKind): number {
  switch (kind) {
    case "number": {
      const a = toTableSortNumber(left) ?? 0;
      const b = toTableSortNumber(right) ?? 0;
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    }
    case "date": {
      const a = Date.parse(String(left).trim());
      const b = Date.parse(String(right).trim());
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    }
    case "boolean": {
      const a = left === true ? 1 : 0;
      const b = right === true ? 1 : 0;
      return a - b;
    }
    case "array": {
      const a = Array.isArray(left) ? left : [];
      const b = Array.isArray(right) ? right : [];
      if (a.length !== b.length) return a.length - b.length;
      return presentationKey(a).localeCompare(presentationKey(b), undefined, {
        sensitivity: "base",
      });
    }
    case "object": {
      return presentationKey(left).localeCompare(presentationKey(right), undefined, {
        sensitivity: "base",
      });
    }
    case "string":
    case "other":
    default:
      return String(left ?? "").localeCompare(String(right ?? ""), undefined, {
        sensitivity: "base",
      });
  }
}

export function compareTableCellValues(
  left: unknown,
  right: unknown,
  direction: TableSortDirection,
  columnKind: SortKind | "mixed" = "mixed"
): number {
  const leftMissing = isTableSortMissing(left);
  const rightMissing = isTableSortMissing(right);
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;

  const leftKind = classifyValue(left, columnKind);
  const rightKind = classifyValue(right, columnKind);
  if (leftKind !== rightKind) return KIND_RANK[leftKind] - KIND_RANK[rightKind];

  const cmp = compareSameKind(left, right, leftKind);
  return direction === "desc" ? -cmp : cmp;
}

export function cycleTableSort(
  current: TableSortState,
  columnKey: string
): TableSortState {
  const key = String(columnKey || "");
  if (!key) return { ...EMPTY_TABLE_SORT };
  if (current.columnKey !== key || current.direction == null) {
    return { columnKey: key, direction: "desc" };
  }
  if (current.direction === "desc") {
    return { columnKey: key, direction: "asc" };
  }
  return { columnKey: null, direction: null };
}

export function ariaSortValue(
  columnKey: string,
  sort: TableSortState
): "none" | "ascending" | "descending" {
  if (!sort.columnKey || sort.columnKey !== columnKey || !sort.direction) return "none";
  return sort.direction === "asc" ? "ascending" : "descending";
}

export function tableSortDatasetKey(table: DisplayTableLike): string {
  const first = table.rows[0];
  const last = table.rows[table.rows.length - 1];
  return [
    String(table.rows.length),
    table.columns.join("\0"),
    table.unwrappedResult ? "1" : "0",
    first ? JSON.stringify(first) : "",
    last ? JSON.stringify(last) : "",
  ].join("|");
}

/**
 * Returns a new table whose `rows` array is a sorted copy.
 * Row objects are the same references. Canonical source is not mutated.
 */
export function applyTableSort<T extends DisplayTableLike>(
  table: T,
  sort: TableSortState
): T {
  if (!sort.columnKey || !sort.direction) return table;
  if (!table.columns.includes(sort.columnKey)) return table;
  const columnKey = sort.columnKey;
  const direction = sort.direction;
  const columnKind = detectColumnSortKind(table.rows, columnKey);
  const decorated = table.rows.map((row, originalIndex) => ({ row, originalIndex }));
  decorated.sort((a, b) => {
    const cmp = compareTableCellValues(a.row[columnKey], b.row[columnKey], direction, columnKind);
    if (cmp !== 0) return cmp;
    return a.originalIndex - b.originalIndex;
  });
  return {
    ...table,
    rows: decorated.map((entry) => entry.row),
  };
}

export function nextTableSortForDataset(
  previousKey: string | null,
  nextKey: string,
  sort: TableSortState
): TableSortState {
  if (previousKey == null || previousKey === nextKey) return sort;
  return { columnKey: null, direction: null };
}

