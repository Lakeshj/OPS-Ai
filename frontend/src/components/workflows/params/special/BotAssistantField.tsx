"use client";

import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { KeywordAssistant } from "@/modules/shared/types";
import type { WorkflowNodeData } from "@/modules/workflows/types";

type Props = {
  data: WorkflowNodeData;
  assistants: KeywordAssistant[];
  onChange: (patch: WorkflowNodeData) => void;
};

export function BotAssistantField({ data, assistants, onChange }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.replace(/^@/, "").trim().toLowerCase();
    if (!q) return assistants;
    return assistants.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.taskType || "").toLowerCase().includes(q)
    );
  }, [assistants, query]);

  const select = (assistant: KeywordAssistant | null) => {
    if (!assistant) {
      onChange({
        ...data,
        assistantId: "",
        assistantName: "",
      });
      setQuery("");
      return;
    }
    onChange({
      ...data,
      assistantId: assistant.id,
      assistantName: assistant.name,
      provider: assistant.provider || data.provider,
      model: assistant.model || data.model || "",
      label: data.label?.includes("@")
        ? data.label
        : `Bot @${assistant.name}`,
    });
    setQuery("");
  };

  return (
    <div>
      <Label className="text-xs">Keyword Assistant (@bot)</Label>
      <input
        className="mb-2 mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-xs"
        value={query || (data.assistantName ? `@${data.assistantName}` : "")}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="@bot-name"
      />
      {data.assistantId && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-2 py-1.5 text-xs">
          <span>
            Using <strong>@{data.assistantName || "assistant"}</strong>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => select(null)}
          >
            Clear
          </Button>
        </div>
      )}
      <div className="max-h-36 space-y-1 overflow-auto rounded-md border p-1">
        {filtered.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            No assistants found
          </div>
        ) : (
          filtered.slice(0, 40).map((a) => (
            <button
              key={a.id}
              type="button"
              className={`w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted ${
                data.assistantId === a.id ? "bg-muted" : ""
              }`}
              onClick={() => select(a)}
            >
              <div className="font-medium">@{a.name}</div>
              <div className="text-[10px] text-muted-foreground">
                {a.provider}/{a.model}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
