"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Maximize2, Minimize2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { WorkflowCanvas } from "@/components/workflows/WorkflowCanvas";
import { workflowsApi } from "@/modules/workflows/api";
import type {
  Workflow,
  WorkflowDefinition,
  WorkflowRun,
} from "@/modules/workflows/types";

type Props = {
  focusMode?: boolean;
  onFocusModeChange?: (focus: boolean) => void;
};

export default function WorkflowEditorPage({
  focusMode = false,
  onFocusModeChange,
}: Props) {
  const params = useParams();
  const workflowId = String(params.workflowId || "");
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [latestRun, setLatestRun] = useState<WorkflowRun | null>(null);

  const load = useCallback(async () => {
    if (!workflowId) return;
    setLoading(true);
    try {
      const wf = await workflowsApi.getById(workflowId);
      setWorkflow(wf);
      setName(wf.name);
      const runs = await workflowsApi.listRuns(workflowId);
      if (runs[0]) {
        const detailed = await workflowsApi.getRun(workflowId, runs[0].id);
        setLatestRun(detailed);
      }
    } catch (error) {
      console.error(error);
      toast.error("Failed to load workflow");
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async (definition: WorkflowDefinition) => {
    if (!workflow) return;
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

  const pollRun = async (runId: string) => {
    for (let i = 0; i < 40; i++) {
      const run = await workflowsApi.getRun(workflowId, runId);
      setLatestRun(run);
      if (
        run.status === "succeeded" ||
        run.status === "failed" ||
        run.status === "cancelled"
      ) {
        return run;
      }
      if (run.status === "waiting" && i === 0) {
        toast.message(
          run.resumeAt
            ? `Waiting until ${new Date(run.resumeAt).toLocaleString()}`
            : "Workflow is waiting"
        );
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    return latestRun;
  };

  const handleRun = async (input: Record<string, unknown>) => {
    if (!workflow) return;
    setRunning(true);
    try {
      const run = await workflowsApi.startRun(workflow.id, input);
      setLatestRun(run);
      toast.message("Running workflow...");
      const finalRun = await pollRun(run.id);
      if (finalRun?.status === "succeeded") toast.success("Run succeeded");
      else if (finalRun?.status === "failed")
        toast.error(finalRun.error || "Run failed");
      else toast.message("Still running… check backend logs if this hangs");
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error ? error.message : "Failed to start run";
      toast.error(message);
    } finally {
      setRunning(false);
    }
  };

  const handlePublish = async () => {
    if (!workflow) return;
    setSaving(true);
    try {
      const updated = await workflowsApi.update(workflow.id, { status: "active" });
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
    return <div className="p-6 text-sm text-muted-foreground">Loading editor...</div>;
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
          <Link href={`/projects/${workflow.workspaceId}`}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Workspace
          </Link>
        </Button>

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
          name={name}
          onNameChange={setName}
          definition={workflow.definition}
          onSave={handleSave}
          onRun={handleRun}
          saving={saving}
          running={running}
          latestRun={latestRun}
          workspaceId={workflow.workspaceId}
          workflowId={workflow.id}
          workflowStatus={workflow.status}
          onPublish={handlePublish}
        />
      </div>
    </div>
  );
}
