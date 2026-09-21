"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ItemDataViewer } from "./ItemDataViewer";
import type {
  WorkflowEditorNodeResult,
  WorkflowEditorOccurrence,
  WorkflowItem,
} from "@/modules/workflows/types";
import {
  formatOutputMetadataSummary,
  selectNodeOutputData,
} from "@/modules/workflows/nodeOutputData";
import { workflowAlertCompact } from "@/modules/workflows/workflowAlertStyles";
import {
  loopBatchOccurrences,
  loopDoneOccurrence,
  occurrenceLabel,
  type LoopPortView,
} from "@/modules/workflows/occurrenceView";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseAiErrorFromUnknown } from "@/modules/workflows/aiAgentUx";

type PortOutputPreview = Record<string, WorkflowItem[]>;

type Props = {
  result?: WorkflowEditorNodeResult | null;
  items?: WorkflowItem[];
  portOutputs?: PortOutputPreview;
  portLabels?: Record<string, string>;
  hasDynamicPorts?: boolean;
  onExecuteStep?: () => void;
  onTestTrigger?: () => void;
  onPin?: () => void;
  pinned?: boolean;
  loading?: boolean;
  isTrigger?: boolean;
  /** Static output keys shown before any run (triggers only) */
  staticSchema?: Record<string, string>;
  /** Loop Over Items — Batch / Done + iteration selector */
  isLoopNode?: boolean;
  /** Body (or other multi-run) node inside a Loop region */
  insideLoop?: boolean;
  selectedRunIndex?: number | null;
  onSelectedRunIndexChange?: (runIndex: number | null) => void;
  loopPortView?: LoopPortView;
  onLoopPortViewChange?: (view: LoopPortView) => void;
  /** Part 12C — auxiliary provider empty OUTPUT copy */
  resourceProviderMessage?: string | null;
};

function occurrenceToResult(
  base: WorkflowEditorNodeResult,
  occ: WorkflowEditorOccurrence
): WorkflowEditorNodeResult {
  return {
    ...base,
    status: (occ.status as WorkflowEditorNodeResult["status"]) || base.status,
    output: occ.output,
    items: occ.items,
    portOutputs: occ.portOutputs || undefined,
    error: occ.error,
    executionIndex: occ.runIndex,
    executionTimeMs: occ.executionTimeMs ?? base.executionTimeMs,
  };
}

export function NodeOutputPanel({
  result,
  portOutputs: portOutputsProp,
  portLabels,
  hasDynamicPorts = false,
  onExecuteStep,
  onTestTrigger,
  onPin,
  pinned,
  loading,
  isTrigger,
  staticSchema,
  isLoopNode = false,
  insideLoop = false,
  selectedRunIndex = null,
  onSelectedRunIndexChange,
  loopPortView = "done",
  onLoopPortViewChange,
  resourceProviderMessage = null,
}: Props) {
  const batchOccs = useMemo(
    () => (isLoopNode ? loopBatchOccurrences(result) : []),
    [isLoopNode, result]
  );
  const doneOcc = useMemo(
    () => (isLoopNode ? loopDoneOccurrence(result) : null),
    [isLoopNode, result]
  );

  const multiOccs = useMemo(() => {
    if (isLoopNode) return [];
    const list = result?.occurrences || [];
    return list.length > 1 ? list : [];
  }, [isLoopNode, result]);

  const effectiveResult = useMemo(() => {
    if (!result) return null;
    if (isLoopNode) {
      if (loopPortView === "batch") {
        const idx =
          selectedRunIndex != null
            ? batchOccs.findIndex((o) => o.runIndex === selectedRunIndex)
            : 0;
        const occ = batchOccs[idx >= 0 ? idx : 0];
        if (occ) {
          return occurrenceToResult(
            {
              ...result,
              portOutputs: { batch: occ.items || [] },
            },
            { ...occ, portOutputs: { batch: occ.items || [] } }
          );
        }
        return {
          ...result,
          items: [],
          portOutputs: { batch: [] },
          status: "succeeded" as const,
        };
      }
      if (doneOcc) {
        return occurrenceToResult(
          {
            ...result,
            portOutputs: { done: doneOcc.items || [] },
          },
          {
            ...doneOcc,
            portOutputs: { done: doneOcc.items || [] },
          }
        );
      }
      return result;
    }
    if (multiOccs.length > 0 && selectedRunIndex != null) {
      const occ = multiOccs.find((o) => o.runIndex === selectedRunIndex);
      if (occ) return occurrenceToResult(result, occ);
    }
    return result;
  }, [
    result,
    isLoopNode,
    loopPortView,
    batchOccs,
    doneOcc,
    multiOccs,
    selectedRunIndex,
  ]);

  const selection = useMemo(
    () =>
      selectNodeOutputData(
        effectiveResult
          ? {
              ...effectiveResult,
              portOutputs: portOutputsProp ?? effectiveResult.portOutputs,
            }
          : null,
        {
          hasDynamicPorts:
            hasDynamicPorts ||
            (isLoopNode &&
              Boolean(effectiveResult?.portOutputs) &&
              Object.keys(effectiveResult?.portOutputs || {}).length > 0),
        }
      ),
    [effectiveResult, portOutputsProp, hasDynamicPorts, isLoopNode]
  );

  const portIds = useMemo(() => {
    if (selection.kind === "portOutputs") {
      return Object.keys(selection.portOutputs).sort();
    }
    return [];
  }, [selection]);

  const [activePortId, setActivePortId] = useState(portIds[0] || "");
  useEffect(() => {
    if (portIds.length > 0 && !portIds.includes(activePortId)) {
      setActivePortId(portIds[0]);
    }
  }, [portIds, activePortId]);

  useEffect(() => {
    if (isLoopNode && loopPortView === "batch" && batchOccs.length > 0) {
      if (
        selectedRunIndex == null ||
        !batchOccs.some((o) => o.runIndex === selectedRunIndex)
      ) {
        onSelectedRunIndexChange?.(batchOccs[0].runIndex);
      }
    } else if (!isLoopNode && multiOccs.length > 0) {
      if (
        selectedRunIndex == null ||
        !multiOccs.some((o) => o.runIndex === selectedRunIndex)
      ) {
        onSelectedRunIndexChange?.(multiOccs[0].runIndex);
      }
    }
  }, [
    isLoopNode,
    loopPortView,
    batchOccs,
    multiOccs,
    selectedRunIndex,
    onSelectedRunIndexChange,
  ]);

  const effectivePortId =
    activePortId && portIds.includes(activePortId) ? activePortId : portIds[0] || "";

  const displayItems =
    selection.kind === "portOutputs"
      ? selection.portOutputs[effectivePortId]
      : selection.kind === "items"
        ? selection.items
        : undefined;

  const metadataSummary =
    selection.kind === "portOutputs" || selection.kind === "items"
      ? formatOutputMetadataSummary(selection.metadata)
      : null;

  const hasOutput =
    selection.kind === "portOutputs" ||
    selection.kind === "items" ||
    selection.kind === "legacy" ||
    selection.kind === "skipped";

  const emptyMessage =
    selection.kind === "skipped"
      ? "Skipped — branch not taken"
      : selection.kind === "items" && selection.executed
        ? "0 items — executed"
        : isLoopNode && loopPortView === "batch" && batchOccs.length === 0
          ? "0 iterations — no body run"
          : "No output data";

  const timingMs = effectiveResult?.executionTimeMs ?? result?.executionTimeMs;
  const statusLabel = effectiveResult?.status || result?.status;

  const promptsUsed = useMemo(() => {
    const out = effectiveResult?.output;
    if (!out || typeof out !== "object" || Array.isArray(out)) return null;
    const record = out as Record<string, unknown>;
    const nested =
      record.promptsUsed &&
      typeof record.promptsUsed === "object" &&
      !Array.isArray(record.promptsUsed)
        ? (record.promptsUsed as Record<string, unknown>)
        : null;
    const userInstructions = String(
      nested?.userInstructions ?? record.userInstructions ?? ""
    );
    const systemPrompt = String(
      nested?.systemPrompt ?? record.systemPrompt ?? ""
    );
    const userPrompt = String(nested?.userPrompt ?? record.userPrompt ?? "");
    const grounded = Boolean(
      nested?.groundingApplied ??
        nested?.gscGrounded ??
        record.gscIntelligence
    );
    if (!userInstructions && !systemPrompt && !userPrompt) return null;
    return {
      userInstructions,
      systemPrompt,
      userPrompt,
      gscGrounded: grounded,
    };
  }, [effectiveResult?.output]);

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Output
        </span>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {statusLabel && multiOccs.length > 1 && (
            <span className="capitalize">{statusLabel}</span>
          )}
          {timingMs != null && (
            <span className="tabular-nums">{timingMs}ms</span>
          )}
        </div>
      </div>

      {isLoopNode && (
        <div className="flex flex-wrap gap-1">
          {(["batch", "done"] as LoopPortView[]).map((view) => (
            <button
              key={view}
              type="button"
              className={cn(
                "rounded border px-2 py-0.5 text-[10px]",
                loopPortView === view
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted/50"
              )}
              title={
                view === "batch"
                  ? "Items for the current iteration"
                  : "Collected results after all iterations"
              }
              onClick={() => onLoopPortViewChange?.(view)}
            >
              {view === "batch" ? "Batch" : "Done"}
            </button>
          ))}
        </div>
      )}

      {isLoopNode && loopPortView === "batch" && batchOccs.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {batchOccs.map((occ) => (
            <button
              key={occ.runIndex}
              type="button"
              className={cn(
                "rounded border px-2 py-0.5 text-[10px]",
                selectedRunIndex === occ.runIndex
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted/50"
              )}
              onClick={() => onSelectedRunIndexChange?.(occ.runIndex)}
            >
              {occurrenceLabel(occ.runIndex, true)}
              <span className="ml-1 opacity-70">
                ({occ.items?.length ?? 0})
              </span>
            </button>
          ))}
        </div>
      )}

      {!isLoopNode && multiOccs.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {multiOccs.map((occ) => (
            <button
              key={occ.runIndex}
              type="button"
              className={cn(
                "rounded border px-2 py-0.5 text-[10px]",
                selectedRunIndex === occ.runIndex
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted/50"
              )}
              onClick={() => onSelectedRunIndexChange?.(occ.runIndex)}
            >
              {occurrenceLabel(occ.runIndex, insideLoop)}
              {occ.status === "failed" ? " · err" : ""}
            </button>
          ))}
        </div>
      )}

      {effectiveResult?.status === "failed" && (
        <div className={cn(workflowAlertCompact("error"), "text-[10px]")}>
          {
            parseAiErrorFromUnknown(effectiveResult.error).message ||
            effectiveResult.error ||
            "Execution failed"
          }
        </div>
      )}

      {Boolean(
        effectiveResult?.cacheState === "dirty" ||
          (effectiveResult?.output &&
            typeof effectiveResult.output === "object" &&
            !Array.isArray(effectiveResult.output) &&
            (effectiveResult.output as { stale?: boolean }).stale === true)
      ) && (
        <div className={cn(workflowAlertCompact("warning"), "text-[10px]")}>
          {(() => {
            const out = effectiveResult?.output;
            if (
              out &&
              typeof out === "object" &&
              !Array.isArray(out) &&
              typeof (out as { message?: unknown }).message === "string"
            ) {
              return String((out as { message: string }).message);
            }
            return "Configuration changed since this output was produced. Run the step again to refresh.";
          })()}
        </div>
      )}

      {resourceProviderMessage ? (
        <div className="space-y-2 rounded border border-dashed p-3 text-center">
          <p className="text-xs text-muted-foreground">
            {resourceProviderMessage}
          </p>
          <p className="text-[10px] text-muted-foreground">
            This node provides a resource to an AI Agent and does not run by
            itself.
          </p>
        </div>
      ) : !hasOutput ? (
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
          {portIds.length > 0 && !isLoopNode && (
            <div className="flex flex-wrap gap-1">
              {portIds.map((portId) => {
                const count =
                  selection.kind === "portOutputs"
                    ? selection.portOutputs[portId]?.length ?? 0
                    : 0;
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
            items={displayItems}
            emptyMessage={emptyMessage}
            canonicalItemsOnly
          />
          {promptsUsed && (
            <details className="rounded border border-dashed bg-muted/15 px-2 py-1.5 text-[10px]">
              <summary className="cursor-pointer font-medium text-muted-foreground">
                Sent to model
                {promptsUsed.gscGrounded
                  ? " · GSC MCP grounding applied"
                  : ""}
              </summary>
              <div className="mt-2 space-y-2">
                {promptsUsed.userInstructions ? (
                  <div>
                    <div className="mb-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                      Instructions
                    </div>
                    <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-background/80 p-2 font-mono text-[10px] text-foreground">
                      {promptsUsed.userInstructions}
                    </pre>
                  </div>
                ) : null}
                {promptsUsed.gscGrounded ? (
                  <div className="rounded border border-emerald-500/30 bg-emerald-500/5 px-2 py-1 text-[10px] text-emerald-900 dark:text-emerald-200">
                    GSC MCP grounding — automatically applied (evidence rules;
                    not a second editable System Prompt)
                  </div>
                ) : null}
                {promptsUsed.userPrompt ? (
                  <div>
                    <div className="mb-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                      Workflow input / user request
                    </div>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-background/80 p-2 font-mono text-[10px] text-foreground">
                      {promptsUsed.userPrompt}
                    </pre>
                  </div>
                ) : null}
              </div>
            </details>
          )}
          {metadataSummary && (
            <p className="text-[10px] text-muted-foreground">{metadataSummary}</p>
          )}
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
