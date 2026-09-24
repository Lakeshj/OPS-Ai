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

  const visibleTypes = (
    Object.keys(CREDENTIAL_TYPE_FIELDS) as WorkflowCredentialType[]
  ).filter((key) => !allowedTypes || allowedTypes.includes(key));

  const googleOnly =
    Boolean(allowedTypes?.length) && allowedTypes!.every(isGoogleType);
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

  const removeSelected = async () => {
    if (!selected) return;
    const ok = window.confirm(
      `Remove "${selected.name}"? Workflows using this account will need another connection.`
    );
    if (!ok) return;
    setRemoving(true);
    try {
      await workflowCredentialsApi.remove(selected.id);
      if (value === selected.id) onChange("");
      reload();
      toast.success("Google connection removed");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not remove connection"
      );
    } finally {
      setRemoving(false);
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
    (googleMeta?.accountLabel
      ? googleMeta.accountLabel
      : googleOnly
        ? "Google Account"
        : "Authentication");
  const addHttpLabel =
    visibleTypes.length > 0 &&
    visibleTypes.every((t) => t === "api_key_header" || t === "query_param")
      ? "Add API key"
      : "Add connection";

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
      ) : (
        <Select
          value={value || "none"}
          onValueChange={(v) => {
            onChange(v === "none" ? "" : v);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder={emptySelectLabel} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{emptySelectLabel}</SelectItem>
            {listed.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.accountEmail
                  ? `${c.name} (${c.accountEmail})`
                  : c.connected === false
                    ? `${c.name} (not connected)`
                    : c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {googleOnly && googleProduct && showGoogleNativeConnect ? (
        <div className="space-y-2">
          {selected && selected.connected === false ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-900 dark:text-amber-100">
              This account is not connected yet. Reconnect to authorize Google,
              or delete it if you no longer need it.
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
                        autoConnect: selected.connected === false,
                        setupMode:
                          selectedAppMode === "PLATFORM_MANAGED"
                            ? "managed"
                            : selectedAppMode === "CUSTOM_APP"
                              ? "custom"
                              : defaultGoogleSetupMode(googleProduct),
                      })
                    }
                  >
                    {selected.connected === false ? "Reconnect" : "Manage"}
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

      {!googleOnly && !adding ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setAdding(true)}
        >
          {addHttpLabel}
        </Button>
      ) : null}

      {!googleOnly && adding ? (
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
          {CREDENTIAL_TYPE_FIELDS[type].fields.map((field) => (
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
          ))}
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

