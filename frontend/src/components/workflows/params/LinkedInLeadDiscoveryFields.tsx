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
  envFeedConfigured?: boolean;
  nativeSources?: Array<{ id: string; label: string; description?: string }>;
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
  requestsUsed?: number | null;
  requestsRemaining?: number | null;
  requestLimit?: number | null;
} | null;

type UsageStatus = {
  available: boolean;
  connected?: boolean;
  reason?: string;
  code?: string;
  allowanceNote?: string;
  refreshedAt?: string;
  sharedAllowance?: boolean;
  provider?: string;
  credentialInvalid?: boolean;
  social?: {
    requestsUsed?: number;
    requestLimit?: number | null;
    since?: string | null;
    resetAt?: string | null;
  } | null;
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
  const isRequests =
    bucket.requestsUsed != null ||
    bucket.requestLimit != null ||
    (bucket.label || "").toLowerCase().includes("social");
  if (bucket.infinite) {
    return (
      <div className="space-y-1">
        <div className="text-[11px] font-medium">{title}</div>
        <p className="text-[10px] text-muted-foreground">
          {isRequests
            ? `Used ${Number(bucket.requestsUsed ?? bucket.usedUsd ?? 0)} requests — no finite limit reported.`
            : `Used $${Number(bucket.usedUsd || 0).toFixed(2)} — no finite limit reported.`}
        </p>
        {bucket.periodStart || bucket.periodEnd ? (
          <p className="text-[10px] text-muted-foreground">
            {isRequests ? "Reset" : "Period"}: {bucket.periodStart || "?"} →{" "}
            {bucket.periodEnd || "?"}
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
        {isRequests && bucket.requestsUsed != null
          ? ` · ${bucket.requestsUsed} consumed${
              bucket.requestsRemaining != null
                ? ` / ${bucket.requestsRemaining} remaining`
                : ""
            }`
          : bucket.usedUsd != null && bucket.limitUsd != null
            ? ` · $${Number(bucket.usedUsd).toFixed(2)} / $${Number(bucket.limitUsd).toFixed(2)}`
            : ""}
      </p>
      {bucket.periodStart || bucket.periodEnd ? (
        <p className="text-[10px] text-muted-foreground">
          {isRequests ? "Reset" : "Period"}: {bucket.periodStart || "?"} →{" "}
          {bucket.periodEnd || "?"}
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
  const [feedTestNote, setFeedTestNote] = useState("");
  const [feedVerifyStatus, setFeedVerifyStatus] = useState<
    | "idle"
    | "not_configured"
    | "configured_unverified"
    | "connected"
    | "connection_failed"
    | "unsupported_api"
  >("idle");
  const [feedTesting, setFeedTesting] = useState(false);
  const [perigonTestNote, setPerigonTestNote] = useState("");
  const [perigonVerifyStatus, setPerigonVerifyStatus] = useState<
    | "idle"
    | "not_configured"
    | "configured_unverified"
    | "connected"
    | "invalid_api_key"
    | "linkedin_not_enabled"
    | "quota_exhausted"
    | "connection_failed"
  >("idle");
  const [perigonTesting, setPerigonTesting] = useState(false);
  const nativeSource = String(values.nativeSource || "perigon");

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
          envFeedConfigured: Boolean(res.nativeStatus?.envFeedConfigured),
          nativeSources: res.nativeSources || [],
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
    const wantApify = dataProvider === "apify";
    const wantPerigon =
      dataProvider === "opsai_native" && nativeSource === "perigon";
    if (!wantApify && !wantPerigon) {
      setUsage(null);
      return;
    }
    const credentialId = wantPerigon
      ? String(values.perigonCredentialId || "")
      : String(values.apifyCredentialId || "");
    // No credential selected → do not call the provider (avoids empty probes).
    if (!credentialId || !workspaceId) {
      setUsage({
        available: false,
        connected: false,
        reason: wantPerigon
          ? "Select a Perigon connection to load social usage."
          : "Select an Apify connection to load usage.",
        free: null,
        paid: null,
      });
      setUsageLoading(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setUsageLoading(true);
    // Debounce mount/restore storms from React Strict Mode + autosave patches.
    timer = setTimeout(() => {
      workflowCredentialsApi
        .getLinkedInLeadDiscoveryUsage({
          provider: wantPerigon ? "perigon" : "apify",
          credentialId,
          workspaceId,
        })
        .then((res) => {
          if (cancelled) return;
          setUsage({
            available: Boolean(res.available),
            connected: res.connected,
            reason: res.reason,
            code: res.code,
            allowanceNote: res.allowanceNote,
            refreshedAt: res.refreshedAt,
            sharedAllowance: res.sharedAllowance,
            provider: res.provider,
            credentialInvalid: res.credentialInvalid,
            social: res.social || null,
            free: res.free || null,
            paid: res.paid || null,
          });
        })
        .catch((err) => {
          if (cancelled) return;
          setUsage({
            available: false,
            connected: false,
            reason:
              err instanceof Error
                ? err.message
                : "Usage status unavailable.",
            code:
              err && typeof err === "object" && "code" in err
                ? String((err as { code?: string }).code || "")
                : undefined,
            free: null,
            paid: null,
          });
        })
        .finally(() => {
          if (!cancelled) setUsageLoading(false);
        });
    }, 150);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    dataProvider,
    nativeSource,
    values.apifyCredentialId,
    values.perigonCredentialId,
    workspaceId,
  ]);

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
  const getPostSupported =
    dataProvider === "apify" ||
    (dataProvider === "opsai_native" && nativeSource !== "perigon");

  return (
    <div className="space-y-3" data-linkedin-lead-discovery-fields="true">
      {showPostDetails && !getPostSupported ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px]">
          {nativeSource === "perigon"
            ? "Get Post Details is not supported for Perigon (no documented individual-post lookup). Switch Native source or use Apify."
            : "Get Post Details is not available for the selected provider."}
        </p>
      ) : null}

      {dataProvider === "apify" ? (
        <div className="space-y-2 rounded-md border border-border/60 p-2">
          <Label className="text-[11px]">Apify connection</Label>
          <p className="text-[11px] text-muted-foreground">
            Optional provider. Uses Apify Actor{" "}
            <code className="text-[10px]">
              scrapeforge/linkedin-all-in-one
            </code>{" "}
            (no LinkedIn session cookies). OpsAi Native does not require Apify.
            Free/Paid share one Apify monthly allowance (not separate quotas).
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
                {usage?.credentialInvalid ||
                usage?.code === "LINKEDIN_LEAD_APIFY_CREDENTIAL_INVALID" ||
                usage?.code === "LINKEDIN_LEAD_APIFY_PERMISSION_DENIED" ? (
                  <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px]">
                    {usage.reason ||
                      "Apify connection is invalid. Edit or replace the API token. Your OpsAi session stays signed in."}
                  </p>
                ) : null}
                {usage?.allowanceNote ? (
                  <p className="text-[10px] text-muted-foreground">
                    {usage.allowanceNote}
                  </p>
                ) : null}
                {usage?.reason &&
                !usage.credentialInvalid &&
                usage.code !== "LINKEDIN_LEAD_APIFY_CREDENTIAL_INVALID" ? (
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
        <div className="space-y-2 rounded-md border border-border/60 p-2">
          <Label className="text-[11px]">Native data source</Label>
          <p className="text-[11px] text-muted-foreground">
            OpsAi Native is not a standalone LinkedIn scraper. Choose a
            permitted source below. Fixtures stay local/dev-only.
          </p>
          <Select
            value={nativeSource}
            onValueChange={(v) => {
              setPerigonVerifyStatus("idle");
              setPerigonTestNote("");
              setFeedVerifyStatus("idle");
              setFeedTestNote("");
              patch({ nativeSource: v });
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="perigon">
                Perigon — LinkedIn Social API
              </SelectItem>
              <SelectItem value="authorized_feed">
                Authorized Data Feed
              </SelectItem>
              <SelectItem value="user_dataset">User-provided Dataset</SelectItem>
              <SelectItem value="previous_node">Previous Node Input</SelectItem>
            </SelectContent>
          </Select>

          {nativeSource === "perigon" ? (
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground">
                Uses Perigon{" "}
                <code className="text-[10px]">
                  GET /v1/social/linkedin/posts
                </code>{" "}
                with your API key. LinkedIn Social access must be enabled on the
                Perigon organization. Endpoint is managed internally — no Feed
                URL. Confirm your Perigon license permits internal discovery /
                CRM use before production prospecting.
              </p>
              {workspaceId ? (
                <CredentialPicker
                  workspaceId={workspaceId}
                  value={String(values.perigonCredentialId || "")}
                  onChange={(id) => {
                    setPerigonVerifyStatus("configured_unverified");
                    setPerigonTestNote("");
                    patch({ perigonCredentialId: id });
                  }}
                  label="Perigon connection"
                  allowedTypes={["perigon"]}
                />
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Open this workflow in a workspace to manage Perigon
                  credentials.
                </p>
              )}
              <p className="text-[10px] text-muted-foreground">
                Status:{" "}
                {(() => {
                  const hasCred = Boolean(
                    String(values.perigonCredentialId || "").trim()
                  );
                  if (perigonVerifyStatus === "connected") return "Connected";
                  if (perigonVerifyStatus === "invalid_api_key")
                    return "Connection failed — invalid API key";
                  if (perigonVerifyStatus === "linkedin_not_enabled")
                    return "LinkedIn Social API access not enabled";
                  if (perigonVerifyStatus === "quota_exhausted")
                    return "Social request quota exhausted";
                  if (perigonVerifyStatus === "connection_failed")
                    return "Connection failed";
                  if (!hasCred) return "Not configured";
                  return "Configured — not verified";
                })()}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8"
                disabled={
                  perigonTesting ||
                  !String(values.perigonCredentialId || "").trim() ||
                  !workspaceId
                }
                onClick={() => {
                  setPerigonTesting(true);
                  setPerigonTestNote("");
                  workflowCredentialsApi
                    .testLinkedInPerigon({
                      workspaceId: workspaceId || "",
                      credentialId: String(values.perigonCredentialId || ""),
                    })
                    .then((res) => {
                      if (res.ok || res.status === "connected") {
                        setPerigonVerifyStatus("connected");
                        setPerigonTestNote(
                          `Connected — ${res.message || "OK"}`
                        );
                      } else if (res.status === "invalid_api_key") {
                        setPerigonVerifyStatus("invalid_api_key");
                        setPerigonTestNote(res.message || "Invalid API key");
                      } else if (res.status === "linkedin_not_enabled") {
                        setPerigonVerifyStatus("linkedin_not_enabled");
                        setPerigonTestNote(
                          res.message || "LinkedIn access not enabled"
                        );
                      } else if (res.status === "quota_exhausted") {
                        setPerigonVerifyStatus("quota_exhausted");
                        setPerigonTestNote(
                          res.message || "Social quota exhausted"
                        );
                      } else if (res.status === "not_configured") {
                        setPerigonVerifyStatus("not_configured");
                        setPerigonTestNote(res.message || "Not configured");
                      } else {
                        setPerigonVerifyStatus("connection_failed");
                        setPerigonTestNote(
                          `Connection failed — ${res.message || res.code || "error"}`
                        );
                      }
                      if (res.usage) {
                        setUsage((prev) => ({
                          available: Boolean(res.usage?.available),
                          connected: Boolean(res.ok),
                          reason: res.usage?.reason || prev?.reason,
                          refreshedAt:
                            res.usage?.refreshedAt || prev?.refreshedAt,
                          social: res.usage?.social || null,
                          free: prev?.free || null,
                          paid: null,
                          provider: "perigon",
                        }));
                      }
                    })
                    .catch((err) => {
                      setPerigonVerifyStatus("connection_failed");
                      setPerigonTestNote(
                        `Connection failed — ${
                          err?.message || "Unable to test Perigon"
                        }`
                      );
                    })
                    .finally(() => setPerigonTesting(false));
                }}
              >
                {perigonTesting ? "Testing… (may take up to 60s)" : "Test connection"}
              </Button>
              {perigonTestNote ? (
                <p className="text-[11px] text-muted-foreground">
                  {perigonTestNote}
                </p>
              ) : null}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-[11px]">Social usage</Label>
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
                          provider: "perigon",
                          credentialId: String(
                            values.perigonCredentialId || ""
                          ),
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
                            provider: res.provider,
                            social: res.social || null,
                            free: res.free || null,
                            paid: null,
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
                    Refresh usage
                  </Button>
                </div>
                {usageLoading ? (
                  <p className="text-[11px] text-muted-foreground">
                    Loading usage…
                  </p>
                ) : (
                  <>
                    {usage?.allowanceNote ? (
                      <p className="text-[10px] text-muted-foreground">
                        {usage.allowanceNote}
                      </p>
                    ) : null}
                    {usage?.reason && !usage.available ? (
                      <p className="text-[11px] text-muted-foreground">
                        {usage.reason}
                      </p>
                    ) : null}
                    <UsageProgressBar
                      title="Perigon social requests"
                      bucket={usage?.free || null}
                    />
                    {usage?.refreshedAt ? (
                      <p className="text-[10px] text-muted-foreground">
                        Last refreshed: {usage.refreshedAt}
                      </p>
                    ) : null}
                  </>
                )}
              </div>
              {showSearchFilters ? (
                <div className="space-y-2">
                  <div>
                    <Label className="text-[11px]">
                      Content type (optional)
                    </Label>
                    <Select
                      value={String(values.contentType || "any")}
                      onValueChange={(v) =>
                        patch({ contentType: v === "any" ? "" : v })
                      }
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any</SelectItem>
                        <SelectItem value="PHOTOS">Photos</SelectItem>
                        <SelectItem value="VIDEOS">Videos</SelectItem>
                        <SelectItem value="JOBS">Jobs</SelectItem>
                        <SelectItem value="LIVE_VIDEOS">Live videos</SelectItem>
                        <SelectItem value="DOCUMENTS">Documents</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[11px]">
                      Author title (optional)
                    </Label>
                    <Input
                      className="mt-1"
                      placeholder="e.g. CTO"
                      value={String(values.authorTitle || "")}
                      onChange={(e) =>
                        patch({ authorTitle: e.target.value })
                      }
                    />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {nativeSource === "authorized_feed" ? (
            <div className="space-y-2">
              <div>
                <Label className="text-[11px]">Feed URL</Label>
                <Input
                  className="mt-1"
                  placeholder={
                    catalog?.envFeedConfigured
                      ? "Optional override (server OPSAI_LINKEDIN_FEED_URL is set)"
                      : "https://your-authorized-feed.example.com"
                  }
                  value={String(values.nativeFeedUrl || "")}
                  onChange={(e) => {
                    setFeedVerifyStatus("idle");
                    setFeedTestNote("");
                    patch({ nativeFeedUrl: e.target.value });
                  }}
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Status:{" "}
                  {(() => {
                    const hasUrl =
                      Boolean(String(values.nativeFeedUrl || "").trim()) ||
                      Boolean(catalog?.envFeedConfigured);
                    if (feedVerifyStatus === "connected") return "Connected";
                    if (feedVerifyStatus === "unsupported_api")
                      return "Unsupported API";
                    if (feedVerifyStatus === "connection_failed")
                      return "Connection failed";
                    if (!hasUrl) return "Not configured";
                    return "Configured — not verified";
                  })()}
                  {catalog?.envFeedConfigured
                    ? " · server default available"
                    : ""}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Feed URL must be an authorized HTTP API base that implements
                  POST /search and POST /post. Do not paste linkedin.com
                  webpages, lnkd.in links, or vendor GET endpoints (for example
                  Perigon GET /v1/social/linkedin/posts) — those need a
                  dedicated adapter.
                </p>
              </div>
              {workspaceId ? (
                <CredentialPicker
                  workspaceId={workspaceId}
                  value={String(values.nativeFeedCredentialId || "")}
                  onChange={(id) => patch({ nativeFeedCredentialId: id })}
                  label="Optional feed auth (Bearer)"
                  allowedTypes={["bearer"]}
                />
              ) : null}
              <p className="text-[10px] text-muted-foreground">
                Optional Bearer token is issued by your licensed feed provider
                (or set via OPSAI_LINKEDIN_FEED_TOKEN). It is not a LinkedIn
                OAuth token and not an Apify API token.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8"
                disabled={
                  feedTesting ||
                  !(
                    String(values.nativeFeedUrl || "").trim() ||
                    catalog?.envFeedConfigured
                  )
                }
                onClick={() => {
                  setFeedTesting(true);
                  setFeedTestNote("");
                  workflowCredentialsApi
                    .testLinkedInNativeFeed({
                      feedUrl: String(values.nativeFeedUrl || "").trim(),
                      workspaceId: workspaceId || "",
                      credentialId: String(
                        values.nativeFeedCredentialId || ""
                      ),
                    })
                    .then((res) => {
                      if (res.ok || res.status === "connected") {
                        setFeedVerifyStatus("connected");
                        setFeedTestNote(
                          `Connected — ${res.message || "OK"}`
                        );
                      } else if (res.status === "unsupported_api") {
                        setFeedVerifyStatus("unsupported_api");
                        setFeedTestNote(
                          `Unsupported API — ${res.message || res.code || ""}`
                        );
                      } else if (res.status === "not_configured") {
                        setFeedVerifyStatus("not_configured");
                        setFeedTestNote(res.message || "Not configured");
                      } else {
                        setFeedVerifyStatus("connection_failed");
                        setFeedTestNote(
                          `Connection failed — ${res.message || res.code || "error"}`
                        );
                      }
                    })
                    .catch((err) => {
                      setFeedVerifyStatus("connection_failed");
                      setFeedTestNote(
                        `Connection failed — ${
                          err?.message || "Unable to test feed"
                        }`
                      );
                    })
                    .finally(() => setFeedTesting(false));
                }}
              >
                {feedTesting ? "Testing…" : "Test connection"}
              </Button>
              {feedTestNote ? (
                <p className="text-[11px] text-muted-foreground">{feedTestNote}</p>
              ) : null}
            </div>
          ) : null}

          {nativeSource === "user_dataset" ? (
            <div>
              <Label className="text-[11px]">Dataset JSON</Label>
              <textarea
                className="mt-1 min-h-[120px] w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs font-mono"
                placeholder='[{"sourcePostUrl":"https://www.linkedin.com/...","content":"..."}]'
                value={String(values.nativeDatasetJson || "")}
                onChange={(e) => patch({ nativeDatasetJson: e.target.value })}
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Preview count:{" "}
                {(() => {
                  try {
                    const parsed = JSON.parse(
                      String(values.nativeDatasetJson || "[]")
                    );
                    if (Array.isArray(parsed)) return parsed.length;
                    if (Array.isArray(parsed?.posts)) return parsed.posts.length;
                    if (Array.isArray(parsed?.items)) return parsed.items.length;
                    return parsed && typeof parsed === "object" ? 1 : 0;
                  } catch {
                    return "invalid JSON";
                  }
                })()}
              </p>
            </div>
          ) : null}

          {nativeSource === "previous_node" ? (
            <p className="text-[11px] text-muted-foreground">
              Uses LinkedIn-shaped items from the connected previous node
              (`sourcePostUrl` / `content`). No remote LinkedIn fetch.
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
            <div className="flex items-center justify-between gap-2">
              <Label className="text-[11px]">
                Additional include keywords ({(values.additionalKeywords || []).length})
              </Label>
              {(values.additionalKeywords || []).length ? (
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => patch({ additionalKeywords: [] })}
                >
                  Clear all
                </button>
              ) : null}
            </div>
            <textarea
              className="mt-1 min-h-[64px] w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
              placeholder="One keyword or phrase per line — extends the selected library"
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
          <div>
            <div className="flex items-center justify-between gap-2">
              <Label className="text-[11px]">
                Exclude keywords ({(values.excludeKeywords || []).length})
              </Label>
              {(values.excludeKeywords || []).length ? (
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => patch({ excludeKeywords: [] })}
                >
                  Clear all
                </button>
              ) : null}
            </div>
            <textarea
              className="mt-1 min-h-[64px] w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
              placeholder="One keyword or phrase per line — matching posts are removed"
              value={(values.excludeKeywords || []).join("\n")}
              onChange={(e) =>
                patch({
                  excludeKeywords: e.target.value
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
            <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="excludeMatchMode"
                  checked={(values.excludeMatchMode || "phrase") === "phrase"}
                  onChange={() => patch({ excludeMatchMode: "phrase" })}
                />
                Phrase / whole word
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="excludeMatchMode"
                  checked={values.excludeMatchMode === "contains"}
                  onChange={() => patch({ excludeMatchMode: "contains" })}
                />
                Contains text
              </label>
            </div>
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
                {dataProvider === "apify" || nativeSource !== "perigon" ? (
                  <SelectItem value="past-year">Past year</SelectItem>
                ) : null}
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
