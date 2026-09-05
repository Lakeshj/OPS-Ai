/**
 * Run Results display helpers — step ordering + output summaries.
 * UI-only; does not change engine execution.
 */

import type { WorkflowDefinition, WorkflowRunStep } from "./types";

const ts = (value: string | Date | null | undefined): number => {
  if (!value) return Number.POSITIVE_INFINITY;
  const n =
    value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
};

/** Stable graph order for timestamp ties (execution graph — not canvas x/y). */
export function buildGraphOrderIndex(
  definition?: WorkflowDefinition | null
): Map<string, number> {
  const index = new Map<string, number>();
  if (!definition || typeof definition !== "object") return index;
  const nodes = Array.isArray(definition.nodes) ? definition.nodes : [];
  const edges = Array.isArray(definition.edges) ? definition.edges : [];
  if (nodes.length === 0) return index;

  const ids = nodes.map((n) => n.id).filter(Boolean);
  const idSet = new Set(ids);
  const incoming = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map(ids.map((id) => [id, [] as string[]]));

  for (const e of edges) {
    const s = e?.source;
    const t = e?.target;
    if (!s || !t || !idSet.has(s) || !idSet.has(t)) continue;
    outgoing.get(s)!.push(t);
    incoming.set(t, (incoming.get(t) || 0) + 1);
  }

  const queue = ids.filter((id) => (incoming.get(id) || 0) === 0);
  const order: string[] = [];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    for (const next of outgoing.get(id) || []) {
      incoming.set(next, (incoming.get(next) || 0) - 1);
      if ((incoming.get(next) || 0) <= 0) queue.push(next);
    }
  }
  for (const id of ids) {
    if (!seen.has(id)) order.push(id);
  }
  order.forEach((id, i) => index.set(id, i));
  return index;
}

/**
 * Authoritative UI order for Run Results steps.
 * Prefer start time, then finish time (breaks same-second start ties),
 * then occurrence index, then graph order. Never use canvas position.
 */
export function sortWorkflowRunSteps<T extends WorkflowRunStep>(
  steps: T[] | null | undefined,
  options?: { definition?: WorkflowDefinition | null }
): T[] {
  if (!Array.isArray(steps) || steps.length <= 1) return steps ? [...steps] : [];
  const graphOrder = buildGraphOrderIndex(options?.definition);
  return [...steps].sort((a, b) => {
    const aStart = ts(a.startedAt || a.createdAt);
    const bStart = ts(b.startedAt || b.createdAt);
    if (aStart !== bStart) return aStart - bStart;

    const aFin = ts(a.finishedAt);
    const bFin = ts(b.finishedAt);
    const aFinKey = Number.isFinite(aFin) ? aFin : Number.POSITIVE_INFINITY;
    const bFinKey = Number.isFinite(bFin) ? bFin : Number.POSITIVE_INFINITY;
    if (aFinKey !== bFinKey) return aFinKey - bFinKey;

    const aEi = Number(a.executionIndex ?? 0);
    const bEi = Number(b.executionIndex ?? 0);
    if (aEi !== bEi) return aEi - bEi;

    const aGo = graphOrder.has(a.nodeId)
      ? graphOrder.get(a.nodeId)!
      : Number.POSITIVE_INFINITY;
    const bGo = graphOrder.has(b.nodeId)
      ? graphOrder.get(b.nodeId)!
      : Number.POSITIVE_INFINITY;
    if (aGo !== bGo) return aGo - bGo;

    const aCreated = ts(a.createdAt);
    const bCreated = ts(b.createdAt);
    if (aCreated !== bCreated) return aCreated - bCreated;

    return String(a.id || a.nodeId || "").localeCompare(
      String(b.id || b.nodeId || "")
    );
  });
}

const TRIGGER_ENVELOPE_KEYS = new Set([
  "triggered",
  "kind",
  "input",
  "items",
  "text",
  "message",
]);

function unwrapMessageJson(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return value;
  try {
    const parsed = JSON.parse(trimmed) as { message?: unknown };
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      parsed.message != null &&
      Object.keys(parsed).length <= 2
    ) {
      return String(parsed.message);
    }
  } catch {
    // keep original
  }
  return value;
}

function summarizeBusinessFields(obj: Record<string, unknown>): string | null {
  const skip = new Set([
    ...TRIGGER_ENVELOPE_KEYS,
    "pairedItem",
    "json",
    "ai",
    "agent",
    "isLlm",
    "agentMeta",
    "fields",
    "count",
    "logs",
    "__callableReturnItems",
  ]);
  const entries = Object.entries(obj).filter(([k, v]) => {
    if (skip.has(k)) return false;
    if (v == null) return false;
    if (typeof v === "object") return false;
    return true;
  });
  if (entries.length === 0) return null;
  if (entries.length === 1) {
    const [k, v] = entries[0];
    return `${k}: ${String(v)}`;
  }
  if (entries.length <= 6) {
    return entries.map(([k, v]) => `${k}: ${String(v)}`).join(" · ");
  }
  return null;
}

/**
 * Compact, human-readable summary for a step's own canonical output.
 */
export function formatStepOutput(output: unknown): string {
  if (output == null) return "";
  if (typeof output === "string") return unwrapMessageJson(output);
  if (typeof output !== "object") return String(output);

  const obj = output as Record<string, unknown>;
  if (typeof obj.text === "string" && obj.text.trim()) return obj.text;

  if (obj.result != null) {
    if (typeof obj.result === "string") return unwrapMessageJson(obj.result);
    if (typeof obj.result === "object") {
      const nested = obj.result as Record<string, unknown>;
      if (nested.message != null) return String(nested.message);
      if (typeof nested.text === "string") return nested.text;
      try {
        return JSON.stringify(obj.result, null, 2);
      } catch {
        return String(obj.result);
      }
    }
    return String(obj.result);
  }

  if (obj.fields && typeof obj.fields === "object") {
    try {
      return JSON.stringify(obj.fields, null, 2);
    } catch {
      return "Set fields";
    }
  }

  // Set / Edit Fields often flattens mapped keys onto the prior item payload.
  // Prefer those business keys over inherited Trigger envelope flags.
  const business = summarizeBusinessFields(obj);
  if (business) return business;

  if (Array.isArray(obj.items) && obj.items.length > 0) {
    const first = (obj.items[0] as { json?: unknown })?.json ?? obj.items[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const nestedBiz = summarizeBusinessFields(first as Record<string, unknown>);
      if (nestedBiz) {
        return obj.items.length > 1
          ? `${obj.items.length} items — ${nestedBiz}`
          : nestedBiz;
      }
    }
  }

  if (obj.message != null && Object.keys(obj).length <= 2) {
    return String(obj.message);
  }

  if (obj.body != null) {
    if (typeof obj.body === "string") {
      return `HTTP ${obj.status ?? ""} — ${obj.body}`.trim();
    }
    return `HTTP ${obj.status ?? ""}\n${JSON.stringify(obj.body, null, 2)}`.trim();
  }

  if (typeof obj.pass === "boolean") {
    return `Condition ${obj.pass ? "passed" : "failed"} (${obj.operator ?? "equals"})`;
  }

  if (Array.isArray(obj.rows) && obj.rowCount != null) {
    return `Spreadsheet “${String(obj.name || obj.sheet || "file")}”: ${obj.rowCount} row(s)${
      obj.truncated ? " (truncated)" : ""
    }`;
  }

  if (obj.sent != null) {
    return `Email ${obj.sent ? "sent" : "skipped"} → ${String(obj.to || "")}`;
  }

  if (obj.agent === true || obj.isLlm === true) {
    if (typeof obj.text === "string") return obj.text;
    if (Array.isArray(obj.items) && obj.items.length > 0) {
      return `${obj.items.length} agent item(s)`;
    }
    return "Agent result";
  }

  if (obj.triggered) {
    const input = obj.input;
    if (typeof input === "string") return `Triggered with: ${input}`;
    if (input && typeof input === "object" && "message" in (input as object)) {
      return `Triggered with: ${String((input as { message?: unknown }).message ?? "")}`;
    }
    return `Triggered (${String(obj.kind || "manual")})`;
  }

  if (typeof obj.count === "number" && Array.isArray(obj.items)) {
    return `${obj.count} item(s)`;
  }

  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}
