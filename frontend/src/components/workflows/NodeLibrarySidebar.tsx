"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  getRecentNodeIds,
  pushRecentNodeId,
  searchNodes,
  splitBestAndRelated,
  type NodeAvailabilityFilter,
  type RankedLibraryNode,
} from "@/modules/workflows/nodeSearch";
import {
  CATEGORY_DISPLAY_LABELS,
  PRIMARY_LIBRARY_CATEGORIES,
} from "@/modules/workflows/nodeSearchMeta";
import { nodeLibraryCatalog } from "@/modules/workflows/nodeLibrary";

type Props = {
  open: boolean;
  onClose: () => void;
  onAddLibraryNode: (node: LibraryNode) => void;
  onApplyAiTemplate?: () => void;
  onApplyEmailTemplate?: () => void;
};

type MainTab = "nodes" | "templates";

const categoryLabel = (c: string) => CATEGORY_DISPLAY_LABELS[c] || c;

export function NodeLibrarySidebar({
  open,
  onClose,
  onAddLibraryNode,
  onApplyAiTemplate,
  onApplyEmailTemplate,
}: Props) {
  const [mainTab, setMainTab] = useState<MainTab>("nodes");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [availability, setAvailability] =
    useState<NodeAvailabilityFilter>("available");
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const primarySet = useMemo(
    () => new Set<string>(PRIMARY_LIBRARY_CATEGORIES),
    []
  );
  const moreCategories = useMemo(
    () => LIBRARY_CATEGORIES.filter((c) => !primarySet.has(c)),
    [primarySet]
  );

  const results = useMemo(
    () =>
      searchNodes({
        query,
        category: category === "all" ? "all" : category,
        availability,
      }),
    [query, category, availability]
  );

  const { best, related, flat } = useMemo(
    () => splitBestAndRelated(results),
    [results]
  );

  const showSections = Boolean(query.trim()) && flat.length > 1 && best;

  const recentNodes = useMemo(() => {
    if (query.trim() || category !== "all") return [];
    const ids = getRecentNodeIds(5);
    return ids
      .map((id) => nodeLibraryCatalog.nodes.find((n) => n.id === id))
      .filter((n): n is LibraryNode => Boolean(n))
      .filter((n) => availability === "all" || n.available);
  }, [query, category, availability, open]);

  useEffect(() => {
    if (!open) return;
    setMainTab("nodes");
    setQuery("");
    setActiveIndex(0);
    const t = window.setTimeout(() => searchRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, category, availability, mainTab]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const addNode = (node: LibraryNode) => {
    if (!node.available) {
      toast.message(`${node.name} isn't available yet`);
      return;
    }
    pushRecentNodeId(node.id);
    onAddLibraryNode(node);
  };

  const selectable = flat.filter((n) => n.available);

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (mainTab !== "nodes") return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(flat.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const target = flat[activeIndex] || selectable[0];
      if (target) addNode(target);
    }
  };

  return (
    <aside
      className={cn(
        "absolute inset-y-0 right-0 z-30 flex w-full flex-col border-l bg-card shadow-xl",
        "sm:w-[min(100%,28rem)] md:w-[26rem] lg:w-[28rem]",
        "max-sm:bg-card/98"
      )}
      role="dialog"
      aria-label="Node Library"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
        <div className="text-sm font-semibold tracking-tight">Node Library</div>
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

      <Tabs
        value={mainTab}
        onValueChange={(v) => setMainTab(v as MainTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="shrink-0 space-y-3 border-b px-4 py-3">
          <TabsList className="grid h-8 w-full grid-cols-2">
            <TabsTrigger value="nodes" className="text-xs">
              Nodes
            </TabsTrigger>
            <TabsTrigger value="templates" className="text-xs">
              Templates
            </TabsTrigger>
          </TabsList>

          {mainTab === "nodes" && (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onSearchKeyDown}
                  placeholder="Search nodes…"
                  className="h-9 pl-8 text-sm"
                  aria-label="Search nodes"
                  aria-controls="node-library-results"
                />
              </div>

              <div
                className="inline-flex rounded-md border p-0.5"
                role="group"
                aria-label="Availability"
              >
                {(
                  [
                    ["available", "Available"],
                    ["all", "All"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={cn(
                      "rounded px-2.5 py-1 text-[11px] font-medium transition-colors",
                      availability === value
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => setAvailability(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <CategoryChip
                  label="All"
                  active={category === "all"}
                  onClick={() => setCategory("all")}
                />
                {PRIMARY_LIBRARY_CATEGORIES.map((c) => (
                  <CategoryChip
                    key={c}
                    label={categoryLabel(c)}
                    active={category === c}
                    onClick={() => setCategory(c)}
                  />
                ))}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "inline-flex shrink-0 items-center gap-0.5 rounded-full border px-2 py-0.5 text-[10px]",
                        moreCategories.includes(category)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background text-muted-foreground hover:bg-muted"
                      )}
                    >
                      More
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-72 w-48">
                    {moreCategories.map((c) => (
                      <DropdownMenuItem
                        key={c}
                        onClick={() => setCategory(c)}
                        className="text-xs"
                      >
                        {categoryLabel(c)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {(query || category !== "all" || availability !== "available") && (
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => {
                    setQuery("");
                    setCategory("all");
                    setAvailability("available");
                    searchRef.current?.focus();
                  }}
                >
                  Reset filters
                </button>
              )}
            </>
          )}

          {mainTab === "templates" && (
            <p className="text-[11px] text-muted-foreground">
              Starter workflows you can drop onto the canvas.
            </p>
          )}
        </div>

        <TabsContent
          value="nodes"
          className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
        >
          <div
            id="node-library-results"
            ref={listRef}
            className="h-full overflow-y-auto overscroll-contain px-3 py-2"
            role="listbox"
            aria-label="Node results"
          >
            {!query.trim() && recentNodes.length > 0 && (
              <section className="mb-3">
                <h3 className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Recently used
                </h3>
                <div className="space-y-1">
                  {recentNodes.map((node) => (
                    <NodeResultRow
                      key={`recent-${node.id}`}
                      node={node}
                      active={false}
                      onAdd={() => addNode(node)}
                    />
                  ))}
                </div>
              </section>
            )}

            {flat.length === 0 ? (
              <div className="px-2 py-10 text-center">
                <p className="text-sm text-muted-foreground">No nodes found</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Try another term or view All nodes.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 h-7 text-xs"
                  onClick={() => {
                    setAvailability("all");
                    setCategory("all");
                  }}
                >
                  View All
                </Button>
              </div>
            ) : showSections && best ? (
              <>
                <section className="mb-3">
                  <h3 className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Best match
                  </h3>
                  <NodeResultRow
                    node={best}
                    active={activeIndex === 0}
                    onAdd={() => addNode(best)}
                    onHover={() => setActiveIndex(0)}
                  />
                </section>
                {related.length > 0 && (
                  <section>
                    <h3 className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Related
                    </h3>
                    <div className="space-y-1 pb-4">
                      {related.map((node, i) => (
                        <NodeResultRow
                          key={node.id}
                          node={node}
                          active={activeIndex === i + 1}
                          onAdd={() => addNode(node)}
                          onHover={() => setActiveIndex(i + 1)}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </>
            ) : (
              <div className="space-y-1 pb-4">
                <div className="mb-1.5 px-1 text-[11px] text-muted-foreground">
                  {flat.length} node{flat.length === 1 ? "" : "s"}
                </div>
                {flat.map((node, i) => (
                  <NodeResultRow
                    key={node.id}
                    node={node}
                    active={activeIndex === i}
                    onAdd={() => addNode(node)}
                    onHover={() => setActiveIndex(i)}
                  />
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent
          value="templates"
          className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
        >
          <div className="h-full overflow-y-auto px-3 py-3">
            <h3 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Starter
            </h3>
            <div className="space-y-2">
              {onApplyAiTemplate && (
                <TemplateCard
                  title="Trigger → AI → Result"
                  description="Manual start, generate with AI, finish with a Result."
                  onClick={onApplyAiTemplate}
                />
              )}
              {onApplyEmailTemplate && (
                <TemplateCard
                  title="Schedule → AI → Email"
                  description="Run on a schedule, generate content, send email."
                  onClick={onApplyEmailTemplate}
                />
              )}
              {!onApplyAiTemplate && !onApplyEmailTemplate && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No templates available
                </p>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
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
        "shrink-0 rounded-full border px-2 py-0.5 text-[10px] transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:bg-muted"
      )}
    >
      {label}
    </button>
  );
}

function NodeResultRow({
  node,
  active,
  onAdd,
  onHover,
}: {
  node: LibraryNode | RankedLibraryNode;
  active: boolean;
  onAdd: () => void;
  onHover?: () => void;
}) {
  const available = node.available;
  return (
    <div
      role="option"
      aria-selected={active}
      className={cn(
        "group flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
        active
          ? "border-primary bg-primary/5"
          : "border-transparent hover:border-border hover:bg-muted/40",
        !available && "opacity-80"
      )}
      onMouseEnter={onHover}
    >
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={onAdd}
        disabled={!available}
        title={
          available
            ? `Add ${node.name}`
            : `${node.name} isn't available yet`
        }
      >
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium leading-snug">
            {node.name}
          </span>
          {!available && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              Soon
            </span>
          )}
        </div>
        <p className="mt-0.5 line-clamp-1 text-[11px] leading-snug text-muted-foreground">
          {node.description}
        </p>
        <div className="mt-0.5 text-[10px] text-muted-foreground">
          {categoryLabel(node.category)}
          {node.provider ? ` · ${node.provider}` : ""}
        </div>
      </button>
      {available && (
        <button
          type="button"
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-primary hover:text-primary-foreground"
          aria-label={`Add ${node.name}`}
          onClick={onAdd}
        >
          <Plus className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function TemplateCard({
  title,
  description,
  onClick,
}: {
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg border bg-background px-3 py-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/30"
    >
      <div className="text-sm font-medium">{title}</div>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        {description}
      </p>
    </button>
  );
}
