/**
 * Central OUTPUT inspector data selection (Part 7D).
 * Prefer canonical WorkflowItem[] / portOutputs over handler summary metadata.
 */

import type { WorkflowEditorNodeResult, WorkflowItem } from "./types";
import { redactOrchestrationOutput } from "./subworkflowUx";

export type NodeOutputPortMap = Record<string, WorkflowItem[]>;

export type NodeOutputSelection =
  | { kind: "unexecuted" }
  | { kind: "skipped" }
  | {
      kind: "portOutputs";
      portOutputs: NodeOutputPortMap;
      metadata?: unknown;
    }
  | {
      kind: "items";
      items: WorkflowItem[];
      executed: boolean;
      metadata?: unknown;
    }
  | { kind: "legacy"; legacy: unknown };

const HANDLER_SUMMARY_KEYS = new Set([
  "count",
  "droppedCount",
  "items",
  "text",
  "routed",
  "routingMode",
  "resolved",
  "outputsByPort",
]);

/** Handler metadata object (count + items[]) — not a workflow item row. */
export function isHandlerSummaryOutput(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.items)) return false;
  const keys = Object.keys(record);
  if (keys.length === 0) return false;
  return keys.every((key) => HANDLER_SUMMARY_KEYS.has(key));
}

function isWorkflowItemLike(value: unknown): value is WorkflowItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as WorkflowItem;
  return row.json != null && typeof row.json === "object" && !Array.isArray(row.json);
}

function normalizeRawItems(raw: unknown[]): WorkflowItem[] {
  return raw.map((entry) => {
    if (isWorkflowItemLike(entry)) return entry;
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      return { json: entry as Record<string, unknown> };
    }
    return { json: { value: entry } };
  });
}

function extractItemsFromOutput(output: unknown): WorkflowItem[] | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  const record = output as Record<string, unknown>;
  if (!Array.isArray(record.items)) return null;
  return normalizeRawItems(record.items);
}

/**
 * IF dynamic ports + portOutputs → portOutputs
 * ELSE IF canonical result.items → items (including [])
 * ELSE IF legacy output.items → items
 * ELSE IF legacy output only → legacy fallback
 */
export function selectNodeOutputData(
  result: WorkflowEditorNodeResult | null | undefined,
  options: { hasDynamicPorts?: boolean } = {}
): NodeOutputSelection {
  if (!result) return { kind: "unexecuted" };

  if (result.status === "skipped") {
    return { kind: "skipped" };
  }

  const portOutputs = result.portOutputs;
  if (
    options.hasDynamicPorts &&
    portOutputs &&
    Object.keys(portOutputs).length > 0
  ) {
    return { kind: "portOutputs", portOutputs, metadata: result.output };
  }

  if (Array.isArray(result.items)) {
    return {
      kind: "items",
      items: result.items,
      executed: result.status === "succeeded",
      metadata: result.output,
    };
  }

  const fromOutput = extractItemsFromOutput(result.output);
  if (fromOutput) {
    return {
      kind: "items",
      items: fromOutput,
      executed: result.status === "succeeded",
      metadata: result.output,
    };
  }

  if (result.output != null && !isHandlerSummaryOutput(result.output)) {
    return { kind: "legacy", legacy: result.output };
  }

  if (result.status === "succeeded") {
    return { kind: "items", items: [], executed: true, metadata: result.output };
  }

  return { kind: "unexecuted" };
}

export function formatOutputMetadataSummary(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const record = redactOrchestrationOutput(metadata) as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof record.count === "number") parts.push(`${record.count} item(s)`);
  if (typeof record.droppedCount === "number") {
    parts.push(`${record.droppedCount} dropped`);
  }
  if (typeof record.routingMode === "string") {
    parts.push(`routing: ${record.routingMode}`);
  }
  if (record.routed === true) parts.push("routed");
  return parts.length > 0 ? parts.join(" · ") : null;
}
