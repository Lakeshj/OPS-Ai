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

type AdAccount = {
  adAccountId: string;
  name: string;
  currency: string;
  timezoneName: string;
};

type Props = {
  param: ParamDescriptor;
  values: WorkflowNodeData;
  onChange: (patch: WorkflowNodeData) => void;
};

const NONE = "__none__";

const numericId = (raw: unknown) => String(raw ?? "").trim().replace(/^act_/i, "");

export function MetaAdAccountField({ param, values, onChange }: Props) {
  const credentialId = String(values.credentialId || "");
  const current = numericId(values[param.name]);
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!credentialId) {
      setAccounts([]);
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    workflowCredentialsApi
      .listMetaAdAccounts(credentialId)
      .then((res) => {
        if (cancelled) return;
        const list = res.adAccounts || [];
        setAccounts(list);
        const fallback = numericId(res.selectedAdAccountId);
        if (!current && fallback && list.some((a) => a.adAccountId === fallback)) {
          onChange({ ...values, [param.name]: fallback });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setAccounts([]);
        setError(err instanceof Error ? err.message : "Could not load ad accounts");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentialId]);

  const known = accounts.some((a) => a.adAccountId === current);

  return (
    <div className="space-y-1.5">
      <Label className="text-[11px]">{param.displayName}</Label>
      <Select
        value={current || NONE}
        disabled={!credentialId || loading}
        onValueChange={(value) =>
          onChange({ ...values, [param.name]: value === NONE ? "" : value })
        }
      >
        <SelectTrigger>
          <SelectValue
            placeholder={loading ? "Loading ad accounts…" : "Select an ad account"}
          />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>
            {credentialId ? "Select an ad account" : "Choose a Meta Ads Account first"}
          </SelectItem>
          {current && !known ? (
            <SelectItem value={current}>{current}</SelectItem>
          ) : null}
          {accounts.map((account) => (
            <SelectItem key={account.adAccountId} value={account.adAccountId}>
              {account.name || account.adAccountId}
              {account.currency ? ` · ${account.currency}` : ""}
              {account.timezoneName ? ` · ${account.timezoneName}` : ""}
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
