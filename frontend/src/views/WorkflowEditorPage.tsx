"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, Maximize2, Minimize2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { WorkflowCanvas } from "@/components/workflows/WorkflowCanvas";
import { RunLineageBadge } from "@/components/workflows/RunLineageBadge";
import { workflowsApi } from "@/modules/workflows/api";
import type {
  Workflow,
  WorkflowDefinition,
  WorkflowErrorRouting,
  WorkflowRun,
  WorkflowRunLineage,
} from "@/modules/workflows/types";
import { subworkflowErrorMessage } from "@/modules/workflows/subworkflowUx";
import { isErrorRoutingTerminal } from "@/modules/workflows/errorRoutingUx";

type Props = {
  focusMode?: boolean;
  onFocusModeChange?: (focus: boolean) => void;
};

export default function WorkflowEditorPage({
  focusMode = false,
  onFocusModeChange,
}: Props) {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const workflowId = String(params.workflowId || "");
  const runIdParam = searchParams.get("runId");
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [latestRun, setLatestRun] = useState<WorkflowRun | null>(null);
  const [lineage, setLineage] = useState<WorkflowRunLineage | null>(null);
  const [errorRouting, setErrorRouting] =
    useState<WorkflowErrorRouting | null>(null);
  const [resuming, setResuming] = useState(false);
  const pollAbortRef = useRef(0);

  const refreshLineage = useCallback(
    async (run: WorkflowRun | null) => {
      if (!workflowId || !run?.id) {
        setLineage(null);
        return;
      }
      try {
        const lin = await workflowsApi.getRunLineage(workflowId, run.id);
        setLineage(lin);
      } catch {
        setLineage(null);
      }
    },
    [workflowId]
  );

  const refreshErrorRouting = useCallback(
    async (run: WorkflowRun | null) => {
      if (!workflowId || !run?.id) {
        setErrorRouting(null);
        return;
      }
      try {
        const routing = await workflowsApi.getErrorRouting(workflowId, run.id);
        setErrorRouting(routing.role === "none" ? null : routing);
      } catch {
        setErrorRouting(null);
      }
    },
    [workflowId]
  );

  const load = useCallback(async () => {
    if (!workflowId) return;
    setLoading(true);
    try {
      let wf: Workflow | null = null;
      try {
        wf = await workflowsApi.getById(workflowId);
      } catch {
        // Part 10C.1: soft-deleted live definition — historical run view only.
        if (!runIdParam) {
          throw new Error("Workflow not found");
        }
        const historical = await workflowsApi.getRun(workflowId, runIdParam);
        if (!historical.workflowDeleted || !historical.historicalDefinition) {
          throw new Error("Workflow not found");
        }
        wf = {
          id: workflowId,
          workspaceId: historical.workspaceId || "",
          name: historical.workflowName || "Deleted workflow",
          definition: historical.historicalDefinition,
          status: "archived",
          isDeleted: true,
          deletedAt: null,
          createdBy: historical.createdBy,
          createdAt: historical.createdAt,
          updatedAt: historical.createdAt,
        };
        // Prefer lineage for workspace when available after run load.
        setLatestRun(historical);
        setWorkflow(wf);
        setName(wf.name);
        await refreshLineage(historical);
        await refreshErrorRouting(historical);
        return;
      }
      setWorkflow(wf);
      setName(wf.name);
      let detailed: WorkflowRun | null = null;
      if (runIdParam) {
        try {
          detailed = await workflowsApi.getRun(workflowId, runIdParam);
        } catch {
          toast.error("Run not found — showing latest");
          const runs = await workflowsApi.listRuns(workflowId);
          if (runs[0]) {
            detailed = await workflowsApi.getRun(workflowId, runs[0].id);
          }
        }
      } else {
        const runs = await workflowsApi.listRuns(workflowId);
        if (runs[0]) {
          detailed = await workflowsApi.getRun(workflowId, runs[0].id);
        }
      }
      setLatestRun(detailed);
      await refreshLineage(detailed);
      await refreshErrorRouting(detailed);
    } catch (error) {
      console.error(error);
      toast.error("Failed to load workflow");
      setWorkflow(null);
    } finally {
      setLoading(false);
    }
  }, [workflowId, runIdParam, refreshLineage, refreshErrorRouting]);

  useEffect(() => {
    load();
  }, [load]);

  const pollRun = async (runId: string) => {
    const token = ++pollAbortRef.current;
    let last: WorkflowRun | null = latestRun;
    for (let i = 0; i < 120; i++) {
      if (token !== pollAbortRef.current) return last;
      const run = await workflowsApi.getRun(workflowId, runId);
      last = run;
      setLatestRun(run);
      void refreshLineage(run);
      void refreshErrorRouting(run);
      if (
        run.status === "succeeded" ||
        run.status === "failed" ||
        run.status === "cancelled"
      ) {
        // After source terminal, keep following Error Workflow briefly.
        if (run.status === "failed") {
          for (let j = 0; j < 40; j++) {
            if (token !== pollAbortRef.current) return last;
            await new Promise((r) => setTimeout(r, 1500));
            const routing = await workflowsApi
              .getErrorRouting(workflowId, run.id)
              .catch(() => null);
            if (routing) {
              setErrorRouting(routing.role === "none" ? null : routing);
              if (isErrorRoutingTerminal(routing)) break;
            }
          }
        }
        return run;
      }
      if (run.status === "waiting" && i === 0) {
        if (run.waitingReason === "child_run") {
          toast.message("Waiting for child workflow");
        } else {
          const mode = run.wait?.resumeMode;
          toast.message(
            mode === "manual"
              ? "Waiting for manual resume"
              : mode === "external"
                ? "Waiting for external signal"
                : run.resumeAt
                  ? `Waiting until ${new Date(run.resumeAt).toLocaleString()}`
                  : "Workflow is waiting"
          );
        }
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    return last;
  };

  // Keep refreshing while a loaded run is waiting / active
  useEffect(() => {
    if (!workflowId || !latestRun?.id) return;
    if (
      latestRun.status !== "waiting" &&
      latestRun.status !== "queued" &&
      latestRun.status !== "running"
    ) {
      return;
    }
    if (running || resuming) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const run = await workflowsApi.getRun(workflowId, latestRun.id);
        if (cancelled) return;
        setLatestRun(run);
        void refreshLineage(run);
        void refreshErrorRouting(run);
      } catch {
        // ignore transient poll errors
      }
    };
    const id = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [
    workflowId,
    latestRun?.id,
    latestRun?.status,
    running,
    resuming,
    refreshLineage,
    refreshErrorRouting,
  ]);

  // Part 11C — follow Error Workflow dispatch after source is terminal failed/handler waiting
  useEffect(() => {
    if (!workflowId || !latestRun?.id) return;
    if (running || resuming) return;
    if (!errorRouting || isErrorRoutingTerminal(errorRouting)) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const routing = await workflowsApi.getErrorRouting(
          workflowId,
          latestRun.id
        );
        if (cancelled) return;
        setErrorRouting(routing.role === "none" ? null : routing);
        // If handler is waiting on this same run (handler role), also refresh run.
        if (routing.role === "handler") {
          const run = await workflowsApi.getRun(workflowId, latestRun.id);
          if (!cancelled) setLatestRun(run);
        }
      } catch {
        // ignore
      }
    };
    const id = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // Depend on routing identity fields, not the whole object (avoids interval thrash).
  }, [
    workflowId,
    latestRun?.id,
    errorRouting?.role,
    errorRouting?.dispatch?.status,
    errorRouting?.dispatch?.errorRunId,
    errorRouting?.errorRun?.status,
    running,
    resuming,
  ]);

  const handleSave = async (definition: WorkflowDefinition) => {
    if (!workflow || workflow.isDeleted) return;
    setSaving(true);
    try {
      const updated = await workflowsApi.update(workflow.id, {
        name: name.trim() || workflow.name,
        definition,
      });
      setWorkflow(updated);
      toast.success("Saved");
    } catch (error) {
      console.error(error);
      toast.error("Failed to save");
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const handleResumeRun = async () => {
    if (!workflow || !latestRun) return;
    setResuming(true);
    try {
      const result = await workflowsApi.resumeRun(workflow.id, latestRun.id);
      setLatestRun(result.run);
      toast.message("Resume signalled — continuing…");
      await pollRun(latestRun.id);
    } catch (error) {
      console.error(error);
      toast.error("Failed to resume run");
    } finally {
      setResuming(false);
    }
  };

  const handleRun = async (input: Record<string, unknown>) => {
    if (!workflow || workflow.isDeleted) return;
    setRunning(true);
    try {
      const useWebhookDelivery = Boolean(input.__opsaiWebhookRespondTest);
      const {
        source: _source,
        __opsaiWebhookRespondTest: _flag,
        ...body
      } = input;

      if (useWebhookDelivery) {
        const delivery = await workflowsApi.testWebhook(
          workflow.id,
          Object.keys(body).length ? body : { ping: true }
        );
        setLatestRun(delivery.run);
        const params = new URLSearchParams(searchParams.toString());
        params.set("runId", delivery.run.id);
        router.replace(`/workflows/${workflow.id}?${params.toString()}`);
        const hr = delivery.httpResponse;
        if (hr) {
          const preview =
            typeof hr.body === "string"
              ? hr.body.slice(0, 120)
              : JSON.stringify(hr.body).slice(0, 120);
          toast.success(`Webhook response ${hr.statusCode}: ${preview}`);
        } else if (delivery.run.status === "succeeded") {
          toast.success("Webhook run succeeded");
        } else {
          toast.error(delivery.run.error || "Webhook run failed");
        }
        return;
      }

      const run = await workflowsApi.startRun(workflow.id, input);
      setLatestRun(run);
      const params = new URLSearchParams(searchParams.toString());
      params.set("runId", run.id);
      router.replace(`/workflows/${workflow.id}?${params.toString()}`);
      toast.message("Running workflow...");
      const finalRun = await pollRun(run.id);
      if (finalRun?.status === "succeeded") toast.success("Run succeeded");
      else if (finalRun?.status === "failed") {
        toast.error(
          subworkflowErrorMessage(
            finalRun.error,
            finalRun.error || "Run failed"
          )
        );
      } else toast.message("Still running… check backend logs if this hangs");
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error ? error.message : "Failed to start run";
      toast.error(subworkflowErrorMessage(message, message));
    } finally {
      setRunning(false);
    }
  };

  const handlePublish = async () => {
    if (!workflow || workflow.isDeleted) return;
    setSaving(true);
    try {
      const updated = await workflowsApi.update(workflow.id, {
        status: "active",
      });
      setWorkflow(updated);
      toast.success("Workflow published");
    } catch (error) {
      console.error(error);
      toast.error("Failed to publish");
      throw error;
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Loading editor...</div>
    );
  }

  if (!workflow) {
    return (
      <div className="space-y-3 p-6">
        <div>Workflow not found.</div>
        <Button asChild variant="outline">
          <Link href="/projects">Back</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-card/60 px-3 py-2 md:px-4">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/projects/${workflow.workspaceId}?mode=workflow`}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Workspace
          </Link>
        </Button>

        <RunLineageBadge lineage={lineage} className="min-w-0 flex-1" />

        <div className="ml-auto flex items-center gap-1">
          {!focusMode && (
            <SidebarTrigger
              className="h-8 w-8"
              title="Collapse / expand app sidebar"
            />
          )}
          <Button
            type="button"
            variant={focusMode ? "secondary" : "ghost"}
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => onFocusModeChange?.(!focusMode)}
            title={
              focusMode
                ? "Show app sidebar (exit full width)"
                : "Hide app sidebar for full-width canvas"
            }
          >
            {focusMode ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">
              {focusMode ? "Exit full width" : "Full width"}
            </span>
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 p-3 md:p-4">
        <WorkflowCanvas
          workflowId={workflow.id}
          workspaceId={workflow.workspaceId}
          name={name}
          onNameChange={setName}
          definition={workflow.definition}
          onSave={handleSave}
          onRun={handleRun}
          onPublish={handlePublish}
          saving={saving}
          running={running}
          latestRun={latestRun}
          errorRouting={errorRouting}
          workflowStatus={workflow.status}
          errorWorkflowId={workflow.errorWorkflowId ?? null}
          description={workflow.description ?? ""}
          onErrorWorkflowChange={(nextId) => {
            setWorkflow((prev) =>
              prev ? { ...prev, errorWorkflowId: nextId } : prev
            );
          }}
          onSaveWorkflowSettings={async ({ description, definition }) => {
            if (!workflow || workflow.isDeleted) return;
            setSaving(true);
            try {
              const updated = await workflowsApi.update(workflow.id, {
                name: name.trim() || workflow.name,
                description: description || null,
                definition,
              });
              setWorkflow(updated);
            } finally {
              setSaving(false);
            }
          }}
          onResumeRun={handleResumeRun}
          resuming={resuming}
          historicalView={Boolean(workflow.isDeleted)}
        />
      </div>
    </div>
  );
}
