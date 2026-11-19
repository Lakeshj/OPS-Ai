"use client";

import React, { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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

type CommentOption = {
  id: string;
  label: string;
  username?: string;
  text?: string;
  timestamp?: string;
};

type Props = {
  param: ParamDescriptor;
  values: WorkflowNodeData;
  onChange: (patch: WorkflowNodeData) => void;
  workspaceId?: string;
  previewContext?: ExpressionFieldContext;
};

type Mode = "list" | "id" | "expression";

const NONE = "__none__";

function inferMode(raw: unknown, stored?: string): Mode {
  if (stored === "list" || stored === "id" || stored === "expression") {
    return stored;
  }
  const v = String(raw ?? "").trim();
  if (!v) return "list";
  if (v.includes("{{") || v.startsWith("=")) return "expression";
  return "list";
}

export function InstagramCommentLocatorField({
  param,
  values,
  onChange,
  workspaceId,
  previewContext,
}: Props) {
  const credentialId = String(values.credentialId || "");
  const mediaId = String(values.mediaId || "");
  const modeField = param.locatorModeField || `${param.name}Mode`;
  const mode = inferMode(values[param.name], String(values[modeField] || ""));
  const current = String(values[param.name] || "");
  const [options, setOptions] = useState<CommentOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!credentialId || !workspaceId || !mediaId || mode !== "list") {
      setOptions([]);
      setError("");
      return;
    }
    if (mediaId.includes("{{") || mediaId.startsWith("=")) {
      setOptions([]);
      setError("Resolve Media / Post first, or use By ID / Expression.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    workflowCredentialsApi
      .listInstagramCommentOptions(workspaceId, credentialId, mediaId)
      .then((res) => {
        if (cancelled) return;
        setOptions(res.options || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setOptions([]);
        setError(
          err instanceof Error ? err.message : "Could not load comments"
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [credentialId, workspaceId, mediaId, mode]);

  const setMode = (next: Mode) => {
    onChange({ ...values, [modeField]: next });
  };

  const setCommentId = (nextId: string) => {
    onChange({ ...values, [param.name]: nextId, [modeField]: mode });
  };

  const known = options.some((o) => o.id === current);

  return (
    <div className="space-y-1.5" data-instagram-comment-locator="true">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-[11px]">{param.displayName || "Comment"}</Label>
        <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <SelectTrigger className="h-7 w-[140px] text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="list">From list</SelectItem>
            <SelectItem value="id">By ID</SelectItem>
            <SelectItem value="expression">Expression</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode === "list" ? (
        <Select
          value={current || NONE}
          disabled={!credentialId || !mediaId || loading}
          onValueChange={(v) => setCommentId(v === NONE ? "" : v)}
        >
          <SelectTrigger>
            <SelectValue
              placeholder={
                !mediaId
                  ? "Select a post first"
                  : loading
                    ? "Loading comments…"
                    : "Select a comment"
              }
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Select a comment</SelectItem>
            {current && !known ? (
              <SelectItem value={current}>{current}</SelectItem>
            ) : null}
            {options.map((opt) => (
              <SelectItem key={opt.id} value={opt.id}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : mode === "expression" ? (
        <ExpressionField
          value={current}
          onChange={(v) => setCommentId(String(v || ""))}
          placeholder="{{item.id}}"
          previewContext={previewContext}
        />
      ) : (
        <Input
          value={current}
          onChange={(e) => setCommentId(e.target.value)}
          placeholder={param.placeholder || "17850000000000000"}
        />
      )}

      {error ? (
        <p className="text-[11px] text-destructive">{error}</p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Pick a comment by author and text. The comment ID is stored
          automatically.
        </p>
      )}
    </div>
  );
}
