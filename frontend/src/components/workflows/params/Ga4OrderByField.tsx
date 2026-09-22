"use client";

import React, { useMemo } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ParamDescriptor } from "@/modules/workflows/nodeContract";
import type { WorkflowNodeData } from "@/modules/workflows/types";
import {
  GA4_DIMENSION_OPTIONS,
  GA4_METRIC_OPTIONS,
} from "@/modules/workflows/ga4Catalog";

type Props = {
  param: ParamDescriptor;
  values: WorkflowNodeData;
  onChange: (patch: WorkflowNodeData) => void;
};

const NONE = "__none__";

const labelFor = (value: string) => {
  const hit =
    GA4_METRIC_OPTIONS.find((o) => o.value === value) ||
    GA4_DIMENSION_OPTIONS.find((o) => o.value === value);
  return hit ? hit.name : value;
};

export function Ga4OrderByField({ param, values, onChange }: Props) {
  const metrics = Array.isArray(values.metrics)
    ? values.metrics.map(String)
    : values.metrics == null || values.metrics === ""
      ? ["sessions", "totalUsers"]
      : [String(values.metrics)];
  const dimensions = Array.isArray(values.dimensions)
    ? values.dimensions.map(String)
    : values.dimensions
      ? [String(values.dimensions)]
      : [];

  const options = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ name: string; value: string }> = [];
    for (const v of [...metrics, ...dimensions]) {
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push({ name: labelFor(v), value: v });
    }
    return out;
  }, [metrics, dimensions]);

  const current = String(values.orderByField || "");
  const selectValue = current && options.some((o) => o.value === current)
    ? current
    : NONE;

  return (
    <div className="space-y-1">
      <Label className="text-xs">{param.displayName}</Label>
      <Select
        value={selectValue}
        onValueChange={(v) =>
          onChange({
            ...values,
            orderByField: v === NONE ? "" : v,
          })
        }
      >
        <SelectTrigger className="text-xs">
          <SelectValue placeholder="None" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>None</SelectItem>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {param.description ? (
        <p className="text-[11px] text-muted-foreground">{param.description}</p>
      ) : null}
      {!options.length ? (
        <p className="text-[11px] text-muted-foreground">
          Select metrics or dimensions first.
        </p>
      ) : null}
    </div>
  );
}
