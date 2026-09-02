"use client";

import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ItemDataViewer } from "./ItemDataViewer";
import type {
  WorkflowEditorNodeResult,
  WorkflowItem,
} from "@/modules/workflows/types";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";

type PortOutputPreview = Record<string, WorkflowItem[]>;

type Props = {
  result?: WorkflowEditorNodeResult | null;
  items?: WorkflowItem[];
  portOutputs?: PortOutputPreview;
  portLabels?: Record<string, string>;
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
  portOutputs,
  portLabels,
  onExecuteStep,
  onTestTrigger,
  onPin,
  pinned,
  loading,
  isTrigger,
  staticSchema,
}: Props) {
  const portIds = useMemo(
    () => (portOutputs ? Object.keys(portOutputs).sort() : []),
    [portOutputs]
  );
  const [activePortId, setActivePortId] = useState(portIds[0] || "");
  const effectivePortId =
    activePortId && portOutputs?.[activePortId] !== undefined
      ? activePortId
      : portIds[0] || "";

  const displayItems = portOutputs
    ? portOutputs[effectivePortId]
    : (items ?? (result?.items as WorkflowItem[] | undefined));

  const hasOutput =
    result?.output != null ||
    (displayItems && displayItems.length > 0) ||
    (portOutputs && portIds.length > 0) ||
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
          {portIds.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {portIds.map((portId) => {
                const count = portOutputs?.[portId]?.length ?? 0;
                return (
                  <button
                    key={portId}
                    type="button"
                    className={cn(
                      "rounded border px-2 py-0.5 text-[10px]",
                      effectivePortId === portId
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:bg-muted/50"
                    )}
                    onClick={() => setActivePortId(portId)}
                  >
                    {portLabels?.[portId] || portId}
                    <span className="ml-1 opacity-70">({count})</span>
                  </button>
                );
              })}
            </div>
          )}
          <ItemDataViewer
            items={displayItems as WorkflowItem[] | undefined}
            data={!portOutputs ? result?.output : undefined}
            emptyMessage={
              portOutputs
                ? "0 items — executed"
                : "No output data"
            }
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
