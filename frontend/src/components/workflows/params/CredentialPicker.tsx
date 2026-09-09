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
import {
  CREDENTIAL_TYPE_FIELDS,
} from "@/modules/workflows/types";
import { workflowCredentialsApi } from "@/modules/workflows/api";
import {
  acceptGoogleOAuthPostMessage,
  resolveOAuthMessageAllowedOrigins,
} from "@/modules/workflows/googleOAuthMessage";

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
  const [connecting, setConnecting] = useState(false);
  const [name, setName] = useState("");
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

  const startGoogleConnect = async (product: WorkflowCredentialType) => {
    if (!workspaceId) return;
    setConnecting(true);
    try {
      const { url, callbackOrigin } =
        await workflowCredentialsApi.startGoogleOAuth({
          workspaceId,
          product,
          name: CREDENTIAL_TYPE_FIELDS[product].label,
        });
      const popup = window.open(url, "opsai-google-oauth", "width=520,height=720");
      if (!popup) {
        setConnecting(false);
        toast.error("Google sign-in popup was blocked");
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
          reload();
          onChange(result.credentialId);
          setAdding(false);
          toast.success("Google account connected");
        } else {
          toast.error(result.error || "Could not connect Google account");
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
      toast.error(
        err instanceof Error ? err.message : "Could not start Google sign-in"
      );
    }
  };

  if (!workspaceId) return null;

  const save = async () => {
    if (isGoogleType(type) && googleProduct) {
      await startGoogleConnect(googleProduct);
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
  const emptySelectLabel = googleOnly
    ? "Select connected account"
    : "Select connection";
  const addHttpLabel =
    visibleTypes.length > 0 &&
    visibleTypes.every((t) => t === "api_key_header" || t === "query_param")
      ? "Add API key"
      : "Add connection";

  return (
    <div className="space-y-2 rounded-md border p-2.5">
      <Label className="text-xs font-semibold uppercase tracking-wide">
        {label}
      </Label>
      <Select
        value={value || "none"}
        onValueChange={(v) => {
          if (v === CONNECT_ANOTHER) {
            if (googleProduct) void startGoogleConnect(googleProduct);
            return;
          }
          onChange(v === "none" ? "" : v);
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder={emptySelectLabel}>
            {selected ? selected.name : emptySelectLabel}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{emptySelectLabel}</SelectItem>
          {listed.map((credential) => (
            <SelectItem key={credential.id} value={credential.id}>
              {googleOnly
                ? credential.name
                : `${credential.name} (${CREDENTIAL_TYPE_FIELDS[credential.type].label})`}
            </SelectItem>
          ))}
          {googleOnly && googleProduct ? (
            <SelectItem value={CONNECT_ANOTHER}>
              + Connect another account
            </SelectItem>
          ) : null}
        </SelectContent>
      </Select>

      {googleOnly && googleProduct ? (
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={connecting}
            onClick={() => void startGoogleConnect(googleProduct)}
          >
            {connecting
              ? "Connecting…"
              : listed.length
                ? "Connect another account"
                : "Connect Google Account"}
          </Button>
        </div>
      ) : adding ? (
        <div className="space-y-2 border-t pt-2">
          <div>
            <Label className="text-[11px]">Name</Label>
            <Input
              value={name}
              placeholder="Production API key"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-[11px]">Type</Label>
            <Select
              value={type}
              onValueChange={(v) => {
                setType(v as WorkflowCredentialType);
                setSecret({});
              }}
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
          {isGoogleType(type) ? (
            <p className="text-[11px] text-muted-foreground">
              Google opens so you can sign in and allow access. OpsAi stores the
              connection encrypted.
            </p>
          ) : (
            CREDENTIAL_TYPE_FIELDS[type].fields.map((field) => (
            <div key={field.key}>
              <Label className="text-[11px]">{field.label}</Label>
              <Input
                type={field.secret ? "password" : "text"}
                value={secret[field.key] || ""}
                onChange={(e) =>
                  setSecret((prev) => ({ ...prev, [field.key]: e.target.value }))
                }
              />
            </div>
            ))
          )}
          <div className="flex gap-1.5">
            <Button
              type="button"
              size="sm"
              disabled={
                saving ||
                connecting ||
                (!isGoogleType(type) && !name.trim())
              }
              onClick={() => void save()}
            >
              {connecting
                ? "Connecting…"
                : saving
                  ? "Saving…"
                  : isGoogleType(type)
                    ? "Connect Google Account"
                    : "Save connection"}
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
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setAdding(true)}
        >
          {addHttpLabel}
        </Button>
      )}
      <p className="text-[11px] text-muted-foreground">
        {googleOnly
          ? "The Google account connection is stored encrypted. It is not written into the workflow."
          : "The secret is stored encrypted and is not written into the workflow."}
      </p>
    </div>
  );
}
