/**
 * OpsAi parameter visibility engine — evaluates displayOptions.show / hide
 * against flat node data values (backward-compatible with WorkflowNodeData).
 */

import type { DisplayOptions, ParamDescriptor } from "./nodeContract";

export type ParamValues = Record<string, unknown>;

const normalizeValue = (v: unknown): string | number | boolean => {
  if (typeof v === "boolean" || typeof v === "number") return v;
  if (v == null) return "";
  return String(v);
};

const conditionMatches = (
  fieldValue: unknown,
  allowed: Array<string | number | boolean>
): boolean => {
  // multiOptions stores an array — show when any selected value is allowed.
  if (Array.isArray(fieldValue)) {
    return fieldValue.some((v) =>
      allowed.some((a) => normalizeValue(a) === normalizeValue(v))
    );
  }
  const normalized = normalizeValue(fieldValue);
  return allowed.some((a) => normalizeValue(a) === normalized);
};

function applyParamDefault(
  next: ParamValues,
  values: ParamValues,
  param: ParamDescriptor
) {
  if (
    param.default !== undefined &&
    !Object.prototype.hasOwnProperty.call(values, param.name)
  ) {
    next[param.name] = param.default;
  }
}

/** Fill missing keys from schema defaults without mutating stored node data. */
export function valuesWithParamDefaults(
  params: ParamDescriptor[],
  values: ParamValues
): ParamValues {
  const next: ParamValues = { ...values };
  for (const param of params) {
    applyParamDefault(next, values, param);
    // Nested per-option settings (e.g. capabilitySettings typeOptions)
    if (param.typeOptions) {
      for (const nested of Object.values(param.typeOptions)) {
        for (const child of nested) {
          applyParamDefault(next, values, child);
        }
      }
    }
    if (param.fields?.length) {
      for (const child of param.fields) {
        applyParamDefault(next, values, child);
      }
    }
  }
  return next;
}

/** True when ALL show rules match and NO hide rule matches. */
export function isParamVisible(
  param: Pick<ParamDescriptor, "displayOptions">,
  values: ParamValues
): boolean {
  const { show, hide } = param.displayOptions || {};

  if (show) {
    for (const [key, allowed] of Object.entries(show)) {
      if (!allowed?.length) continue;
      if (!conditionMatches(values[key], allowed)) return false;
    }
  }

  if (hide) {
    for (const [key, blocked] of Object.entries(hide)) {
      if (!blocked?.length) continue;
      if (conditionMatches(values[key], blocked)) return false;
    }
  }

  return true;
}

export function getVisibleParams(
  params: ParamDescriptor[],
  values: ParamValues
): ParamDescriptor[] {
  const resolved = valuesWithParamDefaults(params, values);
  return params.filter((p) => p.type !== "hidden" && isParamVisible(p, resolved));
}

export function getParamValue(
  values: ParamValues,
  name: string,
  fallback?: unknown
): unknown {
  if (Object.prototype.hasOwnProperty.call(values, name)) {
    return values[name];
  }
  return fallback;
}

export function resolveParamDefault(param: ParamDescriptor): unknown {
  if (param.default !== undefined) return param.default;
  switch (param.type) {
    case "boolean":
      return false;
    case "number":
      return 0;
    case "fixedCollection":
      return [];
    case "collection":
      return {};
    case "multiOptions":
      return [];
    default:
      return "";
  }
}
