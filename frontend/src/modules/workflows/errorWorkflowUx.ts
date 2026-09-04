/** Map Error Workflow configure/dispatch codes to OpsAi UI copy (Part 11B). */

const MESSAGES: Record<string, string> = {
  ERROR_WORKFLOW_SELF: "This workflow cannot handle its own errors.",
  ERROR_WORKFLOW_NOT_CALLABLE:
    "Selected workflow needs exactly one Error Trigger.",
  ERROR_WORKFLOW_NOT_FOUND: "Selected Error Workflow no longer exists.",
  TARGET_UNAVAILABLE: "Selected Error Workflow no longer exists.",
  FORBIDDEN: "You don't have access to this Error Workflow.",
  NOT_FOUND: "Workflow not found.",
};

export function errorWorkflowErrorMessage(
  codeOrMessage: string | null | undefined,
  fallback = "Could not update Error Workflow."
): string {
  if (!codeOrMessage) return fallback;
  const raw = String(codeOrMessage);
  if (MESSAGES[raw]) return MESSAGES[raw];
  for (const [code, msg] of Object.entries(MESSAGES)) {
    if (raw.includes(code)) return msg;
  }
  return raw.slice(0, 300) || fallback;
}
