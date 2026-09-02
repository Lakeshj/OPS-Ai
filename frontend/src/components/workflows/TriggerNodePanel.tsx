"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Clock, Play, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { WorkflowNodeType, WorkflowStatus } from "@/modules/workflows/types";
import type { WorkflowNodeData } from "@/modules/workflows/types";

type Props = {
  nodeType: WorkflowNodeType;
  data: WorkflowNodeData;
  workflowId?: string;
  workflowStatus?: WorkflowStatus;
  runInput: string;
  onRunInputChange: (value: string) => void;
  onTestTrigger?: () => void;
  onExecuteWorkflow?: () => void;
  executing?: boolean;
};

function formatRuleSummary(data: WorkflowNodeData): string {
  const rules = data.scheduleRules || [];
  if (rules.length === 0 && data.cron) return `Cron: ${data.cron}`;
  if (rules.length === 0) return "No schedule rules configured yet";
  return `${rules.length} rule${rules.length > 1 ? "s" : ""} · timezone ${data.timezone || "UTC"}`;
}

/** Trigger chrome: test actions + publish messaging — parameters come from schema renderer. */
export function TriggerNodePanel({
  nodeType,
  data,
  workflowId,
  workflowStatus = "draft",
  runInput,
  onRunInputChange,
  onTestTrigger,
  onExecuteWorkflow,
  executing,
}: Props) {
  const isPublished = workflowStatus === "active";
  const webhookUrl = workflowId
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/api/workflows/${workflowId}/webhook`
    : "/api/workflows/{id}/webhook";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {onTestTrigger && (
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={executing}
            onClick={onTestTrigger}
          >
            <Zap className="h-3.5 w-3.5" />
            Test trigger
          </Button>
        )}
        {onExecuteWorkflow && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={executing}
            onClick={onExecuteWorkflow}
          >
            <Play className="h-3.5 w-3.5" />
            Execute workflow
          </Button>
        )}
      </div>

      {nodeType === "trigger" && (
        <>
          <div className="rounded-md border border-blue-500/25 bg-blue-500/10 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Manual trigger</span> — runs
            when you click Execute workflow or Test trigger.
          </div>
          <div>
            <Label className="text-xs">Message / run input</Label>
            <Textarea
              value={runInput}
              onChange={(e) => onRunInputChange(e.target.value)}
              rows={3}
              className="mt-1.5 bg-background text-xs"
              placeholder='e.g. "Summarize top keywords"'
            />
          </div>
        </>
      )}

      {nodeType === "schedule" && (
        <div
          className={
            isPublished
              ? "rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs"
              : "rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs"
          }
        >
          <div className="flex items-start gap-2">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              {isPublished ? (
                <p>
                  <span className="font-medium text-emerald-800 dark:text-emerald-200">
                    Published — auto-runs on schedule.
                  </span>{" "}
                  {formatRuleSummary(data)}
                </p>
              ) : (
                <p>
                  <span className="font-medium text-amber-900 dark:text-amber-100">
                    Draft — schedule will not run automatically.
                  </span>{" "}
                  Publish from the toolbar to enable timed runs.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {nodeType === "webhook" && (
        <>
          <div className="rounded-md border border-blue-500/25 bg-blue-500/10 px-3 py-2 text-xs text-muted-foreground">
            POST JSON to the URL below in production. Use Test trigger for manual
            testing.
          </div>
          <div>
            <Label className="text-xs">Webhook URL</Label>
            <Textarea
              value={webhookUrl}
              readOnly
              rows={2}
              className="mt-1.5 font-mono text-[11px]"
            />
          </div>
        </>
      )}
    </div>
  );
}
