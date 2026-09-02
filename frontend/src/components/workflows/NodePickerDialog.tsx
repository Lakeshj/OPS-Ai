"use client";

import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  LIBRARY_CATEGORIES,
  searchLibraryNodes,
  type LibraryNode,
} from "@/modules/workflows/nodeLibrary";
import { resolveEngineType } from "@/modules/workflows/nodeLibrary";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  /** When set, prefer nodes compatible with this source port context */
  filterAvailableOnly?: boolean;
  onPick: (node: LibraryNode) => void;
};

export function NodePickerDialog({
  open,
  onOpenChange,
  title = "Add step",
  description = "Search and select a node to add to your workflow.",
  filterAvailableOnly = true,
  onPick,
}: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");

  const filtered = useMemo(() => {
    let list = searchLibraryNodes(query, category === "all" ? "all" : category);
    if (filterAvailableOnly) list = list.filter((n) => n.available);
    return list.slice(0, 80);
  }, [query, category, filterAvailableOnly]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(80vh,640px)] w-[min(96vw,32rem)] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-4 py-3 pr-10 text-left">
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription className="text-xs">{description}</DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 flex-col gap-2 border-b px-4 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, category, provider…"
              className="h-9 pl-8 text-sm"
              autoFocus
            />
          </div>
          <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto">
            <button
              type="button"
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px]",
                category === "all"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}
              onClick={() => setCategory("all")}
            >
              All
            </button>
            {LIBRARY_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px]",
                  category === c
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                )}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {filtered.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              No matching nodes
            </p>
          ) : (
            <ul className="space-y-1">
              {filtered.map((node) => (
                <li key={node.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col rounded-md border border-transparent px-3 py-2 text-left hover:border-border hover:bg-muted/50"
                    onClick={() => {
                      onPick(node);
                      onOpenChange(false);
                      setQuery("");
                    }}
                  >
                    <span className="text-sm font-medium">{node.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {node.category}
                      {node.provider ? ` · ${node.provider}` : ""} ·{" "}
                      {resolveEngineType(node)}
                    </span>
                    {node.description && (
                      <span className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                        {node.description}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="shrink-0 border-t px-4 py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
