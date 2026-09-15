"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  CheckCircle2,
  Copy,
  Info,
  Link2,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  CREDENTIAL_TYPE_FIELDS,
  type WorkflowCredentialType,
} from "@/modules/workflows/types";
import { workflowCredentialsApi } from "@/modules/workflows/api";
import { startGoogleOAuthPopup } from "@/modules/workflows/googleOAuthPopup";
import {
  CredentialSharingPanel,
  type CredentialSharingScope,
} from "./CredentialSharingPanel";
import { isPlatformManagedOnlyGoogle } from "@/modules/workflows/googleNativeAuthPolicy";

const formatCredentialTimestamp = (value: unknown) => {
  if (value == null || value === "") return "—";
  const raw =
    typeof value === "string" || typeof value === "number"
      ? value
      : value instanceof Date
        ? value.toISOString()
        : String(value);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export type GoogleCredentialSetupMode = "managed" | "custom";

type AllowedDomainsMode = "all" | "specific" | "none";

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
  initialSetupMode?: GoogleCredentialSetupMode;
  platformManagedAvailable?: boolean;
  /** When true (native Gmail), force PLATFORM_MANAGED — no Custom OAuth UI. */
  managedOnly?: boolean;
  autoConnect?: boolean;
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
  initialSetupMode = "managed",
  platformManagedAvailable = true,
  managedOnly = false,
  autoConnect = false,
}: Props) {
  const meta = CREDENTIAL_TYPE_FIELDS[product];
  const title = meta?.accountLabel || meta?.label || "Google account";
  const [tab, setTab] = useState("connection");
  const [setupMode, setSetupMode] =
    useState<GoogleCredentialSetupMode>(
      managedOnly || isPlatformManagedOnlyGoogle(product)
        ? "managed"
        : initialSetupMode
    );
  const [allowedDomainsMode, setAllowedDomainsMode] =
    useState<AllowedDomainsMode>("all");
  const [sharingScope, setSharingScope] =
    useState<CredentialSharingScope>("all");
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
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [oauthAttempted, setOauthAttempted] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const autoConnectStarted = useRef(false);
  const [activeId, setActiveId] = useState(credentialId || "");
  const [connected, setConnected] = useState(false);
  const [hasClientSecret, setHasClientSecret] = useState(false);
  const [details, setDetails] = useState<{
    createdAt?: string;
    updatedAt?: string;
    type?: string;
    oauthAppMode?: string;
    accountEmail?: string;
    sharingLabel?: string;
  }>({});

  const forceManaged = managedOnly || isPlatformManagedOnlyGoogle(product);
  const isManaged = forceManaged || setupMode === "managed";
  const oauthAppMode = isManaged ? "PLATFORM_MANAGED" : "CUSTOM_APP";

  useEffect(() => {
    if (!open) return;
    setTab("connection");
    setErrors({});
    setBanner(null);
    setConnecting(false);
    setOauthAttempted(false);
    setEditorReady(false);
    autoConnectStarted.current = false;
    setActiveId(credentialId || "");
    // Keep managed as the normal UI. Native Gmail is always managed-only.
    setSetupMode(
      managedOnly || isPlatformManagedOnlyGoogle(product)
        ? "managed"
        : initialSetupMode
    );
    setForm({
      name: initialName || meta?.label || "Google",
      clientId: "",
      clientSecret: "",
      allowedDomainsText: "",
      customScopes: "",
    });
    setHasClientSecret(false);
    setAllowedDomainsMode("all");
    setSharingScope("all");

    if (!credentialId) {
      setConnected(false);
      setDetails({});
      void workflowCredentialsApi
        .listConnectionTypes()
        .then((res) => {
          const entry = res.predefined.find((p) => p.id === product) as
            | { allowedDomains?: string[] }
            | undefined;
          if (entry?.allowedDomains?.length) {
            setForm((prev) => ({
              ...prev,
              allowedDomainsText: entry.allowedDomains!.join("\n"),
            }));
          }
          setEditorReady(true);
        })
        .catch(() => setEditorReady(true));
      return;
    }

    void workflowCredentialsApi
      .editorView(credentialId)
      .then((view) => {
        const ed = (view.editor || {}) as Record<string, unknown>;
        const modeRaw = String(ed.oauthAppMode || "");
        const nextSetup: GoogleCredentialSetupMode =
          managedOnly || isPlatformManagedOnlyGoogle(product)
            ? "managed"
            : modeRaw === "CUSTOM_APP" || initialSetupMode === "custom"
              ? "custom"
              : "managed";
        setSetupMode(nextSetup);
        setConnected(Boolean(view.connected || ed.connected));
        setHasClientSecret(Boolean(ed.hasClientSecret));
        setSharingScope(
          (String(
            ed.sharingScope || view.sharing || "all"
          ) as CredentialSharingScope) || "all"
        );
        setDetails({
          createdAt: formatCredentialTimestamp(
            view.createdAt ?? (view as { created_at?: string }).created_at
          ),
          updatedAt: formatCredentialTimestamp(
            view.updatedAt ?? (view as { updated_at?: string }).updated_at
          ),
          type: view.type,
          oauthAppMode: modeRaw || oauthAppMode,
          accountEmail: String(ed.accountEmail || ""),
          sharingLabel: String(
            ed.sharingLabel ||
              (view as { sharingLabel?: string }).sharingLabel ||
              "All users and projects"
          ),
        });
        const allowed = Array.isArray(ed.allowedDomains)
          ? (ed.allowedDomains as string[])
          : [];
        setAllowedDomainsMode(
          allowed.length === 0 ? "none" : "specific"
        );
        setForm({
          name: view.name || meta?.label || "Google",
          clientId: String(ed.clientId || ""),
          clientSecret: "",
          allowedDomainsText: allowed.join("\n"),
          customScopes: String(ed.customScopes || ""),
        });
        if (!view.connected && !ed.connected) {
          setBanner({
            kind: "warning",
            text: "Connect your account to use this credential.",
          });
        }
        setEditorReady(true);
      })
      .catch(() => {
        setBanner({ kind: "error", text: "Could not load this connection." });
        setEditorReady(true);
      });
  }, [
    open,
    credentialId,
    initialName,
    meta?.label,
    product,
    initialSetupMode,
    platformManagedAvailable,
    managedOnly,
    oauthAppMode,
  ]);

  const domains = useMemo(() => {
    if (allowedDomainsMode === "all") {
      return form.allowedDomainsText
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (allowedDomainsMode === "none") return [];
    return form.allowedDomainsText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }, [allowedDomainsMode, form.allowedDomainsText]);

  const validate = () => {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = "This field is required";
    if (!isManaged) {
      if (!form.clientId.trim()) next.clientId = "This field is required";
      if (!activeId && !form.clientSecret.trim()) {
        next.clientSecret = "This field is required";
      }
      if (activeId && !hasClientSecret && !form.clientSecret.trim()) {
        next.clientSecret = "This field is required";
      }
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
      const config = {
        oauthAppMode,
        clientId: isManaged ? undefined : form.clientId.trim(),
        allowedDomains: domains,
        customScopes: form.customScopes.trim() || undefined,
        sharingScope,
      };
      if (activeId) {
        await workflowCredentialsApi.update(activeId, {
          name: form.name.trim(),
          secret: !isManaged && form.clientSecret.trim()
            ? { clientSecret: form.clientSecret.trim() }
            : undefined,
          config,
        });
        if (form.clientSecret.trim()) setHasClientSecret(true);
        toast.success(
          connected
            ? "Connection saved"
            : "Connection saved — sign in with Google to finish setup"
        );
        setBanner(null);
        onSaved(activeId);
        return activeId;
      }
      const created = await workflowCredentialsApi.create({
        workspaceId,
        name: form.name.trim(),
        type: product,
        secret: isManaged
          ? { oauthAppMode }
          : { clientSecret: form.clientSecret.trim(), oauthAppMode },
        config,
      });
      setActiveId(created.id);
      setHasClientSecret(!isManaged);
      setConnected(false);
      toast.success(
        isManaged
          ? "Connection ready — sign in with Google to finish setup"
          : "Connection saved — sign in with Google to finish setup"
      );
      setBanner(null);
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
    if (isManaged && !platformManagedAvailable) {
      setBanner({
        kind: "error",
        text: "Google sign-in is not available on this OpsAi instance yet. Please contact your workspace administrator.",
      });
      return;
    }

    let id = activeId;
    if (!id) {
      id = (await saveConnection()) || "";
    } else if (!isManaged && (form.clientSecret.trim() || !hasClientSecret)) {
      id = (await saveConnection()) || "";
    } else if (!validate()) {
      return;
    }
    if (!id) return;

    setConnecting(true);
    setOauthAttempted(true);
    setBanner({
      kind: "warning",
      text: "Complete Google sign-in in the popup. If it was blocked or closed, click Try again.",
    });

    try {
      const result = await startGoogleOAuthPopup({
        workspaceId,
        product,
        name: form.name.trim(),
        credentialId: id,
      });
      setConnecting(false);
      if (result.ok) {
        setConnected(true);
        setActiveId(result.credentialId);
        setBanner(null);
        onSaved(result.credentialId);
        toast.success("Account connected");
      } else {
        toast.error(result.error);
        setBanner({
          kind: "error",
          text: result.error,
        });
      }
    } catch (err) {
      setConnecting(false);
      setBanner({
        kind: "error",
        text:
          err instanceof Error
            ? err.message
            : "Could not start Google sign-in. Click Try again.",
      });
    }
  };

  const testConnection = async () => {
    if (!activeId) {
      toast.error("Save and connect this account before testing");
      return;
    }
    setTesting(true);
    setBanner(null);
    try {
      const res = await workflowCredentialsApi.test(activeId);
      if (res.ok) {
        toast.success("Connection tested successfully");
        setConnected(true);
      } else {
        const message =
          (res as { message?: string }).message ||
          "Connect your account to use this credential";
        toast.error(message);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Connection test failed";
      toast.error(message);
    } finally {
      setTesting(false);
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

  const canConnectCustom =
    !isManaged &&
    Boolean(form.clientId.trim()) &&
    (Boolean(form.clientSecret.trim()) || (activeId && hasClientSecret));

  const connectLabel = connecting
    ? "Connecting…"
    : connected
      ? "Switch account"
      : oauthAttempted
        ? "Try again"
        : "Sign in with Google";

  useEffect(() => {
    if (!open || !autoConnect || !editorReady || connected || connecting) return;
    if (isManaged || canConnectCustom) {
      if (autoConnectStarted.current) return;
      autoConnectStarted.current = true;
      void connectAccount();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoConnect, editorReady, connected, isManaged, canConnectCustom]);

  const navTabs = [
    { id: "connection", label: "Connection", icon: Link2 },
    { id: "sharing", label: "Sharing", icon: Share2 },
    { id: "details", label: "Details", icon: Info },
  ] as const;

  const detailRows = [
    { label: "Name", value: form.name || "—" },
    { label: "Type", value: details.type || product },
    { label: "Provider", value: "Google" },
    {
      label: "Setup",
      value: isManaged
        ? "Managed OAuth2 (recommended)"
        : "Custom OAuth2",
    },
    {
      label: "Google account",
      value: details.accountEmail || "—",
    },
    {
      label: "Status",
      value: connected ? "Account connected" : "Not connected",
    },
    {
      label: "Sharing",
      value: details.sharingLabel || "All users and projects",
    },
    { label: "Created", value: details.createdAt || "—" },
    { label: "Updated", value: details.updatedAt || "—" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(90vh,640px)] min-h-[min(560px,90vh)] max-h-[min(90vh,720px)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:rounded-lg">
        <DialogHeader className="shrink-0 border-b px-4 py-3 pr-12">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="text-base">{title}</DialogTitle>
              <p className="text-xs text-muted-foreground">
                {meta?.label || "Google"} OAuth2 API
              </p>
            </div>
            <span
              className={cn(
                "mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                connected
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-border bg-muted/50 text-muted-foreground"
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  connected ? "bg-emerald-500" : "bg-muted-foreground/50"
                )}
              />
              {connected ? "Connected" : "Not connected"}
            </span>
          </div>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside className="flex w-48 shrink-0 flex-col border-r bg-muted/25 p-3">
            <Tabs
              value={tab}
              onValueChange={(next) => {
                setTab(next);
                setBanner(null);
              }}
              orientation="vertical"
              className="flex w-full flex-col"
            >
              <TabsList className="flex h-auto w-full flex-col items-stretch gap-1 rounded-none bg-transparent p-0">
                {navTabs.map((item) => {
                  const Icon = item.icon;
                  return (
                    <TabsTrigger
                      key={item.id}
                      value={item.id}
                      className="h-10 justify-start gap-2 rounded-md border border-transparent px-3 text-sm font-medium text-muted-foreground shadow-none transition-colors hover:bg-muted/70 hover:text-foreground data-[state=active]:border-border data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                    >
                      <Icon className="h-3.5 w-3.5 opacity-70" />
                      {item.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
              {tab === "connection" && banner ? (
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
                <div className="space-y-4 pb-1">
                  {!forceManaged ? (
                    <div className="flex items-center justify-between gap-3">
                      <Label className="text-sm font-medium">
                        Setup credential
                      </Label>
                      <Select
                        value={setupMode}
                        onValueChange={(next) =>
                          setSetupMode(next as GoogleCredentialSetupMode)
                        }
                      >
                        <SelectTrigger className="h-8 w-[220px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="managed">
                            Managed OAuth2 (recommended)
                          </SelectItem>
                          <SelectItem value="custom">
                            Use custom Google OAuth app
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}

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

                  {isManaged ? (
                    <>
                      {!platformManagedAvailable ? (
                        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-sm text-amber-950 dark:text-amber-50">
                          Google sign-in is not available on this OpsAi instance
                          yet. Please contact your workspace administrator.
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-3">
                          <p className="text-sm text-amber-950 dark:text-amber-50">
                            Connect your account to use this credential
                          </p>
                          <Button
                            type="button"
                            disabled={connecting || saving}
                            className="gap-2 bg-white text-gray-800 hover:bg-gray-100 dark:bg-white dark:text-gray-900"
                            onClick={() => void connectAccount()}
                          >
                            <GoogleMark />
                            {connectLabel}
                          </Button>
                        </div>
                      )}

                      {connected && details.accountEmail ? (
                        <p className="text-xs text-muted-foreground">
                          Connected as{" "}
                          <span className="font-medium text-foreground">
                            {details.accountEmail}
                          </span>
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <div>
                        <Label className="text-[11px]">OAuth Redirect URL</Label>
                        <div className="flex gap-2">
                          <Input
                            value={redirectUri}
                            readOnly
                            className="font-mono text-xs"
                          />
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
                          Use this URL as the Authorized redirect URI in your
                          Google OAuth client.
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
                          onChange={(e) =>
                            setField("clientSecret", e.target.value)
                          }
                          autoComplete="new-password"
                        />
                        {errors.clientSecret ? (
                          <p className="mt-1 text-[11px] text-destructive">
                            {errors.clientSecret}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-3">
                        <p className="text-sm text-amber-950 dark:text-amber-50">
                          Connect your account after saving Client ID and Secret
                        </p>
                        <Button
                          type="button"
                          disabled={connecting || saving || !canConnectCustom}
                          className="gap-2 bg-white text-gray-800 hover:bg-gray-100 dark:bg-white dark:text-gray-900"
                          onClick={() => void connectAccount()}
                        >
                          <GoogleMark />
                          {connectLabel}
                        </Button>
                      </div>
                    </>
                  )}

                  <div>
                    <Label className="text-[11px]">
                      Allowed HTTP Request Domains
                    </Label>
                    <Select
                      value={allowedDomainsMode}
                      onValueChange={(next) =>
                        setAllowedDomainsMode(next as AllowedDomainsMode)
                      }
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="specific">Specific Domains</SelectItem>
                        <SelectItem value="none">None</SelectItem>
                      </SelectContent>
                    </Select>
                    {allowedDomainsMode === "specific" ? (
                      <textarea
                        className="mt-2 min-h-[72px] w-full rounded-md border bg-background px-3 py-2 text-xs"
                        value={form.allowedDomainsText}
                        onChange={(e) =>
                          setField("allowedDomainsText", e.target.value)
                        }
                      />
                    ) : null}
                    {allowedDomainsMode === "all" ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Allow requests to Google APIs used by this connection.
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <Label className="text-[11px]">Custom Scopes</Label>
                    <Input
                      value={form.customScopes}
                      onChange={(e) => setField("customScopes", e.target.value)}
                      placeholder="Leave blank to use provider defaults"
                    />
                  </div>
                </div>
              ) : null}

              {tab === "sharing" ? (
                <CredentialSharingPanel
                  value={sharingScope}
                  onChange={setSharingScope}
                />
              ) : null}

              {tab === "details" ? (
                <div className="space-y-3">
                  <div
                    className={cn(
                      "flex items-center gap-3 rounded-lg border px-3 py-3",
                      connected
                        ? "border-emerald-500/30 bg-emerald-500/10"
                        : "border-border bg-muted/20"
                    )}
                  >
                    <CheckCircle2
                      className={cn(
                        "h-5 w-5 shrink-0",
                        connected
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-muted-foreground"
                      )}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {connected
                          ? "Account connected"
                          : "Account not connected"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {connected
                          ? "Tokens stay encrypted in OpsAi. Secrets are never shown here."
                          : "Open Connection and sign in with Google to finish setup."}
                      </p>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-lg border">
                    <div className="border-b bg-muted/30 px-3 py-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Credential details
                      </p>
                    </div>
                    <dl className="divide-y">
                      {detailRows.map((row) => (
                        <div
                          key={row.label}
                          className="grid grid-cols-[140px_1fr] gap-3 px-3 py-2.5 text-sm"
                        >
                          <dt className="text-muted-foreground">{row.label}</dt>
                          <dd className="min-w-0 break-all font-medium">
                            {row.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="shrink-0 border-t bg-background px-4 py-3">
              {tab === "connection" ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={saving || deleting || connecting || testing}
                      onClick={() => void saveConnection()}
                    >
                      {saving ? "Saving…" : "Save"}
                    </Button>
                    {activeId ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={deleting || connecting || testing || !connected}
                        onClick={() => void testConnection()}
                      >
                        {testing ? "Testing…" : "Test"}
                      </Button>
                    ) : null}
                    {activeId ? (
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={deleting || connecting || saving || testing}
                        onClick={() => void deleteConnection()}
                      >
                        {deleting ? "Removing…" : "Delete"}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={deleting || testing}
                      onClick={() => onOpenChange(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </>
              ) : tab === "sharing" ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={saving || deleting}
                    onClick={() => void saveConnection()}
                  >
                    {saving ? "Saving…" : "Save sharing"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onOpenChange(false)}
                  >
                    Close
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {activeId ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={deleting || connecting || testing || !connected}
                      onClick={() => void testConnection()}
                    >
                      {testing ? "Testing…" : "Test connection"}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setTab("connection")}
                  >
                    Edit connection
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={deleting || testing}
                    onClick={() => onOpenChange(false)}
                  >
                    Close
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
