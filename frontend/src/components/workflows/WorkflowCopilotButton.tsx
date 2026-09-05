"use client";

/**
 * Part 14D — Floating OpsAi Workflow Copilot button.
 * Mounts bottom-left above React Flow Controls (avoids MiniMap bottom-right).
 */

import React from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Props = {
  open: boolean;
  onToggle: () => void;
  attention?: boolean;
  buttonRef?: React.Ref<HTMLButtonElement>;
};

export function WorkflowCopilotButton({
  open,
  onToggle,
  attention = false,
  buttonRef,
}: Props) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={buttonRef}
            type="button"
            data-testid="workflow-copilot-button"
            aria-label="Ask OpsAi Workflow Copilot"
            aria-pressed={open}
            aria-expanded={open}
            onClick={onToggle}
            className={cn(
              "absolute bottom-24 left-4 z-20 flex h-11 w-11 items-center justify-center rounded-full",
              "border bg-card text-foreground shadow-md transition",
              "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              open && "border-primary bg-primary/10 text-primary",
              attention && !open && "ring-2 ring-destructive/60"
            )}
          >
            <Sparkles className="h-5 w-5" aria-hidden />
            {attention && !open ? (
              <span
                className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-destructive"
                aria-hidden
              />
            ) : null}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Workflow Copilot</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
