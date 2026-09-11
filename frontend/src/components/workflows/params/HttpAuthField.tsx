"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  WorkflowNodeData,
} from "@/modules/workflows/types";
import { CREDENTIAL_TYPE_FIELDS } from "@/modules/workflows/types";
import { workflowCredentialsApi } from "@/modules/workflows/api";
import { CredentialPicker } from "./CredentialPicker";
import { OAuth2ConnectionModal } from "./OAuth2ConnectionModal";

type AuthMode = "none" | "predefined" | "generic";

type PredefinedEntry = {
  id: string;
  displayName: string;
  provider: string;
  category: string;
  authScheme: string;
  kind: string;
  status: string;
  searchText: string;
  reason?: string;
  oauthManaged?: boolean;
};

type GenericEntry = {
  id: string;
  displayName: string;
  status: string;
  dbType: string | null;
};

type Props = {
  workspaceId?: string;
  values: WorkflowNodeData;
  onChange: (patch: WorkflowNodeData) => void;
};

const modeFromValues = (values: WorkflowNodeData): AuthMode => {
  const raw = String(values.httpAuthMode || "").trim();
  if (raw === "predefined" || raw === "generic" || raw === "none") return raw;
  if (values.credentialId) return "generic";
  return "none";
};

const GENERIC_TO_DB: Record<string, WorkflowCredentialType> = {
  basic: "basic",
  bearer: "bearer",
  header: "api_key_header",
  query: "query_param",
  oauth2: "oauth2",
};

export function HttpAuthField({ workspaceId, values, onChange }: Props) {
  const mode = modeFromValues(values);
  const [predefined, setPredefined] = useState<PredefinedEntry[]>([]);
  const [generic, setGeneric] = useState<GenericEntry[]>([]);
  const [redirectUri, setRedirectUri] = useState(
    "http://localhost:5013/api/oauth2/callback"
  );
  const [typeSearch, setTypeSearch] = useState("");
  const [credentials, setCredentials] = useState<WorkflowCredential[]>([]);
  const [oauthOpen, setOauthOpen] = useState(false);

  const reloadCredentials = useCallback(() => {
    if (!workspaceId) return;
    workflowCredentialsApi
      .list(workspaceId)
      .then(setCredentials)
      .catch(() => setCredentials([]));
  }, [workspaceId]);

  useEffect(() => {
    reloadCredentials();
  }, [reloadCredentials]);

  useEffect(() => {
    workflowCredentialsApi
      .listConnectionTypes()
      .then((res) => {
        setPredefined(res.predefined || []);
        setGeneric(res.generic || []);
        if (res.oauth2RedirectUri) setRedirectUri(res.oauth2RedirectUri);
      })
      .catch(() => {
        setPredefined([]);
        setGeneric([]);
      });
  }, []);

  const setMode = (next: AuthMode) => {
    onChange({
      ...values,
      httpAuthMode: next,
      credentialId: next === "none" ? "" : values.credentialId || "",
      predefinedConnectionType:
        next === "predefined" ? values.predefinedConnectionType || "" : "",
      genericAuthType: next === "generic" ? values.genericAuthType || "" : "",
    });
  };

  const filteredTypes = useMemo(() => {
    const q = typeSearch.trim().toLowerCase();
    if (!q) return predefined;
    return predefined.filter((e) => e.searchText.includes(q));
  }, [predefined, typeSearch]);

  const selectedPredefinedId = String(values.predefinedConnectionType || "");
  const selectedPredefined = predefined.find((e) => e.id === selectedPredefinedId);
  const genericAuthType = String(values.genericAuthType || "");
  const genericDbType = GENERIC_TO_DB[genericAuthType];

  const compatibleCredentials = useMemo(() => {
    if (mode === "generic" && genericDbType) {
      return credentials.filter((c) => c.type === genericDbType);
    }
    return [];
  }, [credentials, mode, genericDbType]);

  if (!workspaceId) {
    return (
      <p className="text-xs text-muted-foreground">
        Open this workflow from a workspace to configure authentication.
      </p>
    );
  }

  return (
    <div className="space-y-2 rounded-md border p-2.5">
      <Label className="text-xs font-semibold uppercase tracking-wide">
        Authentication
      </Label>
      <Select value={mode} onValueChange={(v) => setMode(v as AuthMode)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">None</SelectItem>
          <SelectItem value="predefined">Predefined Connection Type</SelectItem>
          <SelectItem value="generic">Generic Authentication</SelectItem>
        </SelectContent>
      </Select>

      {mode === "none" ? (
        <p className="text-[11px] text-muted-foreground">
          No connection is attached. No authorization material is injected.
        </p>
      ) : null}

      {mode === "predefined" ? (
        <div className="space-y-2 border-t pt-2">
          <div>
            <Label className="text-[11px]">Connection Type</Label>
            <Input
              className="mb-1.5"
              value={typeSearch}
              onChange={(e) => setTypeSearch(e.target.value)}
              placeholder="Search connection types"
            />
            <Select
              value={selectedPredefinedId || "none"}
              onValueChange={(v) => {
                const id = v === "none" ? "" : v;
                const entry = predefined.find((e) => e.id === id);
                if (entry && entry.status !== "SUPPORTED") {
                  toast.error(
                    entry.reason ||
                      "This connection type is coming soon and cannot be used yet"
                  );
                  return;
                }
                onChange({
                  ...values,
                  predefinedConnectionType: id,
                  credentialId: "",
                });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select connection type">
                  {selectedPredefined
                    ? selectedPredefined.displayName
                    : "Select connection type"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="none">Select connection type</SelectItem>
                {filteredTypes.map((entry) => (
                  <SelectItem
                    key={entry.id}
                    value={entry.id}
                    disabled={entry.status !== "SUPPORTED"}
                  >
                    {entry.displayName}
                    {entry.status === "COMING_SOON" ? " (Coming soon)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedPredefined && selectedPredefined.status === "SUPPORTED" ? (
            selectedPredefined.oauthManaged ? (
              <CredentialPicker
                workspaceId={workspaceId}
                value={String(values.credentialId || "")}
                onChange={(credentialId) =>
                  onChange({ ...values, credentialId })
                }
                label={
                  CREDENTIAL_TYPE_FIELDS[
                    selectedPredefinedId as WorkflowCredentialType
                  ]?.accountLabel || selectedPredefined.displayName
                }
                allowedTypes={[
                  selectedPredefinedId as WorkflowCredentialType,
                ]}
              />
            ) : (
              <>
                <div>
                  <Label className="text-[11px]">Connection</Label>
                  <Select
                    value={String(values.credentialId || "none")}
                    onValueChange={(v) =>
                      onChange({
                        ...values,
                        credentialId: v === "none" ? "" : v,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select connection" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Select connection</SelectItem>
                      {compatibleCredentials.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Add a compatible connection for this type.
                </p>
              </>
            )
          ) : null}
        </div>
      ) : null}

      {mode === "generic" ? (
        <div className="space-y-2 border-t pt-2">
          <div>
            <Label className="text-[11px]">Authentication Type</Label>
            <Select
              value={genericAuthType || "none"}
              onValueChange={(v) => {
                const id = v === "none" ? "" : v;
                const entry = generic.find((g) => g.id === id);
                if (entry && entry.status !== "SUPPORTED") {
                  toast.error(
                    `${entry.displayName} is coming soon and is not executable yet`
                  );
                  return;
                }
                onChange({
                  ...values,
                  genericAuthType: id,
                  credentialId: "",
                });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select authentication type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Select authentication type</SelectItem>
                {generic.map((entry) => (
                  <SelectItem
                    key={entry.id}
                    value={entry.id}
                    disabled={entry.status !== "SUPPORTED"}
                  >
                    {entry.displayName}
                    {entry.status === "COMING_SOON" ? " (Coming soon)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {genericDbType && genericDbType !== "oauth2" ? (
            <>
              <CredentialPicker
                workspaceId={workspaceId}
                value={String(values.credentialId || "")}
                onChange={(credentialId) =>
                  onChange({ ...values, credentialId })
                }
                label="Connection"
                allowedTypes={[genericDbType]}
              />
            </>
          ) : null}

          {genericAuthType === "oauth2" ? (
            <>
              <div>
                <Label className="text-[11px]">Connection</Label>
                <Select
                  value={String(values.credentialId || "none")}
                  onValueChange={(v) =>
                    onChange({
                      ...values,
                      credentialId: v === "none" ? "" : v,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select connection" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Select connection</SelectItem>
                    {compatibleCredentials.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setOauthOpen(true)}
              >
                {values.credentialId ? "Edit OAuth2 connection" : "+ Add connection"}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      <OAuth2ConnectionModal
        open={oauthOpen}
        onOpenChange={setOauthOpen}
        workspaceId={workspaceId}
        credentialId={
          values.credentialId ? String(values.credentialId) : undefined
        }
        redirectUri={redirectUri}
        onSaved={(credentialId) => {
          reloadCredentials();
          onChange({ ...values, credentialId, genericAuthType: "oauth2" });
        }}
      />
    </div>
  );
}
