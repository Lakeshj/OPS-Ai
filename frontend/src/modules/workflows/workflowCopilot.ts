/**
 * Part 14A — Frontend Copilot apply helpers.
 * Server validation remains authoritative; this applies a validated plan
 * to the React Flow draft as ONE undoable history transaction.
 */

import type { Edge, Node } from "@xyflow/react";

export type CopilotOperationType =
  | "addNode"
  | "removeNode"
  | "updateNodeParameters"
  | "renameNode"
  | "connectNodes"
  | "disconnectEdge"
  | "reconnectEdge"
  | "setWorkflowSetting";

export interface CopilotOperation {
  type: CopilotOperationType;
  [key: string]: unknown;
}

export interface WorkflowDraftDefinition {
  version?: number;
  nodes: Node[];
  edges: Edge[];
  settings?: Record<string, unknown>;
}

/** Stable short hash for stale-plan protection (mirrors backend shape). */
export function hashWorkflowDefinition(
  definition: WorkflowDraftDefinition
): string {
  const payload = JSON.stringify({
    nodes: definition.nodes || [],
    edges: definition.edges || [],
    settings: definition.settings || {},
  });
  let h = 0;
  for (let i = 0; i < payload.length; i += 1) {
    h = (Math.imul(31, h) + payload.charCodeAt(i)) | 0;
  }
  return `fe-${(h >>> 0).toString(16)}`;
}

/**
 * Apply a server-validated resulting definition in one history step.
 * Caller must push history with the *before* snapshot once, then set state.
 */
export function prepareCopilotHistoryApply(args: {
  before: WorkflowDraftDefinition;
  after: WorkflowDraftDefinition;
  pushHistory: (nodes: Node[], edges: Edge[]) => void;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  source?: string;
}): { historyTransaction: true; source: string } {
  const { before, after, pushHistory, setNodes, setEdges } = args;
  pushHistory(before.nodes, before.edges);
  setNodes(after.nodes);
  setEdges(after.edges);
  return {
    historyTransaction: true,
    source: args.source || "copilot",
  };
}
