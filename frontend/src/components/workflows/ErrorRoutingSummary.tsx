"use client";

import React from "react";
import { cn } from "@/lib/utils";
import type { WorkflowErrorRouting } from "@/modules/workflows/types";
import { getErrorRoutingDisplayState } from "@/modules/workflows/errorRoutingUx";
import { RunNavigationLink } from "./RunNavigationLink";

type Props = {
  routing: WorkflowErrorRouting | null | undefined;
  className?: string;
};

function severityClass(severity: string) {
  if (severity === "success")
    return "text-emerald-700 dark:text-emerald-300";
  if (severity === "danger") return "text-destructive";
  if (severity === "warning")
    return "text-amber-800 dark:text-amber-200";
  return "text-foreground";
}

/**
 * Compact Error Workflow handling / source-trigger metadata.
 * Separate from subworkflow lineage and business OUTPUT.
 */
export function ErrorRoutingSummary({ routing, className }: Props) {
  const display = getErrorRoutingDisplayState(routing);
  if (!display || !routing || routing.role === "none") return null;

  if (routing.role === "source") {
    const name =
      routing.targetWorkflow?.name ||
      routing.errorRun?.workflowName ||
      "Error Workflow";
    return (
      <div
        className={cn(
          "space-y-2 rounded-md border border-border/70 bg-muted/30 p-3 text-xs",
          className
        )}
        data-testid="error-routing-summary-source"
      >
        <div className="font-medium text-foreground">Error handling</div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
          <dt>Workflow</dt>
          <dd className="text-foreground">
            {routing.targetWorkflow?.deleted ? (
              <span className="italic">{name} (deleted)</span>
            ) : (
              name
            )}
          </dd>
          <dt>Status</dt>
          <dd className={cn("font-medium", severityClass(display.severity))}>
            {display.label}
          </dd>
        </dl>
        {display.description && (
          <p className="text-[11px] text-muted-foreground">
            {display.description}
          </p>
        )}
        <div className="flex flex-wrap gap-2 pt-0.5">
          {display.showOpenErrorRun && (
            <RunNavigationLink
              href={routing.openErrorRunPath}
              label="Open error run"
            />
          )}
          {display.showOpenErrorWorkflow && (
            <RunNavigationLink
              href={routing.openErrorWorkflowPath}
              label="Open workflow"
              variant="ghost"
            />
          )}
          {!display.showOpenErrorWorkflow &&
            routing.targetWorkflow?.deleted && (
              <RunNavigationLink
                href={null}
                label="Open workflow"
                disabledReason="Workflow no longer available"
              />
            )}
        </div>
      </div>
    );
  }

  // handler role
  const sourceName =
    routing.sourceRun?.workflowName || "Source workflow";
  return (
    <div
      className={cn(
        "space-y-2 rounded-md border border-border/70 bg-muted/30 p-3 text-xs",
        className
      )}
      data-testid="error-routing-summary-handler"
    >
      <div className="font-medium text-foreground">
        Triggered by workflow failure
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
        <dt>Source</dt>
        <dd className="text-foreground">
          {routing.sourceRun?.workflowDeleted ? (
            <span className="italic">{sourceName} (deleted)</span>
          ) : (
            sourceName
          )}
        </dd>
        <dt>Source run</dt>
        <dd className="font-mono text-[11px] text-foreground">
          {routing.sourceRun?.runId
            ? `${routing.sourceRun.runId.slice(0, 8)}…`
            : "—"}
        </dd>
        <dt>Source status</dt>
        <dd className="capitalize text-foreground">
          {routing.sourceRun?.status || "failed"}
        </dd>
      </dl>
      <div className="flex flex-wrap gap-2 pt-0.5">
        {display.showOpenSourceRun && (
          <RunNavigationLink
            href={routing.openSourceRunPath}
            label="Open source run"
          />
        )}
        {display.showOpenSourceWorkflow && (
          <RunNavigationLink
            href={routing.openSourceWorkflowPath}
            label="Open workflow"
            variant="ghost"
          />
        )}
        {!display.showOpenSourceWorkflow &&
          routing.sourceRun?.workflowDeleted && (
            <RunNavigationLink
              href={null}
              label="Open workflow"
              disabledReason="Workflow no longer available"
            />
          )}
      </div>
    </div>
  );
}

export function ErrorRunBadge({
  hasErrorDispatch,
  isErrorHandler,
  className,
}: {
  hasErrorDispatch?: boolean;
  isErrorHandler?: boolean;
  className?: string;
}) {
  if (isErrorHandler) {
    return (
      <span
        className={cn(
          "rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground",
          className
        )}
        data-testid="error-handler-badge"
      >
        Error handler
      </span>
    );
  }
  if (hasErrorDispatch) {
    return (
      <span
        className={cn(
          "rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground",
          className
        )}
        data-testid="error-workflow-badge"
      >
        Error workflow
      </span>
    );
  }
  return null;
}
