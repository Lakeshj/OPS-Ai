"use client";

import React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkflowRunLineage } from "@/modules/workflows/types";

type Props = {
  lineage: WorkflowRunLineage | null | undefined;
  className?: string;
};

/** Compact A → B → C breadcrumb for sub-workflow run chains. */
export function RunLineageBadge({ lineage, className }: Props) {
  if (!lineage?.breadcrumb?.length) return null;
  const crumbs = lineage.breadcrumb;
  if (crumbs.length < 2 && !lineage.children?.length) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground",
        className
      )}
      data-testid="run-lineage-badge"
    >
          {crumbs.map((crumb, index) => (
        <React.Fragment key={crumb.runId}>
          {index > 0 && <ChevronRight className="h-3 w-3 opacity-60" />}
          <Link
            href={`/workflows/${crumb.workflowId}?runId=${encodeURIComponent(crumb.runId)}`}
            className={cn(
              "truncate font-medium underline-offset-2 hover:underline",
              crumb.workflowDeleted
                ? "italic text-muted-foreground"
                : "text-foreground/80"
            )}
            title={
              crumb.workflowDeleted
                ? `${crumb.workflowName} (deleted) · ${crumb.status}`
                : `${crumb.workflowName} · ${crumb.status}`
            }
          >
            {crumb.workflowName}
          </Link>
        </React.Fragment>
      ))}
      {lineage.children.length > 0 && (
        <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px]">
          {lineage.children.length} child run
          {lineage.children.length === 1 ? "" : "s"}
        </span>
      )}
    </div>
  );
}
