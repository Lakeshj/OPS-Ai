/**
 * Instagram M8.12 dependent-parameter resets.
 * Extends the M8.10 option cascade with credential/media/comment/publish clears.
 */

import type { ParamValues } from "./paramDisplayOptions";
import {
  isDemographicInsightsPreset,
  isPerformanceInsightsPreset,
  normalizeInstagramInsightsParams,
} from "./instagramInsightsNormalize";

export {
  normalizeInstagramInsightsParams,
  instagramInsightsParamsNeedNormalize,
} from "./instagramInsightsNormalize";

/** Fields scoped to the selected Instagram credential / media selection. */
export const INSTAGRAM_CREDENTIAL_SCOPED_FIELDS = [
  "mediaId",
  "mediaIdMode",
  "mediaIdLabel",
  "commentId",
  "commentIdMode",
  "commentIdLabel",
  "imageUrl",
  "imageUrlMode",
  "videoUrl",
  "videoUrlMode",
  "mediaUrl",
  "mediaUrlMode",
  "coverUrl",
  "coverUrlMode",
  "carouselItems",
] as const;

export const INSTAGRAM_MEDIA_SCOPED_FIELDS = [
  "commentId",
  "commentIdMode",
  "commentIdLabel",
] as const;

export const INSTAGRAM_PUBLISH_URL_FIELDS = [
  "imageUrl",
  "imageUrlMode",
  "videoUrl",
  "videoUrlMode",
  "mediaUrl",
  "mediaUrlMode",
  "coverUrl",
  "coverUrlMode",
  "carouselItems",
] as const;

const clearFields = (
  values: ParamValues,
  fields: readonly string[]
): ParamValues => {
  const next: ParamValues = { ...values };
  for (const field of fields) {
    if (field.endsWith("Mode")) next[field] = "list";
    else if (field === "carouselItems") next[field] = "";
    else next[field] = "";
  }
  return next;
};

/** When credential changes (including disconnect), drop credential-scoped IDs/media. */
export function applyInstagramCredentialChange(
  values: ParamValues,
  nextCredentialId: string
): ParamValues {
  const prev = String(values.credentialId || "");
  const nextId = String(nextCredentialId || "");
  let next: ParamValues = { ...values, credentialId: nextId };
  if (prev !== nextId) {
    next = clearFields(next, INSTAGRAM_CREDENTIAL_SCOPED_FIELDS);
  }
  if (!nextId) {
    next.instagramUserId = "";
    next.username = "";
    next.accountType = "";
    next.profilePictureUrl = "";
  }
  return next;
}

export function applyInstagramMediaChange(
  values: ParamValues,
  nextMediaId: string
): ParamValues {
  const prev = String(values.mediaId || "");
  const nextId = String(nextMediaId || "");
  let next: ParamValues = { ...values, mediaId: nextId };
  if (prev !== nextId) {
    next = clearFields(next, INSTAGRAM_MEDIA_SCOPED_FIELDS);
  }
  return next;
}

/** Image ↔ Reel / Story type switches clear incompatible media URL fields. */
export function applyInstagramPublishOperationChange(
  values: ParamValues,
  nextOperation: string
): ParamValues {
  const prev = String(values.operation || "");
  const nextOp = String(nextOperation || "");
  if (prev === nextOp) return { ...values, operation: nextOp };
  let next: ParamValues = { ...values, operation: nextOp };
  if (
    prev.startsWith("publish_") ||
    nextOp.startsWith("publish_") ||
    String(values.resource || "") === "publish"
  ) {
    next = clearFields(next, INSTAGRAM_PUBLISH_URL_FIELDS);
  }
  return next;
}

/** Account Insights: Performance ↔ Demographics mutates stored params (not just hide). */
export function applyInstagramInsightsPresetChange(
  values: ParamValues,
  nextPreset: string
): ParamValues {
  const prev = String(values.insightsPreset || "");
  const nextKey = String(nextPreset || "");
  let next: ParamValues = { ...values, insightsPreset: nextKey };

  const wasDemo = isDemographicInsightsPreset(prev);
  const isDemo = isDemographicInsightsPreset(nextKey);
  const wasPerf = isPerformanceInsightsPreset(prev);
  const isPerf = isPerformanceInsightsPreset(nextKey);

  // Crossing mode boundary: drop metric selections that belong to the other mode.
  if (prev !== nextKey && ((wasDemo && isPerf) || (wasPerf && isDemo))) {
    next.metrics = [];
  }

  // Always normalize — deletes stale hidden breakdown/period values.
  return normalizeInstagramInsightsParams(next);
}

export function applyInstagramResourceChange(
  values: ParamValues,
  nextResource: string
): ParamValues {
  const prev = String(values.resource || "");
  const nextRes = String(nextResource || "");
  let next: ParamValues = { ...values, resource: nextRes };
  if (prev === nextRes) return next;
  // Leaving comments/insights/publish clears foreign child selections.
  if (prev === "comments" || nextRes === "comments") {
    next = clearFields(next, INSTAGRAM_MEDIA_SCOPED_FIELDS);
  }
  if (prev === "publish" || nextRes === "publish") {
    next = clearFields(next, INSTAGRAM_PUBLISH_URL_FIELDS);
  }
  if (
    (prev === "media" || prev === "insights" || prev === "comments") &&
    nextRes !== "media" &&
    nextRes !== "insights" &&
    nextRes !== "comments"
  ) {
    next.mediaId = "";
    next.mediaIdMode = "list";
    next.mediaIdLabel = "";
  }
  return normalizeInstagramInsightsParams(next);
}
