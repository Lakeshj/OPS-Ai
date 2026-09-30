"use client";

import React, { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { workflowsApi } from "@/modules/workflows/api";
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
};

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
            {(field.enumValues || []).map((option) => (
              <SelectItem key={option} value={option}>
                {option}
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
}: Props) {
  const [providers, setProviders] = useState<McpDynamicProvider[]>([]);
  const [tools, setTools] = useState<McpDynamicTool[]>([]);
  const [detail, setDetail] = useState<McpDynamicTool | null>(null);
  const [error, setError] = useState("");

  const provider = String(values.provider || "");
  const toolId = String(values.toolId || "");
  const params = asParams(values.params);

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
      return;
    }
    let cancelled = false;
    setError("");
    workflowsApi
      .listMcpTools(provider)
      .then((rows) => {
        if (!cancelled) setTools(rows);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setTools([]);
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

  const fields = fieldsFromInputSchema(detail?.inputSchema);
  const authType = (detail?.authType || "") as WorkflowCredentialType;

  const setParam = (name: string, next: unknown) => {
    onChange({
      ...values,
      params: { ...params, [name]: next },
    });
  };

  return (
    <div className="flex flex-col gap-4">
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

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Tool</Label>
        <Select
          value={toolId || undefined}
          onValueChange={(next) =>
            onChange({
              ...values,
              toolId: next,
              params: {},
              credentialId:
                tools.find((tool) => tool.id === next)?.authType === detail?.authType
                  ? values.credentialId
                  : "",
            })
          }
          disabled={!provider}
        >
          <SelectTrigger className="text-xs">
            <SelectValue placeholder={provider ? "Select a tool" : "Choose a provider first"} />
          </SelectTrigger>
          <SelectContent>
            {tools.map((tool) => (
              <SelectItem key={tool.id} value={tool.id}>
                {tool.implemented ? tool.displayName : `${tool.displayName} (not available yet)`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {detail?.description ? (
          <p className="text-[11px] text-muted-foreground">{detail.description}</p>
        ) : null}
      </div>

      {detail && !detail.implemented ? (
        <p className="text-[11px] text-muted-foreground">
          This tool is registered, but execution is not available yet. Saving the selection does not call Google.
        </p>
      ) : null}

      {detail && authType ? (
        <CredentialPicker
          workspaceId={workspaceId}
          workflowId={workflowId}
          value={String(values.credentialId || "")}
          onChange={(credentialId) => onChange({ ...values, credentialId })}
          label="Account"
          allowedTypes={[authType]}
        />
      ) : null}

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
