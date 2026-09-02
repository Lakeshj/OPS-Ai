"use client";

import React from "react";
import {
  Copy,
  Ellipsis,
  Play,
  Power,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { WorkflowNodeData } from "@/modules/workflows/types";
import { nodeSupports } from "@/modules/workflows/nodeRegistry";

export type NodeToolbarActions = {
  onExecuteStep?: () => void;
  onToggleDisable?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onCopy?: () => void;
  onRename?: () => void;
  onOpen?: () => void;
};

type Props = {
  nodeType: string;
  data: WorkflowNodeData;
  visible: boolean;
  actions: NodeToolbarActions;
};

type ActionTone = "default" | "primary" | "danger" | "active";

function ActionButton({
  label,
  onClick,
  tone = "default",
  children,
}: {
  label: string;
  onClick?: () => void;
  tone?: ActionTone;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          title={label}
          aria-label={label}
          onClick={(e) => {
            e.stopPropagation();
            onClick?.();
          }}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-full transition-all duration-150",
            "text-muted-foreground hover:text-foreground",
            "hover:bg-foreground/8 active:scale-95",
            tone === "primary" &&
              "bg-emerald-500 text-white shadow-sm shadow-emerald-500/30 hover:bg-emerald-400 hover:text-white",
            tone === "danger" &&
              "hover:bg-destructive/12 hover:text-destructive",
            tone === "active" &&
              "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary"
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function ActionDivider() {
  return <span className="mx-0.5 h-3.5 w-px shrink-0 bg-border/80" aria-hidden />;
}

export function WorkflowNodeToolbar({
  nodeType,
  data,
  visible,
  actions,
}: Props) {
  if (!visible) return null;

  const canExecute = nodeSupports(nodeType as never, "execute_step") && !data.disabled;
  const canDisable = nodeSupports(nodeType as never, "disable");

  return (
    <TooltipProvider delayDuration={280}>
      <div
        className={cn(
          "pointer-events-auto absolute left-1/2 top-0 z-20",
          "-translate-x-1/2 -translate-y-[55%]",
          "flex items-center gap-0.5 rounded-full",
          "border border-border/50 bg-background/92 px-1 py-0.5",
          "shadow-[0_8px_24px_-6px_rgba(0,0,0,0.28)] backdrop-blur-md",
          "animate-in fade-in-0 zoom-in-95 duration-150",
          "dark:border-white/10 dark:bg-zinc-950/88 dark:shadow-black/50"
        )}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {canExecute && actions.onExecuteStep && (
          <ActionButton
            label="Run step"
            tone="primary"
            onClick={actions.onExecuteStep}
          >
            <Play className="h-3 w-3 fill-current" />
          </ActionButton>
        )}

        {canDisable && actions.onToggleDisable && (
          <>
            {canExecute && actions.onExecuteStep && <ActionDivider />}
            <ActionButton
              label={data.disabled ? "Enable node" : "Disable node"}
              tone={data.disabled ? "active" : "default"}
              onClick={actions.onToggleDisable}
            >
              <Power className="h-3.5 w-3.5" />
            </ActionButton>
          </>
        )}

        {actions.onDelete && (
          <>
            {(canExecute && actions.onExecuteStep) ||
            (canDisable && actions.onToggleDisable) ? (
              <ActionDivider />
            ) : null}
            <ActionButton
              label="Delete"
              tone="danger"
              onClick={actions.onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </ActionButton>
          </>
        )}

        <ActionDivider />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="More actions"
              aria-label="More actions"
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full",
                "text-muted-foreground transition-all duration-150",
                "hover:bg-foreground/8 hover:text-foreground active:scale-95",
                "data-[state=open]:bg-foreground/10 data-[state=open]:text-foreground"
              )}
            >
              <Ellipsis className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="center"
            side="top"
            sideOffset={10}
            className="min-w-[10rem]"
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenuItem onClick={actions.onOpen}>Open</DropdownMenuItem>
            {canExecute && (
              <DropdownMenuItem onClick={actions.onExecuteStep}>
                Run step
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={actions.onRename}>Rename (F2)</DropdownMenuItem>
            <DropdownMenuItem onClick={actions.onCopy}>
              <Copy className="mr-2 h-3.5 w-3.5" />
              Copy
            </DropdownMenuItem>
            <DropdownMenuItem onClick={actions.onDuplicate}>Duplicate</DropdownMenuItem>
            <DropdownMenuSeparator />
            {canDisable && (
              <DropdownMenuItem onClick={actions.onToggleDisable}>
                {data.disabled ? "Enable" : "Disable"}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={actions.onDelete}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </TooltipProvider>
  );
}
