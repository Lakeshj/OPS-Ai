/**
 * Shared output presentation resolver (display-only).
 * Used by ItemDataViewer, Result node OUTPUT, and Run Results Final Result.
 * Never mutates WorkflowItem / execution payloads.
 */

import type { WorkflowItem } from "./types";
import {
  buildInstagramReadableBlock,
  isInstagramOutputJson,
  summarizeInstagramOutput,
  type InstagramReadableBlock,
} from "./instagramOutputPresentation";

export type OutputPresentationProvider = "instagram";

export type ResolvedOutputPresentation = {
  provider: OutputPresentationProvider;
  /** Unwrapped Instagram JSON objects for human-readable renderers. */
  items: Record<string, unknown>[];
  /** As WorkflowItems for existing preview components. */
  workflowItems: WorkflowItem[];
  /** How the Instagram payload was found (safe shallow shapes only). */
  shape:
    | "root"
    | "array"
    | "result"
    | "data"
    | "output"
    | "result_array"
    | "data_array"
    | "output_array";
  /** Original value passed in — for Raw JSON / Copy. */
  original: unknown;
  blocks: InstagramReadableBlock[];
  summaryText: string;
};

const WRAPPER_KEYS = ["result", "data", "output"] as const;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** Accept plain JSON or a WorkflowItem `{ json }`. */
export function asPresentationJson(
  value: unknown
): Record<string, unknown> | null {
  const obj = asRecord(value);
  if (!obj) return null;
  if (
    Object.prototype.hasOwnProperty.call(obj, "json") &&
    asRecord(obj.json) &&
    // Prefer WorkflowItem when it looks like one (json + optional binary/pairedItem).
    (Object.keys(obj).length <= 4 || obj.binary != null || obj.pairedItem != null)
  ) {
    return asRecord(obj.json);
  }
  return obj;
}

function toWorkflowItems(items: Record<string, unknown>[]): WorkflowItem[] {
  return items.map((json) => ({ json: { ...json } }));
}

function buildResolved(
  items: Record<string, unknown>[],
  shape: ResolvedOutputPresentation["shape"],
  original: unknown
): ResolvedOutputPresentation | null {
  if (!items.length || !items.every((row) => isInstagramOutputJson(row))) {
    return null;
  }
  const blocks = items
    .map((row, index) => buildInstagramReadableBlock(row, index))
    .filter(Boolean) as InstagramReadableBlock[];
  if (!blocks.length) return null;
  const summary =
    items.length === 1
      ? summarizeInstagramOutput(items[0]) || blocks[0].text
      : `Instagram · ${items.length} items`;
  return {
    provider: "instagram",
    items,
    workflowItems: toWorkflowItems(items),
    shape,
    original,
    blocks,
    summaryText: summary,
  };
}

/**
 * Resolve a human-readable presentation for supported providers.
 * Safe shapes only — does not deep-walk arbitrary nests.
 */
export function resolveOutputPresentation(
  value: unknown
): ResolvedOutputPresentation | null {
  if (value == null) return null;

  // Single-item root array (or array of Instagram items).
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    const jsons = value
      .map((entry) => asPresentationJson(entry))
      .filter(Boolean) as Record<string, unknown>[];
    if (jsons.length === value.length) {
      const allIg = jsons.every((row) => isInstagramOutputJson(row));
      if (allIg) return buildResolved(jsons, "array", value);
    }
    // Only unwrap a single-element array one level (safe).
    if (value.length === 1) {
      const inner = resolveOutputPresentation(value[0]);
      if (inner) {
        return { ...inner, original: value, shape: "array" };
      }
    }
    return null;
  }

  const json = asPresentationJson(value);
  if (!json) return null;

  // Direct root Instagram item.
  if (isInstagramOutputJson(json)) {
    return buildResolved([json], "root", value);
  }

  // Single obvious wrapper: result | data | output
  for (const key of WRAPPER_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(json, key)) continue;
    const nested = json[key];

    if (Array.isArray(nested)) {
      if (nested.length === 0) continue;
      const nestedJsons = nested
        .map((entry) => asPresentationJson(entry))
        .filter(Boolean) as Record<string, unknown>[];
      if (
        nestedJsons.length === nested.length &&
        nestedJsons.every((row) => isInstagramOutputJson(row))
      ) {
        return buildResolved(nestedJsons, `${key}_array`, value);
      }
      continue;
    }

    const nestedJson = asPresentationJson(nested);
    if (nestedJson && isInstagramOutputJson(nestedJson)) {
      return buildResolved([nestedJson], key, value);
    }
  }

  return null;
}

/** True when value (or a safe wrapper) is Instagram presentation-eligible. */
export function hasInstagramPresentation(value: unknown): boolean {
  return resolveOutputPresentation(value)?.provider === "instagram";
}
