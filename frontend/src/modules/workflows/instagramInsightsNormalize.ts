/**
 * Instagram Account Insights parameter normalization (M8.13.1).
 * displayOptions hide incompatible fields — this mutates stored node config
 * so stale values cannot leak into execution payloads.
 */

import type { ParamValues } from "./paramDisplayOptions";

export const PERFORMANCE_INSIGHT_PRESETS = new Set([
  "overview",
  "engagement",
  "audience",
  "custom",
]);

export const DEMOGRAPHIC_INSIGHT_PRESET = "demographics";

const deleteKeys = (values: ParamValues, keys: readonly string[]): ParamValues => {
  const next: ParamValues = { ...values };
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(next, key)) {
      delete next[key];
    }
  }
  return next;
};

export function isPerformanceInsightsPreset(preset: string): boolean {
  const key = String(preset || "").trim();
  return PERFORMANCE_INSIGHT_PRESETS.has(key) || key === "";
}

export function isDemographicInsightsPreset(preset: string): boolean {
  return String(preset || "").trim() === DEMOGRAPHIC_INSIGHT_PRESET;
}

/**
 * Normalize Account Insights params for the active mode.
 * Safe to call on every load / preset change / before execute.
 */
export function normalizeInstagramInsightsParams(
  values: ParamValues
): ParamValues {
  const resource = String(values.resource || "").trim();
  const operation = String(values.operation || "").trim();
  // Skip non-Insights resources / other Insights operations (e.g. media_insights).
  if (resource && resource !== "insights") {
    return { ...values };
  }
  if (operation && operation !== "account_insights") {
    return { ...values };
  }

  const presetRaw = String(
    values.insightsPreset || values.insightsMode || ""
  ).trim();
  // Nothing to normalize unless Account Insights mode is present or fully scoped.
  if (
    !presetRaw &&
    !(resource === "insights" && operation === "account_insights")
  ) {
    return { ...values };
  }

  const preset = presetRaw || "overview";
  let next: ParamValues = { ...values, insightsPreset: preset };

  if (isDemographicInsightsPreset(preset)) {
    next.period = "lifetime";
    next = deleteKeys(next, [
      "dateRange",
      "since",
      "until",
      "dateStart",
      "dateEnd",
      "timeframe",
    ]);
    if (!String(next.breakdown || "").trim()) {
      next.breakdown = "age";
    }
    return next;
  }

  if (isPerformanceInsightsPreset(preset)) {
    next = deleteKeys(next, ["breakdown", "timeframe"]);
    return next;
  }

  return next;
}

export function instagramInsightsParamsNeedNormalize(
  before: ParamValues,
  after: ParamValues
): boolean {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const a = before[key];
    const b = after[key];
    const aMissing = !Object.prototype.hasOwnProperty.call(before, key);
    const bMissing = !Object.prototype.hasOwnProperty.call(after, key);
    if (aMissing !== bMissing) return true;
    if (String(a ?? "") !== String(b ?? "")) return true;
  }
  return false;
}
