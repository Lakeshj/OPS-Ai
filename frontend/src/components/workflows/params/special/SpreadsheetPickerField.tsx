"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WorkspaceDocument } from "@/modules/shared/types";
import type { WorkflowNodeData } from "@/modules/workflows/types";

type Props = {
  data: WorkflowNodeData;
  spreadsheetDocs: WorkspaceDocument[];
  nodeId: string | null;
  workspaceId?: string;
  uploading?: boolean;
  onUpload?: (file: File | null) => Promise<void>;
  onChange: (patch: WorkflowNodeData) => void;
};

export function SpreadsheetPickerField({
  data,
  spreadsheetDocs,
  nodeId,
  workspaceId,
  uploading,
  onUpload,
  onChange,
}: Props) {
  return (
    <div className="space-y-2">
      <div>
        <Label className="text-xs">Excel / CSV file</Label>
        <Select
          value={String(data.documentId || "") || undefined}
          onValueChange={(id) => {
            const doc = spreadsheetDocs.find((d) => d.id === id);
            onChange({
              ...data,
              documentId: id,
              documentName: doc?.originalName || "",
              label: doc?.originalName ? `Sheet: ${doc.originalName}` : data.label,
              available: true,
            });
          }}
        >
          <SelectTrigger className="text-xs">
            <SelectValue placeholder="Select spreadsheet…" />
          </SelectTrigger>
          <SelectContent>
            {spreadsheetDocs.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.originalName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {spreadsheetDocs.length === 0 && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            No spreadsheet in this workspace yet — upload one below.
          </p>
        )}
      </div>
      <div>
        <Label className="text-xs">Upload new file</Label>
        <Input
          type="file"
          accept=".xlsx,.xls,.csv"
          disabled={!workspaceId || uploading}
          className="text-xs"
          onChange={(e) => {
            const file = e.target.files?.[0] || null;
            void onUpload?.(file);
            e.target.value = "";
          }}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Output: {"{{steps."}
        {nodeId}
        {".rows}}"}, {"{{steps."}
        {nodeId}
        {".text}}"}.
      </p>
    </div>
  );
}
