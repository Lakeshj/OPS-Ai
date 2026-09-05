/**
 * Run Results display helpers (UI ordering + step summaries).
 * Mirror of frontend/src/modules/workflows/runStepDisplay.ts for smoke tests.
 * Does not change engine execution.
 */

const TRIGGER_ENVELOPE_KEYS = new Set([
  "triggered",
  "kind",
  "input",
  "items",
  "text",
  "message",
]);

const ts = (value) => {
  if (!value) return Number.POSITIVE_INFINITY;
  const n =
    value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
};

/**
 * Stable graph order for tie-breaking (execution edges only — not canvas x/y).
 */
const buildGraphOrderIndex = (definition) => {
  const index = new Map();
  if (!definition || typeof definition !== "object") return index;
  const nodes = Array.isArray(definition.nodes) ? definition.nodes : [];
  const edges = Array.isArray(definition.edges) ? definition.edges : [];
  if (nodes.length === 0) return index;

  const ids = nodes.map((n) => n.id).filter(Boolean);
  const idSet = new Set(ids);
  const incoming = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map(ids.map((id) => [id, []]));

  for (const e of edges) {
    const s = e?.source;
    const t = e?.target;
    if (!s || !t || !idSet.has(s) || !idSet.has(t)) continue;
    // Resource/aux edges still create a weak order; prefer listing every edge
    // so Model/Tool nodes sort near their agent without using canvas position.
    outgoing.get(s).push(t);
    incoming.set(t, (incoming.get(t) || 0) + 1);
  }

  const queue = ids.filter((id) => (incoming.get(id) || 0) === 0);
  const order = [];
  const seen = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    for (const next of outgoing.get(id) || []) {
      incoming.set(next, (incoming.get(next) || 0) - 1);
      if (incoming.get(next) <= 0) queue.push(next);
    }
  }
  for (const id of ids) {
    if (!seen.has(id)) order.push(id);
  }
  order.forEach((id, i) => index.set(id, i));
  return index;
};

/**
 * Authoritative UI order for Run Results steps.
 * Prefer start → finish timestamps, then occurrence index, then graph order.
 */
const sortWorkflowRunSteps = (steps, options = {}) => {
  if (!Array.isArray(steps) || steps.length <= 1) {
    return steps ? [...steps] : [];
  }
  const graphOrder = buildGraphOrderIndex(options.definition);
  return [...steps].sort((a, b) => {
    const aStart = ts(a.startedAt || a.createdAt);
    const bStart = ts(b.startedAt || b.createdAt);
    if (aStart !== bStart) return aStart - bStart;

    const aFin = ts(a.finishedAt);
    const bFin = ts(b.finishedAt);
    // Running / unfinished last among same start
    const aFinKey = Number.isFinite(aFin) ? aFin : Number.POSITIVE_INFINITY;
    const bFinKey = Number.isFinite(bFin) ? bFin : Number.POSITIVE_INFINITY;
    if (aFinKey !== bFinKey) return aFinKey - bFinKey;

    const aEi = Number(a.executionIndex ?? 0);
    const bEi = Number(b.executionIndex ?? 0);
    if (aEi !== bEi) return aEi - bEi;

    const aGo = graphOrder.has(a.nodeId)
      ? graphOrder.get(a.nodeId)
      : Number.POSITIVE_INFINITY;
    const bGo = graphOrder.has(b.nodeId)
      ? graphOrder.get(b.nodeId)
      : Number.POSITIVE_INFINITY;
    if (aGo !== bGo) return aGo - bGo;

    const aCreated = ts(a.createdAt);
    const bCreated = ts(b.createdAt);
    if (aCreated !== bCreated) return aCreated - bCreated;

    return String(a.id || a.nodeId || "").localeCompare(
      String(b.id || b.nodeId || "")
    );
  });
};

const unwrapMessageJson = (value) => {
  const trimmed = String(value).trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return value;
  try {
    const parsed = JSON.parse(trimmed);
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
};

const summarizeBusinessFields = (obj) => {
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
};

const formatStepOutput = (output) => {
  if (output == null) return "";
  if (typeof output === "string") return unwrapMessageJson(output);
  if (typeof output !== "object") return String(output);

  const obj = output;
  if (typeof obj.text === "string" && obj.text.trim()) return obj.text;

  if (obj.result != null) {
    if (typeof obj.result === "string") return unwrapMessageJson(obj.result);
    if (typeof obj.result === "object") {
      const nested = obj.result;
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

  const business = summarizeBusinessFields(obj);
  if (business) return business;

  if (Array.isArray(obj.items) && obj.items.length > 0) {
    const first = obj.items[0]?.json || obj.items[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const nestedBiz = summarizeBusinessFields(first);
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
    if (input && typeof input === "object" && "message" in input) {
      return `Triggered with: ${String(input.message ?? "")}`;
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
};

module.exports = {
  sortWorkflowRunSteps,
  formatStepOutput,
  buildGraphOrderIndex,
};
