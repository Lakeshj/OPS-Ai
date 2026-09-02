"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { ItemDataViewer } from "./ItemDataViewer";
import type {
  WorkflowEditorNodeResult,
  WorkflowItem,
} from "@/modules/workflows/types";
import { Zap } from "lucide-react";

type Props = {
  result?: WorkflowEditorNodeResult | null;
  items?: WorkflowItem[];
  onExecuteStep?: () => void;
  onTestTrigger?: () => void;
  onPin?: () => void;
  pinned?: boolean;
  loading?: boolean;
  isTrigger?: boolean;
  /** Static output keys shown before any run (triggers only) */
  staticSchema?: Record<string, string>;
};

export function NodeOutputPanel({
  result,
  items,
  onExecuteStep,
  onTestTrigger,
  onPin,
  pinned,
  loading,
  isTrigger,
  staticSchema,
}: Props) {
  const hasOutput =
    result?.output != null ||
    (items && items.length > 0) ||
    (result?.items && result.items.length > 0);

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Output
        </span>
        {result?.executionTimeMs != null && (
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {result.executionTimeMs}ms
          </span>
        )}
      </div>

      {result?.status === "failed" && (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-[10px] text-destructive">
          {result.error || "Execution failed"}
        </div>
      )}

      {!hasOutput ? (
        <div className="space-y-3 rounded border border-dashed p-3 text-center">
          {isTrigger ? (
            <>
              <Zap className="mx-auto h-5 w-5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">No trigger output</p>
              {staticSchema && (
                <div className="rounded border bg-muted/30 p-2 text-left">
                  <p className="mb-1 text-[10px] font-medium text-muted-foreground">
                    Output schema
                  </p>
                  <ul className="space-y-0.5 font-mono text-[10px] text-muted-foreground">
                    {Object.entries(staticSchema).map(([key, desc]) => (
                      <li key={key}>
                        <span className="text-foreground">{key}</span>
                        {desc ? (
                          <span className="text-muted-foreground"> — {desc}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {onTestTrigger && (
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={loading}
                  onClick={onTestTrigger}
                >
                  Test this trigger
                </Button>
              )}
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Execute previous nodes to see input, or run this step
              </p>
              {onExecuteStep && (
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={loading}
                  onClick={onExecuteStep}
                >
                  Execute step
                </Button>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          <ItemDataViewer
            items={result?.items as WorkflowItem[] | undefined}
            data={result?.output}
          />
          {onPin && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={onPin}
            >
              {pinned ? "Unpin output" : "Pin output"}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
