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

type Props = {
  workspaceId?: string;
  value: string;
  onChange: (credentialId: string) => void;
  label?: string;
};

export function CredentialPicker({
  workspaceId,
  value,
  onChange,
  label = "Authentication",
}: Props) {
  const [credentials, setCredentials] = useState<WorkflowCredential[]>([]);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<WorkflowCredentialType>("bearer");
  const [secret, setSecret] = useState<Record<string, string>>({});

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

  if (!workspaceId) return null;

  const save = async () => {
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
      toast.success("Credential saved");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save the credential"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border p-2.5">
      <Label className="text-xs font-semibold uppercase tracking-wide">
        {label}
      </Label>
      <Select
        value={value || "none"}
        onValueChange={(v) => onChange(v === "none" ? "" : v)}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No authentication</SelectItem>
          {credentials.map((credential) => (
            <SelectItem key={credential.id} value={credential.id}>
              {credential.name} ({CREDENTIAL_TYPE_FIELDS[credential.type].label})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {adding ? (
        <div className="space-y-2 border-t pt-2">
          <div>
            <Label className="text-[11px]">Name</Label>
            <Input
              value={name}
              placeholder="Stripe live key"
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
                {(
                  Object.keys(CREDENTIAL_TYPE_FIELDS) as WorkflowCredentialType[]
                ).map((key) => (
                  <SelectItem key={key} value={key}>
                    {CREDENTIAL_TYPE_FIELDS[key].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {CREDENTIAL_TYPE_FIELDS[type].fields.map((field) => (
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
          ))}
          <div className="flex gap-1.5">
            <Button
              type="button"
              size="sm"
              disabled={saving || !name.trim()}
              onClick={save}
            >
              {saving ? "Saving…" : "Save credential"}
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
          Add credential
        </Button>
      )}
      <p className="text-[11px] text-muted-foreground">
        Stored encrypted and referenced by id — the secret is never written into
        the workflow.
      </p>
    </div>
  );
}
