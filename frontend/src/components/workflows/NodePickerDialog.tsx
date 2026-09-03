"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  LIBRARY_CATEGORIES,
  type LibraryNode,
} from "@/modules/workflows/nodeLibrary";
import {
  pushRecentNodeId,
  searchNodes,
} from "@/modules/workflows/nodeSearch";
import {
  CATEGORY_DISPLAY_LABELS,
  PRIMARY_LIBRARY_CATEGORIES,
} from "@/modules/workflows/nodeSearchMeta";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  /** When set, prefer nodes compatible with this source port context */
  filterAvailableOnly?: boolean;
  onPick: (node: LibraryNode) => void;
};

const categoryLabel = (c: string) => CATEGORY_DISPLAY_LABELS[c] || c;

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
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const primarySet = useMemo(
    () => new Set<string>(PRIMARY_LIBRARY_CATEGORIES),
    []
  );
  const moreCategories = useMemo(
    () => LIBRARY_CATEGORIES.filter((c) => !primarySet.has(c)),
    [primarySet]
  );

  const filtered = useMemo(
    () =>
      searchNodes({
        query,
        category: category === "all" ? "all" : category,
        availability: filterAvailableOnly ? "available" : "all",
        limit: 80,
      }),
    [query, category, filterAvailableOnly]
  );

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, category]);

  const pick = (node: LibraryNode) => {
    if (filterAvailableOnly && !node.available) return;
    pushRecentNodeId(node.id);
    onPick(node);
    onOpenChange(false);
    setQuery("");
  };

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
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveIndex((i) =>
                    Math.min(i + 1, Math.max(filtered.length - 1, 0))
                  );
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveIndex((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const node = filtered[activeIndex];
                  if (node) pick(node);
                }
              }}
              placeholder="Search by name, alias, category…"
              className="h-9 pl-8 text-sm"
              aria-label="Search nodes"
            />
          </div>
          <div className="flex items-center gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10px]",
                category === "all"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}
              onClick={() => setCategory("all")}
            >
              All
            </button>
            {PRIMARY_LIBRARY_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px]",
                  category === c
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                )}
                onClick={() => setCategory(c)}
              >
                {categoryLabel(c)}
              </button>
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                >
                  More
                  <ChevronDown className="h-3 w-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-72 w-48">
                {moreCategories.map((c) => (
                  <DropdownMenuItem
                    key={c}
                    className="text-xs"
                    onClick={() => setCategory(c)}
                  >
                    {categoryLabel(c)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {filtered.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              No matching nodes
            </p>
          ) : (
            <ul className="space-y-1" role="listbox">
              {filtered.map((node, i) => (
                <li key={node.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={activeIndex === i}
                    className={cn(
                      "flex w-full flex-col rounded-md border px-3 py-2 text-left",
                      activeIndex === i
                        ? "border-primary bg-primary/5"
                        : "border-transparent hover:border-border hover:bg-muted/50"
                    )}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => pick(node)}
                  >
                    <span className="text-sm font-medium">{node.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {categoryLabel(node.category)}
                      {node.provider ? ` · ${node.provider}` : ""}
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
