"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  History,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { workspaceSummaryApiService } from "@/modules/workspaceSummary/api";
import {
  getWorkspaceSummaryRegenerateJob,
  runWorkspaceSummaryRegenerate,
} from "@/modules/workspaceSummary/regenerateJobs";
import {
  WorkspaceSummary,
  WorkspaceSummaryCategoryScore,
  WorkspaceSummaryResponse,
} from "@/modules/shared/types";
import { MarkdownMessage } from "@/components/MarkdownMessage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  getScoringCategoryLabel,
} from "@/modules/systemPrompts/scoringCategories";

export interface WorkspaceSummaryPanelProps {
  workspaceId: string;
  canManage: boolean;
  active?: boolean;
  compact?: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  business_intelligence: "Business Intelligence",
  customer_intelligence: "Customer Intelligence",
  brand_intelligence: "Brand Intelligence",
  marketing_intelligence: "Marketing Intelligence",
  operational_intelligence: "Operational Intelligence",
  constraints: "Constraints / Guardrails",
  coverage: "Chat Coverage",
  objectives: "Objectives",
  persona: "Persona",
  completeness: "Completeness",
  tone: "Tone",
  clarity: "Clarity",
  deliverables: "Deliverables",
};

const scoreTone = (score: number | null) => {
  if (score == null) return "secondary";
  if (score >= 80) return "default";
  if (score >= 60) return "secondary";
  return "destructive";
};

const scoreBarClass = (score: number) => {
  if (score >= 80) return "bg-emerald-500";
  if (score >= 60) return "bg-amber-500";
  return "bg-rose-500";
};

const normalizeCategory = (
  value: WorkspaceSummaryCategoryScore | number | undefined
): WorkspaceSummaryCategoryScore | null => {
  if (value == null) return null;
  if (typeof value === "number") {
    return { score: value, feedback: "No category feedback provided." };
  }
  return {
    score: Number(value.score) || 0,
    feedback: value.feedback || "No category feedback provided.",
  };
};

export function WorkspaceSummaryPanel({
  workspaceId,
  canManage,
  active = true,
  compact = false,
}: WorkspaceSummaryPanelProps) {
  const [data, setData] = useState<WorkspaceSummaryResponse>({
    summary: null,
    versions: [],
    activeScoringCategories: [],
  });
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showSystemContext, setShowSystemContext] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadSummary = async () => {
    setIsLoading(true);
    try {
      const response = await workspaceSummaryApiService.get(workspaceId);
      if (!mountedRef.current) return;
      setData(response);
      setDraft(response.summary?.content || "");
    } catch (error) {
      if (!mountedRef.current) return;
      toast.error(
        error instanceof Error ? error.message : "Failed to load summary"
      );
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  };

  useEffect(() => {
    if (active && workspaceId) void loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, workspaceId]);

  // Resume in-flight regenerate if user navigated away and came back.
  useEffect(() => {
    if (!workspaceId) return;
    const job = getWorkspaceSummaryRegenerateJob(workspaceId);
    if (!job) return;

    setBusyAction("regenerate");
    job.promise
      .then(async (summary) => {
        if (!mountedRef.current) return;
        applySummary(summary);
        await loadSummary();
        const files = summary.documentSnapshot?.length || 0;
        const score =
          summary.evaluationScore == null
            ? "—"
            : Math.round(summary.evaluationScore);
        toast.success(
          `Summary rebuilt from ${files} file(s). New score: ${score}/100`
        );
      })
      .catch((error) => {
        if (!mountedRef.current) return;
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to regenerate summary"
        );
      })
      .finally(() => {
        if (mountedRef.current) setBusyAction(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, active]);

  useEffect(() => {
    if (busyAction !== "regenerate") return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [busyAction]);

  const applySummary = (summary: WorkspaceSummary) => {
    setData((current) => ({ ...current, summary }));
    setDraft(summary.content);
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (!draft.trim()) return;
    setBusyAction("save");
    try {
      applySummary(
        await workspaceSummaryApiService.update(workspaceId, draft.trim())
      );
      await loadSummary();
      toast.success("System summary saved and re-evaluated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save summary"
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleRegenerate = async () => {
    setBusyAction("regenerate");
    toast.message("Regenerating summary… You can stay on this tab; it keeps running if you switch panels.");
    try {
      const summary = await runWorkspaceSummaryRegenerate(workspaceId, () =>
        workspaceSummaryApiService.regenerate(workspaceId)
      );
      if (!mountedRef.current) {
        toast.success("Summary regenerated in the background");
        return;
      }
      applySummary(summary);
      await loadSummary();
      const files = summary.documentSnapshot?.length || 0;
      const score =
        summary.evaluationScore == null
          ? "—"
          : Math.round(summary.evaluationScore);
      toast.success(
        `Summary rebuilt from ${files} file(s). New score: ${score}/100`
      );
    } catch (error) {
      if (!mountedRef.current) return;
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to regenerate summary"
      );
    } finally {
      if (mountedRef.current) setBusyAction(null);
    }
  };

  const handleRestore = async (versionId: string) => {
    setBusyAction(versionId);
    try {
      applySummary(
        await workspaceSummaryApiService.restore(workspaceId, versionId)
      );
      await loadSummary();
      toast.success("Summary and document snapshot restored");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to restore version"
      );
    } finally {
      setBusyAction(null);
    }
  };

  const summary = data.summary;
  const evaluation = summary?.evaluationDetails;
  const categoryEntries = evaluation?.categories || {};
  const activeKeys =
    Array.isArray(data.activeScoringCategories) &&
    data.activeScoringCategories.length > 0
      ? data.activeScoringCategories
      : Array.isArray(evaluation?.categoryOrder) &&
          evaluation.categoryOrder.length > 0
        ? evaluation.categoryOrder
        : Object.keys(categoryEntries);

  const categories = activeKeys
    .map((key) => {
      const raw = categoryEntries[key];
      const data = normalizeCategory(raw);
      if (!data) return null;
      const label =
        (raw as WorkspaceSummaryCategoryScore & { label?: string })?.label ||
        CATEGORY_LABELS[key] ||
        getScoringCategoryLabel(key);
      return { key, label, data };
    })
    .filter(Boolean) as Array<{
    key: string;
    label: string;
    data: WorkspaceSummaryCategoryScore;
  }>;

  const hasStaleCategories =
    Object.keys(categoryEntries).length > 0 &&
    activeKeys.some((key) => categoryEntries[key] == null);

  if (isLoading) {
    return (
      <div className="workspace-summary-loading flex min-h-48 items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const content = (
    <div className="workspace-summary-panel-body min-w-0 max-w-full space-y-4 overflow-x-hidden pb-2">
      <p className="text-sm text-muted-foreground">
        Auto-built from workspace files for AI chat context. Review category
        scores to see where system knowledge is weak—not as user-facing copy.
        New ready files trigger a score refresh; use Regenerate from files to
        rebuild immediately.
      </p>

      {summary && (
        <div className="workspace-summary-meta flex flex-wrap items-center gap-2">
          <Badge variant="outline">v{summary.version}</Badge>
          <Badge variant={scoreTone(summary.evaluationScore)}>
            Overall AI Readiness {summary.evaluationScore ?? "—"}/100
          </Badge>
          <Badge variant="secondary">{summary.source}</Badge>
          <span className="text-xs text-muted-foreground">
            {summary.documentSnapshot?.length || 0} file(s) in snapshot
          </span>
        </div>
      )}

      <div className="workspace-summary-actions flex flex-wrap gap-2">
        {canManage && !isEditing && (
          <>
            <Button
              size="sm"
              onClick={handleRegenerate}
              disabled={busyAction !== null}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${
                  busyAction === "regenerate" ? "animate-spin" : ""
                }`}
              />
              Regenerate from files
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setShowSystemContext(true);
                setIsEditing(true);
              }}
              disabled={!summary || busyAction !== null}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit system context
            </Button>
          </>
        )}
        {canManage && isEditing && (
          <>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!draft.trim() || busyAction !== null}
            >
              <Save className="mr-2 h-4 w-4" />
              Save & evaluate
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDraft(summary?.content || "");
                setIsEditing(false);
              }}
              disabled={busyAction !== null}
            >
              <X className="mr-2 h-4 w-4" />
              Cancel
            </Button>
          </>
        )}
      </div>

      <section className="workspace-summary-evaluation min-w-0 max-w-full rounded-lg border p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Category scores</h3>
          {summary?.evaluationFeedback && (
            <p className="text-xs text-muted-foreground md:max-w-[60%] md:text-right">
              {summary.evaluationFeedback}
            </p>
          )}
        </div>

        {hasStaleCategories && (
          <p className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            Scoring checklist changed. Scores refresh automatically after you
            save the System Prompt — reopen this tab in a moment, or click
            Regenerate if content also needs rebuilding from files.
          </p>
        )}

        {categories.length > 0 ? (
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            {categories.map(({ key, label, data: category }) => (
              <div
                key={key}
                className="workspace-summary-category min-w-0 rounded-md border bg-muted/30 p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{label}</span>
                  <Badge variant={scoreTone(category!.score)}>
                    {category!.score}/100
                  </Badge>
                </div>
                <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${scoreBarClass(category!.score)}`}
                    style={{ width: `${category!.score}%` }}
                  />
                </div>
                <p className="break-words text-xs text-muted-foreground">
                  {category!.feedback}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {summary
              ? "No category breakdown yet. Regenerate the summary to run the Workspace Knowledge Evaluator."
              : "No system summary yet. Upload documents or regenerate from files."}
          </p>
        )}

        {evaluation && (
          <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-3">
            {[
              ["Strengths", evaluation.strengths],
              ["Missing information", evaluation.gaps],
              ["Suggestions for improvement", evaluation.recommendations],
            ].map(([label, items]) => (
              <div key={label as string} className="min-w-0">
                <h4 className="text-sm font-medium">{label}</h4>
                <ul className="mt-1 list-disc space-y-1 break-words pl-4 text-xs text-muted-foreground">
                  {(items as string[] | undefined)?.length ? (
                    (items as string[]).map((item) => <li key={item}>{item}</li>)
                  ) : (
                    <li>None provided</li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="workspace-summary-content min-w-0 max-w-full overflow-hidden rounded-lg border bg-card">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium"
          onClick={() => setShowSystemContext((open) => !open)}
        >
          <span>System context (from files)</span>
          {showSystemContext || isEditing ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
        </button>

        {(showSystemContext || isEditing) && (
          <div className="min-w-0 max-w-full overflow-x-hidden border-t p-4">
            {isEditing ? (
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                className={`max-w-full resize-y break-words font-mono text-sm ${
                  compact ? "min-h-[220px]" : "min-h-[320px]"
                }`}
                aria-label="Workspace system summary Markdown"
              />
            ) : summary ? (
              <div className="workspace-summary-markdown min-w-0 max-w-full overflow-x-auto break-words">
                <MarkdownMessage
                  content={summary.content}
                  className="max-w-full overflow-hidden [&_*]:max-w-full [&_pre]:overflow-x-auto"
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No system summary exists yet. Upload a document or regenerate
                from files.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="workspace-summary-history min-w-0 max-w-full rounded-lg border p-4">
        <h3 className="mb-3 flex items-center gap-2 font-semibold">
          <History className="h-4 w-4" />
          Previous versions
        </h3>
        {data.versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No previous versions yet.
          </p>
        ) : (
          <div className="space-y-3">
            {data.versions.map((version) => (
              <div
                key={version.id}
                className="flex min-w-0 items-start justify-between gap-3 rounded-md bg-muted/40 p-3"
              >
                <div className="min-w-0 flex-1 overflow-hidden">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">v{version.version}</Badge>
                    <Badge variant="secondary">{version.source}</Badge>
                    {version.evaluationScore != null && (
                      <Badge variant={scoreTone(version.evaluationScore)}>
                        {version.evaluationScore}/100
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {new Date(version.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 break-words text-sm text-muted-foreground">
                    {version.content.replace(/[#*_`]/g, " ")}
                  </p>
                </div>
                {canManage && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => handleRestore(version.id)}
                    disabled={busyAction !== null}
                  >
                    <RotateCcw
                      className={`mr-2 h-4 w-4 ${
                        busyAction === version.id ? "animate-spin" : ""
                      }`}
                    />
                    Restore
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );

  if (compact) {
    return (
      <div className="workspace-summary-panel-compact min-w-0 max-w-full overflow-x-hidden">
        {content}
      </div>
    );
  }

  return (
    <ScrollArea className="workspace-summary-scroll min-h-0 min-w-0 flex-1 overflow-x-hidden pr-4">
      {content}
    </ScrollArea>
  );
}
