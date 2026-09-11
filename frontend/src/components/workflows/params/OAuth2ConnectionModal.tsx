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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { workflowCredentialsApi } from "@/modules/workflows/api";
import {
  OAUTH2_MESSAGE_TYPE,
  acceptGoogleOAuthPostMessage,
  resolveOAuthMessageAllowedOrigins,
} from "@/modules/workflows/googleOAuthMessage";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  credentialId?: string;
  initialName?: string;
  onSaved: (credentialId: string) => void;
  redirectUri: string;
};

type FormState = {
  name: string;
  grantType: string;
  authorizationUrl: string;
  accessTokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  authUriQuery: string;
  clientAuth: string;
  ignoreSsl: boolean;
  tokenExpiredStatusCode: number;
  allowedDomainsText: string;
};

const emptyForm = (redirectUri: string): FormState => ({
  name: "OAuth2 connection",
  grantType: "authorizationCode",
  authorizationUrl: "",
  accessTokenUrl: "",
  clientId: "",
  clientSecret: "",
  scope: "",
  authUriQuery: "",
  clientAuth: "body",
  ignoreSsl: false,
  tokenExpiredStatusCode: 401,
  allowedDomainsText: "",
});

export function OAuth2ConnectionModal({
  open,
  onOpenChange,
  workspaceId,
  credentialId,
  initialName,
  onSaved,
  redirectUri,
}: Props) {
  const [tab, setTab] = useState("connection");
  const [form, setForm] = useState<FormState>(() => emptyForm(redirectUri));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{
    kind: "error" | "warning" | "success";
    text: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeId, setActiveId] = useState(credentialId || "");
  const [connected, setConnected] = useState(false);
  const [details, setDetails] = useState<{
    createdAt?: string;
    updatedAt?: string;
    type?: string;
  }>({});

  useEffect(() => {
    if (!open) return;
    setTab("connection");
    setErrors({});
    setBanner(null);
    setActiveId(credentialId || "");
    setForm({
      ...emptyForm(redirectUri),
      name: initialName || "OAuth2 connection",
    });
    if (!credentialId) {
      setConnected(false);
      setDetails({});
      return;
    }
    void workflowCredentialsApi
      .editorView(credentialId)
      .then((view) => {
        const ed = (view.editor || {}) as Record<string, unknown>;
        setConnected(Boolean(view.connected || ed.connected));
        setDetails({
          createdAt: String(view.createdAt || ""),
          updatedAt: String(view.updatedAt || ""),
          type: view.type,
        });
        setForm({
          name: view.name || "OAuth2 connection",
          grantType: String(ed.grantType || "authorizationCode"),
          authorizationUrl: String(ed.authorizationUrl || ""),
          accessTokenUrl: String(ed.accessTokenUrl || ""),
          clientId: String(ed.clientId || ""),
          clientSecret: "",
          scope: String(ed.scope || ""),
          authUriQuery: String(ed.authUriQuery || ""),
          clientAuth: String(ed.clientAuth || "body"),
          ignoreSsl: Boolean(ed.ignoreSsl),
          tokenExpiredStatusCode: Number(ed.tokenExpiredStatusCode) || 401,
          allowedDomainsText: Array.isArray(ed.allowedDomains)
            ? ed.allowedDomains.join("\n")
            : "",
        });
        if (!view.connected && !ed.connected) {
          setBanner({
            kind: "warning",
            text: "Connect your account to use this connection",
          });
        }
      })
      .catch(() => {
        setBanner({ kind: "error", text: "Please check the errors below" });
      });
  }, [open, credentialId, initialName, redirectUri]);

  const validate = () => {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = "This field is required";
    if (!form.authorizationUrl.trim())
      next.authorizationUrl = "This field is required";
    if (!form.accessTokenUrl.trim())
      next.accessTokenUrl = "This field is required";
    if (!form.clientId.trim()) next.clientId = "This field is required";
    if (!activeId && !form.clientSecret.trim()) {
      next.clientSecret = "This field is required";
    }
    if (!form.allowedDomainsText.trim()) {
      next.allowedDomainsText = "This field is required";
    }
    setErrors(next);
    if (Object.keys(next).length) {
      setBanner({ kind: "error", text: "Please check the errors below" });
      return false;
    }
    return true;
  };

  const domains = useMemo(
    () =>
      form.allowedDomainsText
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    [form.allowedDomainsText]
  );

  const saveConnection = async () => {
    if (!validate()) return null;
    setSaving(true);
    try {
      if (activeId) {
        // V1: recreate path not needed; connect uses existing row.
        // Name/config updates for existing OAuth2 rows are applied via connect
        // only when creating; keep save as create-or-keep.
        setBanner({
          kind: "success",
          text: connected
            ? "Account connected"
            : "Connection saved — connect your account to use it",
        });
        return activeId;
      }
      const created = await workflowCredentialsApi.create({
        workspaceId,
        name: form.name.trim(),
        type: "oauth2",
        secret: { clientSecret: form.clientSecret },
        config: {
          grantType: form.grantType,
          authorizationUrl: form.authorizationUrl.trim(),
          accessTokenUrl: form.accessTokenUrl.trim(),
          clientId: form.clientId.trim(),
          scope: form.scope.trim(),
          authUriQuery: form.authUriQuery.trim(),
          clientAuth: form.clientAuth,
          ignoreSsl: form.ignoreSsl,
          tokenExpiredStatusCode: form.tokenExpiredStatusCode,
          allowedDomains: domains,
        },
      });
      setActiveId(created.id);
      setConnected(false);
      setBanner({
        kind: "warning",
        text: "Connect your account to use this connection",
      });
      onSaved(created.id);
      return created.id;
    } catch (err) {
      setBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "Please check the errors below",
      });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const connectAccount = async () => {
    let id = activeId;
    if (!id) {
      id = (await saveConnection()) || "";
    }
    if (!id) return;
    setConnecting(true);
    try {
      const { url, callbackOrigin } = await workflowCredentialsApi.startOAuth2({
        workspaceId,
        credentialId: id,
      });
      const popup = window.open(url, "opsai-oauth2", "width=520,height=720");
      if (!popup) {
        toast.error("OAuth popup was blocked");
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
          messageType: OAUTH2_MESSAGE_TYPE,
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
            text: result.error || "Could not connect account",
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
        text: err instanceof Error ? err.message : "Could not start OAuth2",
      });
    }
  };

  const testConnection = async () => {
    if (!activeId) {
      setBanner({
        kind: "warning",
        text: "Connect your account to use this connection",
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
            "Connect your account to use this connection",
        });
      }
    } catch (err) {
      setBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "Connection test failed",
      });
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="text-base">OAuth2 Connection</DialogTitle>
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
                      ? "mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200"
                      : "mb-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200"
                }
              >
                {banner.text}
              </div>
            ) : null}

            <Tabs value={tab} onValueChange={setTab}>
              <TabsContent value="connection" className="mt-0 space-y-3">
                <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  Ask OpsAi Assistant for help setting up OAuth2. Use this
                  redirect URL as the callback URL in the external service.
                </div>

                <div>
                  <Label className="text-xs">Connection name</Label>
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
                  <Label className="text-xs">OAuth Redirect URL</Label>
                  <div className="flex gap-1.5">
                    <Input value={redirectUri} readOnly />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void copyRedirect()}
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      <span className="ml-1">{copied ? "Copied" : "Copy"}</span>
                    </Button>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Use this URL as the callback/redirect URL in the external
                    service.
                  </p>
                </div>

                <div>
                  <Label className="text-xs">Grant Type</Label>
                  <Select
                    value={form.grantType}
                    onValueChange={(v) => setField("grantType", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="authorizationCode">
                        Authorization Code
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs">Authorization URL</Label>
                  <Input
                    value={form.authorizationUrl}
                    onChange={(e) =>
                      setField("authorizationUrl", e.target.value)
                    }
                    placeholder="https://provider.example/oauth/authorize"
                  />
                  {errors.authorizationUrl ? (
                    <p className="mt-1 text-[11px] text-destructive">
                      {errors.authorizationUrl}
                    </p>
                  ) : null}
                </div>

                <div>
                  <Label className="text-xs">Access Token URL</Label>
                  <Input
                    value={form.accessTokenUrl}
                    onChange={(e) => setField("accessTokenUrl", e.target.value)}
                    placeholder="https://provider.example/oauth/token"
                  />
                  {errors.accessTokenUrl ? (
                    <p className="mt-1 text-[11px] text-destructive">
                      {errors.accessTokenUrl}
                    </p>
                  ) : null}
                </div>

                <div>
                  <Label className="text-xs">Client ID</Label>
                  <Input
                    value={form.clientId}
                    onChange={(e) => setField("clientId", e.target.value)}
                  />
                  {errors.clientId ? (
                    <p className="mt-1 text-[11px] text-destructive">
                      {errors.clientId}
                    </p>
                  ) : null}
                </div>

                <div>
                  <Label className="text-xs">Client Secret</Label>
                  <Input
                    type="password"
                    value={form.clientSecret}
                    onChange={(e) => setField("clientSecret", e.target.value)}
                    placeholder={
                      activeId ? "Leave blank to keep existing" : undefined
                    }
                    disabled={Boolean(activeId)}
                  />
                  {errors.clientSecret ? (
                    <p className="mt-1 text-[11px] text-destructive">
                      {errors.clientSecret}
                    </p>
                  ) : null}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Stored encrypted. Not written into the workflow. Expression
                    mode is not allowed for secrets.
                  </p>
                </div>

                <div>
                  <Label className="text-xs">Scope</Label>
                  <Input
                    value={form.scope}
                    onChange={(e) => setField("scope", e.target.value)}
                    placeholder="optional scopes"
                  />
                </div>

                <div>
                  <Label className="text-xs">
                    Authorization URI Query Parameters
                  </Label>
                  <Input
                    value={form.authUriQuery}
                    onChange={(e) => setField("authUriQuery", e.target.value)}
                    placeholder="access_type=offline"
                  />
                </div>

                <div>
                  <Label className="text-xs">Authentication</Label>
                  <Select
                    value={form.clientAuth}
                    onValueChange={(v) => setField("clientAuth", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="body">
                        Send client credentials in body
                      </SelectItem>
                      <SelectItem value="header">
                        Send as Basic Auth header
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-start gap-2">
                  <input
                    id="oauth2-ignore-ssl"
                    type="checkbox"
                    className="mt-1"
                    checked={form.ignoreSsl}
                    onChange={(e) => setField("ignoreSsl", e.target.checked)}
                  />
                  <div>
                    <Label htmlFor="oauth2-ignore-ssl" className="text-xs">
                      Ignore SSL Issues (Insecure)
                    </Label>
                    {form.ignoreSsl ? (
                      <p className="text-[11px] text-amber-700 dark:text-amber-300">
                        Warning: skipping TLS verification is insecure and is
                        not enabled for live token refresh in this release.
                      </p>
                    ) : null}
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Token Expired Status Code</Label>
                  <Input
                    type="number"
                    value={form.tokenExpiredStatusCode}
                    onChange={(e) =>
                      setField(
                        "tokenExpiredStatusCode",
                        Number(e.target.value) || 401
                      )
                    }
                  />
                </div>

                <div>
                  <Label className="text-xs">Allowed HTTP Request Domains</Label>
                  <textarea
                    className="min-h-[72px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={form.allowedDomainsText}
                    onChange={(e) =>
                      setField("allowedDomainsText", e.target.value)
                    }
                    placeholder={"api.example.com\nauth.example.com"}
                  />
                  {errors.allowedDomainsText ? (
                    <p className="mt-1 text-[11px] text-destructive">
                      {errors.allowedDomainsText}
                    </p>
                  ) : null}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Auth is only injected for these hosts (and their redirects).
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5 border-t pt-3">
                  {!activeId ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={saving}
                      onClick={() => void saveConnection()}
                    >
                      {saving ? "Saving…" : "Save"}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={connecting}
                    onClick={() => void connectAccount()}
                  >
                    {connecting
                      ? "Connecting…"
                      : connected
                        ? "Switch account"
                        : "Connect"}
                  </Button>
                  {activeId ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void testConnection()}
                    >
                      Test Connection
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onOpenChange(false)}
                  >
                    Close
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="sharing" className="mt-0 space-y-2 text-sm">
                <p>
                  V1 sharing: connections are available to members of this
                  workspace. Granular owner-only or per-user sharing is not
                  implemented yet.
                </p>
                <p className="text-muted-foreground">
                  Status: shared with workspace
                </p>
              </TabsContent>

              <TabsContent value="details" className="mt-0 space-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Name: </span>
                  {form.name || "—"}
                </div>
                <div>
                  <span className="text-muted-foreground">Type: </span>
                  {details.type || "oauth2"}
                </div>
                <div>
                  <span className="text-muted-foreground">Status: </span>
                  {connected ? "Account connected" : "Not connected"}
                </div>
                <div>
                  <span className="text-muted-foreground">Created: </span>
                  {details.createdAt || "—"}
                </div>
                <div>
                  <span className="text-muted-foreground">Updated: </span>
                  {details.updatedAt || "—"}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Secrets and tokens are never shown here.
                </p>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
