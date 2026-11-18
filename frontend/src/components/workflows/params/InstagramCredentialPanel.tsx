"use client";

import React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/modules/shared/apiClient";
import { workflowCredentialsApi } from "@/modules/workflows/api";
import { startInstagramOAuthPopup } from "@/modules/workflows/instagramOAuthPopup";
import {
  formatInstagramPlatformConfigError,
  instagramOAuthStartCredentialId,
  isInstagramPlatformConfigError,
  type InstagramConnectIntent,
} from "@/modules/workflows/instagramCredentialUx";
import { sanitizeInstagramOAuthError } from "@/modules/workflows/instagramOAuthError";
import type { WorkflowCredential } from "@/modules/workflows/types";

type Props = {
  workspaceId?: string;
  credential?: WorkflowCredential;
  /** Optional display name for a new connection (multi-client). */
  connectName?: string;
  onConnected: (credentialId: string) => void;
  /**
   * When true, OAuth creates a NEW credential (Connect / Connect other).
   * When false and credential.id is set, OAuth may reconnect that credential.
   */
  forceNew?: boolean;
};

function platformErrorMessage(
  err: unknown,
  missingConfigKeys?: string[] | null
): string {
  if (isInstagramPlatformConfigError(err)) {
    return formatInstagramPlatformConfigError(missingConfigKeys);
  }
  if (err instanceof ApiError) {
    return sanitizeInstagramOAuthError(err.message || "Instagram connect failed");
  }
  if (err instanceof Error) {
    return sanitizeInstagramOAuthError(err.message || "Instagram connect failed");
  }
  return "Instagram connect failed";
}

function resolveConnectName(
  connectName: string | undefined,
  credential: WorkflowCredential | undefined,
  intent: InstagramConnectIntent
): string {
  if (intent === "connect_other" || intent === "connect_new") {
    const named = String(connectName || "").trim();
    return named || "Instagram";
  }
  const named = String(connectName || "").trim();
  if (named) return named;
  const existing = String(credential?.name || "").trim();
  if (existing) return existing;
  return "Instagram";
}

export function InstagramCredentialPanel({
  workspaceId,
  credential,
  connectName,
  onConnected,
  forceNew = false,
}: Props) {
  const [connecting, setConnecting] = React.useState(false);
  const [platformReady, setPlatformReady] = React.useState<boolean | null>(null);
  const [missingConfigKeys, setMissingConfigKeys] = React.useState<string[]>(
    []
  );
  const [inlineError, setInlineError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    workflowCredentialsApi
      .getInstagramOAuthStatus()
      .then((status) => {
        if (cancelled) return;
        setPlatformReady(Boolean(status.instagramIntegrationConfigured));
        setMissingConfigKeys(
          Array.isArray(status.missingConfigKeys)
            ? status.missingConfigKeys.map(String)
            : []
        );
      })
      .catch(() => {
        if (!cancelled) {
          setPlatformReady(null);
          setMissingConfigKeys([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reconnectingExisting = Boolean(credential?.id) && !forceNew;
  const intent: InstagramConnectIntent =
    reconnectingExisting && credential?.reconnectRequired
      ? "reconnect"
      : reconnectingExisting
        ? "reconnect"
        : "connect_new";

  const connect = async () => {
    setInlineError(null);
    if (!workspaceId) {
      const msg = "Open this workflow in a workspace to connect Instagram.";
      setInlineError(msg);
      toast.error(msg);
      return;
    }
    setConnecting(true);
    try {
      // Always attempt OAuth-start. Do not require credentialId for new connects.
      // Do not early-return silently when platform config is missing — surface the error.
      const result = await startInstagramOAuthPopup({
        workspaceId,
        name: resolveConnectName(connectName, credential, intent),
        credentialId: instagramOAuthStartCredentialId({
          intent: forceNew ? "connect_new" : intent,
          existingCredentialId: credential?.id,
        }),
      });
      if (!result.ok) {
        const msg = sanitizeInstagramOAuthError(result.error);
        setInlineError(msg);
        toast.error(msg);
        return;
      }
      onConnected(result.credentialId);
      toast.success(
        reconnectingExisting ? "Instagram reconnected" : "Instagram connected"
      );
    } catch (err) {
      const msg = platformErrorMessage(err, missingConfigKeys);
      setInlineError(msg);
      toast.error(msg);
    } finally {
      setConnecting(false);
    }
  };

  const missing = credential?.missingPermissions || [];
  const platformBlocked = platformReady === false;
  const accountTypeLabel = String(credential?.accountType || "").trim();

  const needsReconnect = Boolean(
    reconnectingExisting &&
      (credential?.reconnectRequired || credential?.reconnectSoon)
  );
  const showConnectNew = !reconnectingExisting;
  const showReconnect = needsReconnect;
  let primaryLabel = "Connect Instagram";
  if (connecting) primaryLabel = "Connecting…";
  else if (showReconnect) primaryLabel = "Reconnect Instagram";

  return (
    <div className="space-y-2">
      {platformBlocked ? (
        <div
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-950 dark:text-amber-100"
          data-instagram-oauth-config-error="true"
        >
          <p className="font-medium">Instagram OAuth is not configured on this server.</p>
          <p className="mt-0.5 text-muted-foreground dark:text-amber-100/80">
            {missingConfigKeys.length > 0
              ? `Missing: ${missingConfigKeys.join(", ")}`
              : "Configure INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET on the server, then restart the backend."}
          </p>
        </div>
      ) : null}

      {inlineError ? (
        <div
          className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive"
          data-instagram-oauth-inline-error="true"
          role="alert"
        >
          {inlineError}
        </div>
      ) : null}

      {showConnectNew || showReconnect ? (
        <Button
          type="button"
          size="sm"
          variant={showReconnect ? "default" : "default"}
          disabled={connecting || !workspaceId}
          data-instagram-connect-intent={
            showReconnect ? "reconnect" : "connect_new"
          }
          onClick={() => void connect()}
        >
          {primaryLabel}
        </Button>
      ) : null}

      {credential?.username ? (
        <div className="space-y-0.5 text-[11px] text-muted-foreground">
          <p>
            @{credential.username}
            {accountTypeLabel ? ` · ${accountTypeLabel}` : ""}
          </p>
          {credential.reconnectRequired ? (
            <p className="text-amber-700 dark:text-amber-400">
              Reconnect required — Instagram login expired or was revoked.
            </p>
          ) : credential.reconnectSoon ? (
            <p className="text-amber-700 dark:text-amber-400">
              Instagram access expires soon. Reconnect to renew.
            </p>
          ) : credential.connected === false ? (
            <p>Not connected</p>
          ) : (
            <p>Connected</p>
          )}
          {missing.length > 0 ? (
            <p className="text-amber-700 dark:text-amber-400">
              Some Instagram permissions were not granted. Reconnect to enable
              all features.
            </p>
          ) : null}
        </div>
      ) : !platformBlocked ? (
        <p className="text-[11px] text-muted-foreground">
          Connect Instagram opens OAuth. OpsAi discovers the professional account
          automatically — no User ID or token entry.
        </p>
      ) : null}
    </div>
  );
}
