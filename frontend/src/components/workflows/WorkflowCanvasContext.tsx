"use client";

import React, { createContext, useContext } from "react";
import type { NodeToolbarActions } from "./WorkflowNodeToolbar";
import type { NodeContextMenuActions } from "./WorkflowNodeContextMenu";

export type WorkflowCanvasActions = {
  getNodeActions: (nodeId: string) => NodeToolbarActions & NodeContextMenuActions;
  onAddNextStep?: (nodeId: string, sourceHandle?: string | null) => void;
  /** Part 12C — typed resource picker for Agent auxiliary inputs */
  onAddResource?: (nodeId: string, targetHandle: string) => void;
};

const WorkflowCanvasContext = createContext<WorkflowCanvasActions | null>(null);

export function WorkflowCanvasProvider({
  value,
  children,
}: {
  value: WorkflowCanvasActions;
  children: React.ReactNode;
}) {
  return (
    <WorkflowCanvasContext.Provider value={value}>
      {children}
    </WorkflowCanvasContext.Provider>
  );
}

export function useWorkflowCanvasActions() {
  return useContext(WorkflowCanvasContext);
}
