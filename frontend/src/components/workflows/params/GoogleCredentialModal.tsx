"use client";

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CREDENTIAL_TYPE_FIELDS,
  type WorkflowCredentialType,
} from "@/modules/workflows/types";
import { workflowCredentialsApi } from "@/modules/workflows/api";
import {
  acceptGoogleOAuthPostMessage,
  resolveOAuthMessageAllowedOrigins,
} from "@/modules/workflows/googleOAuthMessage";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  product: WorkflowCredentialType;
  credentialId?: string;
  initialName?: string;
  redirectUri: string;
  onSaved: (credentialId: string) => void;
  onDeleted?: (credentialId: string) => void;
};

type FormState = {
  name: string;
  clientId: string;
  clientSecret: string;
  allowedDomainsText: string;
  customScopes: string;
};

export function GoogleCredentialModal({
  open,
  onOpenChange,
  workspaceId,
  product,
  credentialId,
  initialName,
  redirectUri,
  onSaved,
  onDeleted,
}: Props) {
  const meta = CREDENTIAL_TYPE_FIELDS[product];
  const title = meta?.accountLabel || meta?.label || "Google account";
  const [tab, setTab] = useState("connection");
  const [form, setForm] = useState<FormState>({
    name: initialName || meta?.label || "Google",
    clientId: "",
    clientSecret: "",
    allowedDomainsText: "",
    customScopes: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{
    kind: "error" | "warning" | "success";
    text: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeId, setActiveId] = useState(credentialId || "");
  const [connected, setConnected] = useState(false);
  const [hasClientSecret, setHasClientSecret] = useState(false);
  const [details, setDetails] = useState<{
    createdAt?: string;
    updatedAt?: string;
    type?: string;
    oauthAppMode?: string;
  }>({});

  useEffect(() => {
    if (!open) return;
    setTab("connection");
    setErrors({});
    setBanner(null);
    setActiveId(credentialId || "");
    setForm({
      name: initialName || meta?.label || "Google",
      clientId: "",
      clientSecret: "",
      allowedDomainsText: "",
      customScopes: "",
    });
    setHasClientSecret(false);
    if (!credentialId) {
      setConnected(false);
      setDetails({});
      void workflowCredentialsApi.listConnectionTypes().then((res) => {
        const entry = res.predefined.find((p) => p.id === product) as
          | {
              allowedDomains?: string[];
              defaultScopes?: string[];
            }
          | undefined;
        if (entry?.allowedDomains?.length) {
          setForm((prev) => ({
            ...prev,
            allowedDomainsText: entry.allowedDomains!.join("\n"),
          }));
        }
      });
      return;
    }
    void workflowCredentialsApi
      .editorView(credentialId)
      .then((view) => {
        const ed = (view.editor || {}) as Record<string, unknown>;
        setConnected(Boolean(view.connected || ed.connected));
        setHasClientSecret(Boolean(ed.hasClientSecret));
        setDetails({
          createdAt: String(view.createdAt || ""),
          updatedAt: String(view.updatedAt || ""),
          type: view.type,
          oauthAppMode: String(ed.oauthAppMode || ""),
        });
        setForm({
          name: view.name || meta?.label || "Google",
          clientId: String(ed.clientId || ""),
          clientSecret: "",
          allowedDomainsText: Array.isArray(ed.allowedDomains)
            ? (ed.allowedDomains as string[]).join("\n")
            : "",
          customScopes: String(ed.customScopes || ""),
        });
        if (!view.connected && !ed.connected) {
          setBanner({
            kind: "warning",
            text: "Connect your account to use this credential",
          });
        }
      })
      .catch(() => {
        setBanner({ kind: "error", text: "Please check the errors below" });
      });
  }, [open, credentialId, initialName, meta?.label, product]);

  const domains = useMemo(
    () =>
      form.allowedDomainsText
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    [form.allowedDomainsText]
  );

  const validate = () => {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = "This field is required";
    if (!form.clientId.trim()) next.clientId = "This field is required";
    if (!activeId && !form.clientSecret.trim()) {
      next.clientSecret = "This field is required";
    }
    if (activeId && !hasClientSecret && !form.clientSecret.trim()) {
      next.clientSecret = "This field is required";
    }
    setErrors(next);
    if (Object.keys(next).length) {
      setBanner({ kind: "error", text: "Please check the errors below" });
      return false;
    }
    return true;
  };

  const saveConnection = async () => {
    if (!validate()) return null;
    setSaving(true);
    try {
      if (activeId) {
        await workflowCredentialsApi.update(activeId, {
          name: form.name.trim(),
          secret: form.clientSecret.trim()
            ? { clientSecret: form.clientSecret.trim() }
            : undefined,
          config: {
            oauthAppMode: "CUSTOM_APP",
            clientId: form.clientId.trim(),
            allowedDomains: domains,
            customScopes: form.customScopes.trim() || undefined,
          },
        });
        if (form.clientSecret.trim()) setHasClientSecret(true);
        setBanner({
          kind: "success",
          text: connected
            ? "Account connected"
            : "Connection saved — connect your account to use it",
        });
        onSaved(activeId);
        return activeId;
      }
      const created = await workflowCredentialsApi.create({
        workspaceId,
        name: form.name.trim(),
        type: product,
        secret: { clientSecret: form.clientSecret.trim() },
        config: {
          oauthAppMode: "CUSTOM_APP",
          clientId: form.clientId.trim(),
          allowedDomains: domains,
          customScopes: form.customScopes.trim() || undefined,
        },
      });
      setActiveId(created.id);
      setHasClientSecret(true);
      setConnected(false);
      setBanner({
        kind: "warning",
        text: "Connect your account to use this credential",
      });
      onSaved(created.id);
      return created.id;
    } catch (err) {
      setBanner({
        kind: "error",
        text:
          err instanceof Error ? err.message : "Please check the errors below",
      });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const connectAccount = async () => {
    let id = activeId;
    if (!id || form.clientSecret.trim() || !hasClientSecret) {
      id = (await saveConnection()) || "";
    } else if (!validate()) {
      return;
    }
    if (!id) return;
    setConnecting(true);
    try {
      const { url, callbackOrigin } =
        await workflowCredentialsApi.startGoogleOAuth({
          workspaceId,
          product,
          credentialId: id,
          name: form.name.trim(),
        });
      const popup = window.open(
        url,
        "opsai-google-oauth",
        "width=520,height=720"
      );
      if (!popup) {
        toast.error("Google sign-in popup was blocked");
        setConnecting(false);
        return;
      }
      const allowedOrigins = resolveOAuthMessageAllowedOrigins({
        editorOrigin: window.location.origin,
        callbackOrigin,
      });
      const onMsg = (event: MessageEvent) => {
        const result = acceptGoogleOAuthPostMessage(event, {
          allowedOrigins,
          expectedSource: popup,
        });
        if (!result.handled) return;
        window.removeEventListener("message", onMsg);
        setConnecting(false);
        if (result.accepted) {
          setConnected(true);
          setBanner({ kind: "success", text: "Account connected" });
          onSaved(result.credentialId);
          toast.success("Account connected");
        } else {
          setBanner({
            kind: "error",
            text: result.error || "Could not connect Google account",
          });
        }
        try {
          popup.close();
        } catch {
          // ignore
        }
      };
      window.addEventListener("message", onMsg);
    } catch (err) {
      setConnecting(false);
      setBanner({
        kind: "error",
        text:
          err instanceof Error
            ? err.message
            : "Could not start Google sign-in",
      });
    }
  };

  const testConnection = async () => {
    if (!activeId) {
      setBanner({
        kind: "warning",
        text: "Connect your account to use this credential",
      });
      return;
    }
    try {
      const res = await workflowCredentialsApi.test(activeId);
      if (res.ok) {
        setBanner({
          kind: "success",
          text: "Connection tested successfully",
        });
      } else {
        setBanner({
          kind: "warning",
          text:
            (res as { message?: string }).message ||
            "Connect your account to use this credential",
        });
      }
    } catch (err) {
      setBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "Connection test failed",
      });
    }
  };

  const deleteConnection = async () => {
    if (!activeId) return;
    const ok = window.confirm(
      "Remove this Google connection? Workflows using it will need a new account selected."
    );
    if (!ok) return;
    setDeleting(true);
    try {
      await workflowCredentialsApi.remove(activeId);
      toast.success("Google connection removed");
      onDeleted?.(activeId);
      onOpenChange(false);
    } catch (err) {
      setBanner({
        kind: "error",
        text:
          err instanceof Error ? err.message : "Could not remove connection",
      });
    } finally {
      setDeleting(false);
    }
  };

  const copyRedirect = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy redirect URL");
    }
  };

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const canConnect =
    Boolean(form.clientId.trim()) &&
    (Boolean(form.clientSecret.trim()) || (activeId && hasClientSecret));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="text-base">{title}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            {meta?.label || "Google"} OAuth2 API
          </p>
        </DialogHeader>
        <div className="flex min-h-[420px]">
          <aside className="w-40 shrink-0 border-r bg-muted/30 p-2">
            <Tabs
              value={tab}
              onValueChange={setTab}
              orientation="vertical"
              className="flex flex-col gap-1"
            >
              <TabsList className="flex h-auto w-full flex-col items-stretch bg-transparent p-0">
                <TabsTrigger value="connection" className="justify-start">
                  Connection
                </TabsTrigger>
                <TabsTrigger value="sharing" className="justify-start">
                  Sharing
                </TabsTrigger>
                <TabsTrigger value="details" className="justify-start">
                  Details
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </aside>
          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            {banner ? (
              <div
                className={
                  banner.kind === "error"
                    ? "mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                    : banner.kind === "warning"
                      ? "mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100"
                      : "mb-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-900 dark:text-emerald-100"
                }
              >
                {banner.text}
              </div>
            ) : null}

            {tab === "connection" ? (
              <div className="space-y-3">
                <div>
                  <Label className="text-[11px]">Connection name</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setField("name", e.target.value)}
                  />
                  {errors.name ? (
                    <p className="mt-1 text-[11px] text-destructive">
                      {errors.name}
                    </p>
                  ) : null}
                </div>

                <div>
                  <Label className="text-[11px]">OAuth Redirect URL</Label>
                  <div className="flex gap-2">
                    <Input value={redirectUri} readOnly className="font-mono text-xs" />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void copyRedirect()}
                      aria-label="Copy OAuth Redirect URL"
                    >
                      {copied ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Use this URL as the Authorized redirect URI in your Google
                    OAuth client.
                  </p>
                </div>

                <div>
                  <Label className="text-[11px]">Client ID *</Label>
                  <Input
                    value={form.clientId}
                    onChange={(e) => setField("clientId", e.target.value)}
                    autoComplete="off"
                  />
                  {errors.clientId ? (
                    <p className="mt-1 text-[11px] text-destructive">
                      {errors.clientId}
                    </p>
                  ) : null}
                </div>

                <div>
                  <Label className="text-[11px]">Client Secret *</Label>
                  <Input
                    type="password"
                    value={form.clientSecret}
                    placeholder={
                      hasClientSecret
                        ? "•••••••• (saved — enter to replace)"
                        : undefined
                    }
                    onChange={(e) => setField("clientSecret", e.target.value)}
                    autoComplete="new-password"
                  />
                  {errors.clientSecret ? (
                    <p className="mt-1 text-[11px] text-destructive">
                      {errors.clientSecret}
                    </p>
                  ) : null}
                </div>

                <div>
                  <Label className="text-[11px]">
                    Allowed HTTP Request Domains
                  </Label>
                  <textarea
                    className="min-h-[72px] w-full rounded-md border bg-background px-3 py-2 text-xs"
                    value={form.allowedDomainsText}
                    onChange={(e) =>
                      setField("allowedDomainsText", e.target.value)
                    }
                  />
                </div>

                <div>
                  <Label className="text-[11px]">Custom Scopes</Label>
                  <Input
                    value={form.customScopes}
                    onChange={(e) => setField("customScopes", e.target.value)}
                    placeholder="Leave blank to use provider defaults"
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Authorization and token URLs are fixed for Google and are
                    not edited here.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 border-t pt-3">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={saving || deleting}
                    onClick={() => void saveConnection()}
                  >
                    {saving ? "Saving…" : "Save"}
                  </Button>
                  {canConnect ? (
                    <Button
                      type="button"
                      disabled={connecting || deleting}
                      onClick={() => void connectAccount()}
                    >
                      {connecting
                        ? "Connecting…"
                        : connected
                          ? "Switch account"
                          : activeId
                            ? "Reconnect"
                            : "Connect"}
                    </Button>
                  ) : null}
                  {connected && activeId ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={deleting}
                      onClick={() => void testConnection()}
                    >
                      Test
                    </Button>
                  ) : null}
                  {activeId ? (
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={deleting || connecting || saving}
                      onClick={() => void deleteConnection()}
                    >
                      {deleting ? "Removing…" : "Delete"}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={deleting}
                    onClick={() => onOpenChange(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}

            {tab === "sharing" ? (
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  This connection is available to the current workspace. OpsAi
                  does not invent per-user sharing rules beyond workspace
                  access.
                </p>
                <p className="text-xs">Sharing scope: workspace</p>
              </div>
            ) : null}

            {tab === "details" ? (
              <div className="space-y-2 text-sm">
                <p>
                  <span className="text-muted-foreground">Name:</span>{" "}
                  {form.name || "—"}
                </p>
                <p>
                  <span className="text-muted-foreground">Type:</span>{" "}
                  {details.type || product}
                </p>
                <p>
                  <span className="text-muted-foreground">Provider:</span> Google
                </p>
                <p>
                  <span className="text-muted-foreground">OAuth app mode:</span>{" "}
                  {details.oauthAppMode || "CUSTOM_APP"}
                </p>
                <p>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  {connected ? "Account connected" : "Not connected"}
                </p>
                <p>
                  <span className="text-muted-foreground">Created:</span>{" "}
                  {details.createdAt || "—"}
                </p>
                <p>
                  <span className="text-muted-foreground">Updated:</span>{" "}
                  {details.updatedAt || "—"}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
