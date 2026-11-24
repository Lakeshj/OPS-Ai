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
import { startFacebookPageOAuthPopup } from "@/modules/workflows/facebookPageOAuthPopup";
import type { WorkflowCredential } from "@/modules/workflows/types";

type PageRow = {
  pageId: string;
  pageName?: string;
  category?: string;
  username?: string;
};

type Props = {
  workspaceId?: string;
  credential?: WorkflowCredential;
  connectName?: string;
  forceNew?: boolean;
  onConnected: (credentialId: string) => void;
  onDisconnected?: (credentialId: string) => void;
};

export function FacebookPageCredentialPanel({
  workspaceId,
  credential,
  connectName,
  forceNew = false,
  onConnected,
  onDisconnected,
}: Props) {
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loadingPages, setLoadingPages] = useState(false);
  const [platformReady, setPlatformReady] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    workflowCredentialsApi
      .getFacebookPageOAuthStatus()
      .then((status) => {
        if (!cancelled) {
          setPlatformReady(Boolean(status.facebookPageIntegrationConfigured));
        }
      })
      .catch(() => {
        if (!cancelled) setPlatformReady(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!credential?.id) {
      setPages([]);
      setSelectedId("");
      return;
    }
    let cancelled = false;
    setLoadingPages(true);
    workflowCredentialsApi
      .listFacebookPages(credential.id)
      .then((res) => {
        if (cancelled) return;
        setPages(res.pages || []);
        setSelectedId(
          res.selectedPageId || credential.selectedPageId || ""
        );
      })
      .catch(() => {
        if (!cancelled) setPages([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingPages(false);
      });
    return () => {
      cancelled = true;
    };
  }, [credential?.id, credential?.selectedPageId]);

  const connect = async () => {
    if (!workspaceId) {
      toast.error("Open this workflow in a workspace to connect Facebook.");
      return;
    }
    setConnecting(true);
    try {
      const result = await startFacebookPageOAuthPopup({
        workspaceId,
        name: connectName || credential?.name || "Facebook Page",
        credentialId: forceNew ? undefined : credential?.id,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onConnected(result.credentialId);
      toast.success(
        credential && !forceNew ? "Facebook reconnected" : "Facebook connected"
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Facebook Page connect failed"
      );
    } finally {
      setConnecting(false);
    }
  };

  const choosePage = async (pageId: string) => {
    if (!credential?.id) return;
    setSelectedId(pageId);
    try {
      await workflowCredentialsApi.selectFacebookPage(credential.id, pageId);
      toast.success("Facebook Page selected");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save the Page"
      );
    }
  };

  const disconnect = async () => {
    if (!credential?.id) return;
    setDisconnecting(true);
    try {
      await workflowCredentialsApi.remove(credential.id);
      onDisconnected?.(credential.id);
      toast.success("Facebook Page disconnected");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not disconnect Facebook"
      );
    } finally {
      setDisconnecting(false);
    }
  };

  const reconnecting = Boolean(credential?.id) && !forceNew;
  let primaryLabel = "Connect Facebook";
  if (connecting) primaryLabel = "Connecting…";
  else if (reconnecting && credential?.reconnectRequired) {
    primaryLabel = "Reconnect Facebook";
  } else if (reconnecting) {
    primaryLabel = "Reconnect Facebook";
  }

  return (
    <div className="space-y-2" data-facebook-page-credential-panel="true">
      <Button
        type="button"
        size="sm"
        disabled={connecting || !workspaceId || platformReady === false}
        onClick={() => void connect()}
      >
        {primaryLabel}
      </Button>
      {platformReady === false ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px]">
          Facebook Page is not configured on the server. Set FACEBOOK_PAGE_APP_ID
          / SECRET (or META_APP_* fallback).
        </p>
      ) : null}
      {credential?.metaDisplayName ? (
        <p className="text-[11px] text-muted-foreground">
          Connected as: {credential.metaDisplayName}
        </p>
      ) : null}
      {credential?.reconnectRequired ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px]">
          This Facebook login expired. Reconnect before using it.
        </p>
      ) : null}
      {credential ? (
        <div>
          <Label className="text-[11px]">Select Page</Label>
          <Select
            value={selectedId || "none"}
            onValueChange={(value) => {
              if (value === "none") return;
              void choosePage(value);
            }}
            disabled={loadingPages}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={
                  loadingPages ? "Loading Pages…" : "Select a Facebook Page"
                }
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Select a Facebook Page</SelectItem>
              {pages.map((page) => (
                <SelectItem key={page.pageId} value={page.pageId}>
                  {page.pageName || page.pageId}
                  {page.category ? ` · ${page.category}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Connect Facebook to discover Pages this login can manage.
        </p>
      )}
      {credential?.id && !forceNew ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disconnecting}
          onClick={() => void disconnect()}
        >
          {disconnecting ? "Disconnecting…" : "Disconnect"}
        </Button>
      ) : null}
    </div>
  );
}
