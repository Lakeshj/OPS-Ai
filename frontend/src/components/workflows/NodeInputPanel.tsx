"use client";

import React, { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ItemDataViewer } from "./ItemDataViewer";
import type { WorkflowItem } from "@/modules/workflows/types";

type Props = {
  items?: WorkflowItem[];
  incoming?: Record<string, unknown>;
  /** When no upstream nodes ran yet, show workflow run input like a manual trigger. */
  runInputData?: Record<string, unknown>;
  onExecutePrevious?: () => void;
  loading?: boolean;
  selectedItemIndex?: number;
  onSelectedItemIndexChange?: (index: number) => void;
};

export function NodeInputPanel({
  items,
  incoming,
  runInputData,
  onExecutePrevious,
  loading,
  selectedItemIndex = 0,
  onSelectedItemIndexChange,
}: Props) {
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

  const hasApiItems = Boolean(items && items.length > 0);
  const hasIncomingOnly =
    !hasApiItems && Boolean(incoming && Object.keys(incoming).length > 0);

  const displayItems = hasApiItems ? items : hasIncomingOnly ? undefined : fallbackItems;
  const displayData = hasIncomingOnly ? incoming : undefined;

  const hasData =
    hasApiItems ||
    hasIncomingOnly ||
    (fallbackItems && fallbackItems.length > 0);

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Input
        </span>
      </div>
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
        <ItemDataViewer
          items={displayItems}
          data={displayData}
          emptyMessage="No input data"
          selectedItemIndex={selectedItemIndex}
          onSelectedItemIndexChange={onSelectedItemIndexChange}
        />
      )}
    </div>
  );
}
