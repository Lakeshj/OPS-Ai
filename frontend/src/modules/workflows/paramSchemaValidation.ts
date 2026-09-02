/**
 * Schema-driven parameter validation (required, type, ranges).
 * Semantic / cross-field rules stay in nodeValidation.ts.
 */

import type { ParamDescriptor } from "./nodeContract";
import { getNodeContract } from "./nodeContract";
import {
  getParamValue,
  getVisibleParams,
  isParamVisible,
} from "./paramDisplayOptions";
import type { WorkflowNodeData, WorkflowNodeType } from "./types";

function isEmptyValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

function validateParam(
  param: ParamDescriptor,
  values: Record<string, unknown>
): string | null {
  if (!isParamVisible(param, values)) return null;

  let value = getParamValue(values, param.name, param.default);
  if (param.name === "emailBody" && isEmptyValue(value)) {
    value = values.body;
  }

  if (param.required && isEmptyValue(value)) {
    return `${param.displayName} is required`;
  }

  if (param.type === "number" && value != null && value !== "") {
    const n = Number(value);
    if (Number.isNaN(n)) {
      return `${param.displayName} must be a number`;
    }
    if (param.min != null && n < param.min) {
      return `${param.displayName} must be at least ${param.min}`;
    }
    if (param.max != null && n > param.max) {
      return `${param.displayName} must be at most ${param.max}`;
    }
  }

  if (param.type === "options" && value != null && value !== "" && param.options) {
    const allowed = param.options.map((o) => String(o.value));
    if (!allowed.includes(String(value))) {
      return `${param.displayName} has an invalid value`;
    }
  }

  if (param.type === "multiOptions" && Array.isArray(value) && param.options) {
    const allowed = new Set(param.options.map((o) => o.value));
    for (const v of value) {
      if (!allowed.has(v as string | number | boolean)) {
        return `${param.displayName} contains an invalid selection`;
      }
    }
  }

  return null;
}

export function getSchemaParamIssues(
  nodeType: WorkflowNodeType | string | null | undefined,
  data: WorkflowNodeData | null | undefined
): string[] {
  if (!nodeType || !data) return [];
  const contract = getNodeContract(nodeType as WorkflowNodeType);
  const values = data as Record<string, unknown>;
  const issues: string[] = [];

  for (const param of getVisibleParams(contract.params, values)) {
    const issue = validateParam(param, values);
    if (issue) issues.push(issue);
  }

  // Collection sub-fields: validate enabled entries
  for (const param of contract.params) {
    if (param.type !== "collection" || !param.fields) continue;
    if (!isParamVisible(param, values)) continue;
    const bag =
      values[param.name] && typeof values[param.name] === "object"
        ? (values[param.name] as Record<string, unknown>)
        : {};
    for (const field of param.fields) {
      if (!Object.prototype.hasOwnProperty.call(bag, field.name)) continue;
      const subIssue = validateParam(
        { ...field, displayName: `${param.displayName} → ${field.displayName}` },
        { [field.name]: bag[field.name] }
      );
      if (subIssue) issues.push(subIssue);
    }
  }

  return issues;
}
