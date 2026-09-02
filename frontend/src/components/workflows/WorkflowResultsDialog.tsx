"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  WorkflowResultsPanel,
  type WorkflowResultsPanelProps,
} from "./WorkflowResultsSidebar";

type Props = WorkflowResultsPanelProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function WorkflowResultsDialog({
  open,
  onOpenChange,
  ...panelProps
}: Props) {
  const status = panelProps.latestRun?.status;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(90vh,860px)] max-h-[min(90vh,860px)] w-[min(96vw,48rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 space-y-1 border-b px-5 py-4 pr-12 text-left">
          <DialogTitle className="text-base">Run results</DialogTitle>
          <DialogDescription className="text-xs">
            {status ? (
              <>
                Latest run status:{" "}
                <span className="font-medium capitalize">{status}</span>
              </>
            ) : (
              "Execute the workflow to inspect each step's input and output."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3">
          <WorkflowResultsPanel {...panelProps} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default WorkflowResultsDialog;
