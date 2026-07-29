"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
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
import { ASSISTANT_CATEGORIES } from "@/modules/assistants/templates";

const CUSTOM_VALUE = "__custom__";

type TaskTypeFieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Extra categories from existing bots / session */
  extraOptions?: string[];
  label?: string;
};

export function TaskTypeField({
  id,
  value,
  onChange,
  extraOptions = [],
  label = "Task Type/Function",
}: TaskTypeFieldProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [sessionCustom, setSessionCustom] = useState<string[]>([]);

  const options = useMemo(() => {
    const merged = [
      ...ASSISTANT_CATEGORIES,
      ...extraOptions,
      ...sessionCustom,
      ...(value ? [value] : []),
    ];
    return Array.from(
      new Set(
        merged
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [extraOptions, sessionCustom, value]);

  const selectValue = isAdding
    ? CUSTOM_VALUE
    : value && options.includes(value)
      ? value
      : value
        ? value
        : "";

  const commitCustom = () => {
    const next = draft.trim();
    if (!next) return;
    setSessionCustom((prev) =>
      prev.includes(next) ? prev : [...prev, next]
    );
    onChange(next);
    setDraft("");
    setIsAdding(false);
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {!isAdding ? (
        <Select
          value={selectValue || undefined}
          onValueChange={(next) => {
            if (next === CUSTOM_VALUE) {
              setIsAdding(true);
              setDraft("");
              return;
            }
            onChange(next);
          }}
        >
          <SelectTrigger id={id}>
            <SelectValue placeholder="Select a category" />
          </SelectTrigger>
          <SelectContent>
            {options.map((category) => (
              <SelectItem key={category} value={category}>
                {category}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM_VALUE}>
              <span className="inline-flex items-center gap-1">
                <Plus className="h-3.5 w-3.5" />
                Add new category…
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <div className="flex gap-2">
          <Input
            id={`${id}-custom`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="e.g. Customer Support"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitCustom();
              }
              if (event.key === "Escape") {
                setIsAdding(false);
                setDraft("");
              }
            }}
          />
          <Button type="button" onClick={commitCustom} disabled={!draft.trim()}>
            Add
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setIsAdding(false);
              setDraft("");
            }}
          >
            Cancel
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Pick an existing category or add a new one for this bot.
      </p>
    </div>
  );
}
