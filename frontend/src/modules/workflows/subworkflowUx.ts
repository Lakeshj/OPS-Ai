/** Map sub-workflow engine codes to readable OpsAi UI copy. */

const MESSAGES: Record<string, string> = {
  CHILD_WORKFLOW_NOT_FOUND: "Selected workflow no longer exists.",
  SUBWORKFLOW_NOT_CALLABLE: "Selected workflow is no longer callable.",
  SUBWORKFLOW_ENTRY_REQUIRED: "Selected workflow is no longer callable.",
  SUBWORKFLOW_AMBIGUOUS_OUTPUT:
    "Child workflow produced an ambiguous callable Result.",
  SUBWORKFLOW_RECURSION: "Recursive workflow calls aren't supported.",
  SUBWORKFLOW_MAX_DEPTH: "Maximum workflow call depth reached.",
  CHILD_RUN_CANCELLED: "Child workflow was cancelled.",
  CHILD_RUN_FAILED: "Child workflow failed.",
  EXECUTE_WORKFLOW_PARTIAL_UNSUPPORTED:
    "Execute Workflow requires a full workflow run. Run Step cannot safely wait for a child workflow.",
  EXECUTE_WORKFLOW_IN_MEMORY_UNSUPPORTED:
    "Execute Workflow requires a full durable workflow run.",
  EXECUTE_WORKFLOW_MISSING_TARGET: "Select a workflow to execute.",
};

export function subworkflowErrorMessage(
  codeOrMessage: string | null | undefined,
  fallback = "Child workflow failed."
): string {
  if (!codeOrMessage) return fallback;
  const raw = String(codeOrMessage);
  if (MESSAGES[raw]) return MESSAGES[raw];
  for (const [code, msg] of Object.entries(MESSAGES)) {
    if (raw.includes(code)) return msg;
  }
  if (/child workflow failed/i.test(raw)) return "Child workflow failed.";
  if (/cancelled/i.test(raw) && /child/i.test(raw)) {
    return "Child workflow was cancelled.";
  }
  return raw.slice(0, 300) || fallback;
}

/** Internal orchestration keys never shown as business OUTPUT fields. */
export const ORCHESTRATION_OUTPUT_KEYS = new Set([
  "__callableReturnItems",
  "__subworkflowItems",
  "waitingReason",
  "childRunId",
  "parentNodeId",
  "parentExecutionIndex",
]);

export function redactOrchestrationOutput(output: unknown): unknown {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return output;
  }
  const src = output as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    if (ORCHESTRATION_OUTPUT_KEYS.has(key)) continue;
    next[key] = value;
  }
  return next;
}
