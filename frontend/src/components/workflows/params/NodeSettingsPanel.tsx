"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WorkflowNodeData, WorkflowNodeType } from "@/modules/workflows/types";
import {
  getApplicableSettings,
  getNodeContract,
  nodeSupportsCapability,
} from "@/modules/workflows/nodeRegistry";

type Props = {
  nodeType: WorkflowNodeType;
  data: WorkflowNodeData;
  onChange: (patch: WorkflowNodeData) => void;
};

export function NodeSettingsPanel({ nodeType, data, onChange }: Props) {
  const contract = getNodeContract(nodeType);
  const settings = getApplicableSettings(nodeType);

  return (
    <div className="space-y-3">
      {settings.alwaysOutputData && (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={Boolean(data.alwaysOutputData)}
            onChange={(e) =>
              onChange({ ...data, alwaysOutputData: e.target.checked })
            }
          />
          Always output data (emit empty item when output would be empty)
        </label>
      )}
      {settings.executeOnce && (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={Boolean(data.executeOnce)}
            onChange={(e) =>
              onChange({ ...data, executeOnce: e.target.checked })
            }
          />
          Execute once (process only the first input item)
        </label>
      )}
      {settings.disabled && (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={Boolean(data.disabled)}
            onChange={(e) => onChange({ ...data, disabled: e.target.checked })}
          />
          Disabled (passthrough input without running)
        </label>
      )}
      {settings.notes && (
        <>
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea
              value={String(data.notes || "")}
              onChange={(e) => onChange({ ...data, notes: e.target.value })}
              rows={2}
              className="mt-1 text-xs"
            />
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={Boolean(data.notesInFlow)}
              onChange={(e) =>
                onChange({ ...data, notesInFlow: e.target.checked })
              }
            />
            Display note on canvas
          </label>
        </>
      )}
      {settings.timeoutMs && (
        <div>
          <Label className="text-xs">Timeout (ms)</Label>
          <Input
            type="number"
            min={500}
            max={30000}
            value={Number(data.timeoutMs ?? 2000)}
            onChange={(e) =>
              onChange({
                ...data,
                timeoutMs: Number(e.target.value) || 2000,
              })
            }
            className="mt-1 h-8 text-xs"
          />
        </div>
      )}

      {nodeSupportsCapability(nodeType, "error_policy") && (
        <div className="space-y-2 rounded-md border p-2.5">
          <Label className="text-xs font-semibold uppercase tracking-wide">
            If this node fails
          </Label>
          <Select
            value={String(data.onError || "stop")}
            onValueChange={(v) =>
              onChange({ ...data, onError: v as WorkflowNodeData["onError"] })
            }
          >
            <SelectTrigger className="text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stop">Stop the run</SelectItem>
              <SelectItem value="continue">Continue to the next node</SelectItem>
              <SelectItem value="route">Follow the error output</SelectItem>
            </SelectContent>
          </Select>
          {settings.retries && (
            <div className="flex gap-2">
              <div className="flex-1">
                <Label className="text-[11px]">Retries</Label>
                <Input
                  type="number"
                  min={0}
                  max={5}
                  value={Number(data.retries ?? 0)}
                  onChange={(e) =>
                    onChange({ ...data, retries: Number(e.target.value) || 0 })
                  }
                  className="text-xs"
                />
              </div>
              <div className="flex-1">
                <Label className="text-[11px]">Retry delay (ms)</Label>
                <Input
                  type="number"
                  min={0}
                  step={500}
                  value={Number(data.retryDelayMs ?? 1000)}
                  onChange={(e) =>
                    onChange({
                      ...data,
                      retryDelayMs: Number(e.target.value) || 0,
                    })
                  }
                  className="text-xs"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {contract.inputs.length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          Inputs: {contract.inputs.map((p) => p.label || p.id).join(", ")}
        </p>
      )}
      {contract.outputs.length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          Outputs: {contract.outputs.map((p) => p.label || p.id).join(", ")}
        </p>
      )}
    </div>
  );
}
