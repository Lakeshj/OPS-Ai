"use client";

import React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
  GA4_DIMENSION_FILTER_OPERATORS,
  GA4_DIMENSION_OPTIONS,
  GA4_METRIC_FILTER_OPERATORS,
  GA4_METRIC_OPTIONS,
} from "@/modules/workflows/ga4Catalog";

type FilterBag = {
  field?: string;
  operator?: string;
  value?: string | number;
  valueTo?: string | number;
};

type Props = {
  param: ParamDescriptor;
  values: WorkflowNodeData;
  onChange: (patch: WorkflowNodeData) => void;
};

const NONE = "__none__";

function asBag(raw: unknown): FilterBag {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as FilterBag;
}

export function Ga4FilterField({ param, values, onChange }: Props) {
  const kind = param.name === "metricFilter" ? "metric" : "dimension";
  const bag = asBag(values[param.name]);
  const fieldOptions =
    kind === "metric" ? GA4_METRIC_OPTIONS : GA4_DIMENSION_OPTIONS;
  const operators =
    kind === "metric"
      ? GA4_METRIC_FILTER_OPERATORS
      : GA4_DIMENSION_FILTER_OPERATORS;
  const operator = String(bag.operator || "equals");
  const showValueTo = kind === "metric" && operator === "between";

  const write = (patch: FilterBag) => {
    const next: FilterBag = { ...bag, ...patch };
    const field = String(next.field || "").trim();
    if (!field) {
      onChange({ ...values, [param.name]: undefined });
      return;
    }
    const cleaned: FilterBag = {
      field,
      operator: String(next.operator || "equals"),
      value: next.value ?? "",
    };
    if (kind === "metric" && cleaned.operator === "between") {
      cleaned.valueTo = next.valueTo ?? "";
    }
    onChange({ ...values, [param.name]: cleaned });
  };

  return (
    <div className="space-y-2 rounded-md border border-border/70 p-3">
      <Label className="text-xs">{param.displayName}</Label>
      {param.description ? (
        <p className="text-[11px] text-muted-foreground">{param.description}</p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Field</Label>
          <Select
            value={bag.field ? String(bag.field) : NONE}
            onValueChange={(v) =>
              write({ field: v === NONE ? "" : v, operator })
            }
          >
            <SelectTrigger className="text-xs">
              <SelectValue placeholder="No filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No filter</SelectItem>
              {fieldOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Operator</Label>
          <Select
            value={operator}
            onValueChange={(v) => write({ operator: v })}
            disabled={!bag.field}
          >
            <SelectTrigger className="text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {operators.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className={`grid gap-2 ${showValueTo ? "sm:grid-cols-2" : ""}`}>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">
            {kind === "metric" ? "Value" : operator === "inList" ? "Values" : "Value"}
          </Label>
          <Input
            className="text-xs"
            type={kind === "metric" ? "number" : "text"}
            disabled={!bag.field}
            placeholder={
              operator === "inList" ? "a, b, c" : kind === "metric" ? "0" : ""
            }
            value={bag.value == null ? "" : String(bag.value)}
            onChange={(e) =>
              write({
                value:
                  kind === "metric" && e.target.value !== ""
                    ? Number(e.target.value)
                    : e.target.value,
              })
            }
          />
        </div>
        {showValueTo ? (
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Value to</Label>
            <Input
              className="text-xs"
              type="number"
              disabled={!bag.field}
              placeholder="0"
              value={bag.valueTo == null ? "" : String(bag.valueTo)}
              onChange={(e) =>
                write({
                  valueTo:
                    e.target.value === "" ? "" : Number(e.target.value),
                })
              }
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
