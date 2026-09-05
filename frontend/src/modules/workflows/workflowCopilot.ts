/**
 * Part 14A — Frontend Copilot apply helpers.
 * Part 14B — Drawer-ready planning API types (UI in 14D).
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

export type CopilotIntent =
  | "EXPLAIN"
  | "BUILD"
  | "CREATE"
  | "MODIFY"
  | "DEBUG"
  | "FIX";

/** Request body for POST /workflows/:id/copilot/plan (drawer). */
export interface CopilotPlanRequest {
  message: string;
  workflowId: string;
  /** Server-issued hash only; omit/empty on fresh turns. Never send fe-* hashes. */
  revisionHash?: string | null;
  selectedNodeId?: string | null;
  runId?: string | null;
  recentConversation?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  clarification?: {
    questionId?: string | null;
    answer?: string;
    answers?: Record<string, string>;
  } | null;
  /** Current unsaved React Flow draft (preferred). */
  currentDraftDefinition?: WorkflowDraftDefinition;
  /** Optional draft definition override (editor state). */
  definition?: WorkflowDraftDefinition;
  /** Picker-resolved #workflow references — IDs only. */
  workflowReferences?: Array<{ workflowId: string }>;
}

export interface CopilotClarifyingQuestion {
  id: string;
  prompt: string;
  field?: string;
  required?: boolean;
}

export interface CopilotPlanEnvelope {
  intent: CopilotIntent;
  summary: string;
  operations: CopilotOperation[];
  unresolvedInputs: Array<{
    nodeId?: string;
    nodeType?: string;
    field: string;
    message: string;
  }>;
  warnings: unknown[];
}

/** Response from POST /workflows/:id/copilot/plan */
export interface CopilotPlanResponse {
  intent: CopilotIntent;
  assistantMessage: string;
  summary: string;
  plan: CopilotPlanEnvelope;
  preview: unknown;
  unresolvedInputs: CopilotPlanEnvelope["unresolvedInputs"];
  clarifyingQuestions: CopilotClarifyingQuestion[];
  assumptions: string[];
  warnings: Array<{ code?: string; message?: string } | string>;
  unsupportedCapabilities?: Array<{ capability: string; reason?: string }>;
  revisionHash: string;
  needsClarification?: boolean;
  /** Always false for planning — Copilot never creates workflow_runs. */
  createdWorkflowRun: false;
  repairRounds?: number;
  /** Part 14C */
  diagnosis?: Record<string, unknown>;
  evidence?: unknown[];
  fixPlan?: {
    summary?: string | null;
    plan?: CopilotPlanEnvelope | null;
    preview?: unknown;
    unresolvedInputs?: CopilotPlanEnvelope["unresolvedInputs"];
    warnings?: Array<{ code?: string; message?: string } | string>;
    destructive?: boolean;
    applicable?: boolean;
  } | null;
  /** Part 14D — authorized #workflow reference summaries */
  workflowReferences?: Array<{
    workflowId: string;
    name?: string | null;
    available?: boolean;
    latestRunStatus?: string | null;
  }>;
}

export interface WorkflowDraftDefinition {
  version?: number;
  nodes: Array<Node | Record<string, unknown>>;
  edges: Array<Edge | Record<string, unknown>>;
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
  pushHistory((before.nodes || []) as Node[], (before.edges || []) as Edge[]);
  setNodes((after.nodes || []) as Node[]);
  setEdges((after.edges || []) as Edge[]);
  return {
    historyTransaction: true,
    source: args.source || "copilot",
  };
}
