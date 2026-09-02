"use client";

import React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { NodeInspector } from "./NodeInspector";
import type {
  WorkflowNodeData,
  WorkflowNodeType,
} from "@/modules/workflows/types";

type Props = {
  open: boolean;
  onClose: () => void;
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
};

export function WorkflowSettingsSidebar({
  open,
  onClose,
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
}: Props) {
  if (!open) return null;

  return (
    <aside
      className={cn(
        "absolute inset-y-0 right-0 z-30 flex w-[min(100%,20rem)] flex-col border-l bg-card shadow-xl sm:w-80",
        "max-h-full"
      )}
      role="dialog"
      aria-label="Node settings"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2.5">
        <div className="text-sm font-semibold">
          Settings
          {selectedType ? ` · ${selectedType}` : ""}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onClose}
          aria-label="Close settings"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 py-3">
        {selectedId && (
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClear();
              }}
            >
              Clear Node
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 border-destructive/40 text-xs text-destructive"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete();
              }}
            >
              Delete
            </Button>
          </div>
        )}

        <NodeInspector
          nodeId={selectedId}
          nodeType={selectedType}
          data={selectedData}
          onChange={onChange}
          workspaceId={workspaceId}
          workflowId={workflowId}
        />

        <div>
          <Label>Run input</Label>
          <Textarea
            value={runInput}
            onChange={(e) => onRunInputChange(e.target.value)}
            rows={4}
            placeholder='e.g. "What are the top 5 queries by clicks?"'
          />
          <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
            <strong>With an AI or Bot node:</strong> type your question here
            (e.g. “top 5 by clicks”) — the model answers using the loaded data.
            <br />
            <strong>Without one:</strong> Run input is optional; Result returns
            the loaded data as-is.
          </p>
        </div>
      </div>
    </aside>
  );
}
