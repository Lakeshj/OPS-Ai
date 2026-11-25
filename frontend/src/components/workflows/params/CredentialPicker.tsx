"use client";

import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  WorkflowCredential,
  WorkflowCredentialType,
} from "@/modules/workflows/types";
import { CREDENTIAL_TYPE_FIELDS } from "@/modules/workflows/types";
import { workflowCredentialsApi } from "@/modules/workflows/api";
import { startGoogleOAuthPopup } from "@/modules/workflows/googleOAuthPopup";
import {
  defaultGoogleSetupMode,
  getGoogleNativeAuthPolicy,
  isHybridGoogleCredential,
  isHybridManagedPrimaryGoogle,
  isPlatformManagedOnlyGoogle,
} from "@/modules/workflows/googleNativeAuthPolicy";
import {
  GoogleCredentialModal,
  type GoogleCredentialSetupMode,
} from "./GoogleCredentialModal";
import { MetaCredentialPanel } from "./MetaCredentialPanel";
import { InstagramCredentialPanel } from "./InstagramCredentialPanel";
import { FacebookPageCredentialPanel } from "./FacebookPageCredentialPanel";
import { startInstagramOAuthPopup } from "@/modules/workflows/instagramOAuthPopup";
import { startFacebookPageOAuthPopup } from "@/modules/workflows/facebookPageOAuthPopup";
import { sanitizeInstagramOAuthError } from "@/modules/workflows/instagramOAuthError";
import {
  formatInstagramPlatformConfigError,
  isInstagramFirstConnectState,
  isInstagramPlatformConfigError,
  shouldShowInstagramCredentialDropdown,
} from "@/modules/workflows/instagramCredentialUx";
import { ApiError } from "@/modules/shared/apiClient";

type Props = {
  workspaceId?: string;
  /** When set, Gmail connections are filtered to this workflow only. */
  workflowId?: string;
  value: string;
  onChange: (credentialId: string) => void;
  label?: string;
  allowedTypes?: WorkflowCredentialType[];
};

const isGoogleType = (type: WorkflowCredentialType) =>
  Boolean(CREDENTIAL_TYPE_FIELDS[type]?.oauth);

export function CredentialPicker({
  workspaceId,
  workflowId,
  value,
  onChange,
  label = "Authentication",
  allowedTypes,
}: Props) {
  const [credentials, setCredentials] = useState<WorkflowCredential[]>([]);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [googleModalOpen, setGoogleModalOpen] = useState(false);
  const [googleRedirectUri, setGoogleRedirectUri] = useState(() => {
    if (typeof window === "undefined") {
      return "http://localhost:5013/api/google-oauth/callback";
    }
    const origin = window.location.origin.replace(/\/$/, "");
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
      return "http://localhost:5013/api/google-oauth/callback";
    }
    return `${origin}/api/google-oauth/callback`;
  });
  const [platformManagedAvailable, setPlatformManagedAvailable] = useState(true);
  const [editingCredentialId, setEditingCredentialId] = useState<
    string | undefined
  >();
  const [googleSetupMode, setGoogleSetupMode] =
    useState<GoogleCredentialSetupMode>("custom");
  const [googleAutoConnect, setGoogleAutoConnect] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const defaultType =
    allowedTypes && allowedTypes.length === 1
      ? allowedTypes[0]
      : "bearer";
  const [type, setType] = useState<WorkflowCredentialType>(defaultType);
  const [secret, setSecret] = useState<Record<string, string>>({});
  const [editingApiKey, setEditingApiKey] = useState(false);
  const [editName, setEditName] = useState("");
  const [editSecret, setEditSecret] = useState<Record<string, string>>({});

  // Keep type aligned when the picker is scoped to a single allowed type
  // (e.g. Perigon / Apify / bearer feed) — avoids stale state from remount reuse.
  useEffect(() => {
    if (allowedTypes && allowedTypes.length === 1) {
      setType(allowedTypes[0]);
    }
  }, [allowedTypes]);

  const visibleTypes = (
    Object.keys(CREDENTIAL_TYPE_FIELDS) as WorkflowCredentialType[]
  ).filter((key) => !allowedTypes || allowedTypes.includes(key));

  const googleOnly =
    Boolean(allowedTypes?.length) && allowedTypes!.every(isGoogleType);
  const metaOnly =
    Boolean(allowedTypes?.length) &&
    allowedTypes!.length === 1 &&
    allowedTypes![0] === "meta_ads";
  const instagramOnly =
    Boolean(allowedTypes?.length) &&
    allowedTypes!.length === 1 &&
    allowedTypes![0] === "instagram";
  const facebookPageOnly =
    Boolean(allowedTypes?.length) &&
    allowedTypes!.length === 1 &&
    allowedTypes![0] === "facebook_page";

  /** One Instagram credential → select it automatically (picker pattern). */
  useEffect(() => {
    if (!instagramOnly || value) return;
    const ig = credentials.filter((c) => c.type === "instagram");
    if (ig.length === 1) onChange(ig[0].id);
  }, [instagramOnly, value, credentials, onChange]);

  /** One Facebook Page credential → select it automatically. */
  useEffect(() => {
    if (!facebookPageOnly || value) return;
    const pages = credentials.filter((c) => c.type === "facebook_page");
    if (pages.length === 1) onChange(pages[0].id);
  }, [facebookPageOnly, value, credentials, onChange]);

  const googleProduct =
    googleOnly && allowedTypes!.length === 1 ? allowedTypes![0] : null;
  const nativeAuthPolicy = getGoogleNativeAuthPolicy(googleProduct);
  const gmailManagedOnly = isPlatformManagedOnlyGoogle(googleProduct);
  const hybridGoogle = isHybridGoogleCredential(googleProduct);
  const gmailManagedPrimary = isHybridManagedPrimaryGoogle(googleProduct);
  /** Gmail / Gmail Trigger: direct Google sign-in (no Custom OAuth2 Client ID UI). */
  const gmailDirectSignIn = gmailManagedOnly || gmailManagedPrimary;
  /** Show native Google connect chrome for hybrid products and managed-only Gmail. */
  const showGoogleNativeConnect = hybridGoogle || gmailManagedOnly;

  const reload = useCallback(() => {
    if (!workspaceId) return;
    workflowCredentialsApi
      .list(workspaceId)
      .then(setCredentials)
      .catch(() => setCredentials([]));
  }, [workspaceId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const listed = credentials.filter((c) => {
    if (allowedTypes && !allowedTypes.includes(c.type)) return false;
    // Gmail is per-node: never list other inboxes. Only this node's account.
    if (c.type === "google_gmail") {
      return Boolean(value) && c.id === value;
    }
    return true;
  });

  // Drop a Gmail selection that belongs to another workflow, or a failed stub.
  useEffect(() => {
    if (!value) return;
    const selectedCred = credentials.find((c) => c.id === value);
    if (!selectedCred || selectedCred.type !== "google_gmail") return;
    if (workflowId) {
      const bound = String(selectedCred.workflowId || "");
      if (bound && bound !== String(workflowId)) {
        onChange("");
        return;
      }
    }
    // Never keep a "not connected" stub on the node after a failed/aborted login.
    if (selectedCred.connected === false) {
      onChange("");
      void workflowCredentialsApi
        .remove(selectedCred.id)
        .then(reload)
        .catch(() => null);
    }
  }, [workflowId, value, credentials, onChange, reload]);

  useEffect(() => {
    if (!googleOnly) return;
    void workflowCredentialsApi
      .listConnectionTypes()
      .then((res) => {
        if (res.googleOAuthRedirectUri) {
          setGoogleRedirectUri(res.googleOAuthRedirectUri);
        }
        if (typeof res.platformManagedGoogleOAuthAvailable === "boolean") {
          setPlatformManagedAvailable(res.platformManagedGoogleOAuthAvailable);
        }
      })
      .catch(() => {
        // keep defaults
      });
  }, [googleOnly]);

  const openGoogleModal = (
    credentialId?: string,
    options?: { autoConnect?: boolean; setupMode?: GoogleCredentialSetupMode }
  ) => {
    if (!googleProduct) return;
    setEditingCredentialId(credentialId);
    setGoogleSetupMode(
      options?.setupMode || defaultGoogleSetupMode(googleProduct)
    );
    setGoogleAutoConnect(Boolean(options?.autoConnect));
    setGoogleModalOpen(true);
  };

  const googleMeta = googleProduct
    ? CREDENTIAL_TYPE_FIELDS[googleProduct]
    : null;

  /**
   * Gmail managed sign-in: always create-on-callback (nothing stored until Google
   * succeeds). Optionally replace the previous account on this node.
   * Credentials stay workspace-scoped; each Gmail node keeps its own inbox.
   */
  const connectGmailManagedDirect = async () => {
    if (!workspaceId || !googleProduct || !gmailDirectSignIn) return;
    if (!platformManagedAvailable) {
      toast.error(
        "Couldn't start Google sign-in on this server yet. Platform Google login credentials need to be configured on the server, then restart the backend."
      );
      return;
    }
    const previousId = value || "";
    setConnecting(true);
    try {
      const result = await startGoogleOAuthPopup({
        workspaceId,
        workflowId:
          googleProduct === "google_gmail" ? workflowId : undefined,
        product: googleProduct,
        name: googleMeta?.label || "Gmail",
        // Omit credentialId — nothing is stored until OAuth succeeds.
      });
      if (result.ok) {
        onChange(result.credentialId);
        if (previousId && previousId !== result.credentialId) {
          await workflowCredentialsApi.remove(previousId).catch(() => null);
        }
        reload();
        toast.success("Gmail connected");
      } else {
        // Failed / cancelled — do not keep a stub credential on this node.
        const errText = result.error || "Google connect failed";
        if (/deleted_client|oauth client was deleted/i.test(errText)) {
          toast.error(
            "Google rejected this login app (OAuth client was deleted). Create a new Google Cloud OAuth client, update the server's platform Google login credentials, then click Connect Gmail again."
          );
        } else if (/access_denied|verification|test user|blocked/i.test(errText)) {
          toast.error(errText);
          toast.message(
            "This Google account may need to be added as a Test user on the OpsAi OAuth app (Google Cloud → OAuth consent screen), or the app needs verification."
          );
        } else {
          toast.error(errText);
        }
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not start Google sign-in";
      if (/deleted_client|oauth client was deleted/i.test(msg)) {
        toast.error(
          "Google rejected this login app (OAuth client was deleted). Create a new Google Cloud OAuth client, update the server's platform Google login credentials, then click Connect Gmail again."
        );
      } else {
        toast.error(msg);
      }
    } finally {
      setConnecting(false);
    }
  };

  if (!workspaceId) return null;

  const save = async () => {
    if (isGoogleType(type) && googleProduct) {
      if (gmailDirectSignIn) {
        void connectGmailManagedDirect();
        return;
      }
      openGoogleModal(undefined, {
        setupMode: defaultGoogleSetupMode(googleProduct),
      });
      return;
    }
    setSaving(true);
    try {
      const created = await workflowCredentialsApi.create({
        workspaceId,
        name: name.trim(),
        type,
        secret,
      });
      setCredentials((prev) => [...prev, created]);
      onChange(created.id);
      setAdding(false);
      setName("");
      setSecret({});
      toast.success("Connection saved");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save the connection"
      );
    } finally {
      setSaving(false);
    }
  };

  const selected = listed.find((c) => c.id === value);
  const selectedAppMode = String(
    (selected as { oauthAppMode?: string } | undefined)?.oauthAppMode || ""
  );
  const selectedIsCustomApp =
    selectedAppMode === "CUSTOM_APP" ||
    (!selectedAppMode && nativeAuthPolicy === "HYBRID_CUSTOM_PRIMARY");
  const selectedNeedsReconnect = Boolean(
    selected &&
      (selected.connected === false || selected.reconnectRequired === true)
  );

  const disconnectSelected = () => {
    if (!selected) return;
    onChange("");
    setEditingApiKey(false);
    toast.success("Disconnected from this node (saved connection kept)");
  };

  const removeSelected = async () => {
    if (!selected) return;
    setRemoving(true);
    try {
      let usageNote = "";
      try {
        const usage = await workflowCredentialsApi.getCredentialUsage(
          selected.id
        );
        if (usage.workflowCount > 0) {
          const names = (usage.workflows || [])
            .map((w) => w.name)
            .filter(Boolean)
            .join(", ");
          usageNote =
            `\n\nUsed by ${usage.workflowCount} workflow(s)` +
            (names ? `: ${names}` : "") +
            ".";
        }
      } catch {
        // Usage lookup is best-effort; still allow confirm.
      }
      const ok = window.confirm(
        `Permanently delete saved connection "${selected.name}"?` +
          usageNote +
          "\n\nThis cannot be undone. Prefer Disconnect if you only want to clear this node."
      );
      if (!ok) return;

      try {
        await workflowCredentialsApi.remove(selected.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/still used|CREDENTIAL_IN_USE|409/i.test(msg)) {
          const forceOk = window.confirm(
            `${msg}\n\nForce delete anyway? Other workflows will lose this connection.`
          );
          if (!forceOk) return;
          await workflowCredentialsApi.remove(selected.id, { force: true });
        } else {
          throw err;
        }
      }
      if (value === selected.id) onChange("");
      setEditingApiKey(false);
      reload();
      toast.success(
        selected.type === "instagram"
          ? "Instagram disconnected from OpsAi"
          : "Connection deleted"
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not remove connection"
      );
    } finally {
      setRemoving(false);
    }
  };

  const saveApiKeyEdit = async () => {
    if (!selected) return;
    if (!editName.trim()) {
      toast.error("Connection name is required");
      return;
    }
    setSaving(true);
    try {
      const fields = CREDENTIAL_TYPE_FIELDS[selected.type]?.fields || [];
      const secretPayload: Record<string, string> = {};
      for (const field of fields) {
        const next = String(editSecret[field.key] || "").trim();
        if (next) secretPayload[field.key] = next;
      }
      await workflowCredentialsApi.update(selected.id, {
        name: editName.trim(),
        ...(Object.keys(secretPayload).length
          ? { secret: secretPayload }
          : {}),
      });
      setEditingApiKey(false);
      setEditSecret({});
      reload();
      toast.success("Connection updated");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not update connection"
      );
    } finally {
      setSaving(false);
    }
  };

  const emptySelectLabel = googleOnly
    ? "Select connected account"
    : "Select connection";
  const connectPrimary =
    googleMeta?.connectAction || "Connect Google Account";
  const connectAnother =
    googleMeta?.connectAnotherAction || "Connect another account";
  const fieldLabel =
    label ||
    (metaOnly
      ? "Meta Ads Account"
      : facebookPageOnly
        ? CREDENTIAL_TYPE_FIELDS.facebook_page.accountLabel ||
          "Facebook Page Account"
        : instagramOnly
          ? CREDENTIAL_TYPE_FIELDS.instagram.accountLabel || "Instagram Account"
          : googleMeta?.accountLabel
            ? googleMeta.accountLabel
            : googleOnly
              ? "Google Account"
              : "Authentication");
  const addHttpLabel =
    visibleTypes.length > 0 &&
    visibleTypes.every((t) => t === "api_key_header" || t === "query_param")
      ? "Add API key"
      : "Add connection";
  const instagramConnectAnother =
    CREDENTIAL_TYPE_FIELDS.instagram.connectAnotherAction ||
    "Connect another Instagram account";
  const facebookConnectAnother =
    CREDENTIAL_TYPE_FIELDS.facebook_page.connectAnotherAction ||
    "Connect Another";
  const instagramCredentialCount = listed.filter(
    (c) => c.type === "instagram"
  ).length;
  const facebookPageCredentialCount = listed.filter(
    (c) => c.type === "facebook_page"
  ).length;
  const showInstagramDropdown =
    instagramOnly &&
    shouldShowInstagramCredentialDropdown(instagramCredentialCount);
  const instagramFirstConnect =
    instagramOnly && isInstagramFirstConnectState(instagramCredentialCount);
  const facebookFirstConnect =
    facebookPageOnly && facebookPageCredentialCount === 0;

  /**
   * Connect other account — start a NEW Instagram OAuth transaction immediately.
   * Must not open the credential dropdown or require selecting an existing account.
   */
  const connectOtherInstagramAccount = async () => {
    if (!workspaceId) {
      toast.error("Open this workflow in a workspace to connect Instagram.");
      return;
    }
    const previousId = value || "";
    setConnecting(true);
    try {
      const result = await startInstagramOAuthPopup({
        workspaceId,
        name: "Instagram",
        // Never pass credentialId — additive new credential only.
      });
      if (!result.ok) {
        // Preserve the previously selected credential on cancel/error.
        if (previousId && value !== previousId) onChange(previousId);
        toast.error(sanitizeInstagramOAuthError(result.error));
        return;
      }
      reload();
      onChange(result.credentialId);
      toast.success("Instagram connected");
    } catch (err) {
      if (previousId && value !== previousId) onChange(previousId);
      let missingKeys: string[] = [];
      try {
        const status = await workflowCredentialsApi.getInstagramOAuthStatus();
        missingKeys = Array.isArray(status.missingConfigKeys)
          ? status.missingConfigKeys.map(String)
          : [];
      } catch {
        // ignore status fetch failure
      }
      const msg = isInstagramPlatformConfigError(err)
        ? formatInstagramPlatformConfigError(missingKeys)
        : err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Instagram connect failed";
      toast.error(msg);
    } finally {
      setConnecting(false);
    }
  };

  const connectOtherFacebookPageAccount = async () => {
    if (!workspaceId) {
      toast.error("Open this workflow in a workspace to connect Facebook.");
      return;
    }
    const previousId = value || "";
    setConnecting(true);
    try {
      const result = await startFacebookPageOAuthPopup({
        workspaceId,
        name: "Facebook Page",
      });
      if (!result.ok) {
        if (previousId && value !== previousId) onChange(previousId);
        toast.error(result.error);
        return;
      }
      reload();
      onChange(result.credentialId);
      toast.success("Facebook connected");
    } catch (err) {
      if (previousId && value !== previousId) onChange(previousId);
      toast.error(
        err instanceof Error ? err.message : "Facebook Page connect failed"
      );
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border p-2.5">
      <Label className="text-xs font-semibold uppercase tracking-wide">
        {fieldLabel}
      </Label>
      {/* Gmail: no shared account dropdown — only this node's inbox. */}
      {gmailDirectSignIn ? (
        <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-sm">
          {selected?.accountEmail ||
            (selected
              ? selected.name
              : "No Gmail connected on this node yet")}
        </div>
      ) : instagramFirstConnect ? (
        <p
          className="text-[11px] text-muted-foreground"
          data-instagram-credential-dropdown="hidden"
        >
          No Instagram account connected yet. Use Connect Instagram to authorize
          one — the account list appears after the first connection.
        </p>
      ) : facebookFirstConnect ? (
        <p
          className="text-[11px] text-muted-foreground"
          data-facebook-page-credential-dropdown="hidden"
        >
          No Facebook Page connected yet. Use Connect Facebook to authorize
          one — the account list appears after the first connection.
        </p>
      ) : showInstagramDropdown || !instagramOnly || facebookPageOnly ? (
        <div
          data-instagram-credential-dropdown={
            instagramOnly ? "selection-only" : "generic"
          }
        >
          <Select
            value={value || "none"}
            onValueChange={(v) => {
              // Selection-only: never starts OAuth.
              onChange(v === "none" ? "" : v);
            }}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={
                  instagramOnly
                    ? "Select an already-connected Instagram account"
                    : emptySelectLabel
                }
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                {instagramOnly
                  ? "Select an already-connected Instagram account"
                  : emptySelectLabel}
              </SelectItem>
              {listed.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.accountEmail
                    ? `${c.name} (${c.accountEmail})`
                    : c.username
                      ? `${c.name} (@${c.username})`
                      : c.connected === false
                        ? `${c.name} (not connected)`
                        : c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {googleOnly && googleProduct && showGoogleNativeConnect ? (
        <div className="space-y-2">
          {selectedNeedsReconnect ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-900 dark:text-amber-100">
              This Google account needs reconnect. Sign in again to refresh
              tokens, or delete it if you no longer need it.
            </p>
          ) : selected ? (
            <p className="text-[11px] text-muted-foreground">
              {selected.accountEmail
                ? `This node uses ${selected.accountEmail}.`
                : selectedIsCustomApp
                  ? "Connection ready. OpsAi stores tokens encrypted."
                  : "Account connected. OpsAi stores tokens encrypted."}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              {googleProduct === "google_gmail"
                ? "Sign in with Google. Nothing is stored until login succeeds. Each Gmail node keeps its own inbox — older accounts are not reused here."
                : "Connect a Google account for this node. Add another node to use a different account."}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {selected ? (
              <>
                {gmailDirectSignIn ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={connecting}
                    className="gap-2 bg-white text-gray-800 hover:bg-gray-100 dark:bg-white dark:text-gray-900"
                    onClick={() => void connectGmailManagedDirect()}
                  >
                    <GoogleMark />
                    {connecting ? "Connecting…" : "Change Gmail account"}
                  </Button>
                ) : null}
                {!gmailManagedOnly ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      openGoogleModal(selected.id, {
                        autoConnect: selectedNeedsReconnect,
                        setupMode:
                          selectedAppMode === "PLATFORM_MANAGED"
                            ? "managed"
                            : selectedAppMode === "CUSTOM_APP"
                              ? "custom"
                              : defaultGoogleSetupMode(googleProduct),
                      })
                    }
                  >
                    {selectedNeedsReconnect ? "Reconnect" : "Manage"}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={removing}
                  onClick={() => void removeSelected()}
                >
                  {removing ? "Removing…" : "Delete"}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={connecting}
                className={
                  gmailDirectSignIn
                    ? "gap-2 bg-white text-gray-800 hover:bg-gray-100 dark:bg-white dark:text-gray-900"
                    : undefined
                }
                onClick={() => {
                  if (gmailDirectSignIn) {
                    void connectGmailManagedDirect();
                    return;
                  }
                  openGoogleModal(undefined, {
                    setupMode: defaultGoogleSetupMode(googleProduct),
                  });
                }}
              >
                {gmailDirectSignIn ? <GoogleMark /> : null}
                {connecting ? "Connecting…" : connectPrimary}
              </Button>
            )}
            {listed.length > 0 && !gmailDirectSignIn ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={connecting}
                onClick={() =>
                  openGoogleModal(undefined, {
                    setupMode: defaultGoogleSetupMode(googleProduct),
                  })
                }
              >
                {connectAnother}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {!googleOnly &&
      !metaOnly &&
      !instagramOnly &&
      !facebookPageOnly &&
      !adding &&
      !editingApiKey ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setAdding(true)}
          >
            {addHttpLabel}
          </Button>
          {selected ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => disconnectSelected()}
              >
                Disconnect
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditName(selected.name || "");
                  setEditSecret({});
                  setEditingApiKey(true);
                  setAdding(false);
                }}
              >
                Edit
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={removing}
                onClick={() => void removeSelected()}
              >
                {removing ? "Deleting…" : "Delete"}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      {!googleOnly &&
      !metaOnly &&
      !instagramOnly &&
      !facebookPageOnly &&
      editingApiKey &&
      selected ? (
        <div className="space-y-2 rounded border bg-muted/30 p-2">
          <p className="text-[10px] text-muted-foreground">
            Stored secrets are never shown. Leave secret fields blank to keep
            the existing value.
          </p>
          <div>
            <Label className="text-[11px]">Name</Label>
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Connection name"
            />
          </div>
          {(CREDENTIAL_TYPE_FIELDS[selected.type]?.fields || []).map(
            (field) => (
              <div key={field.key}>
                <Label className="text-[11px]">
                  {field.label}
                  {field.secret ? " (leave blank to keep)" : ""}
                </Label>
                <Input
                  type={field.secret ? "password" : "text"}
                  value={editSecret[field.key] || ""}
                  autoComplete="new-password"
                  placeholder={field.secret ? "••••••••" : undefined}
                  onChange={(e) =>
                    setEditSecret((prev) => ({
                      ...prev,
                      [field.key]: e.target.value,
                    }))
                  }
                />
              </div>
            )
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={saving || !editName.trim()}
              onClick={() => void saveApiKeyEdit()}
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditingApiKey(false);
                setEditSecret({});
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {!googleOnly && !metaOnly && !facebookPageOnly && adding ? (
        <div className="space-y-2 rounded border bg-muted/30 p-2">
          <div>
            <Label className="text-[11px]">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Connection name"
            />
          </div>
          {visibleTypes.length > 1 ? (
            <div>
              <Label className="text-[11px]">Type</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as WorkflowCredentialType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {visibleTypes.map((key) => (
                    <SelectItem key={key} value={key}>
                      {CREDENTIAL_TYPE_FIELDS[key].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {type === "meta_ads" ? (
            <MetaCredentialPanel
              workspaceId={workspaceId}
              onConnected={(id) => {
                reload();
                onChange(id);
                setAdding(false);
              }}
            />
          ) : type === "instagram" ? (
            <InstagramCredentialPanel
              workspaceId={workspaceId}
              connectName={name.trim() || undefined}
              forceNew
              onConnected={(id) => {
                reload();
                onChange(id);
                setAdding(false);
                setName("");
              }}
            />
          ) : type === "facebook_page" ? (
            <FacebookPageCredentialPanel
              workspaceId={workspaceId}
              connectName={name.trim() || undefined}
              forceNew
              onConnected={(id) => {
                reload();
                onChange(id);
                setAdding(false);
                setName("");
              }}
            />
          ) : (
            CREDENTIAL_TYPE_FIELDS[type].fields.map((field) => (
            <div key={field.key}>
              <Label className="text-[11px]">{field.label}</Label>
              <Input
                type={field.secret ? "password" : "text"}
                value={secret[field.key] || ""}
                onChange={(e) =>
                  setSecret((prev) => ({
                    ...prev,
                    [field.key]: e.target.value,
                  }))
                }
              />
            </div>
            ))
          )}
          {type === "meta_ads" ||
          type === "instagram" ||
          type === "facebook_page" ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
          ) : (
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={saving || !name.trim()}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
          </div>
          )}
        </div>
      ) : null}

      {metaOnly ? (
        <MetaCredentialPanel
          workspaceId={workspaceId}
          credential={selected}
          onConnected={(id) => {
            reload();
            onChange(id);
          }}
        />
      ) : null}

      {!adding && (instagramOnly || selected?.type === "instagram") ? (
        <div className="space-y-2">
          <InstagramCredentialPanel
            workspaceId={workspaceId}
            credential={selected}
            forceNew={instagramFirstConnect || !selected}
            onConnected={(id) => {
              reload();
              onChange(id);
            }}
            onDisconnected={(removedId) => {
              if (value === removedId) onChange("");
              reload();
            }}
          />
          {instagramOnly && instagramCredentialCount > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={connecting}
              data-instagram-connect-other="true"
              onClick={() => void connectOtherInstagramAccount()}
            >
              {connecting ? "Connecting…" : instagramConnectAnother}
            </Button>
          ) : null}
        </div>
      ) : null}

      {!adding &&
      (facebookPageOnly || selected?.type === "facebook_page") ? (
        <div className="space-y-2">
          <FacebookPageCredentialPanel
            workspaceId={workspaceId}
            credential={selected}
            forceNew={facebookFirstConnect || !selected}
            onConnected={(id) => {
              reload();
              onChange(id);
            }}
            onDisconnected={(removedId) => {
              if (value === removedId) onChange("");
              reload();
            }}
          />
          {facebookPageOnly && facebookPageCredentialCount > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={connecting}
              data-facebook-page-connect-other="true"
              onClick={() => void connectOtherFacebookPageAccount()}
            >
              {connecting ? "Connecting…" : facebookConnectAnother}
            </Button>
          ) : null}
        </div>
      ) : null}

      {googleProduct ? (
        <GoogleCredentialModal
          open={googleModalOpen}
          onOpenChange={(next) => {
            setGoogleModalOpen(next);
            if (!next) setGoogleAutoConnect(false);
          }}
          workspaceId={workspaceId}
          workflowId={
            googleProduct === "google_gmail" ? workflowId : undefined
          }
          product={googleProduct}
          credentialId={editingCredentialId}
          initialName={googleMeta?.label}
          redirectUri={googleRedirectUri}
          initialSetupMode={
            googleSetupMode || defaultGoogleSetupMode(googleProduct)
          }
          managedOnly={gmailManagedOnly}
          platformManagedAvailable={platformManagedAvailable}
          autoConnect={googleAutoConnect}
          onSaved={(id) => {
            reload();
            onChange(id);
            setAdding(false);
            setGoogleAutoConnect(false);
          }}
          onDeleted={(id) => {
            if (value === id) onChange("");
            reload();
            setGoogleAutoConnect(false);
          }}
        />
      ) : null}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

