"use client";

import React, { memo, useState } from "react";
import { Handle, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import { AlertCircle, Check, Pin, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { nodeHasMissingConfig } from "@/modules/workflows/nodeValidation";
import { getNodeContract } from "@/modules/workflows/nodeRegistry";
import { resolveNodeOutputPorts } from "@/modules/workflows/dynamicPorts";
import type { WorkflowNodeData } from "@/modules/workflows/types";
import { WorkflowNodeToolbar } from "./WorkflowNodeToolbar";
import { WorkflowNodeContextMenu } from "./WorkflowNodeContextMenu";
import { useWorkflowCanvasActions } from "./WorkflowCanvasContext";
import { Button } from "@/components/ui/button";

const base =
  "min-w-[170px] max-w-[220px] rounded-lg border bg-card px-3 py-2 shadow-sm text-sm relative";

const typeStyles: Record<string, string> = {
  trigger: "border-emerald-500/60",
  schedule: "border-teal-500/60",
  webhook: "border-cyan-500/60",
  ai: "border-blue-500/60",
  bot: "border-fuchsia-500/60",
  http: "border-amber-500/60",
  condition: "border-violet-500/60",
  set: "border-sky-500/60",
  splitOut: "border-orange-500/60",
  filter: "border-yellow-600/60",
  limit: "border-slate-500/60",
  sort: "border-slate-500/60",
  removeDuplicates: "border-slate-500/60",
  aggregate: "border-purple-500/60",
  merge: "border-green-600/60",
  switch: "border-indigo-600/60",
  code: "border-zinc-500/60",
  document: "border-indigo-500/60",
  spreadsheet: "border-lime-600/60",
  email: "border-pink-500/60",
  wait: "border-stone-500/60",
  loop: "border-teal-600/60",
  result: "border-rose-500/60",
  noop: "border-border",
  integration: "border-dashed border-muted-foreground/50",
};

const statusStyles: Record<string, string> = {
  succeeded: "ring-2 ring-emerald-500/70",
  failed: "ring-2 ring-destructive/70",
  running: "ring-2 ring-amber-500/70",
  pending: "",
  skipped: "opacity-60",
};

const START_TYPES = new Set(["trigger", "schedule", "webhook"]);

function StatusBadge({
  runStatus,
  missingConfig,
  cacheDirty,
}: {
  runStatus: string;
  missingConfig: boolean;
  cacheDirty?: boolean;
}) {
  if (cacheDirty && runStatus === "succeeded") {
    return (
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-white"
        title="Needs re-run"
      >
        <AlertCircle className="h-3 w-3" />
      </span>
    );
  }
  if (runStatus === "succeeded") {
    return (
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white"
        title="Succeeded"
      >
        <Check className="h-3 w-3" strokeWidth={3} />
      </span>
    );
  }
  if (runStatus === "failed") {
    return (
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-white"
        title="Failed"
      >
        <X className="h-3 w-3" strokeWidth={3} />
      </span>
    );
  }
  if (missingConfig) {
    return (
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-white"
        title="Missing configuration"
      >
        <AlertCircle className="h-3 w-3" />
      </span>
    );
  }
  if (runStatus === "running") {
    return (
      <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] capitalize text-amber-700">
        running
      </span>
    );
  }
  return null;
}

function WorkflowNodeComponent({ id, data, type, selected }: NodeProps) {
  const canvas = useWorkflowCanvasActions();
  const [hovered, setHovered] = useState(false);
  const nodeType = String(type || data?.nodeType || "ai");
  const label = String(data?.label || nodeType);
  const runStatus = data?.runStatus ? String(data.runStatus) : "";
  const preview = data?.runPreview ? String(data.runPreview) : "";
  const nodeData = (data || {}) as WorkflowNodeData;
  const missingConfig =
    !runStatus || runStatus === "pending"
      ? nodeHasMissingConfig(nodeType, nodeData)
      : false;
  const isPlaceholder =
    nodeType === "integration" || nodeData.available === false;
  const actions = canvas?.getNodeActions(id) ?? {};
  const hasOutput = nodeType !== "result";
  const showToolbar = hovered && !selected;
  const contract = getNodeContract(
    nodeType as import("@/modules/workflows/types").WorkflowNodeType
  );
  const mainInputPorts = contract.inputs.filter(
    (p) => p.direction === "in" && p.kind === "main"
  );
  const outputPorts = resolveNodeOutputPorts(
    nodeType as import("@/modules/workflows/types").WorkflowNodeType,
    nodeData,
    id
  );
  const mainOutputPorts = outputPorts.filter(
    (p) =>
      p.direction === "out" &&
      (p.kind === "main" || p.kind === "true" || p.kind === "false" || p.kind === "fallback")
  );

  const nodeBody = (
    <div
      className={cn(
        base,
        "relative transition-[box-shadow,transform] duration-200",
        typeStyles[nodeType] || "border-border",
        selected && "ring-2 ring-primary",
        runStatus && statusStyles[runStatus],
        missingConfig && !runStatus && "ring-1 ring-amber-500/50",
        nodeData.disabled && "border-dashed opacity-50",
        showToolbar &&
          "z-10 shadow-lg shadow-black/10 ring-1 ring-foreground/10 dark:shadow-black/30"
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <WorkflowNodeToolbar
        nodeType={nodeType}
        data={nodeData}
        visible={showToolbar}
        actions={actions}
      />
      {!START_TYPES.has(nodeType) &&
        (mainInputPorts.length > 1 ? (
          <>
            {mainInputPorts.map((port, index) => (
              <Handle
                key={port.id}
                type="target"
                position={Position.Left}
                id={port.id}
                title={
                  port.description
                    ? `${port.label || port.id}: ${port.description}`
                    : port.label || port.id
                }
                style={{
                  top: `${((index + 1) / (mainInputPorts.length + 1)) * 100}%`,
                }}
                className="!h-3 !w-3 !border-2 !bg-background !border-muted-foreground"
              />
            ))}
          </>
        ) : (
          <Handle
            type="target"
            position={Position.Left}
            className="!h-3 !w-3 !border-2 !bg-background !border-muted-foreground"
          />
        ))}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          {nodeType}
          {nodeData.disabled && (
            <span className="normal-case text-destructive">off</span>
          )}
          {nodeData.pinned && (
            <Pin className="h-3 w-3 text-primary" aria-label="Output pinned" />
          )}
        </div>
        <StatusBadge
          runStatus={runStatus}
          missingConfig={missingConfig}
          cacheDirty={nodeData.cacheDirty}
        />
      </div>
      <div className="font-medium text-foreground">{label}</div>
      {nodeData.notesInFlow && nodeData.notes && (
        <div className="mt-1 line-clamp-2 text-[10px] italic text-muted-foreground">
          {nodeData.notes}
        </div>
      )}
      {preview && (
        <div className="mt-1 line-clamp-2 text-[10px] leading-snug text-muted-foreground">
          {preview}
        </div>
      )}
      {isPlaceholder && !preview && (
        <div className="mt-1 text-[10px] text-muted-foreground">
          Placeholder · not executable yet
        </div>
      )}
      {mainInputPorts.length > 1 && (
        <div className="mt-1 flex flex-col gap-0.5 text-[9px] text-muted-foreground">
          {mainInputPorts.map((port) => (
            <span
              key={port.id}
              title={port.description || undefined}
              className="truncate"
            >
              {port.label || port.id}
            </span>
          ))}
        </div>
      )}
      {missingConfig && !preview && !isPlaceholder && (
        <div className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
          Needs configuration
        </div>
      )}

      {nodeType === "condition" ? (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="true"
            style={{ top: "35%" }}
            className="!h-3 !w-3 !border-2 !bg-emerald-500"
          />
          <Handle
            type="source"
            position={Position.Right}
            id="false"
            style={{ top: "70%" }}
            className="!h-3 !w-3 !border-2 !bg-rose-500"
          />
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
            <span>true</span>
            <span>false</span>
          </div>
        </>
      ) : hasOutput && mainOutputPorts.length > 1 ? (
        <>
          {mainOutputPorts.map((port, index) => (
            <Handle
              key={port.id}
              type="source"
              position={Position.Right}
              id={port.id}
              title={
                port.description
                  ? `${port.label || port.id}: ${port.description}`
                  : port.label || port.id
              }
              style={{
                top: `${((index + 1) / (mainOutputPorts.length + 1)) * 100}%`,
              }}
              className="!h-3 !w-3 !border-2 !bg-background !border-muted-foreground"
            />
          ))}
          <div className="mt-1 flex flex-col gap-0.5 text-[9px] text-muted-foreground">
            {mainOutputPorts.map((port) => (
              <span
                key={port.id}
                className="truncate"
                title={port.description || undefined}
              >
                {port.label || port.id}
              </span>
            ))}
          </div>
        </>
      ) : hasOutput ? (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="default"
            className="!h-3 !w-3 !border-2 !bg-background !border-muted-foreground"
            style={nodeData.onError === "route" ? { top: "38%" } : undefined}
          />
          {nodeData.onError === "route" && (
            <>
              <Handle
                type="source"
                position={Position.Right}
                id="error"
                style={{ top: "72%" }}
                className="!h-3 !w-3 !border-2 !bg-destructive"
              />
              <div className="mt-1 text-right text-[10px] text-destructive">
                on error
              </div>
            </>
          )}
        </>
      ) : null}
    </div>
  );

  return (
    <>
      {hasOutput && selected && canvas?.onAddNextStep && (
        <NodeToolbar position={Position.Right} offset={12} align="center">
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="h-6 w-6 rounded-full shadow"
            title="Add next step"
            onClick={(e) => {
              e.stopPropagation();
              canvas.onAddNextStep?.(id, "default");
            }}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </NodeToolbar>
      )}
      <WorkflowNodeContextMenu
        nodeId={id}
        nodeType={nodeType}
        data={nodeData}
        actions={actions}
      >
        {nodeBody}
      </WorkflowNodeContextMenu>
    </>
  );
}

export const WorkflowNode = memo(WorkflowNodeComponent);
