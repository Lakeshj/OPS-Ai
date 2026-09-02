"use client";

import React from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ParamDescriptor } from "@/modules/workflows/nodeContract";
import { ExpressionField, type ExpressionFieldContext } from "../ExpressionField";
import type { WorkflowNodeData, WorkflowSetMapping } from "@/modules/workflows/types";

export type FieldPreviewContext = ExpressionFieldContext;

type ScalarFieldProps = {
  param: ParamDescriptor;
  value: unknown;
  onChange: (value: unknown) => void;
  previewContext?: FieldPreviewContext;
};

export function StringParamField({
  param,
  value,
  onChange,
  previewContext,
}: ScalarFieldProps) {
  const str = value == null ? "" : String(value);
  const useExpression = param.expression && previewContext;

  return (
    <div className="space-y-1">
      <Label className="text-xs">{param.displayName}</Label>
      {useExpression ? (
        <ExpressionField
          value={str}
          onChange={onChange}
          multiline={param.multiline}
          placeholder={param.placeholder}
          parameterName={param.name}
          expressionContext={previewContext}
        />
      ) : param.multiline ? (
        <Textarea
          value={str}
          onChange={(e) => onChange(e.target.value)}
          placeholder={param.placeholder}
          rows={4}
          className="text-xs"
        />
      ) : (
        <Input
          value={str}
          onChange={(e) => onChange(e.target.value)}
          placeholder={param.placeholder}
          className="text-xs"
        />
      )}
      {param.description && (
        <p className="text-[11px] text-muted-foreground">{param.description}</p>
      )}
    </div>
  );
}

export function NumberParamField({ param, value, onChange }: ScalarFieldProps) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{param.displayName}</Label>
      <Input
        type="number"
        min={param.min}
        max={param.max}
        value={value === "" || value == null ? "" : Number(value)}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === "" ? undefined : Number(raw));
        }}
        className="text-xs"
      />
    </div>
  );
}

export function BooleanParamField({ param, value, onChange }: ScalarFieldProps) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked)}
      />
      {param.displayName}
    </label>
  );
}

export function OptionsParamField({ param, value, onChange }: ScalarFieldProps) {
  const str = value == null ? String(param.default ?? "") : String(value);
  return (
    <div className="space-y-1">
      <Label className="text-xs">{param.displayName}</Label>
      <Select value={str} onValueChange={onChange}>
        <SelectTrigger className="text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(param.options || []).map((opt) => (
            <SelectItem key={String(opt.value)} value={String(opt.value)}>
              {opt.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function NoticeParamField({ param }: { param: ParamDescriptor }) {
  return (
    <div className="rounded-md border border-blue-500/25 bg-blue-500/10 px-3 py-2 text-xs text-muted-foreground">
      {param.description || param.displayName}
    </div>
  );
}

export function CodeParamField({ param, value, onChange }: ScalarFieldProps) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{param.displayName}</Label>
      <Textarea
        value={String(value ?? param.default ?? "")}
        onChange={(e) => onChange(e.target.value)}
        rows={10}
        className="font-mono text-xs"
      />
    </div>
  );
}

export function JsonParamField({
  param,
  value,
  onChange,
  previewContext,
}: ScalarFieldProps) {
  if (param.expression && previewContext) {
    return (
      <StringParamField
        param={{ ...param, multiline: true }}
        value={value}
        onChange={onChange}
        previewContext={previewContext}
      />
    );
  }
  const str =
    typeof value === "string"
      ? value
      : value != null
        ? JSON.stringify(value, null, 2)
        : "";
  return (
    <div className="space-y-1">
      <Label className="text-xs">{param.displayName}</Label>
      <Textarea
        value={str}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        className="font-mono text-xs"
      />
    </div>
  );
}

type FixedCollectionProps = {
  param: ParamDescriptor;
  value: unknown;
  onChange: (value: unknown) => void;
  previewContext?: FieldPreviewContext;
};

export function FixedCollectionParamField({
  param,
  value,
  onChange,
  previewContext,
}: FixedCollectionProps) {
  const items = Array.isArray(value) ? (value as WorkflowSetMapping[]) : [];
  const fields = param.fields || [];

  const updateItem = (index: number, patch: Record<string, unknown>) => {
    const next = items.map((row, i) =>
      i === index ? { ...row, ...patch } : row
    );
    onChange(next);
  };

  const addItem = () => {
    const blank: Record<string, string> = {};
    for (const f of fields) blank[f.name] = "";
    onChange([...items, blank]);
  };

  const removeItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs">{param.displayName}</Label>
      {items.map((row, index) => (
        <div key={index} className="space-y-2 rounded border p-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-muted-foreground">
              {index + 1}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => removeItem(index)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          {fields.map((field) => (
            <StringParamField
              key={field.name}
              param={field}
              value={(row as unknown as Record<string, unknown>)[field.name]}
              onChange={(v) => updateItem(index, { [field.name]: v })}
              previewContext={previewContext}
            />
          ))}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1 text-xs"
        onClick={addItem}
      >
        <Plus className="h-3 w-3" />
        Add
      </Button>
    </div>
  );
}

export function MultiOptionsParamField({ param, value, onChange }: ScalarFieldProps) {
  const options = param.options || [];
  const defaultArr = Array.isArray(param.default) ? param.default : [];
  const selected = Array.isArray(value)
    ? value
    : value == null || value === ""
      ? defaultArr
      : [value];

  const isSelected = (optValue: string | number | boolean) =>
    selected.some((v) => String(v) === String(optValue));

  const toggle = (optValue: string | number | boolean) => {
    const next = isSelected(optValue)
      ? selected.filter((v) => String(v) !== String(optValue))
      : [...selected, optValue];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs">{param.displayName}</Label>
      <div className="space-y-1.5 rounded-md border p-2">
        {options.map((opt) => (
          <label
            key={String(opt.value)}
            className="flex cursor-pointer items-center gap-2 text-xs"
          >
            <Checkbox
              checked={isSelected(opt.value)}
              onCheckedChange={() => toggle(opt.value)}
            />
            {opt.name}
          </label>
        ))}
      </div>
      {param.description && (
        <p className="text-[11px] text-muted-foreground">{param.description}</p>
      )}
    </div>
  );
}

function renderCollectionSubField(
  field: ParamDescriptor,
  fieldValue: unknown,
  onFieldChange: (v: unknown) => void,
  previewContext?: FieldPreviewContext
): React.ReactNode {
  switch (field.type) {
    case "boolean":
      return (
        <BooleanParamField
          param={field}
          value={fieldValue}
          onChange={onFieldChange}
        />
      );
    case "number":
      return (
        <NumberParamField
          param={field}
          value={fieldValue}
          onChange={onFieldChange}
        />
      );
    case "options":
      return (
        <OptionsParamField
          param={field}
          value={fieldValue}
          onChange={onFieldChange}
        />
      );
    case "multiOptions":
      return (
        <MultiOptionsParamField
          param={field}
          value={fieldValue}
          onChange={onFieldChange}
        />
      );
    case "json":
      return (
        <JsonParamField
          param={field}
          value={fieldValue}
          onChange={onFieldChange}
          previewContext={previewContext}
        />
      );
    case "code":
      return (
        <CodeParamField
          param={field}
          value={fieldValue}
          onChange={onFieldChange}
        />
      );
    default:
      return (
        <StringParamField
          param={field}
          value={fieldValue}
          onChange={onFieldChange}
          previewContext={previewContext}
        />
      );
  }
}

export function CollectionParamField({
  param,
  value,
  onChange,
  previewContext,
}: FixedCollectionProps) {
  const bag =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const fields = param.fields || [];
  const enabledNames = Object.keys(bag);
  const available = fields.filter((f) => !enabledNames.includes(f.name));

  const setBag = (next: Record<string, unknown>) => onChange(next);

  const addField = (name: string) => {
    const field = fields.find((f) => f.name === name);
    if (!field) return;
    const initial =
      field.default !== undefined
        ? field.default
        : field.type === "boolean"
          ? false
          : field.type === "number"
            ? 0
            : field.type === "multiOptions"
              ? []
              : "";
    setBag({ ...bag, [name]: initial });
  };

  const removeField = (name: string) => {
    const next = { ...bag };
    delete next[name];
    setBag(next);
  };

  const updateField = (name: string, fieldValue: unknown) => {
    setBag({ ...bag, [name]: fieldValue });
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs">{param.displayName}</Label>
      {enabledNames.map((name) => {
        const field = fields.find((f) => f.name === name);
        if (!field) return null;
        return (
          <div key={name} className="space-y-1 rounded border p-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-muted-foreground">
                {field.displayName}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => removeField(name)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
            {renderCollectionSubField(
              field,
              bag[name],
              (v) => updateField(name, v),
              previewContext
            )}
          </div>
        );
      })}
      {available.length > 0 && (
        <div className="flex items-center gap-2">
          <Select onValueChange={addField}>
            <SelectTrigger className="h-8 flex-1 text-xs">
              <SelectValue placeholder="Add option" />
            </SelectTrigger>
            <SelectContent>
              {available.map((f) => (
                <SelectItem key={f.name} value={f.name}>
                  {f.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {param.description && (
        <p className="text-[11px] text-muted-foreground">{param.description}</p>
      )}
    </div>
  );
}

export function QueryParamsField({
  value,
  onChange,
  previewContext,
}: {
  value: unknown;
  onChange: (v: WorkflowSetMapping[]) => void;
  previewContext?: FieldPreviewContext;
}) {
  const items = Array.isArray(value) ? (value as WorkflowSetMapping[]) : [];

  return (
    <div className="space-y-2">
      <Label className="text-xs">Query parameters</Label>
      {items.map((param, index) => (
        <div key={index} className="flex gap-1.5">
          <Input
            className="flex-1 text-xs"
            placeholder="key"
            value={param.key}
            onChange={(e) => {
              const next = items.map((p, i) =>
                i === index ? { ...p, key: e.target.value } : p
              );
              onChange(next);
            }}
          />
          {previewContext ? (
            <div className="flex-1">
              <ExpressionField
                value={param.value}
                onChange={(v) => {
                  const next = items.map((p, i) =>
                    i === index ? { ...p, value: v } : p
                  );
                  onChange(next);
                }}
                parameterName="queryParam"
                expressionContext={previewContext}
              />
            </div>
          ) : (
            <Input
              className="flex-1 text-xs"
              placeholder="value"
              value={param.value}
              onChange={(e) => {
                const next = items.map((p, i) =>
                  i === index ? { ...p, value: e.target.value } : p
                );
                onChange(next);
              }}
            />
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onChange(items.filter((_, i) => i !== index))}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...items, { key: "", value: "" }])}
      >
        Add parameter
      </Button>
    </div>
  );
}

export function HttpPaginationField({
  data,
  onPatch,
}: {
  data: WorkflowNodeData;
  onPatch: (patch: Partial<WorkflowNodeData>) => void;
}) {
  return (
    <details className="rounded-md border p-2.5">
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide">
        Pagination
      </summary>
      <div className="mt-2 space-y-2">
        <div className="flex gap-2">
          <div className="flex-1">
            <Label className="text-[11px]">Page parameter</Label>
            <Input
              placeholder="page"
              value={String(data.pageParam || "")}
              onChange={(e) => onPatch({ pageParam: e.target.value })}
              className="text-xs"
            />
          </div>
          <div className="flex-1">
            <Label className="text-[11px]">Max pages</Label>
            <Input
              type="number"
              min={1}
              max={50}
              value={Number(data.maxPages ?? 1)}
              onChange={(e) =>
                onPatch({ maxPages: Number(e.target.value) || 1 })
              }
              className="text-xs"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <Label className="text-[11px]">Page-size parameter</Label>
            <Input
              placeholder="per_page"
              value={String(data.pageSizeParam || "")}
              onChange={(e) => onPatch({ pageSizeParam: e.target.value })}
              className="text-xs"
            />
          </div>
          <div className="flex-1">
            <Label className="text-[11px]">Page size</Label>
            <Input
              type="number"
              min={1}
              value={Number(data.pageSize ?? 0) || ""}
              onChange={(e) =>
                onPatch({
                  pageSize: Number(e.target.value) || undefined,
                })
              }
              className="text-xs"
            />
          </div>
        </div>
        <div>
          <Label className="text-[11px]">Items path in the response</Label>
          <Input
            placeholder="data.results"
            value={String(data.itemsPath || "")}
            onChange={(e) => onPatch({ itemsPath: e.target.value })}
            className="text-xs"
          />
        </div>
      </div>
    </details>
  );
}
