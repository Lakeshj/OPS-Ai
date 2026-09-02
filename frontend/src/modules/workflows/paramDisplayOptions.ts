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
  const normalized = normalizeValue(fieldValue);
  return allowed.some((a) => normalizeValue(a) === normalized);
};

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
  return params.filter((p) => p.type !== "hidden" && isParamVisible(p, values));
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
