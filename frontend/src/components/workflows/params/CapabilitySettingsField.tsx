"use client";

import React, { useMemo, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import type { ParamDescriptor } from "@/modules/workflows/nodeContract";
import type { WorkflowNodeData } from "@/modules/workflows/types";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NoticeParamField } from "./ParamFields";

type Props = {
  param: ParamDescriptor;
  values: WorkflowNodeData;
  onChange: (patch: WorkflowNodeData) => void;
};

function selectedCapabilities(
  param: ParamDescriptor,
  values: WorkflowNodeData
): Array<string | number | boolean> {
  // Prefer canonical capabilities[] when present.
  const raw =
    (Array.isArray(values.capabilities) && values.capabilities.length
      ? values.capabilities
      : values[param.name]) ?? null;
  const defaultArr = Array.isArray(param.default) ? param.default : [];
  if (Array.isArray(raw)) {
    return raw.filter(
      (v): v is string | number | boolean =>
        typeof v === "string" || typeof v === "number" || typeof v === "boolean"
    );
  }
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
    return [raw];
  }
  return defaultArr.filter(
    (v): v is string | number | boolean =>
      typeof v === "string" || typeof v === "number" || typeof v === "boolean"
  );
}

function fieldValue(
  values: WorkflowNodeData,
  field: ParamDescriptor
): unknown {
  if (Object.prototype.hasOwnProperty.call(values, field.name)) {
    return values[field.name];
  }
  return field.default;
}

function summarizeFields(
  fields: ParamDescriptor[],
  values: WorkflowNodeData
): string {
  const editable = fields.filter((f) => f.type !== "notice" && f.type !== "hidden");
  if (!editable.length) return "No extra filters";
  const parts = editable
    .map((f) => {
      const v = fieldValue(values, f);
      if (v == null || v === "") return null;
      return `${f.displayName} ${v}`;
    })
    .filter(Boolean);
  return parts.length ? parts.join(" · ") : "Using defaults";
}

function ConfigureField({
  field,
  value,
  onChange,
}: {
  field: ParamDescriptor;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  if (field.type === "notice") {
    return <NoticeParamField param={field} />;
  }
  if (field.type === "number") {
    return (
      <div className="space-y-1">
        <Label className="text-xs">{field.displayName}</Label>
        <Input
          type="number"
          value={value == null || value === "" ? "" : String(value)}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              // Clear → use schema/runtime default (do not persist "" — Number("") === 0).
              onChange(undefined);
              return;
            }
            const n = Number(raw);
            onChange(Number.isFinite(n) ? n : raw);
          }}
          className="h-8 text-xs"
        />
        {field.description ? (
          <p className="text-[11px] text-muted-foreground">{field.description}</p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Label className="text-xs">{field.displayName}</Label>
      <Input
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 text-xs"
      />
      {field.description ? (
        <p className="text-[11px] text-muted-foreground">{field.description}</p>
      ) : null}
    </div>
  );
}

export function CapabilitySettingsField({ param, values, onChange }: Props) {
  const options = param.options || [];
  const selected = selectedCapabilities(param, values);
  const typeOptions = param.typeOptions || {};
  const [editing, setEditing] = useState<string | null>(null);

  const isSelected = (optValue: string | number | boolean) =>
    selected.some((v) => String(v) === String(optValue));

  const toggle = (optValue: string | number | boolean) => {
    const next = isSelected(optValue)
      ? selected.filter((v) => String(v) !== String(optValue))
      : [...selected, optValue];
    const ids = next.map((v) => String(v));
    // Write both: capability (multiOptions / displayOptions) and capabilities[]
    // (canonical multi-select field for the backend processor).
    onChange({
      ...values,
      [param.name]: ids,
      capabilities: ids,
    });
  };

  const selectedRows = useMemo(
    () =>
      options.filter((opt) =>
        selected.some((v) => String(v) === String(opt.value))
      ),
    [options, selected]
  );

  const editingKey = editing != null ? String(editing) : null;
  const editingOption = options.find((o) => String(o.value) === editingKey);
  const editingFields = editingKey ? typeOptions[editingKey] || [] : [];

  return (
    <div className="space-y-3">
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
        {param.description ? (
          <p className="text-[11px] text-muted-foreground">{param.description}</p>
        ) : null}
      </div>

      {selectedRows.length > 0 ? (
        <div className="space-y-2">
          <Label className="text-xs">Capability settings</Label>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Capability</th>
                  <th className="px-3 py-2 font-medium">Values</th>
                  <th className="w-10 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {selectedRows.map((opt) => {
                  const key = String(opt.value);
                  const fields = typeOptions[key] || [];
                  return (
                    <tr key={key} className="border-t border-border/60">
                      <td className="px-3 py-2.5 align-top font-medium text-foreground">
                        {opt.name}
                      </td>
                      <td className="px-3 py-2.5 align-top text-muted-foreground">
                        {summarizeFields(fields, values)}
                      </td>
                      <td className="px-1 py-1.5 align-top">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={`Settings for ${opt.name}`}
                          onClick={() => setEditing(String(opt.value))}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <Dialog
        open={editing != null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingOption?.name || "Capability"} settings
            </DialogTitle>
            <DialogDescription>
              Adjust filters for this capability. Other selected capabilities keep
              their own values.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {editingFields.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                This capability uses upstream rows as-is (no extra filters).
              </p>
            ) : (
              editingFields.map((field) => (
                <ConfigureField
                  key={field.name}
                  field={field}
                  value={fieldValue(values, field)}
                  onChange={(next) =>
                    onChange({ ...values, [field.name]: next })
                  }
                />
              ))
            )}
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setEditing(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
