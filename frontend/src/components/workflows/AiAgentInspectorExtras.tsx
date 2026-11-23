"use client";

import React, { useMemo } from "react";
import {
  extractAgentItemMeta,
  extractSafeToolCallsForItem,
  extractUsageForItem,
  getAiAgentReadiness,
  getAiResourceDisplay,
  isAiAgentType,
  isAiResourceProviderType,
  mapAiToolCallsToTrace,
  parseAiErrorFromUnknown,
  providerResourceExplanation,
  sanitizeResourceSummaryForDisplay,
  summarizeAgentToolObservability,
} from "@/modules/workflows/aiAgentUx";
import { workflowAlertCompact } from "@/modules/workflows/workflowAlertStyles";
import { cn } from "@/lib/utils";
import type { WorkflowNodeData, WorkflowNodeType } from "@/modules/workflows/types";
import type { WorkflowDefinition } from "@/modules/workflows/types";

type Props = {
  nodeId: string | null;
  nodeType: WorkflowNodeType | null;
  data: WorkflowNodeData | null;
  definition?: WorkflowDefinition;
  stepOutput?: unknown;
  stepError?: unknown;
  itemIndex?: number;
  /** resources = bindings only; execution = tool trace/error/usage; all = both */
  mode?: "resources" | "execution" | "all";
};

export function AiAgentInspectorExtras({
  nodeId,
  nodeType,
  data,
  definition,
  stepOutput,
  stepError,
  itemIndex = 0,
  mode = "all",
}: Props) {
  const showResources = mode === "resources" || mode === "all";
  const showExecution = mode === "execution" || mode === "all";

  const readiness = useMemo(() => {
    if (!showResources || !nodeId || !isAiAgentType(nodeType) || !definition)
      return null;
    return getAiAgentReadiness(
      nodeId,
      definition.edges || [],
      (definition.nodes || []).map((n) => ({
        id: n.id,
        type: n.type,
        data: (n.data || {}) as Record<string, unknown>,
      }))
    );
  }, [showResources, nodeId, nodeType, definition]);

  const toolTrace = useMemo(() => {
    if (!showExecution || !isAiAgentType(nodeType)) return [];
    return mapAiToolCallsToTrace(
      extractSafeToolCallsForItem(stepOutput, itemIndex)
    );
  }, [showExecution, nodeType, stepOutput, itemIndex]);

  const toolObservability = useMemo(() => {
    if (!showExecution || !isAiAgentType(nodeType) || stepOutput == null)
      return null;
    return summarizeAgentToolObservability(stepOutput, itemIndex);
  }, [showExecution, nodeType, stepOutput, itemIndex]);

  const agentItemMeta = useMemo(() => {
    if (!showExecution || !isAiAgentType(nodeType) || stepOutput == null)
      return null;
    return extractAgentItemMeta(stepOutput, itemIndex);
  }, [showExecution, nodeType, stepOutput, itemIndex]);

  const usage = useMemo(() => {
    if (!showExecution || !isAiAgentType(nodeType)) return null;
    return extractUsageForItem(stepOutput, itemIndex);
  }, [showExecution, nodeType, stepOutput, itemIndex]);

  const aiError = useMemo(() => {
    if (!showExecution || !stepError) return null;
    return parseAiErrorFromUnknown(stepError);
  }, [showExecution, stepError]);

  if (isAiResourceProviderType(nodeType) && showResources) {
    const display = getAiResourceDisplay(
      nodeType,
      (data || {}) as Record<string, unknown>
    );
    const config = sanitizeResourceSummaryForDisplay({
      ...(display.providerLabel ? { provider: display.providerLabel } : {}),
      ...(display.modelLabel ? { model: display.modelLabel } : {}),
      ...(display.toolName ? { toolName: display.toolName } : {}),
    });
    return (
      <div className="mt-3 space-y-2 rounded-md border border-border/70 bg-muted/20 p-3">
        <div className="text-[11px] font-medium text-foreground">
          {display.title}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {providerResourceExplanation(nodeType)}
        </p>
        {Object.keys(config).length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[10px]">
            {Object.entries(config).map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="truncate text-foreground">{String(v)}</dd>
              </React.Fragment>
            ))}
          </dl>
        )}
      </div>
    );
  }

  if (!isAiAgentType(nodeType)) return null;

  return (
    <div className="mt-3 space-y-3">
      {showResources && readiness && (
        <div className="rounded-md border border-border/70 bg-muted/20 p-3">
          <div className="text-[11px] font-medium text-foreground">
            Resources
          </div>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[10px]">
            <dt className="text-muted-foreground">Model</dt>
            <dd
              className={
                readiness.missingModel
                  ? "font-medium text-amber-700 dark:text-amber-300"
                  : "text-foreground"
              }
            >
              {readiness.missingModel
                ? "Required — not connected"
                : readiness.modelLabel || "Connected"}
            </dd>
            <dt className="text-muted-foreground">Tools</dt>
            <dd className="text-foreground">
              {readiness.toolCount === 0
                ? "None"
                : readiness.toolNames.join(", ") || String(readiness.toolCount)}
            </dd>
            <dt className="text-muted-foreground">Memory</dt>
            <dd className="text-muted-foreground">
              {readiness.memoryConnected
                ? "Connected (unsupported)"
                : "Not connected / Unsupported"}
            </dd>
          </dl>
        </div>
      )}

      {showExecution && aiError && (
        <div className={cn(workflowAlertCompact("error"), "p-3 text-[11px]")}>
          {aiError.message}
        </div>
      )}

      {showExecution && toolObservability && (
        <div className="rounded-md border border-border/70 bg-muted/20 p-3">
          <div className="text-[11px] font-medium text-foreground">
            Tools (run)
          </div>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[10px]">
            <dt className="text-muted-foreground">Model requests</dt>
            <dd className="text-foreground">
              {agentItemMeta?.modelRequests ?? "—"}
            </dd>
            {agentItemMeta?.toolEdgesFound != null ? (
              <>
                <dt className="text-muted-foreground">Tool edges</dt>
                <dd className="text-foreground">
                  {agentItemMeta.toolEdgesFound} found ·{" "}
                  {agentItemMeta.toolNodesResolved ?? 0} resolved
                </dd>
              </>
            ) : null}
            {(agentItemMeta?.toolResolutionErrors || []).length > 0 ? (
              <>
                <dt className="text-muted-foreground">Resolve errors</dt>
                <dd className="text-destructive">
                  {(agentItemMeta?.toolResolutionErrors || [])
                    .map(
                      (e) =>
                        `${e.nodeId || "node"}: ${e.code || e.message || "failed"}`
                    )
                    .join("; ")}
                </dd>
              </>
            ) : null}
            {agentItemMeta?.groundingRetryTriggered ? (
              <>
                <dt className="text-muted-foreground">Grounding retry</dt>
                <dd className="text-amber-700 dark:text-amber-300">
                  Triggered
                  {agentItemMeta.groundingRetryReason
                    ? ` — ${agentItemMeta.groundingRetryReason}`
                    : ""}
                </dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">Available</dt>
            <dd className="text-foreground">
              {toolObservability.availableCount === 0
                ? "None"
                : toolObservability.availableNames.join(", ")}
            </dd>
            <dt className="text-muted-foreground">Requested</dt>
            <dd className="text-foreground">
              {(agentItemMeta?.toolsRequested || []).length === 0
                ? "—"
                : (agentItemMeta?.toolsRequested || []).join(", ")}
            </dd>
            <dt className="text-muted-foreground">Used</dt>
            <dd className="text-foreground">
              {toolObservability.usedNames.length === 0
                ? "—"
                : toolObservability.usedNames.join(", ")}
            </dd>
            {(agentItemMeta?.toolErrors || []).length > 0 ? (
              <>
                <dt className="text-muted-foreground">Errors</dt>
                <dd className="text-destructive">
                  {(agentItemMeta?.toolErrors || [])
                    .map(
                      (e) =>
                        `${e.toolName || "tool"}: ${e.code || e.message || "failed"}`
                    )
                    .join("; ")}
                </dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">Status</dt>
            <dd
              className={
                toolObservability.status === "failed"
                  ? "text-destructive"
                  : toolObservability.status === "none_connected" ||
                      toolObservability.status === "skipped"
                    ? "text-amber-700 dark:text-amber-300"
                    : "text-foreground"
              }
            >
              {toolObservability.label}
            </dd>
            {agentItemMeta?.modelRequest?.toolCount != null ? (
              <>
                <dt className="text-muted-foreground">Sent to model</dt>
                <dd className="text-foreground">
                  {agentItemMeta.modelRequest.toolCount} tool
                  {agentItemMeta.modelRequest.toolCount === 1 ? "" : "s"}
                  {(agentItemMeta.modelRequest.toolNames || []).length
                    ? `: ${(agentItemMeta.modelRequest.toolNames || []).join(", ")}`
                    : ""}
                </dd>
              </>
            ) : null}
          </dl>
        </div>
      )}

      {showExecution && toolTrace.length > 0 && (
        <div className="rounded-md border border-border/70 bg-muted/20 p-3">
          <div className="text-[11px] font-medium text-foreground">
            Tool calls
          </div>
          <ol className="mt-2 space-y-1.5 text-[10px]">
            {toolTrace.map((row) => (
              <li
                key={`${row.index}-${row.label}`}
                className="flex items-baseline justify-between gap-2"
              >
                <span className="text-foreground">
                  {row.index}. {row.label}
                  <span
                    className={
                      row.failed
                        ? "ml-1.5 text-destructive"
                        : "ml-1.5 text-emerald-700 dark:text-emerald-400"
                    }
                  >
                    {row.status}
                  </span>
                </span>
                {row.durationMs != null && (
                  <span className="shrink-0 text-muted-foreground">
                    {row.durationMs} ms
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {showExecution &&
      usage &&
      (usage.totalTokens || usage.inputTokens || usage.outputTokens) ? (
        <div className="rounded-md border border-border/70 bg-muted/10 p-3 text-[10px] text-muted-foreground">
          <div className="font-medium text-foreground">Execution details</div>
          <div className="mt-1">
            Tokens: {usage.inputTokens ?? "—"} in · {usage.outputTokens ?? "—"}{" "}
            out · {usage.totalTokens ?? "—"} total
          </div>
        </div>
      ) : null}
    </div>
  );
}
