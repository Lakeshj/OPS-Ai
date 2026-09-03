"use client";

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { keywordAssistantApiService } from "@/modules/assistants/api";
import { workspaceDocumentApiService } from "@/modules/documents/api";
import type { KeywordAssistant, WorkspaceDocument } from "@/modules/shared/types";
import type {
  WorkflowNodeData,
  WorkflowNodeType,
  WorkflowStatus,
} from "@/modules/workflows/types";
import { getNodeConfigIssues } from "@/modules/workflows/nodeValidation";
import { getNodeContract } from "@/modules/workflows/nodeRegistry";
import { TriggerNodePanel } from "./TriggerNodePanel";
import {
  NodeParameterRenderer,
  type ParameterRenderContext,
} from "./params/NodeParameterRenderer";
import { NodeSettingsPanel } from "./params/NodeSettingsPanel";

type Props = {
  nodeId: string | null;
  nodeType: WorkflowNodeType | null;
  data: WorkflowNodeData | null;
  onChange: (patch: WorkflowNodeData) => void;
  workspaceId?: string;
  workflowId?: string;
  workflowStatus?: WorkflowStatus;
  configTab?: "parameters" | "settings";
  runInput?: string;
  onRunInputChange?: (value: string) => void;
  onTestTrigger?: () => void;
  onExecuteWorkflow?: () => void;
  executing?: boolean;
  previewContext?: import("./ExpressionField").ExpressionFieldContext;
};

export function NodeInspector({
  nodeId,
  nodeType,
  data,
  onChange,
  workspaceId,
  workflowId,
  workflowStatus,
  configTab = "parameters",
  runInput = "",
  onRunInputChange,
  onTestTrigger,
  onExecuteWorkflow,
  executing,
  previewContext,
}: Props) {
  const [assistants, setAssistants] = useState<KeywordAssistant[]>([]);
  const [documents, setDocuments] = useState<WorkspaceDocument[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    keywordAssistantApiService
      .getAll()
      .then(setAssistants)
      .catch(() => setAssistants([]));
    workspaceDocumentApiService
      .list(workspaceId)
      .then(setDocuments)
      .catch(() => setDocuments([]));
  }, [workspaceId]);

  const spreadsheetDocs = useMemo(
    () =>
      documents.filter((d) => {
        const name = (d.originalName || "").toLowerCase();
        return (
          name.endsWith(".xlsx") ||
          name.endsWith(".xls") ||
          name.endsWith(".csv")
        );
      }),
    [documents]
  );

  const textDocuments = useMemo(
    () =>
      documents.filter((d) => {
        const name = (d.originalName || "").toLowerCase();
        return !name.endsWith(".xlsx") && !name.endsWith(".xls") && !name.endsWith(".csv");
      }),
    [documents]
  );

  const uploadSpreadsheet = async (file: File | null) => {
    if (!file || !workspaceId) return;
    setUploading(true);
    try {
      const doc = await workspaceDocumentApiService.upload(workspaceId, file);
      setDocuments((prev) => [doc, ...prev]);
      onChange({
        ...(data || {}),
        documentId: doc.id,
        documentName: doc.originalName,
        label: `Sheet: ${doc.originalName}`,
        available: true,
      });
      toast.success("Spreadsheet uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  if (!nodeType || !data) {
    return (
      <p className="text-sm text-muted-foreground">Select a node to configure.</p>
    );
  }

  const contract = getNodeContract(nodeType);
  const configIssues = getNodeConfigIssues(nodeType, data);

  const paramContext: ParameterRenderContext = {
    workspaceId,
    workflowId,
    nodeId,
    previewContext,
    documents: textDocuments,
    spreadsheetDocs,
    assistants,
    uploadingSpreadsheet: uploading,
    onUploadSpreadsheet: uploadSpreadsheet,
  };

  if (configTab === "settings") {
    return (
      <NodeSettingsPanel
        nodeType={nodeType}
        data={data}
        onChange={onChange}
      />
    );
  }

  return (
    <div className="space-y-4">
      {configIssues.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-900 dark:text-amber-100">
          <div className="mb-1 font-semibold">
            Required parameters need configuration
          </div>
          <ul className="list-disc space-y-0.5 pl-4">
            {configIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <Label className="text-xs">Label</Label>
        <Input
          value={String(data.label || "")}
          onChange={(e) => onChange({ ...data, label: e.target.value })}
          className="mt-1 text-xs"
        />
      </div>

      {contract.parametersPanel === "trigger" && (
        <TriggerNodePanel
          nodeType={nodeType}
          data={data}
          workflowId={workflowId}
          workflowStatus={workflowStatus}
          runInput={runInput}
          onRunInputChange={onRunInputChange || (() => {})}
          onTestTrigger={onTestTrigger}
          onExecuteWorkflow={onExecuteWorkflow}
          executing={executing}
        />
      )}

      {contract.parametersPanel === "placeholder" && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-900 dark:text-amber-100">
          {data.available === false || contract.placeholderKind === "stub"
            ? "Placeholder node — not executable yet."
            : "Passes data through without changes."}
        </div>
      )}

      {contract.params.length > 0 && (
        <NodeParameterRenderer
          schema={contract.params}
          values={data}
          onChange={onChange}
          context={paramContext}
        />
      )}
    </div>
  );
}
