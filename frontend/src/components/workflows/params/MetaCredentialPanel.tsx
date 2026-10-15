"use client";

import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { workflowCredentialsApi } from "@/modules/workflows/api";
import { startMetaOAuthPopup } from "@/modules/workflows/metaOAuthPopup";
import type { WorkflowCredential } from "@/modules/workflows/types";

type AdAccount = {
  adAccountId: string;
  name: string;
  currency: string;
  timezoneName: string;
  accountStatus: number | null;
  accountStatusLabel: string | null;
};

type Props = {
  workspaceId?: string;
  credential?: WorkflowCredential;
  onConnected: (credentialId: string) => void;
};

export function MetaCredentialPanel({
  workspaceId,
  credential,
  onConnected,
}: Props) {
  const [connecting, setConnecting] = useState(false);
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  useEffect(() => {
    if (!credential?.id) {
      setAccounts([]);
      setSelectedId("");
      return;
    }
    let cancelled = false;
    setLoadingAccounts(true);
    workflowCredentialsApi
      .listMetaAdAccounts(credential.id)
      .then((res) => {
        if (cancelled) return;
        setAccounts(res.adAccounts || []);
        setSelectedId(res.selectedAdAccountId || credential.selectedAdAccountId || "");
      })
      .catch(() => {
        if (!cancelled) setAccounts([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingAccounts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [credential?.id, credential?.selectedAdAccountId]);

  const connect = async () => {
    if (!workspaceId) return;
    setConnecting(true);
    try {
      const result = await startMetaOAuthPopup({
        workspaceId,
        name: credential?.name || "Meta Ads",
        credentialId: credential?.id,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onConnected(result.credentialId);
      toast.success("Meta Ads connected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Meta connect failed");
    } finally {
      setConnecting(false);
    }
  };

  const chooseAccount = async (adAccountId: string) => {
    if (!credential?.id) return;
    setSelectedId(adAccountId);
    try {
      await workflowCredentialsApi.selectMetaAdAccount(credential.id, adAccountId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the ad account");
    }
  };

  const statusText = (account: AdAccount) =>
    account.accountStatusLabel ||
    (account.accountStatus == null ? "" : String(account.accountStatus));

  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="sm"
        disabled={connecting || !workspaceId}
        onClick={() => void connect()}
      >
        {connecting
          ? "Connecting…"
          : credential
            ? "Reconnect with Meta"
            : "Connect with Meta"}
      </Button>
      {credential?.metaDisplayName ? (
        <p className="text-[11px] text-muted-foreground">
          Connected as: {credential.metaDisplayName}
        </p>
      ) : null}
      {credential?.reconnectRequired ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px]">
          This Meta login expired. Reconnect before using it.
        </p>
      ) : null}
      {credential ? (
        <div>
          <Label className="text-[11px]">Accessible Ad Accounts</Label>
          <Select
            value={selectedId || "none"}
            onValueChange={(value) => {
              if (value === "none") return;
              void chooseAccount(value);
            }}
            disabled={loadingAccounts}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={
                  loadingAccounts ? "Loading accounts…" : "Select an ad account"
                }
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Select an ad account</SelectItem>
              {accounts.map((account) => (
                <SelectItem key={account.adAccountId} value={account.adAccountId}>
                  {account.name || account.adAccountId}
                  {account.currency ? ` · ${account.currency}` : ""}
                  {account.timezoneName ? ` · ${account.timezoneName}` : ""}
                  {statusText(account) ? ` · ${statusText(account)}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Connect with Meta to list the ad accounts this login can read.
        </p>
      )}
    </div>
  );
}
