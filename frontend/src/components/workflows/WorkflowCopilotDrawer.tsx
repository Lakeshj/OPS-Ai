"use client";

/**
 * Part 14D — Persistent right-side Workflow Copilot drawer.
 * Separate conversation from normal Chats. One large right panel at a time.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { workflowsApi } from "@/modules/workflows/api";
import type { Workflow, WorkflowDefinition, WorkflowRun } from "@/modules/workflows/types";
import {
  prepareCopilotHistoryApply,
  type CopilotOperation,
  type CopilotPlanResponse,
} from "@/modules/workflows/workflowCopilot";
import {
  filterWorkflowMentions,
  getActiveHashtagQuery,
  insertWorkflowMention,
  mentionsToWorkflowReferences,
  starterPrompts,
  type ResolvedWorkflowMention,
  type WorkflowMentionOption,
} from "@/modules/workflows/workflowCopilotMentions";
import type { Edge, Node } from "@xyflow/react";

const MAX_TURNS = 12;

type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  response?: CopilotPlanResponse | null;
  mentions?: ResolvedWorkflowMention[];
};

type Props = {
  open: boolean;
  onClose: () => void;
  workflowId: string;
  workflowName?: string;
  workspaceId?: string;
  buildDefinition: () => WorkflowDefinition;
  selectedNodeId: string | null;
  selectedNodeLabel?: string | null;
  selectedNodeType?: string | null;
  onClearSelection?: () => void;
  viewRunId?: string | null;
  latestRun?: WorkflowRun | null;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  pushHistory: (nodes: Node[], edges: Edge[]) => void;
  getNodes: () => Node[];
  getEdges: () => Edge[];
  composerFocusToken?: number;
};

function isDestructivePlan(ops: CopilotOperation[] | undefined): {
  destructive: boolean;
  labels: string[];
} {
  const labels: string[] = [];
  for (const op of ops || []) {
    if (op.type === "removeNode") {
      labels.push(String(op.nodeId || "node"));
    }
    if (op.type === "disconnectEdge") {
      labels.push("connection");
    }
  }
  return { destructive: labels.length > 0, labels };
}

function semanticPreviewLines(preview: unknown, ops: CopilotOperation[]): string[] {
  const lines: string[] = [];
  const p = preview as {
    addedNodes?: Array<{ type?: string; label?: string; id?: string }>;
    addedEdges?: Array<{ source?: string; target?: string }>;
    removedNodes?: Array<{ id?: string; type?: string }>;
    changedParameters?: Array<{ nodeId?: string; field?: string }>;
  } | null;
  if (p?.addedNodes) {
    for (const n of p.addedNodes) {
      lines.push(`+ ${n.label || n.type || n.id || "node"}`);
    }
  }
  if (p?.addedEdges) {
    for (const e of p.addedEdges) {
      lines.push(`+ ${e.source} → ${e.target}`);
    }
  }
  if (p?.removedNodes) {
    for (const n of p.removedNodes) {
      lines.push(`− ${n.id || n.type || "node"}`);
    }
  }
  if (p?.changedParameters) {
    for (const c of p.changedParameters) {
      lines.push(`~ ${c.nodeId}.${c.field}`);
    }
  }
  if (!lines.length && ops.length) {
    for (const op of ops.slice(0, 8)) {
      if (op.type === "addNode") {
        lines.push(`+ ${String(op.nodeType || "node")}`);
      } else if (op.type === "connectNodes") {
        lines.push(
          `+ ${String(op.sourceNodeId || op.sourceTempId || "?")} → ${String(op.targetNodeId || op.targetTempId || "?")}`
        );
      } else if (op.type === "updateNodeParameters") {
        lines.push(`~ update ${String(op.nodeId || "node")}`);
      } else if (op.type === "removeNode") {
        lines.push(`− remove ${String(op.nodeId || "node")}`);
      }
    }
  }
  return lines;
}

function safeAssistantText(text: string): string {
  return String(text || "")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function providerErrorMessage(code?: string): string | null {
  if (code === "COPILOT_PROVIDER_UNAVAILABLE") {
    return "Workflow Copilot isn't configured yet.";
  }
  if (code === "COPILOT_PROVIDER_TIMEOUT") {
    return "Copilot took too long to respond. Try again.";
  }
  if (code === "COPILOT_RESPONSE_INVALID" || code === "COPILOT_PLAN_INVALID") {
    return "I couldn't create a valid suggestion. Try rephrasing your request.";
  }
  if (code === "COPILOT_PLAN_STALE") {
    return "This workflow changed after this suggestion was created.";
  }
  return null;
}

export function WorkflowCopilotDrawer({
  open,
  onClose,
  workflowId,
  workflowName,
  workspaceId,
  buildDefinition,
  selectedNodeId,
  selectedNodeLabel,
  selectedNodeType,
  onClearSelection,
  viewRunId,
  latestRun,
  setNodes,
  setEdges,
  pushHistory,
  getNodes,
  getEdges,
  composerFocusToken = 0,
}: Props) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [mentions, setMentions] = useState<ResolvedWorkflowMention[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmDestructive, setConfirmDestructive] = useState<string | null>(
    null
  );
  const [workflowOptions, setWorkflowOptions] = useState<
    WorkflowMentionOption[]
  >([]);
  const [pickerIndex, setPickerIndex] = useState(0);
  const [cursor, setCursor] = useState(0);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const empty = useMemo(() => {
    const def = buildDefinition();
    return !(def.nodes && def.nodes.length);
  }, [buildDefinition, open, turns]);

  const failedRun = latestRun?.status === "failed";
  const waitingRun = latestRun?.status === "waiting";
  /** Prefer exact URL runId; banner "Ask why" may fall back to latest failed run id. */
  const runIdForRequest = viewRunId || null;
  const diagnosisRunId =
    viewRunId || (failedRun && latestRun?.id ? latestRun.id : null);

  const starters = starterPrompts({
    empty,
    failedRun: Boolean(failedRun && !waitingRun),
    waitingRun: Boolean(waitingRun),
    selectedNode: Boolean(selectedNodeId),
  });

  const activeHash = getActiveHashtagQuery(draft, cursor);
  const filteredOptions = useMemo(() => {
    if (!activeHash) return [];
    return filterWorkflowMentions(workflowOptions, activeHash.query);
  }, [activeHash, workflowOptions]);

  useEffect(() => {
    if (!open || !workspaceId) return;
    let cancelled = false;
    workflowsApi
      .list(workspaceId)
      .then((rows: Workflow[]) => {
        if (cancelled) return;
        setWorkflowOptions(
          (rows || [])
            .filter((w) => !w.isDeleted)
            .map((w) => ({
              workflowId: w.id,
              name: w.name,
              status: w.status,
            }))
        );
      })
      .catch(() => {
        if (!cancelled) setWorkflowOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, workspaceId]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => composerRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open, composerFocusToken]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (filteredOptions.length) {
          e.preventDefault();
          setCursor(cursor);
          return;
        }
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, filteredOptions.length, cursor]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [turns, loading]);

  const sendMessage = useCallback(
    async (
      text: string,
      opts?: {
        clarification?: { questionId?: string; answer: string };
        mentionSnapshot?: ResolvedWorkflowMention[];
        runIdOverride?: string | null;
      }
    ) => {
      const content = text.trim();
      if (!content || loading) return;
      setLoading(true);
      const mentionSnapshot = opts?.mentionSnapshot || mentions;
      const userTurn: ChatTurn = {
        id: `u-${Date.now()}`,
        role: "user",
        content,
        mentions: mentionSnapshot,
      };
      setTurns((prev) => [...prev, userTurn].slice(-MAX_TURNS * 2));
      setDraft("");
      setMentions([]);

      const def = buildDefinition();
      // Do not send a client-side fe-* hash — server SHA-256 is authoritative.
      // Stale protection for Apply uses revisionHash returned by the plan.
      const recentConversation = turns
        .slice(-MAX_TURNS)
        .map((t) => ({ role: t.role, content: t.content }));

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      const effectiveRunId =
        opts?.runIdOverride !== undefined
          ? opts.runIdOverride
          : runIdForRequest;

      try {
        const res = await workflowsApi.copilotPlan(workflowId, {
          message: content,
          workflowId,
          selectedNodeId: selectedNodeId || undefined,
          runId: effectiveRunId || undefined,
          currentDraftDefinition: def as unknown as import("@/modules/workflows/workflowCopilot").WorkflowDraftDefinition,
          definition: def as unknown as import("@/modules/workflows/workflowCopilot").WorkflowDraftDefinition,
          workflowReferences: mentionsToWorkflowReferences(mentionSnapshot),
          recentConversation,
          clarification: opts?.clarification || undefined,
        });

        setTurns((prev) =>
          [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: "assistant" as const,
              content: res.assistantMessage || res.summary || "",
              response: res,
            },
          ].slice(-MAX_TURNS * 2)
        );
      } catch (err: unknown) {
        const msg =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: string }).message)
            : "Copilot request failed";
        const code =
          err && typeof err === "object" && "code" in err
            ? String((err as { code: string }).code)
            : undefined;
        setTurns((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            content: providerErrorMessage(code) || msg,
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [
      loading,
      mentions,
      buildDefinition,
      turns,
      workflowId,
      selectedNodeId,
      runIdForRequest,
    ]
  );

  const applyPlan = useCallback(
    async (response: CopilotPlanResponse, source: string) => {
      const ops =
        response.fixPlan?.plan?.operations ||
        response.plan?.operations ||
        [];
      if (!ops.length) return;

      const destruct = isDestructivePlan(ops);
      if (destruct.destructive && confirmDestructive !== response.revisionHash) {
        setConfirmDestructive(response.revisionHash);
        return;
      }
      setConfirmDestructive(null);

      const draft = buildDefinition();
      const before = {
        version: draft.version || 1,
        nodes: draft.nodes as Node[],
        edges: draft.edges as Edge[],
        settings: draft.settings || {},
      };
      // Use the server hash from the plan — never the local fe-* hasher.
      const revisionHash = response.revisionHash || undefined;

      try {
        const applied = await workflowsApi.copilotApplyPlan(workflowId, {
          definition: draft,
          plan: {
            intent: response.intent,
            summary: response.summary,
            operations: ops,
            unresolvedInputs: response.unresolvedInputs || [],
            warnings: response.warnings || [],
          },
          baseRevisionHash: revisionHash,
        });

        const after = applied.resultingDefinition || applied.definition;
        if (!after?.nodes) {
          toast.error("Apply returned no definition");
          return;
        }

        prepareCopilotHistoryApply({
          before: {
            version: 1,
            nodes: getNodes(),
            edges: getEdges(),
            settings: draft.settings || {},
          },
          after: {
            version: after.version || 1,
            nodes: after.nodes as Node[],
            edges: (after.edges || []) as Edge[],
            settings: after.settings || {},
          },
          pushHistory,
          setNodes,
          setEdges,
          source,
        });
        toast.success("Applied to your draft.");
      } catch (err: unknown) {
        const code =
          err && typeof err === "object" && "code" in err
            ? String((err as { code: string }).code)
            : "";
        if (code === "COPILOT_PLAN_STALE") {
          toast.error(
            "This workflow changed after this suggestion was created."
          );
        } else {
          toast.error(
            err && typeof err === "object" && "message" in err
              ? String((err as { message: string }).message)
              : "Could not apply plan"
          );
        }
      }
    },
    [
      confirmDestructive,
      getNodes,
      getEdges,
      buildDefinition,
      workflowId,
      pushHistory,
      setNodes,
      setEdges,
    ]
  );

  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (filteredOptions.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPickerIndex((i) => Math.min(i + 1, filteredOptions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPickerIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const opt = filteredOptions[pickerIndex];
        if (opt) {
          const next = insertWorkflowMention(draft, cursor, opt, mentions);
          setDraft(next.text);
          setMentions(next.mentions);
          setCursor(next.cursor);
          requestAnimationFrame(() => {
            const el = composerRef.current;
            if (el) {
              el.selectionStart = el.selectionEnd = next.cursor;
              el.focus();
            }
          });
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setPickerIndex(0);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(draft);
    }
  };

  if (!open) return null;

  const failedNode =
    latestRun?.status === "failed"
      ? latestRun.steps?.find((s) => s.status === "failed")
      : null;

  return (
    <aside
      data-testid="workflow-copilot-drawer"
      role="complementary"
      aria-label="OpsAi Workflow Copilot"
      className={cn(
        "absolute inset-y-0 right-0 z-30 flex w-full flex-col border-l bg-card shadow-xl",
        "sm:w-[min(100%,26rem)] md:w-[24rem] lg:w-[26rem]"
      )}
    >
      <header className="flex items-center gap-2 border-b px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold tracking-tight">
            OpsAi Copilot
          </div>
          {workflowName ? (
            <div className="truncate text-xs text-muted-foreground">
              Workflow: {workflowName}
            </div>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close Copilot"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="flex flex-wrap gap-1.5 border-b px-3 py-2">
        {selectedNodeId ? (
          <button
            type="button"
            className="rounded-md border bg-muted/40 px-2 py-1 text-left text-[11px]"
            onClick={() => onClearSelection?.()}
            title="Clear selection"
          >
            <span className="text-muted-foreground">Selected</span>{" "}
            <span className="font-medium">
              {selectedNodeLabel || selectedNodeId}
            </span>
            {selectedNodeType ? (
              <span className="text-muted-foreground">
                {" "}
                · {selectedNodeType}
              </span>
            ) : null}
          </button>
        ) : null}
        {runIdForRequest || latestRun ? (
          <div className="rounded-md border px-2 py-1 text-[11px]">
            <span className="text-muted-foreground">Run</span>{" "}
            <span className="font-medium">
              {waitingRun
                ? "Waiting"
                : failedRun
                  ? "Failed"
                  : latestRun?.status || "Viewing"}
            </span>
            {latestRun?.finishedAt || latestRun?.startedAt ? (
              <span className="text-muted-foreground">
                {" "}
                ·{" "}
                {new Date(
                  latestRun.finishedAt || latestRun.startedAt || ""
                ).toLocaleString()}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {failedRun && !waitingRun ? (
        <div className="border-b bg-destructive/5 px-3 py-2 text-xs">
          <div className="font-medium">Last run failed</div>
          {failedNode ? (
            <div className="text-muted-foreground">
              Failed node: {failedNode.nodeId}
            </div>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="mt-1.5 h-7"
            disabled={loading}
            onClick={() =>
              void sendMessage("Why did this run fail?", {
                runIdOverride: diagnosisRunId,
              })
            }
          >
            Ask why
          </Button>
        </div>
      ) : null}

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {turns.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {empty
                ? "Describe what you want to automate."
                : "Ask about this workflow, a selected node, or a run."}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {starters.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted"
                  disabled={loading}
                  onClick={() => void sendMessage(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {turns.map((t) => (
          <div
            key={t.id}
            className={cn(
              "rounded-lg px-2.5 py-2 text-sm",
              t.role === "user" ? "ml-6 bg-primary/10" : "mr-2 bg-muted/50"
            )}
          >
            <div
              className="whitespace-pre-wrap break-words"
              dangerouslySetInnerHTML={{
                __html: safeAssistantText(t.content),
              }}
            />
            {t.role === "assistant" && t.response ? (
              <AssistantCards
                response={t.response}
                loading={loading}
                confirmDestructive={confirmDestructive}
                onApply={() => void applyPlan(t.response!, "copilot-apply")}
                onApplyFix={() => void applyPlan(t.response!, "copilot-fix")}
                onClarify={(qId, answer) =>
                  void sendMessage(answer, {
                    clarification: { questionId: qId, answer },
                  })
                }
                onRegenerate={() =>
                  void sendMessage(
                    turns.filter((x) => x.role === "user").slice(-1)[0]
                      ?.content || "Try again"
                  )
                }
              />
            ) : null}
          </div>
        ))}
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Thinking…
          </div>
        ) : null}
      </div>

      <div className="relative border-t p-2">
        {filteredOptions.length > 0 ? (
          <div
            className="absolute bottom-full left-2 right-2 mb-1 max-h-48 overflow-y-auto rounded-md border bg-popover shadow-md"
            role="listbox"
            aria-label="Workflows"
          >
            <div className="px-2 py-1 text-[10px] font-medium uppercase text-muted-foreground">
              Workflows
            </div>
            {filteredOptions.map((opt, i) => (
              <button
                key={opt.workflowId}
                type="button"
                role="option"
                aria-selected={i === pickerIndex}
                className={cn(
                  "flex w-full px-2 py-1.5 text-left text-xs",
                  i === pickerIndex ? "bg-accent" : "hover:bg-muted"
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  const next = insertWorkflowMention(
                    draft,
                    cursor,
                    opt,
                    mentions
                  );
                  setDraft(next.text);
                  setMentions(next.mentions);
                  setCursor(next.cursor);
                }}
              >
                #{opt.name}
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {opt.workflowId.slice(0, 8)}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-1.5">
          <textarea
            ref={composerRef}
            data-testid="workflow-copilot-composer"
            value={draft}
            rows={2}
            placeholder="Ask about this workflow..."
            disabled={loading}
            aria-label="Ask about this workflow"
            className="min-h-[2.5rem] flex-1 resize-none rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onChange={(e) => {
              setDraft(e.target.value);
              setCursor(e.target.selectionStart);
              setPickerIndex(0);
            }}
            onSelect={(e) =>
              setCursor((e.target as HTMLTextAreaElement).selectionStart)
            }
            onKeyDown={onComposerKeyDown}
          />
          <Button
            type="button"
            size="icon"
            aria-label="Send"
            disabled={loading || !draft.trim()}
            onClick={() => void sendMessage(draft)}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}

function AssistantCards({
  response,
  loading,
  confirmDestructive,
  onApply,
  onApplyFix,
  onClarify,
  onRegenerate,
}: {
  response: CopilotPlanResponse;
  loading: boolean;
  confirmDestructive: string | null;
  onApply: () => void;
  onApplyFix: () => void;
  onClarify: (questionId: string, answer: string) => void;
  onRegenerate: () => void;
}) {
  const stale = (response.warnings || []).some(
    (w) =>
      (typeof w === "object" && w?.code === "COPILOT_PLAN_STALE") ||
      w === "COPILOT_PLAN_STALE"
  );
  const unsupported = response.unsupportedCapabilities || [];
  const ops = response.plan?.operations || [];
  const fixOps = response.fixPlan?.plan?.operations || [];
  const canApply =
    !stale &&
    !unsupported.length &&
    ops.length > 0 &&
    response.intent !== "EXPLAIN" &&
    response.intent !== "DEBUG";
  const canApplyFix =
    !stale &&
    Boolean(response.fixPlan?.applicable) &&
    fixOps.length > 0;
  const destruct = isDestructivePlan(canApplyFix ? fixOps : ops);
  const previewLines = semanticPreviewLines(response.preview, ops);
  const unresolved = response.unresolvedInputs || [];

  return (
    <div className="mt-2 space-y-2 text-xs">
      {stale && (ops.length > 0 || fixOps.length > 0) ? (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2">
          This workflow changed after this suggestion was created.
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="mt-1 h-7"
            disabled={loading}
            onClick={onRegenerate}
          >
            Regenerate suggestion
          </Button>
        </div>
      ) : null}

      {unsupported.length ? (
        <div className="rounded border p-2 text-muted-foreground">
          {unsupported.map((u) => (
            <div key={u.capability}>
              {u.capability} isn&apos;t available in this OpsAi version yet.
            </div>
          ))}
        </div>
      ) : null}

      {response.diagnosis ? (
        <div className="space-y-1 rounded border p-2">
          <div className="font-medium">Problem</div>
          <div>
            {String(
              (response.diagnosis as { problem?: { summary?: string } })
                ?.problem?.summary ||
                (response.diagnosis as { summary?: string })?.summary ||
                ""
            )}
          </div>
          {(response.diagnosis as { cause?: string })?.cause ? (
            <>
              <div className="mt-1 font-medium">Cause</div>
              <div>{String((response.diagnosis as { cause?: string }).cause)}</div>
            </>
          ) : null}
          {(response.diagnosis as { suggestedAction?: string })
            ?.suggestedAction ? (
            <>
              <div className="mt-1 font-medium">Suggested action</div>
              <div>
                {String(
                  (response.diagnosis as { suggestedAction?: string })
                    .suggestedAction
                )}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {previewLines.length > 0 && (canApply || response.intent === "CREATE" || response.intent === "MODIFY" || response.intent === "BUILD") ? (
        <div className="rounded border p-2">
          <div className="font-medium">Proposed changes</div>
          <ul className="mt-1 list-inside list-disc">
            {previewLines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {unresolved.length ? (
        <div className="rounded border p-2">
          <div className="font-medium">Needs configuration</div>
          <ul className="mt-1 list-inside list-disc">
            {unresolved.map((u, i) => (
              <li key={`${u.field}-${i}`}>
                {u.message || u.field}
                {/credential/i.test(u.field) || /credential/i.test(u.message || "")
                  ? " (select in node settings — do not paste secrets here)"
                  : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {(response.clarifyingQuestions || []).length > 0 ? (
        <div className="space-y-1">
          {(response.clarifyingQuestions || []).map((q) => (
            <div key={q.id} className="rounded border p-2">
              <div>{q.prompt}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {((q as { options?: string[] }).options || [])
                  .slice(0, 6)
                  .map((opt) => (
                    <Button
                      key={opt}
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-7"
                      disabled={loading}
                      onClick={() => onClarify(q.id, opt)}
                    >
                      {opt}
                    </Button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {destruct.destructive &&
      confirmDestructive === response.revisionHash ? (
        <div className="rounded border border-destructive/40 bg-destructive/5 p-2">
          This will remove:
          <ul className="mt-1 list-inside list-disc">
            {destruct.labels.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="mt-1.5 h-7"
            disabled={loading}
            onClick={canApplyFix ? onApplyFix : onApply}
          >
            Confirm apply
          </Button>
        </div>
      ) : null}

      {canApplyFix ? (
        <Button
          type="button"
          size="sm"
          className="h-7"
          disabled={loading}
          onClick={onApplyFix}
        >
          Apply fix
        </Button>
      ) : null}
      {canApply && !canApplyFix ? (
        <Button
          type="button"
          size="sm"
          className="h-7"
          disabled={loading}
          onClick={onApply}
        >
          Apply changes
        </Button>
      ) : null}
    </div>
  );
}
