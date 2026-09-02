"use client";

import React, { useMemo, useState } from "react";
import { Download, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  LIBRARY_CATEGORIES,
  downloadLibraryCsv,
  downloadLibraryJson,
  downloadLibraryXlsx,
  searchLibraryNodes,
  type LibraryNode,
} from "@/modules/workflows/nodeLibrary";

type Props = {
  open: boolean;
  onClose: () => void;
  onAddLibraryNode: (node: LibraryNode) => void;
  onApplyAiTemplate?: () => void;
  onApplyEmailTemplate?: () => void;
};

export function NodeLibrarySidebar({
  open,
  onClose,
  onAddLibraryNode,
  onApplyAiTemplate,
  onApplyEmailTemplate,
}: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [availableOnly, setAvailableOnly] = useState(false);

  const filtered = useMemo(() => {
    let list = searchLibraryNodes(query, category === "all" ? "all" : category);
    if (availableOnly) list = list.filter((n) => n.available);
    return list;
  }, [query, category, availableOnly]);

  if (!open) return null;

  return (
    <aside
      className={cn(
        "absolute inset-y-0 right-0 z-30 flex w-[min(100%,20rem)] flex-col border-l bg-card shadow-xl sm:w-80",
        "max-h-full"
      )}
      role="dialog"
      aria-label="Node Library"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2.5">
        <div className="text-sm font-semibold">Node Library</div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onClose}
          aria-label="Close Node Library"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-b px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search nodes…"
            className="h-9 pl-8 text-sm"
            autoFocus
          />
        </div>

        <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
          <CategoryChip
            label="All"
            active={category === "all"}
            onClick={() => setCategory("all")}
          />
          {LIBRARY_CATEGORIES.map((c) => (
            <CategoryChip
              key={c}
              label={c}
              active={category === c}
              onClick={() => setCategory(c)}
            />
          ))}
        </div>

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={availableOnly}
            onChange={(e) => setAvailableOnly(e.target.checked)}
            className="rounded border"
          />
          Executable only
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
        <div className="mb-2 text-[11px] text-muted-foreground">
          {filtered.length} node{filtered.length === 1 ? "" : "s"}
        </div>
        {filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No nodes match your search.
          </p>
        ) : (
          <div className="space-y-2 pb-4">
            {filtered.map((node) => (
              <div
                key={node.id}
                className="rounded-lg border bg-background p-2.5"
              >
                <div className="mb-0.5 flex items-start justify-between gap-2">
                  <div className="text-sm font-medium leading-snug">
                    {node.name}
                  </div>
                  {!node.available && (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      Soon
                    </span>
                  )}
                </div>
                <div className="mb-1 text-[11px] text-muted-foreground">
                  {node.category}
                  {node.provider ? ` · ${node.provider}` : ""}
                </div>
                <p className="mb-2 line-clamp-2 text-xs leading-snug text-muted-foreground">
                  {node.description}
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 w-full text-xs"
                  variant={node.available ? "default" : "secondary"}
                  onClick={() => onAddLibraryNode(node)}
                >
                  + Add Node
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-1.5 border-t px-3 py-2">
        {(onApplyAiTemplate || onApplyEmailTemplate) && (
          <div className="mb-1 space-y-1">
            {onApplyAiTemplate && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-7 w-full text-[11px]"
                onClick={onApplyAiTemplate}
              >
                Template: Trigger → AI → Result
              </Button>
            )}
            {onApplyEmailTemplate && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 w-full text-[11px]"
                onClick={onApplyEmailTemplate}
              >
                Template: Schedule → AI → Email
              </Button>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-[10px]"
            onClick={() => downloadLibraryJson()}
          >
            <Download className="h-3 w-3" />
            JSON
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-[10px]"
            onClick={() => downloadLibraryCsv()}
          >
            <Download className="h-3 w-3" />
            CSV
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-[10px]"
            onClick={() => void downloadLibraryXlsx()}
          >
            <Download className="h-3 w-3" />
            XLSX
          </Button>
        </div>
      </div>
    </aside>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:bg-muted"
      )}
    >
      {label}
    </button>
  );
}
