"use client";

import React, { useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ExpressionField } from "../ExpressionField";
import type { ParamDescriptor } from "@/modules/workflows/nodeContract";
import type { WorkflowNodeData } from "@/modules/workflows/types";
import { workflowCredentialsApi } from "@/modules/workflows/api";
import type { ExpressionFieldContext } from "../ExpressionField";

type Props = {
  param: ParamDescriptor;
  values: WorkflowNodeData;
  onChange: (patch: WorkflowNodeData) => void;
  workspaceId?: string;
  previewContext?: ExpressionFieldContext;
};

type SourceMode = "upload" | "previous" | "url";

function inferSource(raw: unknown, stored?: string): SourceMode {
  if (stored === "upload" || stored === "previous" || stored === "url") {
    return stored;
  }
  const v = String(raw ?? "").trim();
  if (!v) return "upload";
  if (v.includes("{{") || v.startsWith("=")) return "previous";
  if (/^https:\/\//i.test(v)) return "url";
  return "upload";
}

export function InstagramPublishMediaField({
  param,
  values,
  onChange,
  workspaceId,
  previewContext,
}: Props) {
  const modeField = param.locatorModeField || `${param.name}Mode`;
  const mode = inferSource(values[param.name], String(values[modeField] || ""));
  const current = String(values[param.name] || "");
  const storyType = String(values.storyMediaType || "IMAGE").toUpperCase();
  const mediaKind: "image" | "video" =
    param.locatorKind === "video" ||
    (param.locatorKind === "story" && storyType === "VIDEO")
      ? "video"
      : "image";
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const setMode = (next: SourceMode) => {
    onChange({ ...values, [modeField]: next });
  };

  const setUrl = (next: string) => {
    onChange({ ...values, [param.name]: next, [modeField]: mode });
  };

  const onUpload = async (file: File | null) => {
    if (!file) return;
    if (!workspaceId) {
      setError("Open this workflow in a workspace to upload media.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const staged = await workflowCredentialsApi.stageInstagramPublishMedia({
        workspaceId,
        file,
        kind: mediaKind,
      });
      onChange({
        ...values,
        [param.name]: staged.url,
        [modeField]: "upload",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const label =
    param.displayName ||
    (mediaKind === "video" ? "Video" : "Image");

  return (
    <div className="space-y-1.5" data-instagram-publish-media="true">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-[11px]">{label}</Label>
        <Select value={mode} onValueChange={(v) => setMode(v as SourceMode)}>
          <SelectTrigger className="h-7 w-[160px] text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="upload">Upload file</SelectItem>
            <SelectItem value="previous">From previous node</SelectItem>
            <SelectItem value="url">URL (advanced)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode === "upload" ? (
        <div className="space-y-1.5">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept={
              mediaKind === "video"
                ? "video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
                : "image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
            }
            onChange={(e) => void onUpload(e.target.files?.[0] || null)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={uploading || !workspaceId}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? "Uploading…" : `Choose ${mediaKind} file`}
          </Button>
          {current ? (
            <p className="truncate text-[11px] text-muted-foreground">
              Ready for Instagram
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              OpsAi stages the file securely. Instagram fetches it over HTTPS.
            </p>
          )}
        </div>
      ) : mode === "previous" ? (
        <ExpressionField
          value={current}
          onChange={(v) => setUrl(String(v || ""))}
          placeholder="{{item.mediaUrl}}"
          previewContext={previewContext}
        />
      ) : (
        <Input
          value={current}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={
            param.placeholder ||
            (mediaKind === "video"
              ? "https://cdn.example.com/video.mp4"
              : "https://cdn.example.com/image.jpg")
          }
        />
      )}

      {error ? (
        <p className="text-[11px] text-destructive">{error}</p>
      ) : mode === "url" ? (
        <p className="text-[11px] text-muted-foreground">
          Advanced: HTTPS URL Instagram can fetch directly.
        </p>
      ) : null}
    </div>
  );
}
