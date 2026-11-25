"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CredentialPicker } from "./CredentialPicker";
import { workflowCredentialsApi } from "@/modules/workflows/api";
import type { ParamDescriptor } from "@/modules/workflows/nodeContract";
import type { WorkflowNodeData } from "@/modules/workflows/types";

type Category = {
  id: string;
  label: string;
  keywordCount: number;
  keywords: string[];
};

type Intent = { id: string; label: string };

type Catalog = {
  categories: Category[];
  intentVariations: Intent[];
  originalKeywordCount?: number;
  nativeFeedConfigured?: boolean;
};

type UsageBucket = {
  usedPercent?: number | null;
  remainingPercent?: number | null;
  usedUsd?: number | null;
  remainingUsd?: number | null;
  limitUsd?: number | null;
  label?: string;
  reason?: string;
  available?: boolean;
  infinite?: boolean;
  periodStart?: string | null;
  periodEnd?: string | null;
} | null;

type UsageStatus = {
  available: boolean;
  connected?: boolean;
  reason?: string;
  allowanceNote?: string;
  refreshedAt?: string;
  sharedAllowance?: boolean;
  free: UsageBucket;
  paid: UsageBucket;
};

type Props = {
  param: ParamDescriptor;
  values: WorkflowNodeData;
  onChange: (patch: WorkflowNodeData) => void;
  workspaceId?: string;
};

function UsageProgressBar({
  title,
  bucket,
}: {
  title: string;
  bucket: UsageBucket;
}) {
  if (!bucket) {
    return (
      <div className="space-y-1">
        <div className="text-[11px] font-medium">{title}</div>
        <div className="h-2 w-full overflow-hidden rounded bg-muted">
          <div className="h-full w-0 bg-muted-foreground/30" />
        </div>
        <p className="text-[10px] text-muted-foreground">
          Usage unavailable (not fabricated).
        </p>
      </div>
    );
  }
  if (bucket.available === false) {
    return (
      <div className="space-y-1">
        <div className="text-[11px] font-medium">{title}</div>
        <p className="text-[10px] text-muted-foreground">
          {bucket.reason || "Not available for this account."}
        </p>
      </div>
    );
  }
  if (bucket.infinite) {
    return (
      <div className="space-y-1">
        <div className="text-[11px] font-medium">{title}</div>
        <p className="text-[10px] text-muted-foreground">
          Used ${Number(bucket.usedUsd || 0).toFixed(2)} — no finite limit
          reported.
        </p>
        {bucket.periodStart || bucket.periodEnd ? (
          <p className="text-[10px] text-muted-foreground">
            Period: {bucket.periodStart || "?"} → {bucket.periodEnd || "?"}
          </p>
        ) : null}
      </div>
    );
  }
  if (bucket.usedPercent == null || bucket.remainingPercent == null) {
    return (
      <div className="space-y-1">
        <div className="text-[11px] font-medium">{title}</div>
        <div className="h-2 w-full overflow-hidden rounded bg-muted">
          <div className="h-full w-0 bg-muted-foreground/30" />
        </div>
        <p className="text-[10px] text-muted-foreground">
          {bucket.reason || "Usage percentages unavailable (not fabricated)."}
        </p>
      </div>
    );
  }
  const used = Math.min(100, Math.max(0, Number(bucket.usedPercent)));
  const remaining = Math.min(100, Math.max(0, Number(bucket.remainingPercent)));
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium">{title}</div>
      <div className="h-2 w-full overflow-hidden rounded bg-muted">
        <div
          className="h-full bg-foreground/70"
          style={{ width: `${used}%` }}
        />
      </div>
      <p className="text-[10px] text-muted-foreground">
        {used}% used / {remaining}% remaining
        {bucket.usedUsd != null && bucket.limitUsd != null
          ? ` · $${Number(bucket.usedUsd).toFixed(2)} / $${Number(bucket.limitUsd).toFixed(2)}`
          : ""}
      </p>
      {bucket.periodStart || bucket.periodEnd ? (
        <p className="text-[10px] text-muted-foreground">
          Period: {bucket.periodStart || "?"} → {bucket.periodEnd || "?"}
        </p>
      ) : null}
    </div>
  );
}

export function LinkedInLeadDiscoveryFields({
  values,
  onChange,
  workspaceId,
}: Props) {
  const operation = String(values.operation || "discover_by_category");
  const dataProvider = String(values.dataProvider || "opsai_native");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [usage, setUsage] = useState<UsageStatus | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    workflowCredentialsApi
      .getLinkedInLeadDiscoveryCatalog()
      .then((res) => {
        if (cancelled) return;
        setCatalog({
          categories: res.library?.categories || [],
          intentVariations: res.library?.intentVariations || [],
          originalKeywordCount: res.library?.originalKeywordCount,
          nativeFeedConfigured: Boolean(res.nativeStatus?.feedConfigured),
        });
      })
      .catch(() => {
        if (!cancelled) setCatalog({ categories: [], intentVariations: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (dataProvider !== "apify") {
      setUsage(null);
      return;
    }
    let cancelled = false;
    setUsageLoading(true);
    workflowCredentialsApi
      .getLinkedInLeadDiscoveryUsage({
        provider: "apify",
        credentialId: String(values.apifyCredentialId || ""),
        workspaceId: workspaceId || "",
      })
      .then((res) => {
        if (cancelled) return;
        setUsage({
          available: Boolean(res.available),
          connected: res.connected,
          reason: res.reason,
          allowanceNote: res.allowanceNote,
          refreshedAt: res.refreshedAt,
          sharedAllowance: res.sharedAllowance,
          free: res.free || null,
          paid: res.paid || null,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setUsage({
            available: false,
            reason: "Usage status unavailable.",
            free: null,
            paid: null,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setUsageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dataProvider, values.apifyCredentialId, workspaceId]);

  const selectedCategories = useMemo(
    () =>
      Array.isArray(values.categoryIds)
        ? values.categoryIds.map(String)
        : [],
    [values.categoryIds]
  );

  const selectedIntents = useMemo(
    () =>
      Array.isArray(values.intentIds) ? values.intentIds.map(String) : [],
    [values.intentIds]
  );

  const patch = (partial: WorkflowNodeData) =>
    onChange({ ...values, ...partial });

  const toggleCategory = (id: string) => {
    const set = new Set(selectedCategories);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    patch({ categoryIds: [...set] });
  };

  const selectAllCategories = () => {
    patch({
      categoryIds: (catalog?.categories || []).map((c) => c.id),
    });
  };

  const clearCategories = () => patch({ categoryIds: [] });

  const toggleIntent = (id: string) => {
    const set = new Set(selectedIntents);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    patch({ intentIds: [...set] });
  };

  const keywordPreviewCount = useMemo(() => {
    if (!catalog) return 0;
    return catalog.categories
      .filter((c) => selectedCategories.includes(c.id))
      .reduce((sum, c) => sum + c.keywordCount, 0);
  }, [catalog, selectedCategories]);

  const showCategory = operation === "discover_by_category";
  const showCustom =
    operation === "discover_by_custom_keywords" ||
    operation === "search_posts";
  const showPostDetails = operation === "get_post_details";
  const showIntent =
    operation === "discover_by_category" ||
    operation === "discover_by_custom_keywords";
  const showSearchFilters = operation !== "get_post_details";
  const getPostSupported = dataProvider === "opsai_native" || dataProvider === "apify";

  return (
    <div className="space-y-3" data-linkedin-lead-discovery-fields="true">
      {showPostDetails && !getPostSupported ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px]">
          Get Post Details is not available for the selected provider.
        </p>
      ) : null}

      {dataProvider === "apify" ? (
        <div className="space-y-2 rounded-md border border-border/60 p-2">
          <Label className="text-[11px]">Apify connection</Label>
          <p className="text-[11px] text-muted-foreground">
            Optional provider. Uses Apify Actor{" "}
            <code className="text-[10px]">
              curious_coder/linkedin-post-search-scraper
            </code>
            . OpsAi Native does not require Apify. Free/Paid share one Apify
            monthly allowance (not separate quotas).
          </p>
          {workspaceId ? (
            <CredentialPicker
              workspaceId={workspaceId}
              value={String(values.apifyCredentialId || "")}
              onChange={(id) => patch({ apifyCredentialId: id })}
              label="Apify API token"
              allowedTypes={["apify"]}
            />
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Open this workflow in a workspace to manage Apify credentials.
            </p>
          )}
          <div>
            <Label className="text-[11px]">Billing mode</Label>
            <Select
              value={String(values.apifyBillingMode || "free")}
              onValueChange={(v) => patch({ apifyBillingMode: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="free">Free</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Free stays within included allowance and never auto-switches to
              Paid. Paid requires a paid Apify plan and uses the account limit.
            </p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-[11px]">Usage</Label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px]"
                disabled={usageLoading}
                onClick={() => {
                  setUsage(null);
                  setUsageLoading(true);
                  workflowCredentialsApi
                    .getLinkedInLeadDiscoveryUsage({
                      provider: "apify",
                      credentialId: String(values.apifyCredentialId || ""),
                      workspaceId: workspaceId || "",
                      refresh: true,
                    })
                    .then((res) =>
                      setUsage({
                        available: Boolean(res.available),
                        connected: res.connected,
                        reason: res.reason,
                        allowanceNote: res.allowanceNote,
                        refreshedAt: res.refreshedAt,
                        sharedAllowance: res.sharedAllowance,
                        free: res.free || null,
                        paid: res.paid || null,
                      })
                    )
                    .catch(() =>
                      setUsage({
                        available: false,
                        reason: "Usage status unavailable.",
                        free: null,
                        paid: null,
                      })
                    )
                    .finally(() => setUsageLoading(false));
                }}
              >
                Refresh usage status
              </Button>
            </div>
            {usageLoading ? (
              <p className="text-[11px] text-muted-foreground">Loading usage…</p>
            ) : (
              <>
                {usage?.allowanceNote ? (
                  <p className="text-[10px] text-muted-foreground">
                    {usage.allowanceNote}
                  </p>
                ) : null}
                {usage?.reason ? (
                  <p className="text-[11px] text-muted-foreground">
                    {usage.reason}
                  </p>
                ) : null}
                <UsageProgressBar title="Free" bucket={usage?.free || null} />
                <UsageProgressBar title="Paid" bucket={usage?.paid || null} />
                {usage?.refreshedAt ? (
                  <p className="text-[10px] text-muted-foreground">
                    Last refreshed: {usage.refreshedAt}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-1 rounded-md border border-border/60 p-2">
          <p className="text-[11px] text-muted-foreground">
            OpsAi Native is the primary provider. Live collection uses an
            authorized OpsAi opportunity feed (
            <code className="text-[10px]">OPSAI_LINKEDIN_FEED_URL</code>) or a
            user-provided LinkedIn dataset. Fixtures are development-only and
            never return silently in production.
          </p>
          {catalog?.nativeFeedConfigured === true ? (
            <p className="text-[11px] text-foreground">
              Authorized feed: configured
            </p>
          ) : catalog?.nativeFeedConfigured === false ? (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              Authorized feed: not configured — Run Step needs feed URL, user
              dataset, or local fixtures env.
            </p>
          ) : null}
        </div>
      )}

      {showCategory ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-[11px]">
              Service categories
              {keywordPreviewCount
                ? ` · ${keywordPreviewCount} keywords selected`
                : ""}
            </Label>
            <div className="flex gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px]"
                onClick={selectAllCategories}
              >
                Select All
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px]"
                onClick={clearCategories}
              >
                Clear All
              </Button>
            </div>
          </div>
          <ul className="max-h-56 space-y-1 overflow-auto rounded-md border border-border/60 p-2">
            {(catalog?.categories || []).map((cat) => {
              const checked = selectedCategories.includes(cat.id);
              const open = Boolean(expanded[cat.id]);
              return (
                <li key={cat.id} className="rounded border border-transparent px-1 py-1 hover:border-border/50">
                  <label className="flex cursor-pointer items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={checked}
                      onChange={() => toggleCategory(cat.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{cat.label}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        ({cat.keywordCount})
                      </span>
                    </span>
                    <button
                      type="button"
                      className="text-[10px] text-muted-foreground underline-offset-2 hover:underline"
                      onClick={(e) => {
                        e.preventDefault();
                        setExpanded((prev) => ({
                          ...prev,
                          [cat.id]: !prev[cat.id],
                        }));
                      }}
                    >
                      {open ? "Hide" : "Preview"}
                    </button>
                  </label>
                  {open ? (
                    <ul className="mt-1 space-y-0.5 pl-6 text-[10px] text-muted-foreground">
                      {cat.keywords.map((kw) => (
                        <li key={kw}>{kw}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div>
            <Label className="text-[11px]">Additional custom keywords</Label>
            <textarea
              className="mt-1 min-h-[64px] w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
              placeholder="One keyword per line"
              value={(values.additionalKeywords || []).join("\n")}
              onChange={(e) =>
                patch({
                  additionalKeywords: e.target.value
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </div>
        </div>
      ) : null}

      {showCustom ? (
        <div>
          <Label className="text-[11px]">
            {operation === "search_posts" ? "Search keywords" : "Custom keywords"}
          </Label>
          <textarea
            className="mt-1 min-h-[88px] w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
            placeholder="One keyword per line"
            value={(values.customKeywords || values.searchKeywords || []).join(
              "\n"
            )}
            onChange={(e) => {
              const list = e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean);
              patch({ customKeywords: list, searchKeywords: list });
            }}
          />
        </div>
      ) : null}

      {showIntent ? (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={values.intentExpansion === true}
              onChange={(e) =>
                patch({
                  intentExpansion: e.target.checked,
                  intentIds: e.target.checked
                    ? selectedIntents.length
                      ? selectedIntents
                      : (catalog?.intentVariations || []).map((i) => i.id)
                    : [],
                })
              }
            />
            Enable search intent expansion (15 variations)
          </label>
          {values.intentExpansion ? (
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {(catalog?.intentVariations || []).map((intent) => (
                <label key={intent.id} className="flex items-center gap-2 text-[11px]">
                  <input
                    type="checkbox"
                    checked={selectedIntents.includes(intent.id)}
                    onChange={() => toggleIntent(intent.id)}
                  />
                  {intent.label}
                </label>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {showPostDetails ? (
        <div>
          <Label className="text-[11px]">Post URL</Label>
          <Input
            className="mt-1"
            value={String(values.postUrl || "")}
            placeholder="https://www.linkedin.com/feed/update/..."
            onChange={(e) => patch({ postUrl: e.target.value })}
          />
        </div>
      ) : null}

      {showSearchFilters ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div>
            <Label className="text-[11px]">Publication period</Label>
            <Select
              value={String(values.publicationPeriod || "past-week")}
              onValueChange={(v) => patch({ publicationPeriod: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="past-24h">Past 24 hours</SelectItem>
                <SelectItem value="past-week">Past week</SelectItem>
                <SelectItem value="past-month">Past month</SelectItem>
                <SelectItem value="past-year">Past year</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px]">Sort</Label>
            <Select
              value={String(values.sortBy || "recent")}
              onValueChange={(v) => patch({ sortBy: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Most recent</SelectItem>
                <SelectItem value="relevant">Most relevant</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px]">Max results</Label>
            <Input
              type="number"
              min={1}
              max={100}
              value={Number(values.maxResults || 25)}
              onChange={(e) =>
                patch({ maxResults: Number(e.target.value) || 25 })
              }
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
