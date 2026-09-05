"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { NodeInspector } from "./NodeInspector";
import { NodeInputPanel } from "./NodeInputPanel";
import { NodeOutputPanel } from "./NodeOutputPanel";
import { SubworkflowRunSummary } from "./SubworkflowRunSummary";
import { RunNavigationLink } from "./RunNavigationLink";
import type {
  WorkflowChildInvocationSummary,
  WorkflowEditorNodeResult,
  WorkflowEditorSession,
  WorkflowErrorRouting,
  WorkflowItem,
  WorkflowNodeData,
  WorkflowNodeType,
  WorkflowRun,
  WorkflowStatus,
} from "@/modules/workflows/types";
import { resolveNodeOutputPorts } from "@/modules/workflows/dynamicPorts";
import {
  hasInputPanel,
  isTriggerNode,
  getStaticOutputSchema,
  nodeSupports,
} from "@/modules/workflows/nodeRegistry";
import { workflowsApi } from "@/modules/workflows/api";
import type { WorkflowDefinition } from "@/modules/workflows/types";
import {
  findLoopRegionForNode,
} from "@/modules/workflows/loopValidation";
import {
  mergeSessionWithRun,
  resolveOccurrenceInputItems,
  type LoopPortView,
} from "@/modules/workflows/occurrenceView";
import { toast } from "sonner";
import type { Node as FlowNode, Edge as FlowEdge } from "@xyflow/react";
import { subworkflowErrorMessage } from "@/modules/workflows/subworkflowUx";
import { ErrorRoutingSummary } from "./ErrorRoutingSummary";
import { AiAgentInspectorExtras } from "./AiAgentInspectorExtras";
import {
  getAiAgentReadiness,
  isAiAgentType,
  isAiResourceProviderType,
  mapAiErrorCodeToMessage,
  parseAiErrorFromUnknown,
  providerResourceExplanation,
} from "@/modules/workflows/aiAgentUx";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedId: string | null;
  selectedType: WorkflowNodeType | null;
  selectedData: WorkflowNodeData | null;
  onChange: (patch: WorkflowNodeData) => void;
  onClear: () => void;
  onDelete: () => void;
  runInput: string;
  onRunInputChange: (value: string) => void;
  workspaceId?: string;
  workflowId?: string;
  definition?: WorkflowDefinition;
  editorSession?: WorkflowEditorSession | null;
  onEditorSessionChange?: (session: WorkflowEditorSession) => void;
  latestRun?: WorkflowRun | null;
  errorRouting?: WorkflowErrorRouting | null;
  onTogglePin?: (nodeId: string) => void;
  workflowStatus?: WorkflowStatus;
  onExecuteWorkflow?: () => void;
};

function parseRunInput(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { message: parsed };
  } catch {
    return { message: trimmed };
  }
}

export function WorkflowNodeDialog({
  open,
  onOpenChange,
  selectedId,
  selectedType,
  selectedData,
  onChange,
  onClear,
  onDelete,
  runInput,
  onRunInputChange,
  workspaceId,
  workflowId,
  definition,
  editorSession,
  onEditorSessionChange,
  latestRun,
  errorRouting = null,
  onTogglePin,
  workflowStatus,
  onExecuteWorkflow,
}: Props) {
  const [configTab, setConfigTab] = useState<"parameters" | "settings">(
    "parameters"
  );
  const [executing, setExecuting] = useState(false);
  const [selectedInputItemIndex, setSelectedInputItemIndex] = useState(0);
  const [selectedRunIndex, setSelectedRunIndex] = useState<number | null>(null);
  const [loopPortView, setLoopPortView] = useState<LoopPortView>("done");
  const [childInvocation, setChildInvocation] =
    useState<WorkflowChildInvocationSummary | null>(null);
  const [childInvocationLoading, setChildInvocationLoading] = useState(false);
  const [parentLineageHref, setParentLineageHref] = useState<string | null>(
    null
  );
  const [parentLineageLabel, setParentLineageLabel] = useState<string | null>(
    null
  );
  const [inputPreview, setInputPreview] = useState<{
    incoming?: Record<string, unknown>;
    items?: WorkflowItem[];
    portInputs?: Record<string, import("./NodeInputPanel").PortInputPreview>;
    stale?: boolean;
    staleNodeIds?: string[];
  }>({});

  const flowNodes = useMemo(
    () =>
      (definition?.nodes || []).map(
        (n) =>
          ({
            id: n.id,
            type: n.type,
            position: n.position || { x: 0, y: 0 },
            data: n.data || {},
          }) as FlowNode
      ),
    [definition]
  );
  const flowEdges = useMemo(
    () =>
      (definition?.edges || []).map(
        (e) =>
          ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle,
            targetHandle: e.targetHandle,
          }) as FlowEdge
      ),
    [definition]
  );

  const loopRegion = useMemo(
    () =>
      selectedId
        ? findLoopRegionForNode(selectedId, flowNodes, flowEdges)
        : null,
    [selectedId, flowNodes, flowEdges]
  );

  const isLoopNode = selectedType === "loop";
  const insideLoop = Boolean(loopRegion && loopRegion.loopId !== selectedId);

  const nodeResult: WorkflowEditorNodeResult | null = useMemo(() => {
    if (!selectedId) return null;
    const session = editorSession?.nodeResults?.[selectedId] || null;
    return mergeSessionWithRun(session, latestRun, selectedId);
  }, [selectedId, editorSession, latestRun]);

  useEffect(() => {
    setSelectedRunIndex(null);
    setLoopPortView("done");
    setSelectedInputItemIndex(0);
  }, [selectedId]);

  const occurrenceInputItems = useMemo(() => {
    if (selectedRunIndex == null || !nodeResult?.occurrences) return null;
    const occ = nodeResult.occurrences.find((o) => o.runIndex === selectedRunIndex);
    if (!occ) return null;
    const resolved = resolveOccurrenceInputItems(
      occ,
      editorSession?.nodeResults
    );
    return resolved.length > 0 ? resolved : null;
  }, [selectedRunIndex, nodeResult, editorSession]);

  const previewContext = useMemo(() => {
    const steps: Record<string, unknown> = {};
    const stepItems: Record<string, WorkflowItem[]> = {};
    const nodeLabels: Record<string, string> = {};
    if (definition?.nodes) {
      for (const node of definition.nodes) {
        if (node.data?.label) nodeLabels[node.id] = String(node.data.label);
      }
    }
    if (editorSession?.nodeResults) {
      for (const [id, r] of Object.entries(editorSession.nodeResults)) {
        if (r.output !== undefined) steps[id] = r.output;
        if (Array.isArray(r.items)) stepItems[id] = r.items;
        if (selectedId === id && selectedRunIndex != null && r.occurrences) {
          const occ = r.occurrences.find((o) => o.runIndex === selectedRunIndex);
          if (occ) {
            if (occ.output !== undefined) steps[id] = occ.output;
            if (Array.isArray(occ.items)) stepItems[id] = occ.items;
          }
        }
      }
    }
    if (definition?.nodes) {
      for (const node of definition.nodes) {
        if (node.data?.pinned && node.data.pinnedOutput !== undefined) {
          steps[node.id] = node.data.pinnedOutput;
          if (Array.isArray(node.data.pinnedItems)) {
            stepItems[node.id] = node.data.pinnedItems as WorkflowItem[];
          }
        }
      }
    }
    return {
      workflowId,
      nodeId: selectedId ?? undefined,
      itemIndex: selectedInputItemIndex,
      runIndex: selectedRunIndex ?? undefined,
      definition,
      input: parseRunInput(runInput),
      steps,
      stepItems,
      inputItems: occurrenceInputItems || inputPreview.items,
      nodeLabels,
    };
  }, [
    editorSession,
    runInput,
    inputPreview.items,
    occurrenceInputItems,
    workflowId,
    selectedId,
    selectedInputItemIndex,
    selectedRunIndex,
    definition,
  ]);

  useEffect(() => {
    setSelectedInputItemIndex(0);
  }, [selectedId]);

  // Part 10C — occurrence-scoped child invocation for Execute Workflow
  useEffect(() => {
    if (
      !open ||
      !workflowId ||
      !selectedId ||
      selectedType !== "executeWorkflow" ||
      !latestRun?.id
    ) {
      setChildInvocation(null);
      return;
    }
    let cancelled = false;
    const executionIndex =
      selectedRunIndex != null
        ? selectedRunIndex
        : nodeResult?.executionIndex ?? 0;
    setChildInvocationLoading(true);
    workflowsApi
      .getChildInvocation(
        workflowId,
        latestRun.id,
        selectedId,
        Number(executionIndex) || 0
      )
      .then((summary) => {
        if (!cancelled) setChildInvocation(summary);
      })
      .catch(() => {
        if (!cancelled) setChildInvocation(null);
      })
      .finally(() => {
        if (!cancelled) setChildInvocationLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    open,
    workflowId,
    selectedId,
    selectedType,
    latestRun?.id,
    latestRun?.status,
    latestRun?.waitingReason,
    selectedRunIndex,
    nodeResult?.executionIndex,
    nodeResult?.status,
  ]);

  // Part 10C — parent link when viewing a child run's Workflow Trigger
  useEffect(() => {
    if (
      !open ||
      !workflowId ||
      selectedType !== "workflowTrigger" ||
      !latestRun?.parentRunId ||
      !latestRun?.id
    ) {
      setParentLineageHref(null);
      setParentLineageLabel(null);
      return;
    }
    let cancelled = false;
    workflowsApi
      .getRunLineage(workflowId, latestRun.id)
      .then((lineage) => {
        if (cancelled) return;
        const parent = lineage.ancestors[lineage.ancestors.length - 1];
        if (!parent) {
          setParentLineageHref(null);
          setParentLineageLabel(null);
          return;
        }
        setParentLineageLabel(
          parent.workflowDeleted
            ? `${parent.workflowName} (deleted)`
            : parent.workflowName
        );
        setParentLineageHref(
          `/workflows/${parent.workflowId}?runId=${encodeURIComponent(parent.runId)}`
        );
      })
      .catch(() => {
        if (!cancelled) {
          setParentLineageHref(null);
          setParentLineageLabel(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    open,
    workflowId,
    selectedType,
    latestRun?.id,
    latestRun?.parentRunId,
  ]);

  useEffect(() => {
    const count = inputPreview.items?.length ?? 0;
    if (count > 0 && selectedInputItemIndex >= count) {
      setSelectedInputItemIndex(0);
    }
  }, [inputPreview.items, selectedInputItemIndex]);

  useEffect(() => {
    if (!open || !workflowId || !selectedId) return;
    let cancelled = false;
    workflowsApi
      .getNodeInput(workflowId, selectedId)
      .then((res) => {
        if (!cancelled) {
          setInputPreview({
            incoming: res.incoming,
            items: res.items as WorkflowItem[],
            portInputs: res.portInputs as Record<
              string,
              import("./NodeInputPanel").PortInputPreview
            >,
            stale: res.stale,
            staleNodeIds: res.staleNodeIds,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setInputPreview({});
      });
    return () => {
      cancelled = true;
    };
  }, [open, workflowId, selectedId, editorSession?.updatedAt]);

  const runPartial = async (mode: "step" | "run-to" | "upstream") => {
    if (!workflowId || !selectedId || !definition) {
      toast.error("Save the workflow first");
      return;
    }
    if (isAiResourceProviderType(selectedType) && mode === "step") {
      toast.message(providerResourceExplanation(selectedType));
      return;
    }
    if (isAiAgentType(selectedType) && mode === "step") {
      const readiness = getAiAgentReadiness(
        selectedId,
        definition.edges || [],
        (definition.nodes || []).map((n) => ({
          id: n.id,
          type: n.type,
          data: (n.data || {}) as Record<string, unknown>,
        }))
      );
      if (readiness.missingModel) {
        toast.error(mapAiErrorCodeToMessage("AI_MODEL_REQUIRED"));
        return;
      }
    }
    if (isLoopNode || insideLoop) {
      toast.error(
        isLoopNode
          ? "Loop runs as a complete region. Use Run to a node after Done, or Execute workflow."
          : "Iteration-level rerun inside Loop isn't supported yet. Use Execute workflow or Run to a node after Done."
      );
      return;
    }
    setExecuting(true);
    try {
      const input = parseRunInput(runInput);
      const payload = { definition, input };
      let res;
      if (mode === "run-to") {
        res = await workflowsApi.runToNode(workflowId, selectedId, payload);
      } else if (mode === "upstream") {
        res = await workflowsApi.executePrevious(workflowId, selectedId, payload);
      } else {
        res = await workflowsApi.executeNodeStep(workflowId, selectedId, payload);
      }
      onEditorSessionChange?.(res.session);
      const result = res.results[selectedId];
      if (mode === "upstream") {
        toast.success("Upstream steps executed");
      } else if (result?.status === "failed") {
        const mapped = parseAiErrorFromUnknown(result.error);
        toast.error(mapped.message || result.error || "Node execution failed");
      } else {
        toast.success(
          mode === "run-to" ? "Ran chain to this node" : "Node executed"
        );
      }
    } catch (err) {
      const mapped = parseAiErrorFromUnknown(err);
      toast.error(mapped.message || (err instanceof Error ? err.message : "Execution failed"));
    } finally {
      setExecuting(false);
    }
  };

  const title =
    selectedData?.label?.trim() ||
    (selectedType
      ? selectedType.charAt(0).toUpperCase() + selectedType.slice(1)
      : "Node");

  const showInputPanel = selectedType
    ? hasInputPanel(selectedType) &&
      !isAiResourceProviderType(selectedType)
    : false;
  const isTrigger = selectedType ? isTriggerNode(selectedType) : false;
  const canExecuteStep =
    Boolean(selectedType) &&
    nodeSupports(selectedType as WorkflowNodeType, "execute_step") &&
    !isAiResourceProviderType(selectedType);
  const triggerOutputSchema = selectedType
    ? getStaticOutputSchema(selectedType)
    : undefined;

  const switchPortLabels = useMemo(() => {
    if (selectedType !== "switch" || !selectedData) return undefined;
    const ports = resolveNodeOutputPorts("switch", selectedData, selectedId || undefined);
    return Object.fromEntries(ports.map((p) => [p.id, p.label || p.id]));
  }, [selectedType, selectedData, selectedId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(88vh,920px)] max-h-[min(92vh,960px)] w-[min(96vw,85vw)] max-w-[96vw] flex-col gap-0 overflow-hidden p-0 sm:rounded-xl"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0 space-y-1 border-b px-5 py-3 pr-12 text-left">
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription className="text-xs">
            {selectedType ? (
              <>
                <span className="font-medium">{selectedType}</span> ·{" "}
                <span className="font-mono text-[10px]">{selectedId}</span>
              </>
            ) : (
              "Select a node on the canvas"
            )}
          </DialogDescription>
        </DialogHeader>

        {selectedId && selectedType && selectedData ? (
          <div className="min-h-0 flex-1">
            <ResizablePanelGroup direction="horizontal" className="h-full min-h-[min(72vh,780px)]">
              {showInputPanel ? (
                <>
                  <ResizablePanel defaultSize={26} minSize={18} className="min-w-[200px]">
                    <div className="flex h-full min-h-0 flex-col overflow-y-auto border-r p-4">
                      <NodeInputPanel
                        items={occurrenceInputItems || inputPreview.items}
                        incoming={
                          occurrenceInputItems ? undefined : inputPreview.incoming
                        }
                        portInputs={
                          occurrenceInputItems ? undefined : inputPreview.portInputs
                        }
                        runInputData={parseRunInput(runInput)}
                        loading={executing}
                        onExecutePrevious={() => void runPartial("upstream")}
                        selectedItemIndex={selectedInputItemIndex}
                        onSelectedItemIndexChange={setSelectedInputItemIndex}
                        stale={occurrenceInputItems ? false : inputPreview.stale}
                        staleNodeIds={
                          occurrenceInputItems ? undefined : inputPreview.staleNodeIds
                        }
                      />
                    </div>
                  </ResizablePanel>
                  <ResizableHandle withHandle />
                </>
              ) : null}

              <ResizablePanel defaultSize={showInputPanel ? 48 : 58} minSize={28}>
                <div className="flex h-full min-h-0 flex-col border-r">
                  <div className="shrink-0 border-b px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={onClear}
                      >
                        Clear
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 border-destructive/40 text-xs text-destructive"
                        onClick={() => {
                          onDelete();
                          onOpenChange(false);
                        }}
                      >
                        Delete
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="ml-auto h-7 text-xs"
                        disabled={executing || !canExecuteStep}
                        onClick={() => void runPartial("step")}
                        title={
                          isAiResourceProviderType(selectedType)
                            ? providerResourceExplanation(selectedType)
                            : undefined
                        }
                      >
                        Run step
                      </Button>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                    <Tabs
                      value={configTab}
                      onValueChange={(v) =>
                        setConfigTab(v as "parameters" | "settings")
                      }
                    >
                      <TabsList className="mb-3 h-8">
                        <TabsTrigger value="parameters" className="text-xs">
                          Parameters
                        </TabsTrigger>
                        <TabsTrigger value="settings" className="text-xs">
                          Settings
                        </TabsTrigger>
                      </TabsList>
                      <TabsContent value="parameters" className="mt-0 space-y-0">
                        {isLoopNode && (
                          <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
                            Topology: Items → Loop → Batch → body → Continue;
                            Done → downstream.
                          </p>
                        )}
                        <NodeInspector
                          nodeId={selectedId}
                          nodeType={selectedType}
                          data={selectedData}
                          onChange={onChange}
                          workspaceId={workspaceId}
                          workflowId={workflowId}
                          workflowStatus={workflowStatus}
                          configTab="parameters"
                          previewContext={previewContext}
                          runInput={runInput}
                          onRunInputChange={onRunInputChange}
                          onTestTrigger={
                            isTrigger ? () => void runPartial("step") : undefined
                          }
                          onExecuteWorkflow={onExecuteWorkflow}
                          executing={executing}
                        />
                        {isAiAgentType(selectedType) && definition && (
                          <AiAgentInspectorExtras
                            nodeId={selectedId}
                            nodeType={selectedType}
                            data={selectedData}
                            definition={definition}
                            mode="resources"
                          />
                        )}
                        {isAiResourceProviderType(selectedType) && (
                          <AiAgentInspectorExtras
                            nodeId={selectedId}
                            nodeType={selectedType}
                            data={selectedData}
                            mode="resources"
                          />
                        )}
                        {isAiResourceProviderType(selectedType) && (
                          <p className="mt-3 text-[11px] text-muted-foreground">
                            {providerResourceExplanation(selectedType)} This
                            node does not run by itself.
                          </p>
                        )}
                      </TabsContent>
                      <TabsContent value="settings" className="mt-0">
                        <NodeInspector
                          nodeId={selectedId}
                          nodeType={selectedType}
                          data={selectedData}
                          onChange={onChange}
                          workspaceId={workspaceId}
                          workflowId={workflowId}
                          configTab="settings"
                          previewContext={previewContext}
                        />
                      </TabsContent>
                    </Tabs>

                    {!isTrigger && configTab === "parameters" && (
                      <div className="mt-8 border-t border-border/60 pt-4">
                        <Label className="text-xs">Run input</Label>
                        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                          Optional context for{" "}
                          <code className="rounded bg-muted px-1">
                            {"{{input}}"}
                          </code>{" "}
                          when running this step from the inspector.
                        </p>
                        <Textarea
                          value={runInput}
                          onChange={(e) => onRunInputChange(e.target.value)}
                          rows={2}
                          className="mt-2 bg-background text-xs"
                          placeholder='e.g. "Summarize top rows" or {"message":"..."}'
                        />
                      </div>
                    )}

                    {isTrigger && configTab === "parameters" && (
                      <div className="mt-6 border-t border-border/60 pt-4">
                        <p className="text-xs text-muted-foreground">
                          Triggers have no upstream input. Use Test trigger in the
                          OUTPUT panel, or execute the workflow from the canvas.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel defaultSize={showInputPanel ? 26 : 42} minSize={18} className="min-w-[200px]">
                <div className="flex h-full min-h-0 flex-col overflow-y-auto p-4">
                  <NodeOutputPanel
                    result={nodeResult}
                    hasDynamicPorts={selectedType === "switch"}
                    portLabels={switchPortLabels}
                    loading={executing}
                    pinned={Boolean(selectedData.pinned)}
                    isTrigger={isTrigger}
                    staticSchema={triggerOutputSchema}
                    isLoopNode={isLoopNode}
                    insideLoop={insideLoop}
                    selectedRunIndex={selectedRunIndex}
                    onSelectedRunIndexChange={setSelectedRunIndex}
                    loopPortView={loopPortView}
                    onLoopPortViewChange={setLoopPortView}
                    onExecuteStep={
                      canExecuteStep
                        ? () => void runPartial("step")
                        : undefined
                    }
                    onTestTrigger={
                      isTrigger ? () => void runPartial("step") : undefined
                    }
                    onPin={
                      onTogglePin && selectedId
                        ? () => onTogglePin(selectedId)
                        : undefined
                    }
                    resourceProviderMessage={
                      isAiResourceProviderType(selectedType)
                        ? providerResourceExplanation(selectedType)
                        : null
                    }
                  />
                  <AiAgentInspectorExtras
                    nodeId={selectedId}
                    nodeType={selectedType}
                    data={selectedData}
                    definition={definition}
                    stepOutput={nodeResult?.output}
                    stepError={
                      nodeResult?.status === "failed" ? nodeResult.error : null
                    }
                    itemIndex={
                      selectedRunIndex != null
                        ? selectedRunIndex
                        : selectedInputItemIndex
                    }
                    mode="execution"
                  />
                  {selectedType === "executeWorkflow" && (
                    <SubworkflowRunSummary
                      summary={childInvocation}
                      loading={childInvocationLoading}
                      returnedItemCount={
                        Array.isArray(nodeResult?.items)
                          ? nodeResult.items.length
                          : null
                      }
                    />
                  )}
                  {selectedType === "executeWorkflow" &&
                    nodeResult?.status === "failed" &&
                    nodeResult?.error &&
                    !childInvocation && (
                      <p className="mt-2 text-[11px] text-destructive">
                        {subworkflowErrorMessage(nodeResult.error)}
                      </p>
                    )}
                  {selectedType === "workflowTrigger" &&
                    (parentLineageHref || parentLineageLabel) && (
                      <div className="mt-3 rounded-md border border-border/70 bg-muted/30 p-3 text-xs">
                        <div className="text-muted-foreground">Called from</div>
                        <div className="mt-1 font-medium text-foreground">
                          {parentLineageLabel || "Parent workflow"}
                        </div>
                        <div className="mt-2">
                          <RunNavigationLink
                            href={parentLineageHref}
                            label="Open parent run"
                            disabledReason="Parent run unavailable"
                          />
                        </div>
                      </div>
                    )}
                  {selectedType === "errorTrigger" &&
                    errorRouting?.role === "handler" && (
                      <ErrorRoutingSummary
                        routing={errorRouting}
                        className="mt-3"
                      />
                    )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3 h-7 w-full text-xs"
                    disabled={executing}
                    onClick={() =>
                      isTrigger
                        ? void onExecuteWorkflow?.()
                        : void runPartial("run-to")
                    }
                  >
                    {isTrigger ? "Execute workflow" : "Run to this node"}
                  </Button>
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        ) : (
          <p className="p-6 text-sm text-muted-foreground">
            Click a node on the canvas to configure it.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default WorkflowNodeDialog;
