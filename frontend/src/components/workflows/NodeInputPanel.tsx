"use client";

import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ItemDataViewer } from "./ItemDataViewer";
import type { WorkflowItem } from "@/modules/workflows/types";
import { cn } from "@/lib/utils";

export type PortInputPreview = {
  portId: string;
  label: string;
  state: string;
  items?: WorkflowItem[];
  sourceNodeId?: string | null;
  sourcePort?: string | null;
};

type Props = {
  items?: WorkflowItem[];
  incoming?: Record<string, unknown>;
  portInputs?: Record<string, PortInputPreview>;
  /** When no upstream nodes ran yet, show workflow run input like a manual trigger. */
  runInputData?: Record<string, unknown>;
  onExecutePrevious?: () => void;
  loading?: boolean;
  selectedItemIndex?: number;
  onSelectedItemIndexChange?: (index: number) => void;
  stale?: boolean;
  staleNodeIds?: string[];
};

const portStateLabel = (state: string, itemCount: number) => {
  if (state === "pending") return "Waiting";
  if (state === "skipped") return "Branch not taken";
  if (state === "error") return "Error";
  if (state === "arrived_empty") return "0 items — executed";
  if (state === "arrived_with_data") return `${itemCount} item${itemCount === 1 ? "" : "s"}`;
  if (itemCount === 0) return "Not executed";
  return `${itemCount} item${itemCount === 1 ? "" : "s"}`;
};

export function NodeInputPanel({
  items,
  incoming,
  portInputs,
  runInputData,
  onExecutePrevious,
  loading,
  selectedItemIndex = 0,
  onSelectedItemIndexChange,
  stale,
  staleNodeIds,
}: Props) {
  const portIds = useMemo(
    () => (portInputs ? Object.keys(portInputs).sort() : []),
    [portInputs]
  );
  const [activePortId, setActivePortId] = useState(portIds[0] || "");

  const effectivePortId =
    activePortId && portInputs?.[activePortId] ? activePortId : portIds[0] || "";

  const activePort = effectivePortId ? portInputs?.[effectivePortId] : undefined;

  const fallbackItems = useMemo(() => {
    if (!runInputData || Object.keys(runInputData).length === 0) return undefined;
    return [
      {
        json: {
          triggered: true,
          kind: "manual",
          input: runInputData,
        },
      },
    ] as WorkflowItem[];
  }, [runInputData]);

  const hasPortInputs = portIds.length > 0;
  const portItems = activePort?.items;
  const hasApiItems = Boolean(
    hasPortInputs ? portItems && portItems.length > 0 : items && items.length > 0
  );
  const hasIncomingOnly =
    !hasApiItems && Boolean(incoming && Object.keys(incoming).length > 0);

  const displayItems = hasPortInputs
    ? portItems
    : hasApiItems
      ? items
      : hasIncomingOnly
        ? undefined
        : fallbackItems;
  const displayData = hasIncomingOnly && !hasPortInputs ? incoming : undefined;

  const hasData =
    hasPortInputs ||
    hasApiItems ||
    hasIncomingOnly ||
    (fallbackItems && fallbackItems.length > 0);

  const portEmptyMessage = activePort
    ? portStateLabel(activePort.state, activePort.items?.length ?? 0)
    : "No input data";

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Input
        </span>
      </div>

      {hasPortInputs && (
        <div className="flex flex-wrap gap-1">
          {portIds.map((portId) => {
            const port = portInputs![portId];
            const count = port.items?.length ?? 0;
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
                {port.label || portId}
                <span className="ml-1 opacity-70">
                  ({portStateLabel(port.state, count)})
                </span>
              </button>
            );
          })}
        </div>
      )}

      {!hasData ? (
        <div className="space-y-2 rounded border border-dashed p-3 text-center">
          <p className="text-xs text-muted-foreground">No input data available</p>
          {onExecutePrevious && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={loading}
              onClick={onExecutePrevious}
            >
              Execute previous steps
            </Button>
          )}
        </div>
      ) : (
        <>
          {stale && (
            <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-900 dark:text-amber-100">
              Previous output may be stale
              {staleNodeIds && staleNodeIds.length > 0
                ? ` (${staleNodeIds.join(", ")})`
                : ""}
              . Run previous steps to refresh.
            </p>
          )}
          <ItemDataViewer
            items={displayItems}
            data={displayData}
            emptyMessage={hasPortInputs ? portEmptyMessage : "No input data"}
            selectedItemIndex={selectedItemIndex}
            onSelectedItemIndexChange={onSelectedItemIndexChange}
          />
        </>
      )}
    </div>
  );
}
