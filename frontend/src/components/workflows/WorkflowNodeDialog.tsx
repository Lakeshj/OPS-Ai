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
import type {
  WorkflowEditorNodeResult,
  WorkflowEditorSession,
  WorkflowItem,
  WorkflowNodeData,
  WorkflowNodeType,
  WorkflowStatus,
} from "@/modules/workflows/types";
import { hasInputPanel, isTriggerNode, getStaticOutputSchema } from "@/modules/workflows/nodeRegistry";
import { workflowsApi } from "@/modules/workflows/api";
import type { WorkflowDefinition } from "@/modules/workflows/types";
import { toast } from "sonner";

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
  onTogglePin,
  workflowStatus,
  onExecuteWorkflow,
}: Props) {
  const [configTab, setConfigTab] = useState<"parameters" | "settings">(
    "parameters"
  );
  const [executing, setExecuting] = useState(false);
  const [selectedInputItemIndex, setSelectedInputItemIndex] = useState(0);
  const [inputPreview, setInputPreview] = useState<{
    incoming?: Record<string, unknown>;
    items?: WorkflowItem[];
  }>({});

  const nodeResult: WorkflowEditorNodeResult | null = useMemo(() => {
    if (!selectedId || !editorSession?.nodeResults) return null;
    return editorSession.nodeResults[selectedId] || null;
  }, [selectedId, editorSession]);

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
      definition,
      input: parseRunInput(runInput),
      steps,
      stepItems,
      inputItems: inputPreview.items,
      nodeLabels,
    };
  }, [
    editorSession,
    runInput,
    inputPreview.items,
    workflowId,
    selectedId,
    selectedInputItemIndex,
    definition,
  ]);

  useEffect(() => {
    setSelectedInputItemIndex(0);
  }, [selectedId]);

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
        toast.error(result.error || "Node execution failed");
      } else {
        toast.success(
          mode === "run-to" ? "Ran chain to this node" : "Node executed"
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Execution failed");
    } finally {
      setExecuting(false);
    }
  };

  const title =
    selectedData?.label?.trim() ||
    (selectedType
      ? selectedType.charAt(0).toUpperCase() + selectedType.slice(1)
      : "Node");

  const showInputPanel = selectedType ? hasInputPanel(selectedType) : false;
  const isTrigger = selectedType ? isTriggerNode(selectedType) : false;
  const triggerOutputSchema = selectedType
    ? getStaticOutputSchema(selectedType)
    : undefined;

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
                        items={inputPreview.items}
                        incoming={inputPreview.incoming}
                        runInputData={parseRunInput(runInput)}
                        loading={executing}
                        onExecutePrevious={() => void runPartial("upstream")}
                        selectedItemIndex={selectedInputItemIndex}
                        onSelectedItemIndexChange={setSelectedInputItemIndex}
                      />
                    </div>
                  </ResizablePanel>
                  <ResizableHandle withHandle />
                </>
              ) : null}

              <ResizablePanel defaultSize={showInputPanel ? 48 : 58} minSize={28}>
                <div className="flex h-full min-h-0 flex-col overflow-y-auto border-r p-4">
                  <div className="mb-3 flex flex-wrap gap-2">
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
                      disabled={executing}
                      onClick={() => void runPartial("step")}
                    >
                      Run step
                    </Button>
                  </div>

                  <Tabs
                    value={configTab}
                    onValueChange={(v) =>
                      setConfigTab(v as "parameters" | "settings")
                    }
                    className="min-h-0 flex-1"
                  >
                    <TabsList className="mb-3 h-8">
                      <TabsTrigger value="parameters" className="text-xs">
                        Parameters
                      </TabsTrigger>
                      <TabsTrigger value="settings" className="text-xs">
                        Settings
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="parameters" className="mt-0">
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

                  <div className="mt-4 shrink-0 rounded-md border bg-muted/30 p-3">
                    {!isTrigger ? (
                      <>
                        <Label className="text-xs">Run input</Label>
                        <Textarea
                          value={runInput}
                          onChange={(e) => onRunInputChange(e.target.value)}
                          rows={2}
                          className="mt-1.5 bg-background text-xs"
                          placeholder='e.g. "Summarize top rows" or {"message":"..."}'
                        />
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Triggers have no upstream input. Use Test trigger in the OUTPUT
                        panel, or execute the workflow from the canvas.
                      </p>
                    )}
                  </div>
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel defaultSize={showInputPanel ? 26 : 42} minSize={18} className="min-w-[200px]">
                <div className="flex h-full min-h-0 flex-col overflow-y-auto p-4">
                  <NodeOutputPanel
                    result={nodeResult}
                    items={nodeResult?.items as WorkflowItem[] | undefined}
                    loading={executing}
                    pinned={Boolean(selectedData.pinned)}
                    isTrigger={isTrigger}
                    staticSchema={triggerOutputSchema}
                    onExecuteStep={() => void runPartial("step")}
                    onTestTrigger={
                      isTrigger ? () => void runPartial("step") : undefined
                    }
                    onPin={
                      onTogglePin && selectedId
                        ? () => onTogglePin(selectedId)
                        : undefined
                    }
                  />
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
