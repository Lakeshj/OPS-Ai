/**
 * Dependent options cascade — when a parent field (e.g. resource) changes,
 * child option values with displayOptions must remain valid for the new parent.
 *
 * Display-only normalization for the editor. Does not change backend contracts.
 */

import type { ParamDescriptor } from "./nodeContract";
import {
  isParamVisible,
  valuesWithParamDefaults,
  type ParamValues,
} from "./paramDisplayOptions";

export function getVisibleOptionValues(
  param: ParamDescriptor,
  values: ParamValues
): Array<string | number | boolean> {
  return (param.options || [])
    .filter((opt) =>
      isParamVisible({ displayOptions: opt.displayOptions }, values)
    )
    .map((opt) => opt.value);
}

export function isOptionValueVisible(
  param: ParamDescriptor,
  value: unknown,
  values: ParamValues
): boolean {
  if (value == null || value === "") return false;
  return getVisibleOptionValues(param, values).some(
    (allowed) => String(allowed) === String(value)
  );
}

/**
 * If any options field with per-option displayOptions holds an invalid value
 * for the current parent values, reset it to the first visible option (or "").
 */
export function reconcileDependentOptionParams(
  params: ParamDescriptor[],
  values: ParamValues
): ParamValues {
  const next: ParamValues = { ...values };
  // Iterate until stable — resource → operation may unlock other option fields.
  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;
    const resolved = valuesWithParamDefaults(params, next);
    for (const param of params) {
      if (param.type !== "options" || !param.options?.length) continue;
      const hasDependentOptions = param.options.some((opt) =>
        Boolean(opt.displayOptions)
      );
      if (!hasDependentOptions) continue;

      const visible = getVisibleOptionValues(param, resolved);
      if (!visible.length) continue;
      const current =
        next[param.name] !== undefined ? next[param.name] : param.default;
      const ok = visible.some((v) => String(v) === String(current ?? ""));
      if (!ok) {
        next[param.name] = visible[0];
        changed = true;
      }
    }
    if (!changed) break;
  }
  return next;
}

export function dependentParamsNeedReconcile(
  before: ParamValues,
  after: ParamValues,
  params: ParamDescriptor[]
): boolean {
  for (const param of params) {
    if (param.type !== "options") continue;
    if (!param.options?.some((opt) => opt.displayOptions)) continue;
    if (String(before[param.name] ?? "") !== String(after[param.name] ?? "")) {
      return true;
    }
  }
  return false;
}
