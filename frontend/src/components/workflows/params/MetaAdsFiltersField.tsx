"use client";

import React, { useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ParamDescriptor } from "@/modules/workflows/nodeContract";
import type { WorkflowNodeData } from "@/modules/workflows/types";

type FilterKey = "campaignId" | "adSetId" | "adId" | "effectiveStatus";
type Filters = Partial<Record<FilterKey, string>>;

const REPORT_FILTERS: Record<string, { level: string; entity: string; keys: FilterKey[] }> = {
  account_performance: { level: "account", entity: "Account", keys: [] },
  campaign_performance: {
    level: "campaign",
    entity: "Campaign",
    keys: ["campaignId", "effectiveStatus"],
  },
  ad_set_performance: {
    level: "adset",
    entity: "Ad Set",
    keys: ["campaignId", "adSetId", "effectiveStatus"],
  },
  ad_performance: {
    level: "ad",
    entity: "Ad",
    keys: ["campaignId", "adSetId", "adId", "effectiveStatus"],
  },
};

const EFFECTIVE_STATUS: Record<string, string[]> = {
  campaign: ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED", "IN_PROCESS", "WITH_ISSUES"],
  adset: [
    "ACTIVE",
    "PAUSED",
    "DELETED",
    "CAMPAIGN_PAUSED",
    "ARCHIVED",
    "IN_PROCESS",
    "WITH_ISSUES",
  ],
  ad: [
    "ACTIVE",
    "PAUSED",
    "DELETED",
    "PENDING_REVIEW",
    "DISAPPROVED",
    "PREAPPROVED",
    "PENDING_BILLING_INFO",
    "CAMPAIGN_PAUSED",
    "ARCHIVED",
    "ADSET_PAUSED",
    "IN_PROCESS",
    "WITH_ISSUES",
  ],
};

const ID_LABELS: Record<Exclude<FilterKey, "effectiveStatus">, string> = {
  campaignId: "Campaign IDs",
  adSetId: "Ad Set IDs",
  adId: "Ad IDs",
};

const ANY = "__any__";

const statusLabel = (value: string) =>
  value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

function asFilters(raw: unknown): Filters {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Filters = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    out[key as FilterKey] = Array.isArray(value) ? value.join(",") : String(value ?? "");
  }
  return out;
}

type Props = {
  param: ParamDescriptor;
  values: WorkflowNodeData;
  onChange: (patch: WorkflowNodeData) => void;
};

export function MetaAdsFiltersField({ param, values, onChange }: Props) {
  const reportType = String(values.reportType || "campaign_performance");
  const report = REPORT_FILTERS[reportType] || REPORT_FILTERS.campaign_performance;
  const filters = asFilters(values[param.name]);

  useEffect(() => {
    const stale = Object.keys(filters).filter(
      (key) => !report.keys.includes(key as FilterKey)
    );
    if (!stale.length) return;
    const next: Filters = {};
    for (const key of report.keys) {
      if (filters[key]) next[key] = filters[key];
    }
    onChange({ ...values, [param.name]: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportType]);

  if (!report.keys.length) return null;

  const setKey = (key: FilterKey, value: string) => {
    const next: Filters = { ...filters };
    if (value) next[key] = value;
    else delete next[key];
    onChange({ ...values, [param.name]: next });
  };

  return (
    <div className="space-y-2">
      <Label className="text-[11px]">{param.displayName}</Label>
      {report.keys
        .filter((key): key is Exclude<FilterKey, "effectiveStatus"> => key !== "effectiveStatus")
        .map((key) => (
          <div key={key} className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">{ID_LABELS[key]}</Label>
            <Input
              value={filters[key] || ""}
              placeholder="Numeric IDs, comma separated"
              className="h-8 text-xs"
              onChange={(e) => setKey(key, e.target.value)}
            />
          </div>
        ))}
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">{report.entity} status</Label>
        <Select
          value={filters.effectiveStatus || ANY}
          onValueChange={(value) => setKey("effectiveStatus", value === ANY ? "" : value)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Any status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any status</SelectItem>
            {(EFFECTIVE_STATUS[report.level] || []).map((status) => (
              <SelectItem key={status} value={status}>
                {statusLabel(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
