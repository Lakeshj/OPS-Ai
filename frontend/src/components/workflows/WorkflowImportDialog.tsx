"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { workflowsApi } from "@/modules/workflows/api";

type PreviewResult = {
  ok?: boolean;
  format?: string;
  detection?: { format?: string };
  structureImportable?: boolean;
  runtimeReady?: boolean;
  commitToken?: string | null;
  fingerprint?: string;
  report?: {
    summary?: {
      converted?: Array<{ name: string; mappedType?: string }>;
      unsupported?: Array<{ name: string; reasons?: string[] }>;
      needsSetup?: Array<{ nodeName: string; reason?: string }>;
      needsReview?: Array<{ nodeName?: string; status?: string }>;
      annotations?: Array<{ name: string; status?: string }>;
      runtimeReadiness?: string;
    };
    sourceWorkflowName?: string;
    sourceNodeCount?: number;
    nodeCount?: number;
  };
  draftName?: string;
  error?: string;
  source?: unknown;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
};

export function WorkflowImportDialog({
  open,
  onOpenChange,
  workspaceId,
}: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<unknown>(null);
  const [fileName, setFileName] = useState<string>("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = useCallback(() => {
    setSource(null);
    setFileName("");
    setPreview(null);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const onFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      setSource(json);
      setFileName(file.name);
      const result = await workflowsApi.previewImport({
        workspaceId,
        workflow: json,
      });
      setPreview(result as PreviewResult);
    } catch (err) {
      setPreview(null);
      setSource(null);
      toast.error(
        err instanceof Error ? err.message : "Could not preview workflow JSON"
      );
    } finally {
      setBusy(false);
    }
  };

  const onImport = async () => {
    if (!source || !preview?.commitToken) {
      toast.error("Preview the file first");
      return;
    }
    setBusy(true);
    try {
      const result = await workflowsApi.commitImport({
        workspaceId,
        workflow: source,
        commitToken: preview.commitToken,
        name: preview.draftName,
      });
      const id = result.workflow?.id;
      toast.success("Imported as draft");
      onOpenChange(false);
      reset();
      if (id) router.push(`/workflows/${id}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Import failed"
      );
    } finally {
      setBusy(false);
    }
  };

  const formatLabel =
    preview?.detection?.format || preview?.format || "—";
  const summary = preview?.report?.summary;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[min(90vh,720px)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:rounded-lg">
        <DialogHeader className="shrink-0 space-y-1.5 border-b px-6 py-4 pr-12 text-left">
          <DialogTitle>Import workflow</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-6 py-4 text-sm">
          <p className="text-muted-foreground">
            Upload an OpsAi or n8n workflow JSON. Format is detected
            automatically. Import always creates a new inactive draft.
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            className="block w-full text-sm"
            disabled={busy}
            onChange={(e) => void onFile(e.target.files?.[0] || null)}
          />
          {fileName ? (
            <p className="text-xs text-muted-foreground">File: {fileName}</p>
          ) : null}
          {preview ? (
            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              <div>
                <span className="font-medium">Format:</span> {formatLabel}
              </div>
              <div>
                <span className="font-medium">Structure:</span>{" "}
                {preview.structureImportable ? "Importable" : "Not importable"}
              </div>
              <div>
                <span className="font-medium">Runtime readiness:</span>{" "}
                {preview.runtimeReady
                  ? "Ready"
                  : summary?.runtimeReadiness || "Not ready"}
              </div>
              {summary?.converted?.length ? (
                <div>
                  <div className="font-medium">
                    Converted ({summary.converted.length})
                  </div>
                  <ul className="list-disc pl-4 text-xs">
                    {summary.converted.map((c) => (
                      <li key={c.name}>
                        {c.name}
                        {c.mappedType ? ` → ${c.mappedType}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {summary?.needsSetup?.length ? (
                <div>
                  <div className="font-medium">
                    Needs setup ({summary.needsSetup.length})
                  </div>
                  <ul className="list-disc pl-4 text-xs">
                    {summary.needsSetup.map((c) => (
                      <li key={c.nodeName}>
                        {c.nodeName}
                        {c.reason ? `: ${c.reason}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {summary?.unsupported?.length ? (
                <div>
                  <div className="font-medium">
                    Unsupported ({summary.unsupported.length})
                  </div>
                  <ul className="list-disc pl-4 text-xs">
                    {summary.unsupported.map((u) => (
                      <li key={u.name}>
                        {u.name}
                        {u.reasons?.length
                          ? `: ${u.reasons.join(", ")}`
                          : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {summary?.needsReview?.length ? (
                <div>
                  <div className="font-medium">
                    Needs review ({summary.needsReview.length})
                  </div>
                  <ul className="list-disc pl-4 text-xs">
                    {summary.needsReview.map((r, i) => (
                      <li key={`${r.nodeName || "x"}-${i}`}>
                        {r.nodeName || "expression"} ({r.status})
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {summary?.annotations?.length ? (
                <div>
                  <div className="font-medium">
                    Annotations ({summary.annotations.length})
                  </div>
                  <ul className="list-disc pl-4 text-xs">
                    {summary.annotations.map((a) => (
                      <li key={a.name}>
                        {a.name} ({a.status})
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter className="shrink-0 border-t px-6 py-4">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || !preview?.ok || !preview.commitToken}
            onClick={() => void onImport()}
          >
            {busy ? "Working…" : "Import as Draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
