/**
 * Shared output presentation resolver (display-only).
 * Used by ItemDataViewer, Result node OUTPUT, and Run Results Final Result.
 * Never mutates WorkflowItem / execution payloads.
 */

import type { WorkflowItem } from "./types";
import {
  buildInstagramInsightsCollection,
  buildInstagramMediaListCollection,
  buildInstagramReadableBlock,
  getInstagramMeta,
  isInstagramOutputJson,
  summarizeInstagramOutput,
  type InstagramReadableBlock,
} from "./instagramOutputPresentation";
import {
  isMetaAdsOutputJson,
  resolveMetaAdsOutputPresentation,
  type MetaAdsReadableBlock,
} from "./metaAdsOutputPresentation";
import {
  isFacebookPageOutputJson,
  resolveFacebookPageOutputPresentation,
  type FacebookPageReadableBlock,
} from "./facebookPageOutputPresentation";

export type OutputPresentationProvider =
  | "instagram"
  | "meta_ads"
  | "facebook_page";

export type OutputReadableBlock =
  | InstagramReadableBlock
  | MetaAdsReadableBlock
  | FacebookPageReadableBlock;

type PresentationShape =
  | "root"
  | "array"
  | "result"
  | "data"
  | "output"
  | "items"
  | "result_array"
  | "data_array"
  | "output_array"
  | "items_array";

type PresentationBase = {
  /** Unwrapped JSON objects for human-readable renderers. */
  items: Record<string, unknown>[];
  /** As WorkflowItems for existing preview components. */
  workflowItems: WorkflowItem[];
  /** How the payload was found (safe shallow shapes only). */
  shape: PresentationShape;
  /** Original value passed in — for Raw JSON / Copy. */
  original: unknown;
  summaryText: string;
};

export type ResolvedOutputPresentation =
  | (PresentationBase & {
      provider: "instagram";
      blocks: InstagramReadableBlock[];
    })
  | (PresentationBase & {
      provider: "meta_ads";
      blocks: MetaAdsReadableBlock[];
      /** Optional Meta Ads node `output` envelope (presentation/metrics). */
      metaAdsOutput?: Record<string, unknown> | null;
    })
  | (PresentationBase & {
      provider: "facebook_page";
      blocks: FacebookPageReadableBlock[];
    });

const WRAPPER_KEYS = ["result", "data", "output", "items"] as const;

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

function buildInstagramResolved(
  items: Record<string, unknown>[],
  shape: PresentationShape,
  original: unknown
): ResolvedOutputPresentation | null {
  if (!items.length || !items.every((row) => isInstagramOutputJson(row))) {
    return null;
  }

  const allInsights = items.every((row) => {
    const meta = getInstagramMeta(row);
    return (
      String(meta?.resource || "").toLowerCase() === "insights" ||
      String(meta?.operation || "")
        .toLowerCase()
        .includes("insights")
    );
  });

  const allMediaList = items.every((row) => {
    const meta = getInstagramMeta(row);
    return (
      String(meta?.resource || "").toLowerCase() === "media" &&
      String(meta?.operation || "").toLowerCase() === "list_media"
    );
  });

  let blocks: InstagramReadableBlock[];
  let summary: string;
  if (allInsights) {
    const collection = buildInstagramInsightsCollection(items);
    if (!collection) return null;
    blocks = [collection];
    summary = collection.text;
  } else if (allMediaList) {
    const collection = buildInstagramMediaListCollection(items);
    if (!collection) return null;
    blocks = [collection];
    summary = collection.title;
  } else {
    blocks = items
      .map((row, index) =>
        buildInstagramReadableBlock(
          row,
          items.length > 1 ? index : undefined
        )
      )
      .filter(Boolean) as InstagramReadableBlock[];
    if (!blocks.length) return null;
    summary =
      items.length === 1
        ? summarizeInstagramOutput(items[0]) || blocks[0].text
        : `Instagram · ${items.length} items`;
  }

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

function buildMetaAdsResolved(
  items: Record<string, unknown>[],
  shape: PresentationShape,
  original: unknown,
  outputEnvelope?: Record<string, unknown> | null
): ResolvedOutputPresentation | null {
  if (!items.length || !items.every((row) => isMetaAdsOutputJson(row))) {
    return null;
  }
  const resolved = resolveMetaAdsOutputPresentation({
    items,
    output: outputEnvelope || null,
  });
  if (!resolved?.blocks?.length) return null;
  return {
    provider: "meta_ads",
    items,
    workflowItems: toWorkflowItems(items),
    shape,
    original,
    blocks: resolved.blocks,
    summaryText: resolved.summaryText,
    metaAdsOutput: outputEnvelope || null,
  };
}

function buildFacebookPageResolved(
  items: Record<string, unknown>[],
  shape: PresentationShape,
  original: unknown
): ResolvedOutputPresentation | null {
  if (!items.length || !items.every((row) => isFacebookPageOutputJson(row))) {
    return null;
  }
  const resolved = resolveFacebookPageOutputPresentation({ items });
  if (!resolved?.blocks?.length) return null;
  return {
    provider: "facebook_page",
    items,
    workflowItems: toWorkflowItems(items),
    shape,
    original,
    blocks: resolved.blocks,
    summaryText: resolved.summaryText,
  };
}

function buildResolved(
  items: Record<string, unknown>[],
  shape: PresentationShape,
  original: unknown,
  outputEnvelope?: Record<string, unknown> | null
): ResolvedOutputPresentation | null {
  return (
    buildInstagramResolved(items, shape, original) ||
    buildMetaAdsResolved(items, shape, original, outputEnvelope) ||
    buildFacebookPageResolved(items, shape, original)
  );
}

function extractItemsAndOutput(value: unknown): {
  items: Record<string, unknown>[] | null;
  output: Record<string, unknown> | null;
  shape: PresentationShape;
} | null {
  const root = asRecord(value);
  if (!root) return null;

  // Native node envelope: { items: WorkflowItem[], output?: {...} }
  if (Array.isArray(root.items) && root.items.length) {
    const jsons = root.items
      .map((entry) => asPresentationJson(entry))
      .filter(Boolean) as Record<string, unknown>[];
    if (jsons.length === root.items.length) {
      return {
        items: jsons,
        output: asRecord(root.output),
        shape: "items_array",
      };
    }
  }
  return null;
}

/**
 * Resolve a human-readable presentation for supported providers.
 * Safe shapes only — does not deep-walk arbitrary nests.
 */
export function resolveOutputPresentation(
  value: unknown
): ResolvedOutputPresentation | null {
  if (value == null) return null;

  // Node execution envelope { items, output }
  const envelope = extractItemsAndOutput(value);
  if (envelope?.items) {
    const built = buildResolved(
      envelope.items,
      envelope.shape,
      value,
      envelope.output
    );
    if (built) return built;
  }

  // Single-item root array (or array of provider items).
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    const jsons = value
      .map((entry) => asPresentationJson(entry))
      .filter(Boolean) as Record<string, unknown>[];
    if (jsons.length === value.length) {
      const built = buildResolved(jsons, "array", value);
      if (built) return built;
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

  // Direct root item.
  if (
    isInstagramOutputJson(json) ||
    isMetaAdsOutputJson(json) ||
    isFacebookPageOutputJson(json)
  ) {
    return buildResolved([json], "root", value);
  }

  // Single obvious wrapper: result | data | output | items
  for (const key of WRAPPER_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(json, key)) continue;
    const nested = json[key];

    if (Array.isArray(nested)) {
      if (nested.length === 0) continue;
      const nestedJsons = nested
        .map((entry) => asPresentationJson(entry))
        .filter(Boolean) as Record<string, unknown>[];
      if (nestedJsons.length === nested.length) {
        const outputEnvelope =
          key === "items" ? asRecord(json.output) : null;
        const built = buildResolved(
          nestedJsons,
          `${key}_array` as PresentationShape,
          value,
          outputEnvelope
        );
        if (built) return built;
      }
      continue;
    }

    const nestedJson = asPresentationJson(nested);
    if (
      nestedJson &&
      (isInstagramOutputJson(nestedJson) ||
        isMetaAdsOutputJson(nestedJson) ||
        isFacebookPageOutputJson(nestedJson))
    ) {
      return buildResolved([nestedJson], key, value);
    }
  }

  return null;
}

/** True when value (or a safe wrapper) is Instagram presentation-eligible. */
export function hasInstagramPresentation(value: unknown): boolean {
  return resolveOutputPresentation(value)?.provider === "instagram";
}

/** True when value (or a safe wrapper) is Meta Ads presentation-eligible. */
export function hasMetaAdsPresentation(value: unknown): boolean {
  return resolveOutputPresentation(value)?.provider === "meta_ads";
}

/** True when value (or a safe wrapper) is Facebook Page presentation-eligible. */
export function hasFacebookPagePresentation(value: unknown): boolean {
  return resolveOutputPresentation(value)?.provider === "facebook_page";
}
