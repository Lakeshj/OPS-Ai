import type { WorkflowDefinition, WorkflowItem } from "./types";

export type ExpressionSuggestion = {
  label: string;
  insert: string;
  description?: string;
  kind: "root" | "node" | "field" | "accessor" | "index";
};

const ROOT_SUGGESTIONS: ExpressionSuggestion[] = [
  { label: "item", insert: "item", description: "Current item", kind: "root" },
  {
    label: "input",
    insert: "input",
    description: "Workflow run input",
    kind: "root",
  },
  {
    label: "steps",
    insert: "steps",
    description: "Upstream step outputs",
    kind: "root",
  },
  {
    label: "items",
    insert: "items",
    description: "Step item arrays",
    kind: "root",
  },
];

const ACCESSOR_SUGGESTIONS: ExpressionSuggestion[] = [
  {
    label: "$item",
    insert: "$item",
    description: "Corresponding item",
    kind: "accessor",
  },
  {
    label: "$first",
    insert: "$first",
    description: "First output item",
    kind: "accessor",
  },
  {
    label: "$last",
    insert: "$last",
    description: "Last output item",
    kind: "accessor",
  },
  {
    label: "$all[index]",
    insert: "$all[0]",
    description: "Specific output item by index",
    kind: "accessor",
  },
];

const SECRET_KEY_RE =
  /^(token|secret|password|api[_-]?key|credential|authorization|auth|bearer)$/i;

export function getUpstreamNodeIds(
  definition: WorkflowDefinition | undefined,
  currentNodeId: string | undefined
): string[] {
  if (!definition || !currentNodeId) return [];
  const incoming = new Map<string, string[]>();
  for (const edge of definition.edges || []) {
    const list = incoming.get(edge.target) || [];
    list.push(edge.source);
    incoming.set(edge.target, list);
  }
  const visited = new Set<string>();
  const stack = [currentNodeId];
  const upstream = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const source of incoming.get(id) || []) {
      if (source === currentNodeId) continue;
      upstream.add(source);
      stack.push(source);
    }
  }
  return [...upstream];
}

function getItemPayload(item: unknown): Record<string, unknown> | null {
  if (item == null || typeof item !== "object") return null;
  const row = item as WorkflowItem & Record<string, unknown>;
  if (row.json && typeof row.json === "object" && !Array.isArray(row.json)) {
    return row.json as Record<string, unknown>;
  }
  const { pairedItem, binary, json, ...rest } = row;
  if (Object.keys(rest).length > 0) {
    return rest as Record<string, unknown>;
  }
  return (row.json as Record<string, unknown>) || null;
}

function objectFieldKeys(
  obj: unknown,
  maxDepth = 2,
  depth = 0
): string[] {
  if (obj == null || depth > maxDepth) return [];
  const payload =
    typeof obj === "object" && !Array.isArray(obj)
      ? (obj as Record<string, unknown>)
      : null;
  if (!payload) return [];
  return Object.keys(payload).filter((k) => !SECRET_KEY_RE.test(k));
}

function valueAtPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const part of path) {
    if (cur == null) return undefined;
    if (Array.isArray(cur) && /^\d+$/.test(part)) {
      cur = cur[Number(part)];
      continue;
    }
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export type ParsedExpressionContext = {
  prefix: string;
  partial: string;
  replaceStart: number;
  replaceEnd: number;
};

/** Returns autocomplete context when cursor is inside an open `{{` block. */
export function parseExpressionAtCursor(
  value: string,
  cursor: number
): ParsedExpressionContext | null {
  const before = value.slice(0, cursor);
  const openIdx = before.lastIndexOf("{{");
  if (openIdx === -1) return null;
  const afterOpen = before.slice(openIdx + 2);
  if (afterOpen.includes("}}")) return null;
  const expr = afterOpen.replace(/^\s+/, "");
  const exprStart = openIdx + 2 + (afterOpen.length - expr.length);
  return {
    prefix: expr,
    partial: expr.split(/[.\[]/).pop() || "",
    replaceStart: exprStart,
    replaceEnd: cursor,
  };
}

function filterSuggestions(
  suggestions: ExpressionSuggestion[],
  partial: string
): ExpressionSuggestion[] {
  const q = partial.toLowerCase();
  if (!q) return suggestions;
  return suggestions.filter(
    (s) =>
      s.label.toLowerCase().startsWith(q) ||
      s.insert.toLowerCase().startsWith(q)
  );
}

export type AutocompleteContext = {
  definition?: WorkflowDefinition;
  nodeId?: string;
  currentItemIndex?: number;
  input?: Record<string, unknown>;
  steps?: Record<string, unknown>;
  stepItems?: Record<string, WorkflowItem[]>;
  inputItems?: WorkflowItem[];
  nodeLabels?: Record<string, string>;
};

export function getExpressionSuggestions(
  parsed: ParsedExpressionContext,
  ctx: AutocompleteContext
): ExpressionSuggestion[] {
  const expr = parsed.prefix.trim();
  const partial = parsed.partial;

  if (!expr || expr === "") {
    return filterSuggestions(ROOT_SUGGESTIONS, partial);
  }

  if (expr === "item" || expr.startsWith("item.")) {
    const path = expr === "item" ? [] : expr.slice("item.".length).split(".");
    const idx = ctx.currentItemIndex ?? 0;
    const base =
      ctx.inputItems && ctx.inputItems.length > idx
        ? getItemPayload(ctx.inputItems[idx])
        : null;
    const current =
      path.length === 0 ? base : valueAtPath(base, path.slice(0, -1));
    const keys = objectFieldKeys(current);
    return filterSuggestions(
      keys.map((k) => ({
        label: k,
        insert: k,
        kind: "field" as const,
      })),
      partial
    );
  }

  if (expr === "input" || expr.startsWith("input.")) {
    const path = expr === "input" ? [] : expr.slice("input.".length).split(".");
    const base = ctx.input;
    const current =
      path.length === 0 ? base : valueAtPath(base, path.slice(0, -1));
    const keys = objectFieldKeys(current);
    return filterSuggestions(
      keys.map((k) => ({
        label: k,
        insert: k,
        kind: "field" as const,
      })),
      partial
    );
  }

  if (expr === "steps" || expr === "steps.") {
    const upstream = getUpstreamNodeIds(ctx.definition, ctx.nodeId);
    const nodes = upstream.map((id) => ({
      label: ctx.nodeLabels?.[id] || id,
      insert: id,
      description: id,
      kind: "node" as const,
    }));
    return filterSuggestions(nodes, partial);
  }

  if (expr.startsWith("steps.")) {
    const rest = expr.slice("steps.".length);
    const rawSegments = rest.split(".");
    const nodeId = rawSegments[0];
    if (!nodeId) {
      const upstream = getUpstreamNodeIds(ctx.definition, ctx.nodeId);
      return filterSuggestions(
        upstream.map((id) => ({
          label: ctx.nodeLabels?.[id] || id,
          insert: id,
          description: id,
          kind: "node" as const,
        })),
        partial
      );
    }

    const pathAfterNode = rawSegments.slice(1).filter(Boolean);
    const atNodeBoundary =
      pathAfterNode.length === 0 ||
      (rawSegments.length > 1 && rawSegments[rawSegments.length - 1] === "");

    if (atNodeBoundary) {
      return filterSuggestions(
        [
          ...ACCESSOR_SUGGESTIONS,
          ...objectFieldKeys(ctx.steps?.[nodeId]).map((k) => ({
            label: k,
            insert: k,
            kind: "field" as const,
          })),
        ],
        partial
      );
    }

    const firstSeg = pathAfterNode[0];

    if (firstSeg?.startsWith("$all[")) {
      const items = ctx.stepItems?.[nodeId];
      const count = Math.min(items?.length ?? 0, 20);
      return filterSuggestions(
        Array.from({ length: count }, (_, i) => ({
          label: String(i),
          insert: String(i),
          kind: "index" as const,
        })),
        partial
      );
    }

    if (firstSeg?.startsWith("$")) {
      let base: unknown = ctx.stepItems?.[nodeId]?.[0];
      if (firstSeg === "$first" && ctx.stepItems?.[nodeId]?.length) {
        base = ctx.stepItems[nodeId][0];
      } else if (firstSeg === "$last" && ctx.stepItems?.[nodeId]?.length) {
        const arr = ctx.stepItems[nodeId];
        base = arr[arr.length - 1];
      } else if (firstSeg.startsWith("$all[")) {
        const m = firstSeg.match(/^\$all\[(\d+)\]$/);
        const idx = m ? Number(m[1]) : 0;
        base = ctx.stepItems?.[nodeId]?.[idx];
      } else if (firstSeg === "$item") {
        const idx = ctx.currentItemIndex ?? 0;
        base = ctx.stepItems?.[nodeId]?.[idx] ?? ctx.stepItems?.[nodeId]?.[0];
      }
      const fieldPath = pathAfterNode.slice(1);
      const current =
        fieldPath.length <= 1
          ? getItemPayload(base)
          : valueAtPath(getItemPayload(base), fieldPath.slice(0, -1));
      return filterSuggestions(
        objectFieldKeys(current).map((k) => ({
          label: k,
          insert: k,
          kind: "field" as const,
        })),
        partial
      );
    }

    const output = ctx.steps?.[nodeId];
    const current =
      pathAfterNode.length <= 1
        ? output
        : valueAtPath(output, pathAfterNode.slice(0, -1));
    return filterSuggestions(
      objectFieldKeys(current).map((k) => ({
        label: k,
        insert: k,
        kind: "field" as const,
      })),
      partial
    );
  }

  if (expr === "items" || expr === "items.") {
    const nodeIds = Object.keys(ctx.stepItems || {});
    return filterSuggestions(
      nodeIds.map((id) => ({
        label: ctx.nodeLabels?.[id] || id,
        insert: id,
        description: id,
        kind: "node" as const,
      })),
      partial
    );
  }

  if (expr.startsWith("items.")) {
    const rest = expr.slice("items.".length);
    const [nodeId, ...path] = rest.split(".");
    if (!nodeId) {
      return filterSuggestions(
        Object.keys(ctx.stepItems || {}).map((id) => ({
          label: ctx.nodeLabels?.[id] || id,
          insert: id,
          kind: "node" as const,
        })),
        partial
      );
    }
    const items = ctx.stepItems?.[nodeId];
    if (path.length === 0) {
      const count = Math.min(items?.length ?? 0, 20);
      return filterSuggestions(
        Array.from({ length: count }, (_, i) => ({
          label: String(i),
          insert: String(i),
          kind: "index" as const,
        })),
        partial
      );
    }
    const idx = /^\d+$/.test(path[0]) ? Number(path[0]) : 0;
    const item = items?.[idx];
    const fieldPath = path.slice(1);
    const base = getItemPayload(item);
    const current =
      fieldPath.length <= 1 ? base : valueAtPath(base, fieldPath.slice(0, -1));
    return filterSuggestions(
      objectFieldKeys(current).map((k) => ({
        label: k,
        insert: k,
        kind: "field" as const,
      })),
      partial
    );
  }

  return [];
}

export function applySuggestion(
  value: string,
  parsed: ParsedExpressionContext,
  suggestion: ExpressionSuggestion
): { nextValue: string; cursor: number } {
  const before = value.slice(0, parsed.replaceStart);
  const after = value.slice(parsed.replaceEnd);
  let expr = parsed.prefix;
  if (parsed.partial) {
    expr = expr.slice(0, expr.length - parsed.partial.length);
  }

  let insert = suggestion.insert;
  const trailDot = (text: string) => (text.endsWith(".") ? text : `${text}.`);

  switch (suggestion.kind) {
    case "root":
      insert = suggestion.insert;
      break;
    case "node":
      if (expr === "steps" || expr === "steps.") {
        insert = `steps.${suggestion.insert}.`;
      } else if (expr === "items" || expr === "items.") {
        insert = `items.${suggestion.insert}.`;
      } else {
        insert = `${trailDot(expr)}${suggestion.insert}.`;
      }
      break;
    case "accessor":
      if (suggestion.insert === "$all[0]") {
        insert = `${expr}$all[0]`;
      } else {
        insert = `${expr}${suggestion.insert}.`;
      }
      break;
    case "index":
      insert = `${expr}${suggestion.insert}`;
      break;
    default:
      insert = `${expr}${suggestion.insert}`;
      break;
  }

  const nextValue = `${before}${insert}${after}`;
  let cursor = before.length + insert.length;
  if (suggestion.insert === "$all[0]") {
    cursor = before.length + insert.indexOf("[") + 1;
  }
  return { nextValue, cursor };
}
