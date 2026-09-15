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
  findLegacyGscPropertyMatches,
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
  if (state === "unauthorized") {
    return "This Google credential is expired or revoked. Reconnect it, then refresh.";
  }
  if (state === "permission_denied") {
    if (kind === "gscSites") {
      return "Couldn't load Search Console properties. Retry.";
    }
    return "Couldn't load resources for this account. Retry.";
  }
  if (state === "provider_error") {
    if (kind === "gscSites") {
      return "Couldn't load Search Console properties. Retry.";
    }
    return "Could not load resources. You can still enter a value manually.";
  }
  return "";
};

const resourceMismatchMessage = (kind: LocatorKind) => {
  if (kind === "gscSites") {
    return "The selected Search Console property isn't available to this account. The saved property was kept.";
  }
  return "The selected resource isn't available to this account. The saved value was kept.";
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
  /** Search filter only — never written to siteUrl / resource value. */
  const [searchQuery, setSearchQuery] = useState("");

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
          const perm = s.permissionLevel ? ` · ${s.permissionLevel}` : "";
          return {
            id: s.siteUrl,
            label: `${cls.label || s.siteUrl}${perm}`,
            kind: cls.kind,
          };
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

  // Credential switch: clear search filter and reload (load deps already cover reload).
  useEffect(() => {
    setSearchQuery("");
  }, [credentialId, kind]);

  const visible = useMemo(
    () => filterResourceOptions(options, searchQuery),
    [options, searchQuery]
  );

  const stale =
    currentMode === "account" && !loading && loadState === "ok"
      ? staleResourceState(multi ? selectedIds.join(",") : scalar, options)
      : { stale: false, retained: scalar };

  const legacyGsc =
    kind === "gscSites" &&
    currentMode === "account" &&
    !loading &&
    loadState === "ok" &&
    !multi
      ? findLegacyGscPropertyMatches(scalar, options)
      : { legacyBare: false, matches: [] as ResourceOption[], ambiguous: false };

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
                value={searchQuery}
                placeholder={
                  kind === "gscSites"
                    ? "Search properties"
                    : "Search"
                }
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 text-xs"
                aria-label="Search resources"
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
                    // Persist canonical provider id only — never the search filter.
                    patchValue(id, {
                      mode: "account",
                      ...(displayNameField && opt
                        ? { [displayNameField]: opt.label }
                        : {}),
                    });
                    setSearchQuery("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        loading
                          ? "Loading…"
                          : placeholder || "Select a property"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent
                    position="popper"
                    className="z-[200]"
                    onCloseAutoFocus={(e) => e.preventDefault()}
                  >
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

              {stale.stale && !legacyGsc.legacyBare ? (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  {resourceMismatchMessage(kind)}
                </p>
              ) : null}

              {legacyGsc.legacyBare && legacyGsc.matches.length > 0 ? (
                <div className="space-y-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2">
                  <p className="text-[11px] text-amber-900 dark:text-amber-100">
                    Saved value <span className="font-mono">{scalar}</span> is
                    not a canonical Search Console property ID. Select the
                    matching property from this account
                    {legacyGsc.ambiguous ? " (more than one match)" : ""}:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {legacyGsc.matches.map((opt) => (
                      <Button
                        key={opt.id}
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-7 max-w-full truncate px-2 text-[11px]"
                        onClick={() => {
                          patchValue(opt.id, {
                            mode: "account",
                            ...(displayNameField
                              ? { [displayNameField]: opt.label }
                              : {}),
                          });
                          setSearchQuery("");
                        }}
                      >
                        {opt.label}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}

              {legacyGsc.legacyBare &&
              loadState === "ok" &&
              legacyGsc.matches.length === 0 &&
              options.length > 0 ? (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  {resourceMismatchMessage(kind)} Enter the exact property ID
                  (for example <span className="font-mono">sc-domain:…</span>{" "}
                  or <span className="font-mono">https://…/</span>) or pick one
                  from the list.
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
