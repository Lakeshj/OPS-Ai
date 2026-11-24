"use client";

import React, { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ParamDescriptor } from "@/modules/workflows/nodeContract";
import type { WorkflowNodeData } from "@/modules/workflows/types";
import { workflowCredentialsApi } from "@/modules/workflows/api";

type PageRow = {
  pageId: string;
  pageName?: string;
  category?: string;
};

type Props = {
  param: ParamDescriptor;
  values: WorkflowNodeData;
  onChange: (patch: WorkflowNodeData) => void;
};

const NONE = "__none__";

export function FacebookPagePickerField({ param, values, onChange }: Props) {
  const credentialId = String(values.credentialId || "");
  const current = String(values[param.name] || "").trim();
  const [pages, setPages] = useState<PageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!credentialId) {
      setPages([]);
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    workflowCredentialsApi
      .listFacebookPages(credentialId)
      .then((res) => {
        if (cancelled) return;
        const list = res.pages || [];
        setPages(list);
        const fallback = String(res.selectedPageId || "").trim();
        if (!current && fallback && list.some((p) => p.pageId === fallback)) {
          onChange({ ...values, [param.name]: fallback, postId: "" });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setPages([]);
        setError(err instanceof Error ? err.message : "Could not load Pages");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentialId]);

  const known = pages.some((p) => p.pageId === current);

  return (
    <div className="space-y-1.5" data-facebook-page-picker="true">
      <Label className="text-[11px]">{param.displayName}</Label>
      <Select
        value={current || NONE}
        disabled={!credentialId || loading}
        onValueChange={(value) =>
          onChange({
            ...values,
            [param.name]: value === NONE ? "" : value,
            postId: "",
          })
        }
      >
        <SelectTrigger>
          <SelectValue
            placeholder={
              loading ? "Loading Pages…" : "Select a Facebook Page"
            }
          />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>
            {credentialId
              ? "Select a Facebook Page"
              : "Connect Facebook first"}
          </SelectItem>
          {current && !known ? (
            <SelectItem value={current}>{current}</SelectItem>
          ) : null}
          {pages.map((page) => (
            <SelectItem key={page.pageId} value={page.pageId}>
              {page.pageName || page.pageId}
              {page.category ? ` · ${page.category}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <p className="text-[11px] text-destructive">{error}</p>
      ) : param.description ? (
        <p className="text-[11px] text-muted-foreground">{param.description}</p>
      ) : null}
    </div>
  );
}
