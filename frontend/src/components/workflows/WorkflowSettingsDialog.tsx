"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronsUpDown, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

const TIMEZONE_OPTIONS = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowId: string;
  workspaceId: string;
  errorWorkflowId: string | null;
  onErrorWorkflowSaved: (nextErrorWorkflowId: string | null) => void;
  description: string;
  timezone: string;
  onSaveGeneral: (payload: {
    description: string;
    timezone: string;
  }) => Promise<void>;
  disabled?: boolean;
};

export function WorkflowSettingsDialog({
  open,
  onOpenChange,
  workflowId,
  workspaceId,
  errorWorkflowId,
  onErrorWorkflowSaved,
  description: descriptionProp,
  timezone: timezoneProp,
  onSaveGeneral,
  disabled = false,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [creating, setCreating] = useState(false);
  const [targets, setTargets] = useState<WorkflowErrorTarget[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(errorWorkflowId);
  const [search, setSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [description, setDescription] = useState(descriptionProp);
  const [timezone, setTimezone] = useState(timezoneProp || "UTC");

  const reloadTargets = async () => {
    const rows = await workflowsApi.listErrorTargets(workspaceId, workflowId);
    setTargets(rows);
    return rows;
  };

  useEffect(() => {
    if (!open) return;
    setSelectedId(errorWorkflowId);
    setDescription(descriptionProp || "");
    setTimezone(timezoneProp || "UTC");
  }, [open, errorWorkflowId, descriptionProp, timezoneProp]);

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
  const missingSelected = Boolean(selectedId) && !loading && !selected;
  const invalidSelected =
    Boolean(selected) && selected != null && !selected.validation.valid;
  const selectableTargets = useMemo(
    () => targets.filter((t) => t.validErrorWorkflow && !t.isSelf),
    [targets]
  );
  const hasSelectableTarget = selectableTargets.length > 0;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = !q
      ? targets
      : targets.filter((t) => t.name.toLowerCase().includes(q));
    return [...rows].sort((a, b) => {
      const aOk = a.validErrorWorkflow && !a.isSelf ? 0 : 1;
      const bOk = b.validErrorWorkflow && !b.isSelf ? 0 : 1;
      if (aOk !== bOk) return aOk - bOk;
      return a.name.localeCompare(b.name);
    });
  }, [targets, search]);

  const displayLabel = selected?.name
    ? selected.name
    : selectedId
      ? missingSelected
        ? "Selected Error Workflow no longer exists"
        : "Selected workflow…"
      : "None";

  const generalDirty =
    (description || "") !== (descriptionProp || "") ||
    (timezone || "UTC") !== (timezoneProp || "UTC");

  const persistErrorWorkflow = async (nextId: string | null) => {
    if (disabled) return;
    const previous = selectedId;
    setSelectedId(nextId);
    setSaving(true);
    try {
      const updated = await workflowsApi.setErrorWorkflow(workflowId, nextId);
      onErrorWorkflowSaved(updated.errorWorkflowId ?? null);
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

  const saveGeneral = async () => {
    if (disabled || savingGeneral) return;
    setSavingGeneral(true);
    try {
      await onSaveGeneral({
        description: description.trim(),
        timezone: timezone || "UTC",
      });
      toast.success("Settings saved");
    } catch (error) {
      console.error(error);
      toast.error("Could not save settings");
    } finally {
      setSavingGeneral(false);
    }
  };

  const createErrorWorkflow = async () => {
    if (disabled || creating) return;
    setCreating(true);
    try {
      const triggerId = `errorTrigger-${Date.now()}`;
      const created = await workflowsApi.create({
        name: `Error handler ${new Date().toLocaleString()}`,
        workspaceId,
        description: "Runs when another workflow fails (Error Trigger).",
        definition: {
          version: 1,
          nodes: [
            {
              id: triggerId,
              type: "errorTrigger",
              position: { x: 240, y: 180 },
              data: {
                label: "Error Trigger",
                nodeType: "errorTrigger",
              },
            },
          ],
          edges: [],
        },
      });
      await reloadTargets();
      setSelectedId(created.id);
      const updated = await workflowsApi.setErrorWorkflow(
        workflowId,
        created.id
      );
      onErrorWorkflowSaved(updated.errorWorkflowId ?? null);
      toast.success("Error Workflow created and linked");
    } catch (error) {
      console.error(error);
      toast.error("Could not create Error Workflow");
    } finally {
      setCreating(false);
    }
  };

  const timezoneChoices = useMemo(() => {
    const set = new Set(TIMEZONE_OPTIONS);
    if (timezone && !set.has(timezone)) set.add(timezone);
    return [...set];
  }, [timezone]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3 pr-10 text-left">
          <DialogTitle className="text-base">Workflow settings</DialogTitle>
          <DialogDescription className="text-xs">
            Options for this workflow. Changes apply to future runs.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[min(70vh,520px)] space-y-5 overflow-y-auto px-4 py-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              General
            </p>
            <div className="mt-3 space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={disabled || savingGeneral}
                  rows={2}
                  className="min-h-[64px] resize-y text-xs"
                  placeholder="Optional notes about this workflow"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Timezone</Label>
                <p className="text-[11px] text-muted-foreground">
                  Used for Schedule triggers and time-based expressions when a
                  node does not override it.
                </p>
                <select
                  value={timezone || "UTC"}
                  disabled={disabled || savingGeneral}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {timezoneChoices.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                size="sm"
                className="h-8 text-xs"
                disabled={
                  disabled || savingGeneral || !generalDirty || creating
                }
                onClick={() => void saveGeneral()}
              >
                {savingGeneral ? "Saving…" : "Save general settings"}
              </Button>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Execution
            </p>
            <div className="mt-3 space-y-1.5">
              <Label className="text-xs">Error Workflow</Label>
              <p className="text-[11px] text-muted-foreground">
                Optional. When this workflow fails, run another workflow that
                starts with an Error Trigger.
              </p>
              {!loading && !hasSelectableTarget && (
                <div className="mt-2 space-y-2 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-[11px] text-muted-foreground">
                  <p className="font-medium text-foreground">
                    No Error Workflow ready yet
                  </p>
                  <p>
                    Creating a blank workflow is not enough — it must contain an{" "}
                    <span className="font-medium text-foreground">
                      Error Trigger
                    </span>{" "}
                    node. Or create one here in one click:
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={disabled || creating || saving}
                    onClick={() => void createErrorWorkflow()}
                  >
                    {creating ? "Creating…" : "Create Error Workflow"}
                  </Button>
                  <p className="text-[10px] leading-relaxed">
                    Manual path: Nodes → search “error” → add{" "}
                    <span className="font-medium text-foreground">
                      Error Trigger
                    </span>{" "}
                    → Save → return here and pick it.
                  </p>
                </div>
              )}

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
                    disabled={disabled || saving || loading || creating}
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
                        void persistErrorWorkflow(null);
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
                          No workflows in this project yet.
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
                              void persistErrorWorkflow(t.id);
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
                                {t.validErrorWorkflow
                                  ? " · Ready to use"
                                  : t.isSelf
                                    ? " · Current workflow (not allowed)"
                                    : " · Needs Error Trigger"}
                              </span>
                              {reason && !t.validErrorWorkflow && (
                                <span className="mt-0.5 block text-[10px] text-muted-foreground/80">
                                  {reason}
                                </span>
                              )}
                            </span>
                          </button>
                        );
                      })}
                  </div>
                </PopoverContent>
              </Popover>

              {(saving || creating) && (
                <p className="text-[11px] text-muted-foreground">
                  {creating ? "Creating…" : "Saving…"}
                </p>
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
                    Linked
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
                  onClick={() => void persistErrorWorkflow(null)}
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

/** @deprecated Use WorkflowSettingsDialog */
export const WorkflowErrorSettingsDialog = WorkflowSettingsDialog;
