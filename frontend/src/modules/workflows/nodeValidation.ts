import type { WorkflowNodeData, WorkflowNodeType } from "./types";
import { getSchemaParamIssues } from "./paramSchemaValidation";

/**
 * Semantic / cross-field validation beyond declarative schema rules.
 * Basic required, type, enum, and range checks live in paramSchemaValidation.ts.
 */
function getSemanticNodeIssues(
  nodeType: WorkflowNodeType | string,
  d: WorkflowNodeData
): string[] {
  const issues: string[] = [];

  switch (nodeType) {
    case "email": {
      if (!String(d.emailBody || d.body || "").trim()) {
        issues.push("Body is required");
      }
      break;
    }
    case "set": {
      const mappings = Array.isArray(d.mappings) ? d.mappings : [];
      const valid = mappings.filter(
        (m) => String(m?.key || "").trim() && String(m?.value ?? "").length > 0
      );
      if (valid.length === 0) {
        issues.push("Add at least one key → value mapping");
      }
      break;
    }
    case "schedule": {
      const rules = Array.isArray(d.scheduleRules) ? d.scheduleRules : [];
      if (rules.length === 0 && !String(d.cron || "").trim()) {
        issues.push("Add at least one schedule rule");
      }
      break;
    }
    case "filter": {
      if (!String(d.fieldName || "").trim() && !String(d.left || "").trim()) {
        issues.push("Pick the field to test");
      }
      break;
    }
    case "aggregate": {
      const operation = String(d.operation || "count");
      if (operation !== "count" && !String(d.fieldName || "").trim()) {
        issues.push(`"${operation}" needs a field name`);
      }
      break;
    }
    default:
      break;
  }

  return issues;
}

/** Returns human-readable missing/invalid config messages for a node. */
export function getNodeConfigIssues(
  nodeType: WorkflowNodeType | string | null | undefined,
  data: WorkflowNodeData | null | undefined
): string[] {
  if (!nodeType) return [];
  const d = data || {};

  const schemaIssues = getSchemaParamIssues(nodeType, d);
  const semanticIssues = getSemanticNodeIssues(nodeType, d);

  // Email body: schema checks emailBody; semantic adds legacy `body` fallback without duplicating
  const filteredSchema =
    nodeType === "email"
      ? schemaIssues.filter((i) => !i.toLowerCase().includes("body"))
      : schemaIssues;

  const merged = [...filteredSchema, ...semanticIssues];
  return [...new Set(merged)];
}

export function nodeHasMissingConfig(
  nodeType: WorkflowNodeType | string | null | undefined,
  data: WorkflowNodeData | null | undefined
): boolean {
  return getNodeConfigIssues(nodeType, data).length > 0;
}
