/**
 * Part 11C — centralized Error Workflow routing display state.
 * Maps dispatch + error-run status to user-facing labels/actions.
 */

import type { WorkflowErrorRouting } from "./types";

export type ErrorRoutingSeverity =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";

export type ErrorRoutingDisplayState = {
  label: string;
  description: string | null;
  severity: ErrorRoutingSeverity;
  showOpenErrorRun: boolean;
  showOpenSourceRun: boolean;
  showOpenErrorWorkflow: boolean;
  showOpenSourceWorkflow: boolean;
  /** True when UI should keep polling (non-terminal handler / pending dispatch). */
  keepPolling: boolean;
};

const RUN_STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  waiting: "Waiting",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
};

function runStatusLabel(status?: string | null): string {
  if (!status) return "Unknown";
  return RUN_STATUS_LABEL[status] || status;
}

export function isErrorRoutingTerminal(
  routing: WorkflowErrorRouting | null | undefined
): boolean {
  if (!routing || routing.role === "none" || !routing.dispatch) return true;
  const st = routing.dispatch.status;
  if (st === "unavailable" || st === "failed") return true;
  if (st === "pending" || st === "claimed") return false;
  if (st === "dispatched") {
    const rs = routing.errorRun?.status;
    if (!rs) return false;
    return (
      rs === "succeeded" || rs === "failed" || rs === "cancelled"
    );
  }
  return true;
}

export function getErrorRoutingDisplayState(
  routing: WorkflowErrorRouting | null | undefined
): ErrorRoutingDisplayState | null {
  if (!routing || routing.role === "none" || !routing.dispatch) return null;

  const d = routing.dispatch;
  const outcome = d.outcomeCode || "";
  const handlerName =
    routing.targetWorkflow?.name ||
    routing.errorRun?.workflowName ||
    "Error Workflow";

  const baseActions = {
    showOpenErrorRun: Boolean(routing.openErrorRunPath),
    showOpenSourceRun: Boolean(routing.openSourceRunPath),
    showOpenErrorWorkflow: Boolean(routing.openErrorWorkflowPath),
    showOpenSourceWorkflow: Boolean(routing.openSourceWorkflowPath),
  };

  if (d.status === "unavailable" || outcome === "TARGET_UNAVAILABLE") {
    return {
      label: "Unavailable",
      description:
        "Error workflow could not be started because the selected workflow is no longer available.",
      severity: "warning",
      ...baseActions,
      showOpenErrorRun: false,
      keepPolling: false,
    };
  }

  if (outcome === "ERROR_WORKFLOW_NOT_CALLABLE") {
    return {
      label: "Invalid configuration",
      description:
        "Error workflow could not be started because its Error Trigger configuration is no longer valid.",
      severity: "warning",
      ...baseActions,
      showOpenErrorRun: false,
      keepPolling: false,
    };
  }

  if (d.status === "failed") {
    return {
      label: "Could not start",
      description: "Error workflow could not be started.",
      severity: "danger",
      ...baseActions,
      showOpenErrorRun: false,
      keepPolling: false,
    };
  }

  if (d.status === "pending") {
    return {
      label: "Queued",
      description: "Preparing error workflow…",
      severity: "info",
      ...baseActions,
      showOpenErrorRun: false,
      keepPolling: true,
    };
  }

  if (d.status === "claimed") {
    return {
      label: "Starting",
      description: "Starting error workflow…",
      severity: "info",
      ...baseActions,
      showOpenErrorRun: false,
      keepPolling: true,
    };
  }

  // dispatched (+ error run status)
  const rs = routing.errorRun?.status;
  if (!rs) {
    return {
      label: "Starting",
      description: "Starting error workflow…",
      severity: "info",
      ...baseActions,
      showOpenErrorRun: false,
      keepPolling: true,
    };
  }

  if (rs === "queued" || rs === "running") {
    return {
      label: runStatusLabel(rs),
      description: `${handlerName} is ${runStatusLabel(rs).toLowerCase()}.`,
      severity: "info",
      ...baseActions,
      keepPolling: true,
    };
  }

  if (rs === "waiting") {
    const reason = routing.errorRun?.waitingReason;
    let description = "Error workflow waiting";
    if (routing.errorRun?.resumeAt) {
      description = `Waiting until ${new Date(
        String(routing.errorRun.resumeAt)
      ).toLocaleString()}`;
    } else if (reason === "wait_node" || reason === "wait") {
      description = "Waiting for resume";
    }
    return {
      label: "Waiting",
      description,
      severity: "warning",
      ...baseActions,
      keepPolling: true,
    };
  }

  if (rs === "succeeded") {
    return {
      label: "Succeeded",
      description: null,
      severity: "success",
      ...baseActions,
      keepPolling: false,
    };
  }

  if (rs === "failed") {
    return {
      label: "Failed",
      description: null,
      severity: "danger",
      ...baseActions,
      keepPolling: false,
    };
  }

  if (rs === "cancelled") {
    return {
      label: "Cancelled",
      description: "Error workflow cancelled",
      severity: "warning",
      ...baseActions,
      keepPolling: false,
    };
  }

  return {
    label: runStatusLabel(rs),
    description: null,
    severity: "neutral",
    ...baseActions,
    keepPolling: !isErrorRoutingTerminal(routing),
  };
}
