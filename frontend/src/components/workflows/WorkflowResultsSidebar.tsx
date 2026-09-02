"use client";

import React, { useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, Pin, PinOff, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WorkflowRun, WorkflowRunStep } from "@/modules/workflows/types";

export type WorkflowResultsPanelProps = {
  latestRun?: WorkflowRun | null;
  formatStepOutput: (output: unknown) => string;
  onSelectStepNode?: (nodeId: string) => void;
  onTogglePin?: (nodeId: string) => void;
  isPinned?: (nodeId: string) => boolean;
};

type Props = WorkflowResultsPanelProps & {
  open: boolean;
  onClose: () => void;
};

type StepInput = {
  nodeType?: string;
  nodeData?: Record<string, unknown>;
  contextInput?: unknown;
  incoming?: Record<string, unknown>;
  resolved?: Record<string, unknown> | null;
};

const isMultiline = (value: unknown) =>
  typeof value === "string" && (value.includes("\n") || value.length > 80);

function CopyButton({ value, label }: { value: unknown; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const text =
      typeof value === "string" ? value : JSON.stringify(value, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Clipboard not available");
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-6 gap-1 px-1.5 text-[10px]"
      onClick={copy}
      title={`Copy ${label}`}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-64 overflow-auto rounded bg-muted/60 p-2 text-[11px] leading-snug whitespace-pre-wrap break-words">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** Resolved values read best as labelled fields, with prompts kept verbatim. */
function ResolvedFields({ resolved }: { resolved: Record<string, unknown> }) {
  const entries = Object.entries(resolved);
  if (entries.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {entries.map(([key, value]) => (
        <div key={key}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {key}
            </span>
            {isMultiline(value) && <CopyButton value={value} label={key} />}
          </div>
          {isMultiline(value) || typeof value === "object" ? (
            <JsonBlock value={value} />
          ) : (
            <div className="break-words rounded bg-muted/60 px-2 py-1 text-[11px]">
              {String(value === "" ? "(empty)" : value)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function StepDetails({
  step,
  onTogglePin,
  pinned,
}: {
  step: WorkflowRunStep;
  onTogglePin?: (nodeId: string) => void;
  pinned?: boolean;
}) {
  const [tab, setTab] = useState<"input" | "output">("input");
  const input = (step.input || {}) as StepInput;
  const resolved = input.resolved || null;
  const incoming = input.incoming || {};
  const incomingIds = Object.keys(incoming);

  return (
    <div className="mt-2 border-t pt-2">
      <div className="mb-2 flex items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant={tab === "input" ? "secondary" : "ghost"}
          className="h-6 px-2 text-[11px]"
          onClick={() => setTab("input")}
        >
          Input
        </Button>
        <Button
          type="button"
          size="sm"
          variant={tab === "output" ? "secondary" : "ghost"}
          className="h-6 px-2 text-[11px]"
          onClick={() => setTab("output")}
        >
          Output
        </Button>
        <div className="ml-auto flex items-center gap-1">
          {onTogglePin && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[10px]"
              onClick={() => onTogglePin(step.nodeId)}
              title={
                pinned
                  ? "Stop reusing this output"
                  : "Reuse this output on the next runs instead of calling again"
              }
            >
              {pinned ? (
                <PinOff className="h-3 w-3" />
              ) : (
                <Pin className="h-3 w-3" />
              )}
              {pinned ? "Unpin" : "Pin"}
            </Button>
          )}
          <CopyButton
            value={tab === "input" ? step.input : step.output}
            label={tab}
          />
        </div>
      </div>

      {tab === "input" ? (
        <div className="space-y-3">
          {resolved ? (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
                Resolved (what this node actually used)
              </div>
              <ResolvedFields resolved={resolved} />
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              No resolved values recorded for this node type.
            </p>
          )}

          {incomingIds.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
                Incoming from {incomingIds.join(", ")}
              </div>
              <JsonBlock value={incoming} />
            </div>
          )}

          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
              Run input
            </div>
            <JsonBlock value={input.contextInput ?? null} />
          </div>
        </div>
      ) : (
        <JsonBlock value={step.output ?? null} />
      )}
    </div>
  );
}

/** Shared results body — used by the centered dialog and legacy sidebar. */
export function WorkflowResultsPanel({
  latestRun,
  formatStepOutput,
  onSelectStepNode,
  onTogglePin,
  isPinned,
}: WorkflowResultsPanelProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-1">
        {!latestRun ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No runs yet. Execute the workflow to see results here.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <span
                className={
                  latestRun.status === "succeeded"
                    ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-700 dark:text-emerald-300"
                    : latestRun.status === "failed"
                      ? "rounded-full bg-destructive/15 px-2 py-0.5 text-destructive"
                      : "rounded-full bg-muted px-2 py-0.5 text-muted-foreground"
                }
              >
                {latestRun.status}
              </span>
            </div>

            {latestRun.error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive whitespace-pre-wrap">
                {latestRun.error}
              </div>
            )}

            {latestRun.output != null && latestRun.status === "succeeded" && (
              <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3">
                <div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">
                  Final result
                </div>
                <div className="max-h-[min(50vh,420px)] overflow-y-auto overscroll-contain whitespace-pre-wrap text-sm leading-relaxed">
                  {formatStepOutput(latestRun.output)}
                </div>
              </div>
            )}

            {latestRun.steps && latestRun.steps.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase text-muted-foreground">
                  Steps
                </div>
                {latestRun.steps.map((step, index) => {
                  const isOpen = expanded === step.id;
                  return (
                    <div
                      key={step.id}
                      className={cn(
                        "rounded-md border p-2.5",
                        step.status === "failed" && "border-destructive/40"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => onSelectStepNode?.(step.nodeId)}
                        >
                          <div className="flex items-center gap-1.5 text-xs">
                            <span className="font-medium capitalize">
                              {index + 1}. {step.nodeType}
                            </span>
                            <span
                              className={
                                step.status === "failed"
                                  ? "text-destructive"
                                  : "text-muted-foreground"
                              }
                            >
                              {step.status}
                            </span>
                            {typeof step.attempts === "number" &&
                              step.attempts > 1 && (
                                <span className="rounded bg-amber-500/15 px-1 text-[10px] text-amber-700 dark:text-amber-300">
                                  {step.attempts} attempts
                                </span>
                              )}
                          </div>
                          <div className="truncate text-[10px] text-muted-foreground">
                            {step.nodeId}
                          </div>
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 shrink-0 gap-1 px-1.5 text-[10px]"
                          onClick={() => setExpanded(isOpen ? null : step.id)}
                        >
                          {isOpen ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronRight className="h-3 w-3" />
                          )}
                          {isOpen ? "Hide" : "Inspect"}
                        </Button>
                      </div>

                      {step.error && (
                        <div className="mt-1 text-xs text-destructive whitespace-pre-wrap">
                          {step.error}
                        </div>
                      )}

                      {!isOpen &&
                        step.output != null &&
                        step.status === "succeeded" && (
                          <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm">
                            {formatStepOutput(step.output)}
                          </div>
                        )}

                      {isOpen && (
                        <StepDetails
                          step={step}
                          onTogglePin={onTogglePin}
                          pinned={isPinned?.(step.nodeId)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
    </div>
  );
}

/** @deprecated Prefer WorkflowResultsDialog — kept for reference only. */
export function WorkflowResultsSidebar({
  open,
  onClose,
  ...panelProps
}: Props) {
  if (!open) return null;

  return (
    <aside
      className={cn(
        "absolute inset-y-0 right-0 z-30 flex w-[min(100%,24rem)] flex-col border-l bg-card shadow-xl sm:w-96",
        "max-h-full"
      )}
      role="dialog"
      aria-label="Workflow Results"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2.5">
        <div className="text-sm font-semibold">Results</div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onClose}
          aria-label="Close Results"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 px-3 py-3">
        <WorkflowResultsPanel {...panelProps} />
      </div>
    </aside>
  );
}

export default WorkflowResultsSidebar;
