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

type PostRow = {
  postId: string;
  label: string;
  createdTime?: string | null;
};

type Props = {
  param: ParamDescriptor;
  values: WorkflowNodeData;
  onChange: (patch: WorkflowNodeData) => void;
};

const NONE = "__none__";

export function FacebookPagePostPickerField({
  param,
  values,
  onChange,
}: Props) {
  const credentialId = String(values.credentialId || "");
  const pageId = String(values.pageId || "").trim();
  const current = String(values[param.name] || "").trim();
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!credentialId || !pageId) {
      setPosts([]);
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    workflowCredentialsApi
      .listFacebookPagePostOptions(credentialId, pageId, 10)
      .then((res) => {
        if (cancelled) return;
        setPosts(res.posts || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setPosts([]);
        setError(err instanceof Error ? err.message : "Could not load posts");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [credentialId, pageId]);

  const known = posts.some((p) => p.postId === current);

  return (
    <div className="space-y-1.5" data-facebook-page-post-picker="true">
      <Label className="text-[11px]">{param.displayName}</Label>
      <Select
        value={current || NONE}
        disabled={!credentialId || !pageId || loading}
        onValueChange={(value) =>
          onChange({ ...values, [param.name]: value === NONE ? "" : value })
        }
      >
        <SelectTrigger>
          <SelectValue
            placeholder={
              !pageId
                ? "Select a Page first"
                : loading
                  ? "Loading recent posts…"
                  : "Select a recent post"
            }
          />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>
            {!pageId ? "Select a Page first" : "Select a recent post"}
          </SelectItem>
          {current && !known ? (
            <SelectItem value={current}>{current}</SelectItem>
          ) : null}
          {posts.map((post) => (
            <SelectItem key={post.postId} value={post.postId}>
              {post.label}
              {post.createdTime ? ` · ${post.createdTime}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <p className="text-[11px] text-destructive">{error}</p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Recent published posts only (bounded lookup).
        </p>
      )}
    </div>
  );
}
