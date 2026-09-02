"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ScheduleIntervalField, ScheduleRule } from "@/modules/workflows/types";
import { Plus, Trash2 } from "lucide-react";

const INTERVALS: { value: ScheduleIntervalField; label: string }[] = [
  { value: "seconds", label: "Seconds" },
  { value: "minutes", label: "Minutes" },
  { value: "hours", label: "Hours" },
  { value: "days", label: "Days" },
  { value: "weeks", label: "Weeks" },
  { value: "months", label: "Months" },
  { value: "cron", label: "Custom (cron)" },
];

const WEEKDAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

const ruleInterval = (rule: ScheduleRule): ScheduleIntervalField =>
  rule.triggerInterval || rule.field || "weeks";

const ruleEvery = (rule: ScheduleRule): number =>
  rule.every ??
  rule.secondsInterval ??
  rule.minutesInterval ??
  rule.hoursInterval ??
  rule.daysInterval ??
  rule.weeksInterval ??
  rule.monthsInterval ??
  1;

const defaultRule = (): ScheduleRule => ({
  triggerInterval: "weeks",
  field: "weeks",
  weeksInterval: 1,
  triggerAtDay: [1],
  triggerAtHour: 7,
  triggerAtMinute: 0,
});

type Props = {
  rules: ScheduleRule[];
  timezone: string;
  legacyCron?: string;
  onChange: (rules: ScheduleRule[]) => void;
  onTimezoneChange: (tz: string) => void;
};

export function ScheduleRulesEditor({
  rules,
  timezone,
  legacyCron,
  onChange,
  onTimezoneChange,
}: Props) {
  const effectiveRules =
    rules.length > 0
      ? rules
      : legacyCron
        ? [{ field: "cron" as const, expression: legacyCron }]
        : [defaultRule()];

  const updateRule = (index: number, patch: Partial<ScheduleRule>) => {
    const next = effectiveRules.map((r, i) =>
      i === index ? { ...r, ...patch } : r
    );
    onChange(next);
  };

  const toggleWeekday = (index: number, day: number) => {
    const rule = effectiveRules[index];
    const days = new Set(rule.triggerAtDay || []);
    if (days.has(day)) days.delete(day);
    else days.add(day);
    updateRule(index, { triggerAtDay: [...days].sort() });
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Timezone</Label>
        <Input
          value={timezone}
          onChange={(e) => onTimezoneChange(e.target.value)}
          placeholder="UTC"
          className="mt-1 h-8 text-xs"
        />
      </div>

      {effectiveRules.map((rule, index) => (
        <div key={index} className="space-y-2 rounded border p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Rule {index + 1}</span>
            {effectiveRules.length > 1 && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() =>
                  onChange(effectiveRules.filter((_, i) => i !== index))
                }
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>

          <Select
            value={ruleInterval(rule)}
            onValueChange={(v) => {
              const interval = v as ScheduleIntervalField;
              updateRule(index, {
                triggerInterval: interval,
                field: interval,
              });
            }}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INTERVALS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {ruleInterval(rule) === "cron" && (
            <Input
              value={rule.cronExpression || rule.expression || ""}
              onChange={(e) =>
                updateRule(index, {
                  cronExpression: e.target.value,
                  expression: e.target.value,
                })
              }
              placeholder="0 9 * * 1-5"
              className="h-8 font-mono text-xs"
            />
          )}

          {(ruleInterval(rule) === "seconds" ||
            ruleInterval(rule) === "minutes" ||
            ruleInterval(rule) === "hours" ||
            ruleInterval(rule) === "days" ||
            ruleInterval(rule) === "weeks" ||
            ruleInterval(rule) === "months") && (
            <div>
              <Label className="text-xs">
                Every{" "}
                {ruleInterval(rule) === "seconds"
                  ? "N seconds"
                  : ruleInterval(rule) === "minutes"
                    ? "N minutes"
                    : ruleInterval(rule) === "hours"
                      ? "N hours"
                      : ruleInterval(rule) === "days"
                        ? "N days"
                        : ruleInterval(rule) === "weeks"
                          ? "N weeks"
                          : "N months"}
              </Label>
              <Input
                type="number"
                min={1}
                value={ruleEvery(rule)}
                onChange={(e) => {
                  const n = Number(e.target.value) || 1;
                  const interval = ruleInterval(rule);
                  const patch: Partial<ScheduleRule> = { every: n };
                  if (interval === "seconds") patch.secondsInterval = n;
                  else if (interval === "minutes") patch.minutesInterval = n;
                  else if (interval === "hours") patch.hoursInterval = n;
                  else if (interval === "days") patch.daysInterval = n;
                  else if (interval === "weeks") patch.weeksInterval = n;
                  else if (interval === "months") patch.monthsInterval = n;
                  updateRule(index, patch);
                }}
                className="mt-1 h-8 text-xs"
              />
            </div>
          )}

          {ruleInterval(rule) === "weeks" && (
            <div className="flex flex-wrap gap-1">
              {WEEKDAYS.map((d) => (
                <Button
                  key={d.value}
                  type="button"
                  size="sm"
                  variant={
                    (rule.triggerAtDay || []).includes(d.value)
                      ? "default"
                      : "outline"
                  }
                  className="h-7 px-2 text-[10px]"
                  onClick={() => toggleWeekday(index, d.value)}
                >
                  {d.label}
                </Button>
              ))}
            </div>
          )}

          {ruleInterval(rule) === "months" && (
            <div>
              <Label className="text-xs">Day of month</Label>
              <Input
                type="number"
                min={1}
                max={31}
                value={rule.triggerAtDayOfMonth ?? 1}
                onChange={(e) =>
                  updateRule(index, {
                    triggerAtDayOfMonth: Number(e.target.value) || 1,
                  })
                }
                className="mt-1 h-8 text-xs"
              />
            </div>
          )}

          {ruleInterval(rule) !== "cron" && ruleInterval(rule) !== "seconds" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Hour</Label>
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={rule.triggerAtHour ?? 9}
                  onChange={(e) =>
                    updateRule(index, {
                      triggerAtHour: Number(e.target.value) || 0,
                    })
                  }
                  className="mt-1 h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs">Minute</Label>
                <Input
                  type="number"
                  min={0}
                  max={59}
                  value={rule.triggerAtMinute ?? 0}
                  onChange={(e) =>
                    updateRule(index, {
                      triggerAtMinute: Number(e.target.value) || 0,
                    })
                  }
                  className="mt-1 h-8 text-xs"
                />
              </div>
            </div>
          )}
        </div>
      ))}

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 gap-1 text-xs"
        onClick={() => onChange([...effectiveRules, defaultRule()])}
      >
        <Plus className="h-3 w-3" />
        Add rule
      </Button>
    </div>
  );
}
