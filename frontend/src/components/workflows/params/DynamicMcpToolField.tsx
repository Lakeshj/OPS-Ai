"use client";

import React, { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { workflowsApi } from "@/modules/workflows/api";
import {
  googleAdsSourceFieldState,
  type GoogleAdsSourceNodeRef,
} from "@/modules/workflows/googleAdsMcpSource";
import {
  metaAdsSourceFieldState,
  type MetaAdsSourceNodeRef,
} from "@/modules/workflows/metaAdsMcpSource";
import {
  fieldsFromInputSchema,
  type McpDynamicProvider,
  type McpDynamicTool,
  type McpParamField,
} from "@/modules/workflows/mcpDynamicTools";
import type { WorkflowCredentialType, WorkflowNodeData } from "@/modules/workflows/types";
import { ExpressionField, type ExpressionFieldContext } from "../ExpressionField";
import { CredentialPicker } from "./CredentialPicker";

type Props = {
  values: WorkflowNodeData;
  onChange: (patch: WorkflowNodeData) => void;
  workspaceId?: string;
  workflowId?: string;
  previewContext?: ExpressionFieldContext;
  /** When set, the provider dropdown is omitted and tools load for this provider. */
  lockedProvider?: string;
  workflowNodes?: Array<GoogleAdsSourceNodeRef | MetaAdsSourceNodeRef>;
};

const GOOGLE_ACCOUNT_PARAM_NAMES = new Set([
  "credentialId",
  "customerId",
  "loginCustomerId",
]);
const META_ACCOUNT_PARAM_NAMES = new Set(["credentialId", "adAccountId"]);
const ACCOUNT_PARAM_NAMES = new Set([
  ...GOOGLE_ACCOUNT_PARAM_NAMES,
  ...META_ACCOUNT_PARAM_NAMES,
]);

function toolOptionLabel(tool: McpDynamicTool) {
  return tool.implemented ? tool.displayName : `${tool.displayName} (not available yet)`;
}

function ToolOptions({ tools, grouped }: { tools: McpDynamicTool[]; grouped: boolean }) {
  const item = (tool: McpDynamicTool) => (
    <SelectItem key={tool.id} value={tool.id}>
      {toolOptionLabel(tool)}
    </SelectItem>
  );
  if (!grouped) return <>{tools.map(item)}</>;
  const common = tools.filter((tool) => (tool.uiGroup || "common") === "common");
  const performance = tools.filter((tool) => tool.uiGroup === "performance");
  const advanced = tools.filter((tool) => tool.uiGroup === "advanced");
  const held = tools.filter((tool) => tool.uiGroup === "internal");
  return (
    <>
      {held.map(item)}
      {common.length > 0 ? (
        <SelectGroup>
          <SelectLabel>Common</SelectLabel>
          {common.map(item)}
        </SelectGroup>
      ) : null}
      {performance.length > 0 ? (
        <SelectGroup>
          <SelectLabel>Performance</SelectLabel>
          {performance.map(item)}
        </SelectGroup>
      ) : null}
      {advanced.length > 0 ? (
        <SelectGroup>
          <SelectLabel>Advanced</SelectLabel>
          {advanced.map(item)}
        </SelectGroup>
      ) : null}
    </>
  );
}

function asParams(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function dateRangeValue(value: unknown): { start: string; end: string } {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const row = value as { start?: unknown; end?: unknown; startDate?: unknown; endDate?: unknown };
    return {
      start: String(row.start ?? row.startDate ?? ""),
      end: String(row.end ?? row.endDate ?? ""),
    };
  }
  return { start: "", end: "" };
}

function ParamControl({
  field,
  value,
  onValue,
  previewContext,
}: {
  field: McpParamField;
  value: unknown;
  onValue: (next: unknown) => void;
  previewContext?: ExpressionFieldContext;
}) {
  const hint = (
    <>
      {field.description ? (
        <p className="text-[11px] text-muted-foreground">{field.description}</p>
      ) : null}
    </>
  );
  const requiredMark = field.required ? " *" : "";

  if (field.type === "boolean") {
    return (
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onValue(e.target.checked)}
        />
        <span>
          {field.title}
          {requiredMark}
        </span>
      </label>
    );
  }

  if (field.type === "enum") {
    return (
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">
          {field.title}
          {requiredMark}
        </Label>
        <Select
          value={typeof value === "string" && value ? value : undefined}
          onValueChange={onValue}
        >
          <SelectTrigger className="text-xs">
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            {(field.enumValues || []).map((option, index) => (
              <SelectItem key={option} value={option}>
                {field.enumLabels?.[index] || option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hint}
      </div>
    );
  }

  if (field.type === "dateRange") {
    const range = dateRangeValue(value);
    const set = (key: "start" | "end", next: string) =>
      onValue({ ...range, [key]: next });
    return (
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">
          {field.title}
          {requiredMark}
        </Label>
        <div className="grid grid-cols-2 gap-2">
          <ExpressionField
            value={range.start}
            onChange={(next) => set("start", next)}
            placeholder="Start YYYY-MM-DD"
            parameterName={`${field.name}.start`}
            expressionContext={previewContext}
          />
          <ExpressionField
            value={range.end}
            onChange={(next) => set("end", next)}
            placeholder="End YYYY-MM-DD"
            parameterName={`${field.name}.end`}
            expressionContext={previewContext}
          />
        </div>
        {hint}
      </div>
    );
  }

  if (field.type === "array") {
    const text = Array.isArray(value)
      ? value.map((entry) => String(entry)).join("\n")
      : value == null
        ? ""
        : String(value);
    return (
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">
          {field.title}
          {requiredMark}
        </Label>
        <ExpressionField
          value={text}
          multiline
          onChange={(next) => {
            if (next.includes("{{") && !next.includes("\n")) {
              onValue(next);
              return;
            }
            onValue(
              next
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean)
            );
          }}
          placeholder="One value per line"
          parameterName={field.name}
          expressionContext={previewContext}
        />
        {hint}
      </div>
    );
  }

  const text = value == null ? "" : String(value);
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">
        {field.title}
        {requiredMark}
      </Label>
      <ExpressionField
        value={text}
        onChange={onValue}
        placeholder={field.type === "date" ? "YYYY-MM-DD" : field.type === "number" || field.type === "integer" ? "Number" : ""}
        parameterName={field.name}
        expressionContext={previewContext}
      />
      {hint}
    </div>
  );
}

export function DynamicMcpToolField({
  values,
  onChange,
  workspaceId,
  workflowId,
  previewContext,
  lockedProvider,
  workflowNodes,
}: Props) {
  const [providers, setProviders] = useState<McpDynamicProvider[]>([]);
  const [tools, setTools] = useState<McpDynamicTool[]>([]);
  const [detail, setDetail] = useState<McpDynamicTool | null>(null);
  const [error, setError] = useState("");
  const [toolsReady, setToolsReady] = useState(false);

  const provider = lockedProvider || String(values.provider || "");
  const toolId = String(values.toolId || "");
  const params = asParams(values.params);
  const isMetaLocked = lockedProvider === "meta_ads";
  const isGoogleLocked = lockedProvider === "google_ads";

  useEffect(() => {
    let cancelled = false;
    workflowsApi
      .listMcpProviders()
      .then((rows) => {
        if (!cancelled) setProviders(rows.filter((row) => row.toolCount > 0));
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || "Could not load providers.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!provider) {
      setTools([]);
      setDetail(null);
      setToolsReady(false);
      return;
    }
    let cancelled = false;
    setError("");
    setToolsReady(false);
    workflowsApi
      .listMcpTools(provider)
      .then((rows) => {
        if (!cancelled) {
          setTools(rows);
          setToolsReady(true);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setTools([]);
          setToolsReady(true);
          setError(err.message || "Could not load tools.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  useEffect(() => {
    if (!provider || !toolId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    workflowsApi
      .getMcpTool(provider, toolId)
      .then((row) => {
        if (!cancelled) setDetail(row);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setDetail(null);
          setError(err.message || "Could not load the tool schema.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [provider, toolId]);

  const hiddenAccountParams = isMetaLocked
    ? META_ACCOUNT_PARAM_NAMES
    : isGoogleLocked
      ? GOOGLE_ACCOUNT_PARAM_NAMES
      : ACCOUNT_PARAM_NAMES;
  const fields = fieldsFromInputSchema(detail?.inputSchema).filter((field) =>
    lockedProvider ? !hiddenAccountParams.has(field.name) : true
  );
  const authType = (detail?.authType || "") as WorkflowCredentialType;
  const showCredential = Boolean(!lockedProvider && detail && authType);
  const sourceState = isGoogleLocked
    ? googleAdsSourceFieldState(
        workflowNodes,
        String(values.googleAdsSourceNodeId || "")
      )
    : isMetaLocked
      ? metaAdsSourceFieldState(
          workflowNodes,
          String(values.metaAdsSourceNodeId || "")
        )
      : null;
  const sourceLabel = isMetaLocked ? "Meta Ads Source" : "Google Ads Source";
  const sourcePlaceholder = isMetaLocked
    ? "Select a Meta Ads node"
    : "Select a Google Ads node";
  const selectableTools =
    detail && !tools.some((tool) => tool.id === detail.id) ? [...tools, detail] : tools;
  const groupTools = Boolean(lockedProvider);
  const showEmptyToolList =
    Boolean(lockedProvider) && toolsReady && selectableTools.length === 0 && !error;

  const emit = (patch: WorkflowNodeData) => {
    if (!lockedProvider) {
      onChange(patch);
      return;
    }
    const next = { ...patch };
    delete next.provider;
    delete next.credentialId;
    delete next.customerId;
    delete next.loginCustomerId;
    delete next.adAccountId;
    if (next.params && typeof next.params === "object" && !Array.isArray(next.params)) {
      const nextParams = { ...next.params };
      delete nextParams.customerId;
      delete nextParams.loginCustomerId;
      delete nextParams.credentialId;
      delete nextParams.adAccountId;
      next.params = nextParams;
    }
    onChange(next);
  };

  const setParam = (name: string, next: unknown) => {
    emit({
      ...values,
      params: { ...params, [name]: next },
    });
  };

  const credentialPicker = showCredential ? (
    <CredentialPicker
      workspaceId={workspaceId}
      workflowId={workflowId}
      value={String(values.credentialId || "")}
      onChange={(credentialId) => emit({ ...values, credentialId })}
      label="Account"
      allowedTypes={[authType]}
    />
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      {sourceState?.message ? (
        <p className="text-[11px] text-destructive">{sourceState.message}</p>
      ) : null}
      {sourceState?.showSelector ? (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">{sourceLabel}</Label>
          <Select
            value={
              String(
                isMetaLocked
                  ? values.metaAdsSourceNodeId || ""
                  : values.googleAdsSourceNodeId || ""
              ) || undefined
            }
            onValueChange={(sourceNodeId) =>
              emit(
                isMetaLocked
                  ? { ...values, metaAdsSourceNodeId: sourceNodeId }
                  : { ...values, googleAdsSourceNodeId: sourceNodeId }
              )
            }
          >
            <SelectTrigger className="text-xs">
              <SelectValue placeholder={sourcePlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {sourceState.sources.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  {source.label} ({source.id})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {lockedProvider ? null : (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Provider</Label>
          <Select
            value={provider || undefined}
            onValueChange={(next) =>
              onChange({
                ...values,
                provider: next,
                toolId: "",
                params: {},
                credentialId: "",
              })
            }
          >
            <SelectTrigger className="text-xs">
              <SelectValue placeholder="Select a provider" />
            </SelectTrigger>
            <SelectContent>
              {providers.map((row) => (
                <SelectItem key={row.id} value={row.id}>
                  {row.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {showEmptyToolList ? (
        <p className="text-[11px] text-muted-foreground">
          {isMetaLocked
            ? "No Meta Ads MCP tools are available in this phase."
            : "No tools are available yet."}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Tool</Label>
          <Select
            value={toolId || undefined}
            onValueChange={(next) => {
              const nextAuth = selectableTools.find((tool) => tool.id === next)?.authType;
              const keepCredential = !lockedProvider && nextAuth === detail?.authType;
              emit({
                ...values,
                toolId: next,
                params: {},
                ...(lockedProvider
                  ? {}
                  : { credentialId: keepCredential ? values.credentialId : "" }),
              });
            }}
            disabled={!provider}
          >
            <SelectTrigger className="text-xs">
              <SelectValue placeholder={provider ? "Select a tool" : "Choose a provider first"} />
            </SelectTrigger>
            <SelectContent>
              <ToolOptions tools={selectableTools} grouped={groupTools} />
            </SelectContent>
          </Select>
          {detail?.description ? (
            <p className="text-[11px] text-muted-foreground">{detail.description}</p>
          ) : null}
        </div>
      )}

      {detail && !detail.implemented ? (
        <p className="text-[11px] text-muted-foreground">
          This tool is registered, but execution is not available yet. Saving the selection does not call Google.
        </p>
      ) : null}

      {credentialPicker}

      {fields.map((field) => (
        <ParamControl
          key={field.name}
          field={field}
          value={params[field.name]}
          onValue={(next) => setParam(field.name, next)}
          previewContext={previewContext}
        />
      ))}

      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
    </div>
  );
}
