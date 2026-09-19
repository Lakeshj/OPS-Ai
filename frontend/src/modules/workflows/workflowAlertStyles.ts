/** Shared high-contrast styles for workflow error / warning / success / info panels. */

export type WorkflowAlertTone = "error" | "warning" | "success" | "info";

const PANEL: Record<WorkflowAlertTone, string> = {
  error:
    "rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-950 shadow-sm dark:border-red-500/45 dark:bg-red-950/90 dark:text-red-50",
  warning:
    "rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 shadow-sm dark:border-amber-500/45 dark:bg-amber-950/90 dark:text-amber-50",
  success:
    "rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-950 shadow-sm dark:border-emerald-500/45 dark:bg-emerald-950/90 dark:text-emerald-50",
  info:
    "rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-950 shadow-sm dark:border-sky-500/45 dark:bg-sky-950/90 dark:text-sky-50",
};

const BADGE: Record<WorkflowAlertTone, string> = {
  error:
    "rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white",
  warning:
    "rounded bg-amber-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white",
  success:
    "rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white",
  info: "rounded bg-sky-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white",
};

const COMPACT: Record<WorkflowAlertTone, string> = {
  error:
    "rounded-md border border-red-300 bg-red-50 p-2 text-red-950 dark:border-red-500/45 dark:bg-red-950/90 dark:text-red-50",
  warning:
    "rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-950 dark:border-amber-500/45 dark:bg-amber-950/90 dark:text-amber-50",
  success:
    "rounded-md border border-emerald-300 bg-emerald-50 p-2 text-emerald-950 dark:border-emerald-500/45 dark:bg-emerald-950/90 dark:text-emerald-50",
  info: "rounded-md border border-sky-300 bg-sky-50 p-2 text-sky-950 dark:border-sky-500/45 dark:bg-sky-950/90 dark:text-sky-50",
};

export const workflowAlertPanel = (tone: WorkflowAlertTone) => PANEL[tone];
export const workflowAlertBadge = (tone: WorkflowAlertTone) => BADGE[tone];
export const workflowAlertCompact = (tone: WorkflowAlertTone) => COMPACT[tone];
