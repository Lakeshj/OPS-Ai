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
import { applyInstagramMediaChange } from "@/modules/workflows/instagramDependentCascade";
import type { ExpressionFieldContext } from "../ExpressionField";

type MediaOption = {
  id: string;
  label: string;
  captionSnippet?: string;
  mediaType?: string;
  timestamp?: string;
  thumbnailUrl?: string;
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

export function InstagramMediaLocatorField({
  param,
  values,
  onChange,
  workspaceId,
  previewContext,
}: Props) {
  const credentialId = String(values.credentialId || "");
  const modeField = param.locatorModeField || `${param.name}Mode`;
  const mode = inferMode(values[param.name], String(values[modeField] || ""));
  const current = String(values[param.name] || "");
  const [options, setOptions] = useState<MediaOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!credentialId || !workspaceId || mode !== "list") {
      setOptions([]);
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    workflowCredentialsApi
      .listInstagramMediaOptions(workspaceId, credentialId)
      .then((res) => {
        if (cancelled) return;
        setOptions(res.options || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setOptions([]);
        setError(
          err instanceof Error ? err.message : "Could not load Instagram media"
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [credentialId, workspaceId, mode]);

  const setMode = (next: Mode) => {
    onChange({ ...values, [modeField]: next });
  };

  const setMediaId = (nextId: string) => {
    const patched = applyInstagramMediaChange(
      { ...values, [modeField]: mode },
      nextId
    );
    onChange(patched as WorkflowNodeData);
  };

  const known = options.some((o) => o.id === current);

  return (
    <div className="space-y-1.5" data-instagram-media-locator="true">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-[11px]">{param.displayName || "Media / Post"}</Label>
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
          disabled={!credentialId || loading}
          onValueChange={(v) => setMediaId(v === NONE ? "" : v)}
        >
          <SelectTrigger>
            <SelectValue
              placeholder={
                !credentialId
                  ? "Connect Instagram first"
                  : loading
                    ? "Loading media…"
                    : "Select a post"
              }
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Select a post</SelectItem>
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
          onChange={(v) => setMediaId(String(v || ""))}
          placeholder="{{item.id}}"
          previewContext={previewContext}
        />
      ) : (
        <Input
          value={current}
          onChange={(e) => setMediaId(e.target.value)}
          placeholder={param.placeholder || "17895695668004550"}
        />
      )}

      {error ? (
        <p className="text-[11px] text-destructive">{error}</p>
      ) : param.description ? (
        <p className="text-[11px] text-muted-foreground">{param.description}</p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Choose a post from this account. The media ID is stored automatically.
        </p>
      )}
    </div>
  );
}
