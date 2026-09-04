"use client";

import React from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WorkflowChildInvocationSummary } from "@/modules/workflows/types";
import { subworkflowErrorMessage } from "@/modules/workflows/subworkflowUx";

type Props = {
  summary: WorkflowChildInvocationSummary | null | undefined;
  loading?: boolean;
  className?: string;
  /** Returned item count from parent occurrence (business output). */
  returnedItemCount?: number | null;
};

function statusLabel(status: string, waitingReason?: string | null) {
  if (status === "waiting" && waitingReason === "child_run") {
    return "Waiting for child";
  }
  if (status === "waiting") return "Waiting";
  if (status === "queued") return "Queued";
  if (status === "running") return "Running";
  if (status === "succeeded") return "Succeeded";
  if (status === "failed") return "Failed";
  if (status === "cancelled") return "Cancelled";
  return status;
}

function durationMs(
  startedAt?: string | null,
  finishedAt?: string | null
): string | null {
  if (!startedAt || !finishedAt) return null;
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

/** Execute Workflow occurrence metadata — separate from business OUTPUT items. */
export function SubworkflowRunSummary({
  summary,
  loading,
  className,
  returnedItemCount,
}: Props) {
  if (loading) {
    return (
      <div className={cn("mt-3 text-xs text-muted-foreground", className)}>
        Loading child workflow…
      </div>
    );
  }
  if (!summary) return null;

  const waiting = summary.status === "waiting";
  const failed = summary.status === "failed";
  const cancelled = summary.status === "cancelled";
  const dur = durationMs(summary.startedAt, summary.finishedAt);

  let headline = statusLabel(summary.status, summary.waitingReason);
  if (waiting) {
    headline = "Waiting for child workflow";
  } else if (failed) {
    headline = "Child workflow failed";
  } else if (cancelled) {
    headline = "Child workflow was cancelled";
  }

  const waitDetail = (() => {
    if (!waiting) return null;
    const mode = summary.childWait?.resumeMode;
    if (mode === "manual") return "Child workflow is waiting for manual resume";
    if (mode === "external")
      return "Child workflow is waiting for an external signal";
    if (summary.childWait?.resumeAt || summary.resumeAt) {
      const at = summary.childWait?.resumeAt || summary.resumeAt;
      return `Child waiting until ${new Date(String(at)).toLocaleString()}`;
    }
    if (summary.waitingReason === "wait_node" || summary.waitingReason === "wait") {
      return "Child workflow is waiting";
    }
    return `Child status: ${statusLabel(summary.status, summary.waitingReason)}`;
  })();

  return (
    <div
      className={cn(
        "mt-3 space-y-2 rounded-md border border-border/70 bg-muted/30 p-3 text-xs",
        className
      )}
      data-testid="subworkflow-run-summary"
    >
      <div className="font-medium text-foreground">{headline}</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
        <dt>Child workflow</dt>
        <dd className="text-foreground">
          {summary.workflowDeleted ? (
            <span className="italic">Deleted workflow</span>
          ) : (
            summary.workflowName
          )}
        </dd>
        <dt>Child run</dt>
        <dd className="font-mono text-[11px] text-foreground">
          {summary.runId.slice(0, 8)}…
        </dd>
        <dt>Status</dt>
        <dd className="capitalize text-foreground">{summary.status}</dd>
        {dur && (
          <>
            <dt>Duration</dt>
            <dd className="text-foreground">{dur}</dd>
          </>
        )}
        {typeof returnedItemCount === "number" && summary.status === "succeeded" && (
          <>
            <dt>Returned</dt>
            <dd className="text-foreground">
              {returnedItemCount} item{returnedItemCount === 1 ? "" : "s"}
            </dd>
          </>
        )}
      </dl>

      {waitDetail && (
        <p className="text-[11px] text-amber-800 dark:text-amber-200">
          {waitDetail}
        </p>
      )}

      {(failed || cancelled) && summary.error && (
        <p className="text-[11px] text-destructive">
          {subworkflowErrorMessage(summary.error)}
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {summary.openRunPath && (
          <Button asChild type="button" variant="outline" size="sm" className="h-7 text-xs">
            <Link href={summary.openRunPath}>
              <ExternalLink className="mr-1 h-3 w-3" />
              Open child run
            </Link>
          </Button>
        )}
        {summary.openWorkflowPath && !summary.workflowDeleted && (
          <Button asChild type="button" variant="ghost" size="sm" className="h-7 text-xs">
            <Link href={summary.openWorkflowPath}>Open workflow</Link>
          </Button>
        )}
        {summary.workflowDeleted && (
          <span className="text-[11px] italic text-muted-foreground">
            Live workflow deleted — historical run only
          </span>
        )}
      </div>
    </div>
  );
}
