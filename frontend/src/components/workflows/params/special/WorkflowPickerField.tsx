"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { workflowsApi } from "@/modules/workflows/api";
import type {
  WorkflowCallableTarget,
  WorkflowNodeData,
} from "@/modules/workflows/types";

type Props = {
  data: WorkflowNodeData;
  onChange: (patch: WorkflowNodeData) => void;
  workspaceId?: string;
  currentWorkflowId?: string;
  nodeId: string | null;
};

export function WorkflowPickerField({
  data,
  onChange,
  workspaceId,
  currentWorkflowId,
  nodeId,
}: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(Boolean(workspaceId));
  const [targets, setTargets] = useState<WorkflowCallableTarget[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    setLoading(true);
    workflowsApi
      .listCallableTargets(workspaceId, currentWorkflowId)
      .then((rows) => {
        if (!cancelled) setTargets(rows);
      })
      .catch(() => {
        if (!cancelled) setTargets([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, currentWorkflowId]);

  const selectedId = String(data.workflowId || "");
  const selected = targets.find((t) => t.id === selectedId);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return targets;
    return targets.filter((t) => t.name.toLowerCase().includes(q));
  }, [targets, search]);

  const displayLabel =
    selected?.name ||
    (data.workflowName ? String(data.workflowName) : "") ||
    (selectedId ? "Selected workflow unavailable" : "Select workflow…");

  const missingSelected =
    Boolean(selectedId) && !loading && !selected;

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Workflow</Label>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSearch("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={!workspaceId}
            className="h-9 w-full justify-between px-3 text-xs font-normal"
          >
            <span
              className={cn(
                "truncate",
                !selectedId && "text-muted-foreground",
                (missingSelected ||
                  (selectedId && !selected && !data.workflowName)) &&
                  "text-amber-700 dark:text-amber-300"
              )}
            >
              {displayLabel}
            </span>
            <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search workflows…"
            className="mb-2 h-8 text-xs"
          />
          <div className="max-h-56 overflow-y-auto">
            {loading && (
              <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                Loading…
              </p>
            )}
            {!loading && filtered.length === 0 && (
              <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                <p className="font-medium text-foreground">No callable workflows yet.</p>
                <p className="mt-1">
                  Add a Workflow Trigger and one Result node to make a workflow callable.
                </p>
              </div>
            )}
            {!loading &&
              filtered.map((t) => {
                const disabled = !t.callable || t.isSelf;
                const reason =
                  t.disabledReason ||
                  (!t.callable
                    ? "Add a Workflow Trigger and one Result node to make this workflow callable."
                    : null);
                const statusLabel =
                  t.status === "active" ? "Active" : "Inactive";
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={disabled}
                    title={reason || undefined}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs",
                      disabled
                        ? "cursor-not-allowed opacity-50"
                        : "hover:bg-accent hover:text-accent-foreground",
                      selectedId === t.id && "bg-accent/60"
                    )}
                    onClick={() => {
                      if (disabled) return;
                      onChange({
                        ...data,
                        workflowId: t.id,
                        workflowName: t.name,
                        label: `Workflow: ${t.name}`,
                      });
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    <Check
                      className={cn(
                        "mt-0.5 h-3.5 w-3.5 shrink-0",
                        selectedId === t.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{t.name}</span>
                      <span className="mt-0.5 block text-[10px] text-muted-foreground">
                        {statusLabel}
                        {reason ? ` · ${reason}` : ""}
                      </span>
                    </span>
                  </button>
                );
              })}
          </div>
        </PopoverContent>
      </Popover>
      {missingSelected && (
        <p className="text-[11px] text-amber-700 dark:text-amber-300">
          Selected workflow unavailable
        </p>
      )}
      {!workspaceId && (
        <p className="text-[11px] text-muted-foreground">
          Open this workflow from a workspace to pick a target.
        </p>
      )}
      {nodeId && selectedId && !missingSelected && (
        <p className="text-[11px] text-muted-foreground">
          Child Result becomes {"{{steps."}
          {nodeId}
          {".*}}"}.
        </p>
      )}
    </div>
  );
}
