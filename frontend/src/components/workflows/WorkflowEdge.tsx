"use client";

import React, { memo, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type WorkflowEdgeData = {
  runStatus?: "running" | "succeeded" | "failed" | "skipped";
  onDelete?: (edgeId: string) => void;
  onInsert?: (edgeId: string) => void;
};

function WorkflowEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
  markerEnd,
}: EdgeProps) {
  const edgeData = (data || {}) as WorkflowEdgeData;
  const [hovered, setHovered] = useState(false);
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const stroke =
    edgeData.runStatus === "running"
      ? "#f59e0b"
      : edgeData.runStatus === "succeeded"
        ? "#10b981"
        : edgeData.runStatus === "failed"
          ? "#ef4444"
          : selected
            ? "hsl(var(--primary))"
            : hovered
              ? "hsl(var(--foreground) / 0.55)"
              : "hsl(var(--muted-foreground) / 0.65)";

  const showControls = hovered || selected;

  return (
    <>
      {/* Wide invisible hit area for easier selection */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={24}
        className="react-flow__edge-interaction"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          strokeWidth: selected ? 3 : hovered ? 2.5 : 1.75,
          stroke,
          transition: "stroke 120ms ease, stroke-width 120ms ease",
        }}
        interactionWidth={24}
      />
      <EdgeLabelRenderer>
        <div
          className={cn(
            "nodrag nopan pointer-events-auto flex items-center gap-1.5 rounded-full border bg-card/95 px-1 py-0.5 shadow-md backdrop-blur-sm transition-opacity",
            showControls ? "opacity-100" : "pointer-events-none opacity-0"
          )}
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {edgeData.onInsert && (
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-primary hover:text-primary-foreground"
              title="Insert step"
              onClick={(e) => {
                e.stopPropagation();
                edgeData.onInsert?.(id);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
          {edgeData.onDelete && (
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
              title="Delete connection"
              onClick={(e) => {
                e.stopPropagation();
                edgeData.onDelete?.(id);
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const WorkflowEdge = memo(WorkflowEdgeComponent);
