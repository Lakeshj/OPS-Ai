"use client";

import React from "react";
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
  documents: WorkspaceDocument[];
  nodeId: string | null;
  onChange: (patch: WorkflowNodeData) => void;
};

export function DocumentPickerField({
  data,
  documents,
  nodeId,
  onChange,
}: Props) {
  return (
    <div>
      <Label className="text-xs">Workspace document</Label>
      <Select
        value={String(data.documentId || "") || undefined}
        onValueChange={(id) => {
          const doc = documents.find((d) => d.id === id);
          onChange({
            ...data,
            documentId: id,
            documentName: doc?.originalName || "",
            label: doc?.originalName ? `Doc: ${doc.originalName}` : data.label,
          });
        }}
      >
        <SelectTrigger className="text-xs">
          <SelectValue placeholder="Select document…" />
        </SelectTrigger>
        <SelectContent>
          {documents.map((d) => (
            <SelectItem key={d.id} value={d.id}>
              {d.originalName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Injects document text as {"{{steps."}
        {nodeId}
        {".text}}"}.
      </p>
    </div>
  );
}
