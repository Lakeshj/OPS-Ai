"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ExpressionField, type ExpressionFieldContext } from "../ExpressionField";
import { workflowCredentialsApi } from "@/modules/workflows/api";
import { ApiError } from "@/modules/shared/apiClient";
import {
  classifyGscProperty,
  classifyResourceLoadError,
  filterResourceOptions,
  inferLocatorMode,
  isExpressionValue,
  suggestedAiModels,
  staleResourceState,
  type LocatorMode,
  type ResourceOption,
} from "@/modules/workflows/resourceLocator";

export type LocatorKind =
  | "gscSites"
  | "ga4Properties"
  | "gmailLabels"
  | "sheetTabs"
  | "aiModels"
  | "spreadsheetId";

type Props = {
  kind: LocatorKind;
  workspaceId?: string;
  credentialId: string;
  value: unknown;
  onChange: (value: unknown, extra?: Record<string, unknown>) => void;
  label: string;
  placeholder?: string;
  modes?: LocatorMode[];
  accountModeLabel?: string;
  manualModeLabel?: string;
  mode?: string;
  modeField?: string;
  displayName?: string;
  displayNameField?: string;
  multi?: boolean;
  spreadsheetId?: string;
  provider?: string;
  previewContext?: ExpressionFieldContext;
};

const MODE_LABEL: Record<LocatorMode, string> = {
  account: "From account",
  manual: "Manual",
  expression: "Expression",
};

const connectContinueHint = (kind: LocatorKind) => {
  if (kind === "gscSites") return "Connect Google Search Console to continue.";
  if (kind === "ga4Properties") return "Connect Google Analytics to continue.";
  if (kind === "gmailLabels") return "Connect Gmail to continue.";
  if (kind === "sheetTabs") return "Connect Google Sheets to continue.";
  return "Connect a Google account to load resources.";
};

const loadErrorMessage = (state: string, kind: LocatorKind) => {
  if (state === "missing_credential") return connectContinueHint(kind);
  if (state === "unauthorized") return "This Google credential is expired or revoked. Reconnect it, then refresh.";
  if (state === "permission_denied") return "This account cannot list that resource. The saved value was kept.";
  if (state === "provider_error") return "Could not load resources. You can still enter a value manually.";
  return "";
};

export function ResourceLocatorField({
  kind,
  workspaceId,
  credentialId,
  value,
  onChange,
  label,
  placeholder,
  modes,
  accountModeLabel = "From account",
  manualModeLabel = "Manual",
  mode: modeValue,
  displayName,
  displayNameField,
  multi,
  spreadsheetId,
  provider,
  previewContext,
}: Props) {
  const allowed: LocatorMode[] =
    modes && modes.length
      ? modes
      : kind === "spreadsheetId" || kind === "aiModels"
        ? ["account", "manual", "expression"]
        : ["account", "manual", "expression"];
  const effectiveAllowed: LocatorMode[] =
    kind === "spreadsheetId"
      ? allowed.filter((m) => m !== "account")
      : allowed;

  const scalar = Array.isArray(value) ? "" : String(value ?? "");
  const selectedIds = Array.isArray(value)
    ? value.map((v) => String(v))
    : scalar && !isExpressionValue(scalar) && multi
      ? scalar.split(/[,\s]+/).filter(Boolean)
      : [];

  const currentMode: LocatorMode = effectiveAllowed.includes(modeValue as LocatorMode)
    ? (modeValue as LocatorMode)
    : inferLocatorMode(Array.isArray(value) ? selectedIds[0] : scalar, effectiveAllowed);

  const [options, setOptions] = useState<ResourceOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadState, setLoadState] = useState<
    "ok" | "missing_credential" | "unauthorized" | "permission_denied" | "provider_error" | "empty"
  >("ok");
  const [query, setQuery] = useState("");

  const canLoadAccount =
    kind === "aiModels" ||
    (Boolean(credentialId) &&
      (kind !== "sheetTabs" || Boolean(String(spreadsheetId || "").trim() && !isExpressionValue(spreadsheetId))));

  const load = useCallback(async () => {
    if (kind === "spreadsheetId") {
      setOptions([]);
      setLoadState("ok");
      return;
    }
    if (kind === "aiModels") {
      const list = suggestedAiModels(provider || "openai");
      setOptions(list);
      setLoadState(list.length ? "ok" : "empty");
      return;
    }
    if (!workspaceId || !credentialId) {
      setOptions([]);
      setLoadState("missing_credential");
      return;
    }
    if (kind === "sheetTabs" && (!spreadsheetId || isExpressionValue(spreadsheetId))) {
      setOptions([]);
      setLoadState("ok");
      return;
    }
    setLoading(true);
    try {
      let next: ResourceOption[] = [];
      if (kind === "gscSites") {
        const res = await workflowCredentialsApi.listGscSites(workspaceId, credentialId);
        next = (res.sites || []).map((s) => {
          const cls = classifyGscProperty(s.siteUrl);
          return { id: s.siteUrl, label: cls.label || s.siteUrl, kind: cls.kind };
        });
      } else if (kind === "ga4Properties") {
        const res = await workflowCredentialsApi.listGa4Properties(workspaceId, credentialId);
        next = (res.properties || []).map((p) => ({
          id: p.propertyId,
          label: p.displayName ? `${p.displayName} (${p.propertyId})` : p.propertyId,
        }));
      } else if (kind === "gmailLabels") {
        const res = await workflowCredentialsApi.listGmailLabels(workspaceId, credentialId);
        next = (res.labels || []).map((l) => ({
          id: l.id,
          label: l.name ? `${l.name} (${l.id})` : l.id,
        }));
      } else if (kind === "sheetTabs") {
        const res = await workflowCredentialsApi.listSheetTabs(
          workspaceId,
          credentialId,
          String(spreadsheetId || "")
        );
        next = (res.sheets || []).map((s) => ({
          id: s.title,
          label: s.title,
        }));
      }
      setOptions(next);
      setLoadState(next.length ? "ok" : "empty");
    } catch (err) {
      const mapped = classifyResourceLoadError(
        err instanceof ApiError
          ? { code: err.code, status: err.status, message: err.message }
          : { message: err instanceof Error ? err.message : String(err) }
      );
      setOptions([]);
      setLoadState(mapped === "ok" ? "provider_error" : mapped);
    } finally {
      setLoading(false);
    }
  }, [kind, workspaceId, credentialId, spreadsheetId, provider]);

  useEffect(() => {
    if (currentMode === "account") void load();
  }, [currentMode, load]);

  const visible = useMemo(
    () => filterResourceOptions(options, query),
    [options, query]
  );

  const stale =
    currentMode === "account" && !loading && loadState === "ok"
      ? staleResourceState(multi ? selectedIds.join(",") : scalar, options)
      : { stale: false, retained: scalar };

  const setMode = (next: LocatorMode) => {
    onChange(value, { mode: next });
  };

  const patchValue = (next: unknown, extra: Record<string, unknown> = {}) => {
    onChange(next, extra);
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold uppercase tracking-wide">{label}</Label>
      <div className="flex flex-wrap gap-1">
        {effectiveAllowed.map((m) => (
          <Button
            key={m}
            type="button"
            size="sm"
            variant={currentMode === m ? "secondary" : "ghost"}
            className="h-7 px-2 text-[11px]"
            onClick={() => setMode(m)}
          >
            {m === "account"
              ? accountModeLabel
              : m === "manual"
                ? manualModeLabel
                : MODE_LABEL[m]}
          </Button>
        ))}
      </div>

      {currentMode === "expression" ? (
        <ExpressionField
          value={scalar}
          onChange={(v) => patchValue(v, { mode: "expression" })}
          placeholder={placeholder || "{{input.field}}"}
          expressionContext={previewContext}
        />
      ) : null}

      {currentMode === "manual" ? (
        <Input
          value={multi ? selectedIds.join(", ") : scalar}
          placeholder={placeholder}
          onChange={(e) =>
            patchValue(
              multi
                ? e.target.value.split(/[,\s]+/).filter(Boolean)
                : e.target.value,
              { mode: "manual" }
            )
          }
        />
      ) : null}

      {currentMode === "account" ? (
        <>
          {!canLoadAccount ? (
            <p className="text-[11px] text-muted-foreground">
              {kind === "sheetTabs" && !spreadsheetId
                ? "Enter a spreadsheet ID first to list tabs."
                : connectContinueHint(kind)}
            </p>
          ) : null}

          {canLoadAccount ? (
            <>
              <Input
                value={query}
                placeholder="Search"
                onChange={(e) => setQuery(e.target.value)}
                className="h-8 text-xs"
              />
              {loading ? (
                <p className="text-[11px] text-muted-foreground">Loading…</p>
              ) : null}
              {!loading && loadState === "empty" ? (
                <p className="text-[11px] text-muted-foreground">
                  No accessible resources for this account.
                </p>
              ) : null}
              {!loading && loadErrorMessage(loadState, kind) ? (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  {loadErrorMessage(loadState, kind)}
                </p>
              ) : null}

              {multi ? (
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                  {visible.map((opt) => {
                    const checked = selectedIds.includes(opt.id);
                    return (
                      <label key={opt.id} className="flex items-center gap-2 text-xs">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(on) => {
                            const enabled = on === true;
                            const next = enabled
                              ? [...selectedIds, opt.id]
                              : selectedIds.filter((id) => id !== opt.id);
                            patchValue(next, { mode: "account" });
                          }}
                        />
                        <span className="truncate">{opt.label}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <Select
                  value={scalar || undefined}
                  onValueChange={(id) => {
                    const opt = options.find((o) => o.id === id);
                    patchValue(id, {
                      mode: "account",
                      ...(displayNameField && opt ? { [displayNameField]: opt.label } : {}),
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={loading ? "Loading…" : placeholder || "Select"} />
                  </SelectTrigger>
                  <SelectContent>
                    {scalar && !visible.some((o) => o.id === scalar) ? (
                      <SelectItem value={scalar}>
                        {displayName || scalar} (saved)
                      </SelectItem>
                    ) : null}
                    {visible.map((opt) => (
                      <SelectItem key={opt.id} value={opt.id}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {stale.stale ? (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  Saved value is no longer in this account’s list. It was kept — pick another only if you intend to change it.
                </p>
              ) : null}

              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={loading || (kind !== "aiModels" && !credentialId)}
                onClick={() => void load()}
              >
                {loading ? "Loading…" : "Refresh"}
              </Button>
            </>
          ) : null}
        </>
      ) : null}

      {kind === "gscSites" && scalar && !isExpressionValue(scalar) ? (
        <p className="text-[11px] text-muted-foreground">
          {classifyGscProperty(scalar).label}
        </p>
      ) : null}
    </div>
  );
}
