"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronsUpDown, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ApiError } from "@/modules/shared/apiClient";
import { workflowsApi } from "@/modules/workflows/api";
import { errorWorkflowErrorMessage } from "@/modules/workflows/errorWorkflowUx";
import type { WorkflowErrorTarget } from "@/modules/workflows/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowId: string;
  workspaceId: string;
  errorWorkflowId: string | null;
  onSaved: (nextErrorWorkflowId: string | null) => void;
  disabled?: boolean;
};

export function WorkflowErrorSettingsDialog({
  open,
  onOpenChange,
  workflowId,
  workspaceId,
  errorWorkflowId,
  onSaved,
  disabled = false,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [targets, setTargets] = useState<WorkflowErrorTarget[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(errorWorkflowId);
  const [search, setSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedId(errorWorkflowId);
  }, [open, errorWorkflowId]);

  useEffect(() => {
    if (!open || !workspaceId) return;
    let cancelled = false;
    setLoading(true);
    workflowsApi
      .listErrorTargets(workspaceId, workflowId)
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
  }, [open, workspaceId, workflowId]);

  const selected = targets.find((t) => t.id === selectedId);
  const missingSelected =
    Boolean(selectedId) && !loading && !selected;
  const invalidSelected =
    Boolean(selected) && selected != null && !selected.validation.valid;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return targets;
    return targets.filter((t) => t.name.toLowerCase().includes(q));
  }, [targets, search]);

  const displayLabel = selected?.name
    ? selected.name
    : selectedId
      ? missingSelected
        ? "Selected Error Workflow no longer exists"
        : "Selected workflow…"
      : "None";

  const persist = async (nextId: string | null) => {
    if (disabled) return;
    const previous = selectedId;
    setSelectedId(nextId);
    setSaving(true);
    try {
      const updated = await workflowsApi.setErrorWorkflow(workflowId, nextId);
      onSaved(updated.errorWorkflowId ?? null);
      toast.success(
        nextId ? "Error Workflow saved" : "Error Workflow cleared"
      );
    } catch (error) {
      setSelectedId(previous);
      const code =
        error instanceof ApiError
          ? error.code || error.message
          : error instanceof Error
            ? error.message
            : null;
      toast.error(errorWorkflowErrorMessage(code));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3 pr-10 text-left">
          <DialogTitle className="text-base">Workflow settings</DialogTitle>
          <DialogDescription className="text-xs">
            Execution options for this workflow. Changes apply to future runs.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-4 py-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Execution
            </p>
            <div className="mt-3 space-y-1.5">
              <Label className="text-xs">Error Workflow</Label>
              <p className="text-[11px] text-muted-foreground">
                Run another workflow when this workflow fails.
              </p>

              <Popover
                open={pickerOpen}
                onOpenChange={(next) => {
                  setPickerOpen(next);
                  if (!next) setSearch("");
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    disabled={disabled || saving || loading}
                    className="mt-1.5 h-9 w-full justify-between px-3 text-xs font-normal"
                  >
                    <span
                      className={cn(
                        "truncate",
                        !selectedId && "text-muted-foreground",
                        (missingSelected || invalidSelected) &&
                          "text-amber-700 dark:text-amber-300"
                      )}
                    >
                      {displayLabel}
                    </span>
                    <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[var(--radix-popover-trigger-width)] p-2"
                  align="start"
                >
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search workflows…"
                    className="mb-2 h-8 text-xs"
                  />
                  <div className="max-h-56 overflow-y-auto">
                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent",
                        !selectedId && "bg-accent/60"
                      )}
                      onClick={() => {
                        setPickerOpen(false);
                        void persist(null);
                      }}
                    >
                      <Check
                        className={cn(
                          "mt-0.5 h-3.5 w-3.5 shrink-0",
                          !selectedId ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <span className="font-medium">None</span>
                    </button>
                    {loading && (
                      <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                        Loading…
                      </p>
                    )}
                    {!loading && filtered.length === 0 && (
                      <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                        <p className="font-medium text-foreground">
                          No Error Workflows yet.
                        </p>
                        <p className="mt-1">
                          Create a workflow with an Error Trigger.
                        </p>
                      </div>
                    )}
                    {!loading &&
                      filtered.map((t) => {
                        const disabledRow = !t.validErrorWorkflow || t.isSelf;
                        const reason = t.disabledReason;
                        const statusLabel =
                          t.status === "active" ? "Active" : "Inactive";
                        return (
                          <button
                            key={t.id}
                            type="button"
                            disabled={disabledRow}
                            title={reason || undefined}
                            className={cn(
                              "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs",
                              disabledRow
                                ? "cursor-not-allowed opacity-50"
                                : "hover:bg-accent hover:text-accent-foreground",
                              selectedId === t.id && "bg-accent/60"
                            )}
                            onClick={() => {
                              if (disabledRow) return;
                              setPickerOpen(false);
                              void persist(t.id);
                            }}
                          >
                            <Check
                              className={cn(
                                "mt-0.5 h-3.5 w-3.5 shrink-0",
                                selectedId === t.id
                                  ? "opacity-100"
                                  : "opacity-0"
                              )}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">
                                {t.name}
                              </span>
                              <span className="mt-0.5 block text-[10px] text-muted-foreground">
                                {statusLabel}
                                {t.validation.valid
                                  ? " · Valid Error Workflow"
                                  : ""}
                                {reason ? ` · ${reason}` : ""}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                  </div>
                </PopoverContent>
              </Popover>

              {saving && (
                <p className="text-[11px] text-muted-foreground">Saving…</p>
              )}
              {missingSelected && (
                <p className="text-[11px] text-amber-700 dark:text-amber-300">
                  Selected Error Workflow no longer exists. Remove or replace
                  it.
                </p>
              )}
              {invalidSelected && (
                <p className="text-[11px] text-amber-700 dark:text-amber-300">
                  Selected Error Workflow is no longer valid. It needs exactly
                  one Error Trigger.
                </p>
              )}
              {selected && !missingSelected && !invalidSelected && (
                <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-muted-foreground">
                  <span>
                    {selected.status === "active" ? "Active" : "Inactive"} ·
                    Valid Error Workflow
                  </span>
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 text-[11px]"
                    asChild
                  >
                    <Link href={`/workflows/${selected.id}`}>
                      Open workflow
                      <ExternalLink className="ml-1 inline h-3 w-3" />
                    </Link>
                  </Button>
                </div>
              )}
              {(missingSelected || invalidSelected) && selectedId && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-1 h-7 text-xs"
                  disabled={saving || disabled}
                  onClick={() => void persist(null)}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
