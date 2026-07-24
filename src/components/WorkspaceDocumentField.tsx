"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { workspaceDocumentApiService } from "@/modules/documents/api";
import { WorkspaceDocument } from "@/modules/shared/types";

interface WorkspaceDocumentFieldProps {
  workspaceId?: string;
  pendingFiles: File[];
  onPendingFilesChange: (files: File[]) => void;
  disabled?: boolean;
}

const ACCEPTED_EXTENSIONS = ".pdf,.docx,.xlsx,.pptx,.txt,.md";

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function WorkspaceDocumentField({
  workspaceId,
  pendingFiles,
  onPendingFilesChange,
  disabled = false,
}: WorkspaceDocumentFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<WorkspaceDocument[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(workspaceId));
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  useEffect(() => {
    const state: {
      cancelled: boolean;
      timer: ReturnType<typeof setInterval> | null;
    } = {
      cancelled: false,
      timer: null,
    };

    const loadDocuments = async (showSpinner = false) => {
      if (!workspaceId) {
        setDocuments([]);
        setIsLoading(false);
        return [] as WorkspaceDocument[];
      }

      if (showSpinner) setIsLoading(true);
      try {
        const items = await workspaceDocumentApiService.list(workspaceId);
        if (!state.cancelled) setDocuments(items);
        return items;
      } catch (error) {
        if (!state.cancelled && showSpinner) {
          toast.error(
            error instanceof Error ? error.message : "Failed to load documents"
          );
        }
        return [] as WorkspaceDocument[];
      } finally {
        if (!state.cancelled) setIsLoading(false);
      }
    };

    void loadDocuments(true).then((items) => {
      if (state.cancelled || !workspaceId) return;

      const shouldPoll = items.some(
        (doc) => doc.status === "uploaded" || doc.status === "converting"
      );
      if (!shouldPoll) return;

      state.timer = setInterval(() => {
        void loadDocuments(false).then((latest) => {
          const stillPending = latest.some(
            (doc) => doc.status === "uploaded" || doc.status === "converting"
          );
          if (!stillPending && state.timer) {
            clearInterval(state.timer);
            state.timer = null;
          }
        });
      }, 2500);
    });

    return () => {
      state.cancelled = true;
      if (state.timer) clearInterval(state.timer);
    };
  }, [workspaceId]);

  const addFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const next = [...pendingFiles];

    for (const file of Array.from(fileList)) {
      const duplicate = next.some(
        (item) =>
          item.name === file.name &&
          item.size === file.size &&
          item.lastModified === file.lastModified
      );
      if (!duplicate) next.push(file);
    }

    onPendingFilesChange(next);
    if (inputRef.current) inputRef.current.value = "";
  };

  const removePendingFile = (index: number) => {
    onPendingFilesChange(
      pendingFiles.filter((_, fileIndex) => fileIndex !== index)
    );
  };

  const deleteDocument = async (document: WorkspaceDocument) => {
    if (!confirm(`Delete "${document.originalName}" from static memory?`)) {
      return;
    }

    setDeletingId(document.id);
    try {
      await workspaceDocumentApiService.remove(document.id);
      setDocuments((current) =>
        current.filter((item) => item.id !== document.id)
      );
      toast.success("Document deleted");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete document"
      );
    } finally {
      setDeletingId(null);
    }
  };

  const retryDocument = async (document: WorkspaceDocument) => {
    setRetryingId(document.id);
    try {
      const result = await workspaceDocumentApiService.reconvert(document.id);
      setDocuments((current) =>
        current.map((item) =>
          item.id === document.id ? result.document : item
        )
      );
      toast.success("Document reconverted");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to reconvert document"
      );
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <section className="workspace-document-field space-y-3">
      <div>
        <p className="text-sm font-medium">Static Memory Documents</p>
        <p className="text-xs text-muted-foreground">
          PDF, DOCX, XLSX, PPTX, TXT or Markdown. Maximum 25MB per file.
        </p>
      </div>

      <input
        ref={inputRef}
        className="workspace-document-input sr-only"
        type="file"
        multiple
        accept={ACCEPTED_EXTENSIONS}
        disabled={disabled}
        onChange={(event) => addFiles(event.target.files)}
      />
      <Button
        className="workspace-document-picker w-full"
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="mr-2 h-4 w-4" />
        Select documents
      </Button>

      {isLoading && (
        <div className="workspace-document-loading flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading documents…
        </div>
      )}

      {!isLoading && documents.length > 0 && (
        <div className="workspace-document-existing space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Existing documents
          </p>
          {documents.map((document) => (
            <div
              key={document.id}
              className="workspace-document-existing-item flex items-center gap-2 rounded-md border p-2"
            >
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{document.originalName}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(document.sizeBytes)}
                  {document.errorMessage ? ` · ${document.errorMessage}` : ""}
                </p>
              </div>
              <Badge variant="outline">{document.status}</Badge>
              {document.status === "failed" && document.storageKey && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Retry ${document.originalName}`}
                  disabled={disabled || retryingId === document.id}
                  onClick={() => void retryDocument(document)}
                >
                  {retryingId === document.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              )}
              {document.status === "failed" && !document.storageKey && (
                <span className="text-xs text-muted-foreground">Re-upload</span>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Delete ${document.originalName}`}
                disabled={disabled || deletingId === document.id}
                onClick={() => void deleteDocument(document)}
              >
                {deletingId === document.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 text-destructive" />
                )}
              </Button>
            </div>
          ))}
        </div>
      )}

      {pendingFiles.length > 0 && (
        <div className="workspace-document-pending space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Upload when workspace is saved
          </p>
          {pendingFiles.map((file, index) => (
            <div
              key={`${file.name}-${file.size}-${file.lastModified}`}
              className="workspace-document-pending-item flex items-center gap-2 rounded-md border border-dashed p-2"
            >
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(file.size)}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${file.name}`}
                disabled={disabled}
                onClick={() => removePendingFile(index)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
