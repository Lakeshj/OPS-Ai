"use client";

import React, { memo, useMemo, useState } from "react";
import {
  Handle,
  NodeToolbar,
  Position,
  useStore,
  type NodeProps,
} from "@xyflow/react";
import { AlertCircle, Check, Pin, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { nodeHasMissingConfig } from "@/modules/workflows/nodeValidation";
import {
  resolveNodeInputPorts,
  resolveNodeOutputPorts,
} from "@/modules/workflows/dynamicPorts";
import {
  getAiAgentReadiness,
  getAiResourceDisplay,
  getVisibleAiAuxiliaryInputPorts,
  isAiAgentType,
  isAiResourceProviderType,
} from "@/modules/workflows/aiAgentUx";
import {
  getNodeCardDescription,
  getNodeCardIcon,
  getNodeCardTitle,
  getNodeVisualCategory,
} from "@/modules/workflows/nodeCardPresentation";
import type { WorkflowNodeData } from "@/modules/workflows/types";
import { WorkflowNodeToolbar } from "./WorkflowNodeToolbar";
import { WorkflowNodeContextMenu } from "./WorkflowNodeContextMenu";
import { useWorkflowCanvasActions } from "./WorkflowCanvasContext";
import { Button } from "@/components/ui/button";

const base =
  "min-w-[200px] max-w-[260px] rounded-xl border bg-card/95 px-3 py-2.5 text-sm relative backdrop-blur-[2px]";

const statusStyles: Record<string, string> = {
  succeeded: "ring-2 ring-emerald-500/50",
  failed: "ring-2 ring-destructive/60",
  running: "ring-2 ring-amber-500/50",
  pending: "",
  skipped: "opacity-60",
};

const START_TYPES = new Set([
  "trigger",
  "schedule",
  "webhook",
  "workflowTrigger",
  "errorTrigger",
  "gmailTrigger",
]);

const HANDLE_MAIN =
  "!h-3 !w-3 !border-2 !border-sky-300/80 !bg-white dark:!bg-slate-100";

function StatusBadge({
  runStatus,
  missingConfig,
  cacheDirty,
  failTitle,
}: {
  runStatus: string;
  missingConfig: boolean;
  cacheDirty?: boolean;
  failTitle?: string;
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
        title={failTitle || "Failed"}
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
      <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] capitalize text-amber-700 dark:text-amber-300">
        running
      </span>
    );
  }
  return null;
}

function WorkflowNodeComponent({ id, data, type, selected }: NodeProps) {
  const canvas = useWorkflowCanvasActions();
  const edges = useStore((s) => s.edges);
  const nodes = useStore((s) => s.nodes);
  const [hovered, setHovered] = useState(false);
  const nodeType = String(type || data?.nodeType || "ai");
  const runStatus = data?.runStatus ? String(data.runStatus) : "";
  const preview = data?.runPreview ? String(data.runPreview) : "";
  const nodeData = (data || {}) as WorkflowNodeData;
  const visual = useMemo(() => getNodeVisualCategory(nodeType), [nodeType]);
  const Icon = useMemo(() => getNodeCardIcon(nodeType), [nodeType]);
  const title = useMemo(
    () => getNodeCardTitle(nodeType, nodeData),
    [nodeType, nodeData]
  );
  const description = useMemo(
    () => getNodeCardDescription(nodeType, nodeData, preview),
    [nodeType, nodeData, preview]
  );
  const resourceDisplay = useMemo(
    () => getAiResourceDisplay(nodeType, nodeData as Record<string, unknown>),
    [nodeType, nodeData]
  );
  const isResourceProvider = isAiResourceProviderType(nodeType);
  const agentReadiness = useMemo(() => {
    if (!isAiAgentType(nodeType)) return null;
    return getAiAgentReadiness(id, edges, nodes);
  }, [nodeType, id, nodes, edges]);

  const paramMissing = nodeHasMissingConfig(
    nodeType as import("@/modules/workflows/types").WorkflowNodeType,
    nodeData
  );
  const missingConfig = paramMissing || Boolean(agentReadiness?.missingModel);
  const isPlaceholder =
    nodeType === "integration" ||
    nodeType === "migrationUnsupported" ||
    nodeData.available === false;

  const actions = canvas?.getNodeActions(id) ?? {};
  const showToolbar = hovered && !selected;

  const inputPorts = resolveNodeInputPorts(
    nodeType as import("@/modules/workflows/types").WorkflowNodeType,
    nodeData
  );
  const mainInputPorts = inputPorts.filter(
    (p) => p.direction === "in" && p.kind === "main"
  );
  const auxiliaryInputPorts = isAiAgentType(nodeType)
    ? getVisibleAiAuxiliaryInputPorts(nodeType)
    : inputPorts.filter(
        (p) =>
          p.direction === "in" &&
          (p.connectionKind === "auxiliary" ||
            p.kind === "ai_languageModel" ||
            p.kind === "ai_tool" ||
            p.kind === "ai_memory")
      );
  const outputPorts = resolveNodeOutputPorts(
    nodeType as import("@/modules/workflows/types").WorkflowNodeType,
    nodeData,
    id
  );
  const mainOutputPorts = outputPorts.filter(
    (p) =>
      p.direction === "out" &&
      (p.kind === "main" ||
        p.kind === "true" ||
        p.kind === "false" ||
        p.kind === "fallback")
  );
  const auxiliaryOutputPorts = outputPorts.filter(
    (p) =>
      p.direction === "out" &&
      (p.connectionKind === "auxiliary" ||
        p.kind === "ai_languageModel" ||
        p.kind === "ai_tool" ||
        p.kind === "ai_memory")
  );
  const hasMainOutput = mainOutputPorts.length > 0;

  const subtitle =
    isResourceProvider && resourceDisplay.role === "model"
      ? [
          resourceDisplay.providerLabel,
          resourceDisplay.modelLabel,
        ]
          .filter(Boolean)
          .join(" / ") || description
      : isResourceProvider && resourceDisplay.toolName
        ? resourceDisplay.toolName
        : agentReadiness
          ? agentReadiness.missingModel
            ? "Model required"
            : `Model · ${agentReadiness.toolCount} tool${agentReadiness.toolCount === 1 ? "" : "s"}`
          : description;

  const nodeBody = (
    <div
      className={cn(
        base,
        "relative transition-[box-shadow,transform] duration-200",
        visual.borderClass,
        visual.glowClass,
        visual.dashed && "border-dashed",
        selected && "ring-2 ring-primary/80",
        runStatus && statusStyles[runStatus],
        missingConfig && !runStatus && "ring-1 ring-amber-500/50",
        nodeData.disabled && "border-dashed opacity-50",
        showToolbar && "z-10",
        // Room for inside-left Input 1..N labels on Merge / multi-input nodes
        mainInputPorts.length > 1 && "pl-14"
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
        mainInputPorts.length > 0 &&
        (mainInputPorts.length > 1 ? (
          <>
            {mainInputPorts.map((port, index) => {
              const top = `${((index + 1) / (mainInputPorts.length + 1)) * 100}%`;
              return (
                <React.Fragment key={port.id}>
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={port.id}
                    title={
                      port.description
                        ? `${port.label || port.id}: ${port.description}`
                        : port.label || port.id
                    }
                    style={{ top }}
                    className={HANDLE_MAIN}
                  />
                  <span
                    className="pointer-events-none absolute left-2 z-[1] -translate-y-1/2 whitespace-nowrap text-[9px] font-medium text-muted-foreground"
                    style={{ top }}
                    aria-hidden
                  >
                    {port.label || `Input ${index + 1}`}
                  </span>
                </React.Fragment>
              );
            })}
          </>
        ) : (
          <Handle
            type="target"
            position={Position.Left}
            id={mainInputPorts[0]?.id || "main"}
            className={HANDLE_MAIN}
          />
        ))}

      {auxiliaryInputPorts.map((port, index) => (
        <Handle
          key={port.id}
          type="target"
          position={Position.Top}
          id={port.id}
          title={
            port.description
              ? `${port.label || port.id}: ${port.description}`
              : port.label || "Auxiliary input"
          }
          aria-label={port.label || port.id}
          style={{
            left: `${((index + 1) / (auxiliaryInputPorts.length + 1)) * 100}%`,
          }}
          className="!h-2.5 !w-2.5 !rounded-sm !border-2 !border-violet-400/60 !bg-violet-500/20"
          onClick={(e) => {
            e.stopPropagation();
            if (isAiAgentType(nodeType) && canvas?.onAddResource) {
              canvas.onAddResource(id, port.id);
            }
          }}
        />
      ))}
      {auxiliaryInputPorts.length > 0 && (
        <div className="absolute -top-4 left-0 right-0 flex justify-around px-1 text-[8px] text-muted-foreground">
          {auxiliaryInputPorts.map((port) => (
            <button
              key={port.id}
              type="button"
              className="nodrag nopan max-w-[40%] truncate hover:text-foreground"
              title={
                port.description
                  ? `${port.label}: ${port.description}`
                  : `Connect ${port.label || port.id}`
              }
              onClick={(e) => {
                e.stopPropagation();
                canvas?.onAddResource?.(id, port.id);
              }}
            >
              {port.label || port.id}
            </button>
          ))}
        </div>
      )}

      {/* Header: category tag + status */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "truncate text-[9px] font-semibold uppercase tracking-[0.08em]",
              visual.tagClass
            )}
          >
            {visual.label}
          </span>
          {nodeData.disabled && (
            <span className="text-[9px] text-destructive">off</span>
          )}
          {nodeData.pinned && (
            <Pin className="h-3 w-3 shrink-0 text-primary" aria-label="Output pinned" />
          )}
        </div>
        <StatusBadge
          runStatus={runStatus}
          missingConfig={missingConfig}
          cacheDirty={nodeData.cacheDirty}
          failTitle={preview || undefined}
        />
      </div>

      {/* Body: icon + title + description */}
      <div className="flex items-start gap-2.5">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            visual.iconWrapClass
          )}
        >
          <Icon className="h-4 w-4" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="truncate font-semibold leading-tight text-foreground">
            {title}
          </div>
          <div
            className={cn(
              "mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground",
              runStatus === "failed" && "text-destructive",
              agentReadiness?.missingModel &&
                "font-medium text-amber-700 dark:text-amber-300"
            )}
            title={subtitle}
          >
            {isPlaceholder && !preview
              ? "Placeholder · not executable yet"
              : paramMissing &&
                  !preview &&
                  !isPlaceholder &&
                  !agentReadiness?.missingModel
                ? "Needs configuration"
                : subtitle}
          </div>
        </div>
      </div>

      {nodeType === "condition" ? (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="true"
            style={{ top: "38%" }}
            className="!h-3 !w-3 !border-2 !border-emerald-400 !bg-emerald-500"
          />
          <Handle
            type="source"
            position={Position.Right}
            id="false"
            style={{ top: "72%" }}
            className="!h-3 !w-3 !border-2 !border-rose-400 !bg-rose-500"
          />
          <span
            className="pointer-events-none absolute left-full ml-1.5 -translate-y-1/2 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-semibold text-white"
            style={{ top: "38%" }}
          >
            true
          </span>
          <span
            className="pointer-events-none absolute left-full ml-1.5 -translate-y-1/2 rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-semibold text-white"
            style={{ top: "72%" }}
          >
            false
          </span>
        </>
      ) : hasMainOutput && mainOutputPorts.length > 1 ? (
        <>
          {mainOutputPorts.map((port, index) => {
            const top = `${((index + 1) / (mainOutputPorts.length + 1)) * 100}%`;
            return (
              <React.Fragment key={port.id}>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={port.id}
                  title={
                    port.description
                      ? `${port.label || port.id}: ${port.description}`
                      : port.label || port.id
                  }
                  style={{ top }}
                  className={HANDLE_MAIN}
                />
                <span
                  className="pointer-events-none absolute left-full ml-1.5 -translate-y-1/2 whitespace-nowrap rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground"
                  style={{ top }}
                  aria-hidden
                >
                  {port.label || port.id}
                </span>
              </React.Fragment>
            );
          })}
        </>
      ) : hasMainOutput ? (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id={mainOutputPorts[0]?.id || "main"}
            className={HANDLE_MAIN}
            style={nodeData.onError === "route" ? { top: "38%" } : undefined}
          />
          {nodeData.onError === "route" && (
            <>
              <Handle
                type="source"
                position={Position.Right}
                id="error"
                style={{ top: "72%" }}
                className="!h-3 !w-3 !border-2 !border-destructive !bg-destructive"
              />
              <span
                className="pointer-events-none absolute left-full ml-1.5 -translate-y-1/2 whitespace-nowrap rounded-full bg-destructive px-1.5 py-0.5 text-[9px] font-semibold text-white"
                style={{ top: "72%" }}
              >
                on error
              </span>
            </>
          )}
        </>
      ) : null}

      {auxiliaryOutputPorts.map((port, index) => (
        <Handle
          key={port.id}
          type="source"
          position={Position.Bottom}
          id={port.id}
          title={
            port.description
              ? `${port.label || port.id}: ${port.description}`
              : port.label || "Resource output"
          }
          aria-label={port.label || port.id}
          style={{
            left: `${((index + 1) / (auxiliaryOutputPorts.length + 1)) * 100}%`,
          }}
          className="!h-2.5 !w-2.5 !rounded-sm !border-2 !border-violet-400/60 !bg-violet-500/20"
        />
      ))}
      {auxiliaryOutputPorts.length > 0 && (
        <div className="mt-1.5 text-center text-[9px] text-muted-foreground">
          {auxiliaryOutputPorts.map((p) => p.label || p.id).join(" · ")}
        </div>
      )}
    </div>
  );

  return (
    <>
      {hasMainOutput && selected && canvas?.onAddNextStep && (
        <NodeToolbar position={Position.Right} offset={12} align="center">
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="h-6 w-6 rounded-full shadow"
            title="Add next step"
            onClick={(e) => {
              e.stopPropagation();
              canvas.onAddNextStep?.(id, mainOutputPorts[0]?.id || "main");
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
