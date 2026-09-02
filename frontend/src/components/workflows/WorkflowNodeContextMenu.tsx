"use client";

import React from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { WorkflowNodeData } from "@/modules/workflows/types";
import { nodeSupports } from "@/modules/workflows/nodeRegistry";

export type NodeContextMenuActions = {
  onOpen?: () => void;
  onExecuteStep?: () => void;
  onRename?: () => void;
  onToggleDisable?: () => void;
  onCopy?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onTidy?: () => void;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
};

type Props = {
  nodeId: string;
  nodeType: string;
  data: WorkflowNodeData;
  children: React.ReactNode;
  actions: NodeContextMenuActions;
};

export function WorkflowNodeContextMenu({
  nodeType,
  data,
  children,
  actions,
}: Props) {
  const canExecute = nodeSupports(nodeType as never, "execute_step") && !data.disabled;
  const canDisable = nodeSupports(nodeType as never, "disable");
  const canPin = nodeSupports(nodeType as never, "pin");

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={actions.onOpen}>Open</ContextMenuItem>
        {canExecute && (
          <ContextMenuItem onClick={actions.onExecuteStep}>
            Run step
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={actions.onRename}>Rename</ContextMenuItem>
        {canDisable && (
          <ContextMenuItem onClick={actions.onToggleDisable}>
            {data.disabled ? "Enable" : "Disable"}
          </ContextMenuItem>
        )}
        {canPin && (
          <ContextMenuItem disabled title="Pin from the Output panel after a run">
            Pin / test data
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={actions.onCopy}>Copy</ContextMenuItem>
        <ContextMenuItem onClick={actions.onDuplicate}>Duplicate</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={actions.onTidy}>Auto arrange</ContextMenuItem>
        <ContextMenuItem onClick={actions.onSelectAll}>Select all</ContextMenuItem>
        <ContextMenuItem onClick={actions.onClearSelection}>
          Clear selection
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onClick={actions.onDelete}
        >
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
