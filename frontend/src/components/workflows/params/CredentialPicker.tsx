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
import { GoogleCredentialModal } from "./GoogleCredentialModal";

type Props = {
  workspaceId?: string;
  value: string;
  onChange: (credentialId: string) => void;
  label?: string;
  allowedTypes?: WorkflowCredentialType[];
};

const isGoogleType = (type: WorkflowCredentialType) =>
  Boolean(CREDENTIAL_TYPE_FIELDS[type]?.oauth);

const CONNECT_ANOTHER = "__connect_another__";

export function CredentialPicker({
  workspaceId,
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
  const [editingCredentialId, setEditingCredentialId] = useState<
    string | undefined
  >();
  const [googleAutoConnect, setGoogleAutoConnect] = useState(false);
  const [removing, setRemoving] = useState(false);
  const defaultType =
    allowedTypes && allowedTypes.length === 1
      ? allowedTypes[0]
      : "bearer";
  const [type, setType] = useState<WorkflowCredentialType>(defaultType);
  const [secret, setSecret] = useState<Record<string, string>>({});

  const visibleTypes = (
    Object.keys(CREDENTIAL_TYPE_FIELDS) as WorkflowCredentialType[]
  ).filter((key) => !allowedTypes || allowedTypes.includes(key));

  const listed = credentials.filter(
    (c) => !allowedTypes || allowedTypes.includes(c.type)
  );

  const googleOnly =
    Boolean(allowedTypes?.length) && allowedTypes!.every(isGoogleType);
  const googleProduct =
    googleOnly && allowedTypes!.length === 1 ? allowedTypes![0] : null;

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

  useEffect(() => {
    if (!googleOnly) return;
    void workflowCredentialsApi
      .listConnectionTypes()
      .then((res) => {
        if (res.googleOAuthRedirectUri) {
          setGoogleRedirectUri(res.googleOAuthRedirectUri);
        }
      })
      .catch(() => {
        // keep default
      });
  }, [googleOnly]);

  const openGoogleModal = (credentialId?: string, autoConnect = false) => {
    if (!googleProduct) return;
    setEditingCredentialId(credentialId);
    setGoogleAutoConnect(autoConnect);
    setGoogleModalOpen(true);
  };

  if (!workspaceId) return null;

  const save = async () => {
    if (isGoogleType(type) && googleProduct) {
      openGoogleModal();
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
  const googleMeta = googleProduct
    ? CREDENTIAL_TYPE_FIELDS[googleProduct]
    : null;
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
      <Select
        value={value || "none"}
        onValueChange={(v) => {
          if (v === CONNECT_ANOTHER) {
            if (googleProduct) openGoogleModal();
            return;
          }
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
          {googleOnly && googleProduct ? (
            <SelectItem value={CONNECT_ANOTHER}>{connectAnother}</SelectItem>
          ) : null}
        </SelectContent>
      </Select>

      {googleOnly && googleProduct ? (
        <div className="space-y-2">
          {selected && selected.connected === false ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-900 dark:text-amber-100">
              This account is not connected yet. Reconnect to authorize Google,
              or delete it if you no longer need it.
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Configure your Google OAuth client, then connect a Google account.
              OpsAi stores the connection encrypted.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {selected ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  onClick={() =>
                    openGoogleModal(
                      selected.id,
                      selected.connected === false
                    )
                  }
                >
                  {selected.connected === false ? "Reconnect" : "Manage"}
                </Button>
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
                onClick={() => openGoogleModal()}
              >
                {connectPrimary}
              </Button>
            )}
            {listed.length > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => openGoogleModal()}
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
          product={googleProduct}
          credentialId={editingCredentialId}
          initialName={googleMeta?.label}
          redirectUri={googleRedirectUri}
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
