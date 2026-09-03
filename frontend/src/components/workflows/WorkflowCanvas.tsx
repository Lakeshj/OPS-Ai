"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  reconnectEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toast } from "sonner";

import { WorkflowNode } from "./WorkflowNode";
import { WorkflowEdge } from "./WorkflowEdge";
import { WorkflowCanvasProvider } from "./WorkflowCanvasContext";
import { NodeLibrarySidebar } from "./NodeLibrarySidebar";
import { WorkflowResultsDialog } from "./WorkflowResultsDialog";
import { WorkflowNodeDialog } from "./WorkflowNodeDialog";
import { NodePickerDialog } from "./NodePickerDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CircleDot, LayoutGrid, Plus, Settings2 } from "lucide-react";
import type {
  EditorInvalidationEvent,
  WorkflowDefinition,
  WorkflowEditorSession,
  WorkflowNodeData,
  WorkflowNodeType,
  WorkflowRun,
  WorkflowStatus,
} from "@/modules/workflows/types";
import {
  getLoopConnectionError,
  validateLoopGraph,
  findLoopRegionForNode,
} from "@/modules/workflows/loopValidation";
import { layoutWorkflowGraph } from "@/modules/workflows/workflowLayout";
import {
  getNodeConfigIssues,
  nodeHasMissingConfig,
} from "@/modules/workflows/nodeValidation";
import { getNodeContract } from "@/modules/workflows/nodeRegistry";
import {
  isValidSwitchSourceHandle,
  normalizeDefinitionSwitchNodes,
  normalizeSwitchRules,
  pruneInvalidSwitchEdges,
  prunePinnedPortOutputs,
} from "@/modules/workflows/dynamicPorts";
import {
  resolveEngineType,
  type LibraryNode,
} from "@/modules/workflows/nodeLibrary";
import { useWorkflowHistory } from "@/modules/workflows/useWorkflowHistory";
import {
  duplicateSnapshot,
  pasteSnapshot,
  readClipboard,
  serializeSelection,
  writeClipboard,
} from "@/modules/workflows/workflowClipboard";
import { workflowsApi } from "@/modules/workflows/api";

const UI_ONLY_DATA_KEYS = new Set(["label", "runStatus", "runPreview", "cacheDirty"]);

function isExecutionAffectingPatch(patch: WorkflowNodeData): boolean {
  return Object.keys(patch).some((key) => !UI_ONLY_DATA_KEYS.has(key));
}

type RightPanel = "library" | null;

const nodeTypes = {
  trigger: WorkflowNode,
  schedule: WorkflowNode,
  webhook: WorkflowNode,
  ai: WorkflowNode,
  bot: WorkflowNode,
  http: WorkflowNode,
  splitOut: WorkflowNode,
  filter: WorkflowNode,
  limit: WorkflowNode,
  sort: WorkflowNode,
  removeDuplicates: WorkflowNode,
  aggregate: WorkflowNode,
  merge: WorkflowNode,
  code: WorkflowNode,
  condition: WorkflowNode,
  switch: WorkflowNode,
  set: WorkflowNode,
  document: WorkflowNode,
  spreadsheet: WorkflowNode,
  email: WorkflowNode,
  result: WorkflowNode,
  noop: WorkflowNode,
  integration: WorkflowNode,
};

const edgeTypes = {
  workflow: WorkflowEdge,
};

const defaultEdgeOptions = {
  type: "workflow",
  animated: false,
  reconnectable: true,
};

const START_TYPES = new Set(["trigger", "schedule", "webhook"]);

type PickerTarget =
  | { kind: "insert"; edgeId: string }
  | { kind: "append"; sourceId: string; sourceHandle?: string | null };

const isValidWorkflowConnection = (
  connection: Connection,
  nodes: Node[],
  edges: Edge[]
): boolean => {
  if (!connection.source || !connection.target) return false;
  if (connection.source === connection.target) return false;

  const sourceNode = nodes.find((n) => n.id === connection.source);
  const targetNode = nodes.find((n) => n.id === connection.target);
  if (!sourceNode || !targetNode) return false;

  const targetType = String(targetNode.type);
  if (START_TYPES.has(targetType)) return false;

  const duplicate = edges.some(
    (e) =>
      e.source === connection.source &&
      e.target === connection.target &&
      (e.sourceHandle || null) === (connection.sourceHandle || null) &&
      (e.targetHandle || null) === (connection.targetHandle || null)
  );
  if (duplicate) return false;

  const sourceType = String(sourceNode.type);
  if (sourceType === "switch") {
    const sourceData = normalizeSwitchRules(
      (sourceNode.data || {}) as WorkflowNodeData,
      sourceNode.id
    );
    if (
      connection.sourceHandle &&
      !isValidSwitchSourceHandle(
        connection.sourceHandle,
        sourceData,
        sourceNode.id
      )
    ) {
      return false;
    }
    if (!connection.sourceHandle) return false;
  }

  if (connection.targetHandle) {
    const contract = getNodeContract(
      targetType as import("@/modules/workflows/types").WorkflowNodeType
    );
    const portDef = contract.inputs.find((p) => p.id === connection.targetHandle);
    if (portDef?.maxConnections === 1) {
      const portTaken = edges.some(
        (e) =>
          e.target === connection.target &&
          (e.targetHandle || null) === (connection.targetHandle || null)
      );
      if (portTaken) return false;
    }
  }

  if (getLoopConnectionError(connection, nodes, edges)) return false;

  return true;
};

/** Message for toast when connection rejected (Loop-aware). */
const getConnectionRejectMessage = (
  connection: Connection,
  nodes: Node[],
  edges: Edge[]
): string =>
  getLoopConnectionError(connection, nodes, edges) || "Invalid connection";

type Props = {
  name: string;
  onNameChange: (name: string) => void;
  definition: WorkflowDefinition;
  onSave: (definition: WorkflowDefinition) => Promise<void>;
  onRun: (input: Record<string, unknown>) => Promise<void>;
  saving?: boolean;
  running?: boolean;
  latestRun?: WorkflowRun | null;
  workspaceId?: string;
  workflowId?: string;
  workflowStatus?: WorkflowStatus;
  onPublish?: () => Promise<void>;
  onResumeRun?: () => void | Promise<void>;
  resuming?: boolean;
};

function formatStepOutput(output: unknown): string {
  if (output == null) return "";
  if (typeof output === "string") return unwrapMessageJson(output);
  if (typeof output !== "object") return String(output);

  const obj = output as Record<string, unknown>;
  if (typeof obj.text === "string") return obj.text;

  if (obj.result != null) {
    if (typeof obj.result === "string") return unwrapMessageJson(obj.result);
    if (typeof obj.result === "object") {
      const nested = obj.result as Record<string, unknown>;
      if (nested.message != null) return String(nested.message);
      if (typeof nested.text === "string") return nested.text;
      try {
        return JSON.stringify(obj.result, null, 2);
      } catch {
        return String(obj.result);
      }
    }
    return String(obj.result);
  }

  if (obj.message != null && Object.keys(obj).length <= 2) {
    return String(obj.message);
  }

  if (obj.body != null) {
    if (typeof obj.body === "string") {
      return `HTTP ${obj.status ?? ""} — ${obj.body}`.trim();
    }
    return `HTTP ${obj.status ?? ""}\n${JSON.stringify(obj.body, null, 2)}`.trim();
  }

  if (typeof obj.pass === "boolean") {
    return `Condition ${obj.pass ? "passed" : "failed"} (${obj.operator ?? "equals"})`;
  }

  if (obj.fields && typeof obj.fields === "object") {
    try {
      return JSON.stringify(obj.fields, null, 2);
    } catch {
      return "Set fields";
    }
  }

  if (Array.isArray(obj.rows) && obj.rowCount != null) {
    return `Spreadsheet “${String(obj.name || obj.sheet || "file")}”: ${obj.rowCount} row(s)${
      obj.truncated ? " (truncated)" : ""
    }`;
  }

  if (obj.sent != null) {
    return `Email ${obj.sent ? "sent" : "skipped"} → ${String(obj.to || "")}`;
  }

  if (obj.triggered) {
    const input = obj.input;
    if (typeof input === "string") return `Triggered with: ${input}`;
    if (input && typeof input === "object" && "message" in (input as object)) {
      return `Triggered with: ${String((input as { message?: unknown }).message ?? "")}`;
    }
    return `Triggered (${String(obj.kind || "manual")})`;
  }

  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

function unwrapMessageJson(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return value;
  try {
    const parsed = JSON.parse(trimmed) as { message?: unknown };
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      parsed.message != null &&
      Object.keys(parsed).length <= 2
    ) {
      return String(parsed.message);
    }
  } catch {
    // keep original
  }
  return value;
}

const defaultDataForType = (type: WorkflowNodeType): WorkflowNodeData => {
  switch (type) {
    case "ai":
      return {
        label: "AI",
        nodeType: "ai",
        provider: "openai",
        systemPrompt:
          "You are a helpful workflow assistant. Use the provided data to answer the user request. Do not dump the entire dataset unless asked.",
        prompt: "{{input}}",
      };
    case "bot":
      return {
        label: "Bot (@assistant)",
        nodeType: "bot",
        assistantId: "",
        assistantName: "",
        systemPrompt: "",
        prompt: "{{input}}",
      };
    case "http":
      return {
        label: "HTTP Request",
        nodeType: "http",
        method: "GET",
        url: "",
      };
    case "condition":
      return {
        label: "Condition",
        nodeType: "condition",
        left: "{{input}}",
        operator: "contains",
        right: "",
      };
    case "switch":
      return {
        label: "Switch",
        nodeType: "switch",
        routingMode: "firstMatch",
        enableFallback: true,
        rules: [
          {
            left: "{{item}}",
            operator: "equals",
            right: "",
            label: "Rule 1",
          },
        ],
      };
    case "set":
      return {
        label: "Set fields",
        nodeType: "set",
        mappings: [{ key: "text", value: "{{input}}" }],
      };
    case "document":
      return {
        label: "Document",
        nodeType: "document",
        documentId: "",
        documentName: "",
      };
    case "spreadsheet":
      return {
        label: "Spreadsheet File",
        nodeType: "spreadsheet",
        documentId: "",
        documentName: "",
        sheetName: "",
        hasHeader: true,
        rowLimit: 2000,
        available: true,
      };
    case "email":
      return {
        label: "Send email",
        nodeType: "email",
        to: "",
        subject: "Workflow result",
        emailBody: "{{steps.ai-1.text}}",
      };
    case "schedule":
      return {
        label: "Schedule",
        nodeType: "schedule",
        cron: "0 9 * * 1-5",
        timezone: "UTC",
      };
    case "webhook":
      return {
        label: "Webhook",
        nodeType: "webhook",
      };
    case "splitOut":
      return {
        label: "Split Out",
        nodeType: "splitOut",
        fieldName: "",
      };
    case "filter":
      return {
        label: "Filter",
        nodeType: "filter",
        fieldName: "",
        operator: "is_not_empty",
        right: "",
      };
    case "limit":
      return {
        label: "Limit",
        nodeType: "limit",
        maxItems: 10,
        keep: "first",
      };
    case "sort":
      return {
        label: "Sort",
        nodeType: "sort",
        fieldName: "",
        direction: "desc",
      };
    case "removeDuplicates":
      return {
        label: "Remove Duplicates",
        nodeType: "removeDuplicates",
        fieldName: "",
      };
    case "aggregate":
      return {
        label: "Aggregate",
        nodeType: "aggregate",
        operation: "count",
        fieldName: "",
      };
    case "merge":
      return { label: "Merge", nodeType: "merge", mode: "append" };
    case "code":
      return {
        label: "Code",
        nodeType: "code",
        mode: "all",
        timeoutMs: 2000,
        code: "// items = the incoming rows, input = Run input, steps = earlier outputs\nreturn items;",
      };
    case "result":
      return { label: "Result", nodeType: "result", mapFrom: "{{input}}" };
    case "noop":
      return { label: "No Operation", nodeType: "noop", available: true };
    case "integration":
      return {
        label: "Integration",
        nodeType: "integration",
        available: false,
      };
    case "trigger":
    default:
      return { label: "Manual Trigger", nodeType: "trigger" };
  }
};

const dataFromLibraryNode = (node: LibraryNode): WorkflowNodeData => {
  const engineType = resolveEngineType(node);
  const base = defaultDataForType(engineType);
  return {
    ...base,
    label: node.name,
    nodeType: engineType,
    libraryId: node.id,
    libraryCategory: node.category,
    libraryProvider: node.provider || undefined,
    available: node.available,
    ...(engineType === "ai" && node.provider
      ? {
          provider:
            node.provider.toLowerCase().includes("gemini")
              ? "gemini"
              : node.provider.toLowerCase().includes("deepseek")
                ? "deepseek"
                : node.provider.toLowerCase().includes("openai")
                  ? "openai"
                  : base.provider,
        }
      : {}),
  };
};

const aiTemplateDefinition = (): WorkflowDefinition => ({
  version: 1,
  nodes: [
    {
      id: "trigger-1",
      type: "trigger",
      position: { x: 40, y: 200 },
      data: { label: "Manual Trigger", nodeType: "trigger" },
    },
    {
      id: "ai-1",
      type: "ai",
      position: { x: 300, y: 200 },
      data: defaultDataForType("ai"),
    },
    {
      id: "result-1",
      type: "result",
      position: { x: 560, y: 200 },
      data: {
        label: "Result",
        nodeType: "result",
        mapFrom: "{{steps.ai-1.text}}",
      },
    },
  ],
  edges: [
    { id: "e-trigger-ai", source: "trigger-1", target: "ai-1" },
    { id: "e-ai-result", source: "ai-1", target: "result-1" },
  ],
});

const emailTemplateDefinition = (): WorkflowDefinition => ({
  version: 1,
  nodes: [
    {
      id: "schedule-1",
      type: "schedule",
      position: { x: 20, y: 200 },
      data: defaultDataForType("schedule"),
    },
    {
      id: "ai-1",
      type: "ai",
      position: { x: 280, y: 200 },
      data: defaultDataForType("ai"),
    },
    {
      id: "email-1",
      type: "email",
      position: { x: 540, y: 200 },
      data: {
        ...defaultDataForType("email"),
        emailBody: "{{steps.ai-1.text}}",
      },
    },
    {
      id: "result-1",
      type: "result",
      position: { x: 800, y: 200 },
      data: {
        label: "Result",
        nodeType: "result",
        mapFrom: "{{steps.ai-1.text}}",
      },
    },
  ],
  edges: [
    { id: "e-schedule-ai", source: "schedule-1", target: "ai-1" },
    { id: "e-ai-email", source: "ai-1", target: "email-1" },
    { id: "e-email-result", source: "email-1", target: "result-1" },
  ],
});

const toFlowNodes = (
  definition: WorkflowDefinition,
  latestRun?: WorkflowRun | null
): Node[] => {
  const stepByNode = new Map((latestRun?.steps || []).map((s) => [s.nodeId, s]));
  return (definition.nodes || []).map((n) => {
    const step = stepByNode.get(n.id);
    const preview = step?.output != null ? formatStepOutput(step.output) : "";
    const rawData = (n.data || {}) as WorkflowNodeData;
    const normalizedData =
      n.type === "switch" ? normalizeSwitchRules(rawData, n.id) : rawData;
    return {
      id: n.id,
      type: n.type,
      position: n.position,
      data: {
        ...normalizedData,
        label: normalizedData.label || n.type,
        runStatus: step?.status,
        runPreview: preview ? preview.slice(0, 120) : undefined,
      },
    };
  });
};

const toFlowEdges = (
  definition: WorkflowDefinition,
  edgeMeta?: Record<string, { runStatus?: string }>
): Edge[] =>
  (definition.edges || []).map((e) => {
    const targetNode = (definition.nodes || []).find((n) => n.id === e.target);
    const loopContinue =
      String(targetNode?.type || "") === "loop" &&
      String(e.targetHandle || "") === "continue";
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle || undefined,
      targetHandle: e.targetHandle || undefined,
      type: "workflow",
      className: "group",
      data: {
        ...(edgeMeta?.[e.id] || {}),
        ...(loopContinue ? { loopContinue: true } : {}),
      },
    };
  });

const LLM_TYPES = new Set(["ai", "bot"]);
/** Nodes that produce data a Result node can display directly. */
const LOADER_TYPES = new Set([
  "spreadsheet",
  "document",
  "http",
  "splitOut",
  "filter",
  "limit",
  "sort",
  "removeDuplicates",
  "aggregate",
  "merge",
  "code",
  "set",
]);

const isLlmNode = (n: Node) => LLM_TYPES.has(String(n.type));
const isLoaderNode = (n: Node) => LOADER_TYPES.has(String(n.type));

const autoWireResultMapFrom = (nodes: Node[], edges: Edge[]): Node[] => {
  const llmIds = nodes.filter(isLlmNode).map((n) => n.id);
  const loaderIds = nodes.filter(isLoaderNode).map((n) => n.id);

  return nodes.map((n) => {
    if (n.type !== "result") return n;
    const data = (n.data || {}) as WorkflowNodeData;
    const mapFrom = String(data.mapFrom || "{{input}}");
    const incoming = edges.filter((e) => e.target === n.id).map((e) => e.source);
    const pick = (ids: string[]) =>
      incoming.find((id) => ids.includes(id)) || ids[ids.length - 1];

    const isUnset = mapFrom === "{{input}}" || mapFrom === "{{input.message}}";
    const referenced = /\{\{\s*steps\.([^.}\s]+)/.exec(mapFrom)?.[1];
    const pointsAtLoader = Boolean(referenced && loaderIds.includes(referenced));
    const pointsAtMissingNode = Boolean(
      referenced && !nodes.some((node) => node.id === referenced)
    );

    // An AI/Bot answer always wins over raw loader output.
    if (llmIds.length > 0 && (isUnset || pointsAtLoader || pointsAtMissingNode)) {
      const llmId = pick(llmIds);
      if (llmId) {
        return { ...n, data: { ...data, mapFrom: `{{steps.${llmId}.text}}` } };
      }
    }

    if ((isUnset || pointsAtMissingNode) && loaderIds.length > 0) {
      const loaderId = pick(loaderIds);
      if (loaderId) {
        return { ...n, data: { ...data, mapFrom: `{{steps.${loaderId}.text}}` } };
      }
    }
    return n;
  });
};

/** If an AI/Bot prompt is still generic, inject upstream data + Run input. */
const autoWireAiPrompt = (nodes: Node[], edges: Edge[]): Node[] => {
  const dataNodes = nodes.filter(
    (n) => n.type === "spreadsheet" || n.type === "document"
  );
  if (dataNodes.length === 0) return nodes;

  const isGenericPrompt = (prompt: string) => {
    const p = prompt.trim();
    return (
      !p ||
      p === "{{input}}" ||
      p === "{{input.message}}" ||
      // Placeholder text shipped by an earlier default — replace, never send.
      p.includes("still has no spreadsheet/document block")
    );
  };

  return nodes.map((n) => {
    if (!isLlmNode(n)) return n;
    const data = (n.data || {}) as WorkflowNodeData;
    if (!isGenericPrompt(String(data.prompt || ""))) return n;

    const incoming = new Set(
      edges.filter((e) => e.target === n.id).map((e) => e.source)
    );
    const upstream =
      dataNodes.find((d) => incoming.has(d.id)) ||
      dataNodes[dataNodes.length - 1];
    if (!upstream) return n;

    const kind = upstream.type === "spreadsheet" ? "Spreadsheet" : "Document";
    return {
      ...n,
      data: {
        ...data,
        prompt: `User request (from Run input):\n{{input}}\n\n${kind} data:\n{{steps.${upstream.id}.text}}\n\nAnswer the user request using the ${kind.toLowerCase()} data. Summarize or extract only what was asked — do not return the full sheet unless requested.`,
      },
    };
  });
};

const uniqueEdgeId = (source: string, target: string, handle?: string | null) =>
  `e-${source}-${handle || "default"}-${target}-${Math.random().toString(36).slice(2, 9)}`;

export function WorkflowCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function WorkflowCanvasInner({
  name,
  onNameChange,
  definition,
  onSave,
  onRun,
  saving,
  running,
  latestRun,
  workspaceId,
  workflowId,
  workflowStatus = "draft",
  onPublish,
  onResumeRun,
  resuming,
}: Props) {
  const { fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState(
    toFlowNodes(definition, latestRun)
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(toFlowEdges(definition));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedIdRef = useRef<string | null>(null);
  const [runInput, setRunInput] = useState("");
  const [publishing, setPublishing] = useState(false);
  const hasManualTrigger = useMemo(
    () => nodes.some((n) => n.type === "trigger"),
    [nodes]
  );
  const hasScheduleTrigger = useMemo(
    () => nodes.some((n) => n.type === "schedule"),
    [nodes]
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const [rightPanel, setRightPanel] = useState<RightPanel>(null);
  const [nodeDialogOpen, setNodeDialogOpen] = useState(false);
  const [resultsDialogOpen, setResultsDialogOpen] = useState(false);
  const [editorSession, setEditorSession] = useState<WorkflowEditorSession | null>(
    null
  );
  const [executingNode, setExecutingNode] = useState<string | null>(null);
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [renameNodeId, setRenameNodeId] = useState<string | null>(null);
  const prevRunningRef = useRef(false);
  const history = useWorkflowHistory({ nodes, edges });
  const historyPushedRef = useRef(false);

  const selectedId = selectedIds.size > 0 ? [...selectedIds][0] : null;

  const openNodeDialog = useCallback(() => {
    setNodeDialogOpen(true);
  }, []);

  const togglePanel = useCallback((panel: Exclude<RightPanel, null>) => {
    setRightPanel((prev) => (prev === panel ? null : panel));
  }, []);

  const setSelected = useCallback((id: string | null) => {
    selectedIdRef.current = id;
    setSelectedIds(id ? new Set([id]) : new Set());
  }, []);

  const pushHistory = useCallback(() => {
    history.push(nodes, edges);
  }, [history, nodes, edges]);

  const applyEditorSession = useCallback(
    (session: WorkflowEditorSession) => {
      setEditorSession(session);
      setNodes((prev) =>
        prev.map((n) => ({
          ...n,
          data: {
            ...n.data,
            cacheDirty: Boolean(session.dirtyNodes?.[n.id]?.dirty),
          },
        }))
      );
    },
    [setNodes]
  );

  useEffect(() => {
    if (!workflowId) return;
    workflowsApi
      .getEditorSession(workflowId)
      .then(applyEditorSession)
      .catch(() => setEditorSession(null));
  }, [workflowId, applyEditorSession]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && rightPanel) {
        e.preventDefault();
        setRightPanel(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rightPanel]);

  // After Execute finishes, open the results modal briefly.
  useEffect(() => {
    if (prevRunningRef.current && !running && latestRun) {
      const done =
        latestRun.status === "succeeded" ||
        latestRun.status === "failed" ||
        latestRun.status === "cancelled";
      if (done) {
        setResultsDialogOpen(true);
        const t = window.setTimeout(() => {
          setResultsDialogOpen(false);
        }, 12000);
        prevRunningRef.current = Boolean(running);
        return () => window.clearTimeout(t);
      }
    }
    prevRunningRef.current = Boolean(running);
  }, [running, latestRun]);

  useEffect(() => {
    setNodes(toFlowNodes(definition, latestRun));
    setEdges(toFlowEdges(definition));
  }, [definition, setNodes, setEdges]);

  useEffect(() => {
    if (!latestRun?.steps) return;
    const stepByNode = new Map(latestRun.steps.map((s) => [s.nodeId, s]));
    setNodes((prev) =>
      prev.map((n) => {
        const step = stepByNode.get(n.id);
        if (!step) {
          return {
            ...n,
            data: { ...n.data, runStatus: undefined, runPreview: undefined },
          };
        }
        const preview = step.output != null ? formatStepOutput(step.output) : "";
        return {
          ...n,
          data: {
            ...n.data,
            runStatus: step.status,
            runPreview: preview ? preview.slice(0, 120) : undefined,
          },
        };
      })
    );
  }, [latestRun, setNodes]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) || null,
    [nodes, selectedId]
  );

  const isSimplePassThrough = useMemo(() => {
    const types = new Set(nodes.map((n) => n.type));
    return (
      nodes.length === 2 &&
      (types.has("trigger") || types.has("schedule") || types.has("webhook")) &&
      types.has("result") &&
      !types.has("ai") &&
      !types.has("bot")
    );
  }, [nodes]);

  /**
   * Pinning freezes a node's last output so re-running does not re-hit a slow
   * or paid call. The pin lives in node data, so it saves with the workflow.
   */

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      setEdges((eds) => {
        const exists = eds.some(
          (e) =>
            e.source === connection.source &&
            e.target === connection.target &&
            (e.sourceHandle || null) === (connection.sourceHandle || null)
        );
        if (exists) return eds;
        const targetNode = nodes.find((n) => n.id === connection.target);
        const loopContinue =
          String(targetNode?.type || "") === "loop" &&
          String(connection.targetHandle || "") === "continue";
        return addEdge(
          {
            ...connection,
            id: uniqueEdgeId(
              connection.source,
              connection.target,
              connection.sourceHandle
            ),
            data: loopContinue ? { loopContinue: true } : {},
          },
          eds
        );
      });
    },
    [setEdges, nodes]
  );

  const onSelectionChange = useCallback(
    (params: OnSelectionChangeParams) => {
      const ids = new Set(params.nodes.map((n) => n.id));
      setSelectedIds(ids);
      selectedIdRef.current = params.nodes[0]?.id || null;
    },
    []
  );

  const buildDefinition = useCallback((): WorkflowDefinition => {
    const withAi = autoWireAiPrompt(nodes, edges);
    const wired = autoWireResultMapFrom(withAi, edges);
    const normalizedNodes = normalizeDefinitionSwitchNodes(wired);
    return {
      version: 1,
      nodes: normalizedNodes.map((n) => {
        const data = { ...(n.data || {}) } as WorkflowNodeData & {
          runStatus?: unknown;
          runPreview?: unknown;
        };
        delete data.runStatus;
        delete data.runPreview;
        return {
          id: n.id,
          type: (n.type || "ai") as WorkflowNodeType,
          position: n.position,
          data,
        };
      }),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
      })),
    };
  }, [nodes, edges]);

  const invalidateEditorCache = useCallback(
    async (event: EditorInvalidationEvent) => {
      if (!workflowId) return;
      try {
        const res = await workflowsApi.invalidateEditorSession(workflowId, {
          definition: buildDefinition(),
          event,
        });
        applyEditorSession(res.session);
      } catch {
        // Session invalidation is best-effort; partial runs still reconcile server-side.
      }
    },
    [workflowId, buildDefinition, applyEditorSession]
  );

  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      if (!newConnection.source || !newConnection.target) return;
      const edgesWithoutOld = edges.filter((e) => e.id !== oldEdge.id);
      if (
        !isValidWorkflowConnection(newConnection, nodes, edgesWithoutOld)
      ) {
        toast.error(
          getConnectionRejectMessage(newConnection, nodes, edgesWithoutOld)
        );
        return;
      }
      pushHistory();
      setEdges((eds) => {
        const next = reconnectEdge(oldEdge, newConnection, eds);
        return next.map((e) => {
          if (
            e.source === newConnection.source &&
            e.target === newConnection.target &&
            (e.sourceHandle || null) === (newConnection.sourceHandle || null) &&
            (e.targetHandle || null) === (newConnection.targetHandle || null)
          ) {
            const targetNode = nodes.find((n) => n.id === e.target);
            const loopContinue =
              String(targetNode?.type || "") === "loop" &&
              String(e.targetHandle || "") === "continue";
            return {
              ...e,
              data: {
                ...(e.data || {}),
                loopContinue: loopContinue || undefined,
              },
            };
          }
          return e;
        });
      });
      void invalidateEditorCache({
        type: "edge_reconnect",
        edgeId: oldEdge.id,
        previous: {
          source: oldEdge.source,
          target: oldEdge.target,
          sourceHandle: oldEdge.sourceHandle ?? null,
          targetHandle: oldEdge.targetHandle ?? null,
        },
        current: {
          source: newConnection.source,
          target: newConnection.target,
          sourceHandle: newConnection.sourceHandle ?? null,
          targetHandle: newConnection.targetHandle ?? null,
        },
      });
    },
    [nodes, edges, pushHistory, setEdges, invalidateEditorCache]
  );

  const togglePin = useCallback(
    (nodeId: string) => {
      const step = latestRun?.steps?.find((s) => s.nodeId === nodeId);
      const sessionResult = editorSession?.nodeResults?.[nodeId];
      const node = nodes.find((n) => n.id === nodeId);
      const wasPinned = Boolean((node?.data as WorkflowNodeData)?.pinned);
      const nodeType = String(
        node?.type || (node?.data as WorkflowNodeData)?.nodeType
      );
      const portOutputs = sessionResult?.portOutputs;
      let pinnedNow = false;
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== nodeId) return n;
          const data = n.data as WorkflowNodeData;
          if (data.pinned) {
            const {
              pinned: _p,
              pinnedOutput: _o,
              pinnedItems: _i,
              pinnedPortOutputs: _pp,
              ...rest
            } = data;
            return { ...n, data: rest };
          }
          pinnedNow = true;
          if (nodeType === "switch" && portOutputs) {
            return {
              ...n,
              data: {
                ...data,
                pinned: true,
                pinnedOutput:
                  sessionResult?.output ?? step?.output ?? { pinned: true },
                pinnedItems: Array.isArray(sessionResult?.items)
                  ? sessionResult.items
                  : undefined,
                pinnedPortOutputs: portOutputs,
              },
            };
          }
          return {
            ...n,
            data: {
              ...data,
              pinned: true,
              pinnedOutput: sessionResult?.output ?? step?.output ?? null,
              pinnedItems: Array.isArray(sessionResult?.items)
                ? sessionResult.items
                : undefined,
            },
          };
        })
      );
      void invalidateEditorCache({
        type: "pin",
        nodeId,
        unpinned: wasPinned,
      });
      if (pinnedNow && !step && !sessionResult) {
        toast.message("Pinned with an empty output — run the node once first");
      } else if (pinnedNow && nodeType === "switch" && !portOutputs) {
        toast.message(
          "Run this Switch step first to pin per-rule outputs"
        );
      } else {
        toast.success(
          pinnedNow
            ? "Output pinned — Save to keep it"
            : "Pin removed — Save to keep it"
        );
      }
    },
    [latestRun, setNodes, nodes, invalidateEditorCache, editorSession]
  );

  const parseRunInput = useCallback((): Record<string, unknown> => {
    const raw = runInput.trim();
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : { message: parsed };
    } catch {
      return { message: raw };
    }
  }, [runInput]);

  const executeNodeStep = useCallback(
    async (nodeId: string) => {
      if (!workflowId) {
        toast.error("Save the workflow first");
        return;
      }
      const region = findLoopRegionForNode(nodeId, nodes, edges);
      if (region) {
        const isLoop = region.loopId === nodeId;
        toast.error(
          isLoop
            ? "Loop runs as a complete region. Use Run to a node after Done, or Execute workflow."
            : "Iteration-level rerun inside Loop isn't supported yet. Use Execute workflow or Run to a node after Done."
        );
        return;
      }
      setExecutingNode(nodeId);
      setNodes((prev) =>
        prev.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, runStatus: "running" } }
            : n
        )
      );
      try {
        const def = buildDefinition();
        const res = await workflowsApi.executeNodeStep(workflowId, nodeId, {
          definition: def,
          input: parseRunInput(),
        });
        applyEditorSession(res.session);
        const result = res.results[nodeId];
        setNodes((prev) =>
          prev.map((n) => {
            const r = res.results[n.id];
            if (!r) return n;
            const preview =
              r.output != null ? formatStepOutput(r.output).slice(0, 120) : "";
            return {
              ...n,
              data: {
                ...n.data,
                runStatus: r.status,
                runPreview: preview || undefined,
              },
            };
          })
        );
        if (result?.status === "failed") {
          toast.error(result.error || "Execution failed");
        } else {
          toast.success("Node executed");
        }
      } catch (err) {
        setNodes((prev) =>
          prev.map((n) =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, runStatus: "failed" } }
              : n
          )
        );
        toast.error(err instanceof Error ? err.message : "Execution failed");
      } finally {
        setExecutingNode(null);
      }
    },
    [workflowId, parseRunInput, setNodes, buildDefinition, nodes, edges, applyEditorSession]
  );

  const toggleDisableNode = useCallback(
    (nodeId: string) => {
      pushHistory();
      setNodes((prev) =>
        prev.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  disabled: !(n.data as WorkflowNodeData).disabled,
                },
              }
            : n
        )
      );
      invalidateEditorCache({ type: "disabled", nodeId });
    },
    [pushHistory, setNodes, invalidateEditorCache]
  );

  const duplicateSelection = useCallback(() => {
    if (selectedIds.size === 0) {
      toast.error("Select nodes to duplicate");
      return;
    }
    pushHistory();
    const snap = duplicateSnapshot(nodes, edges, selectedIds);
    setNodes((prev) => [...prev, ...snap.nodes]);
    setEdges((prev) => [...prev, ...snap.edges]);
    setSelectedIds(new Set(snap.nodes.map((n) => n.id)));
    toast.success("Duplicated");
  }, [selectedIds, nodes, edges, pushHistory, setNodes, setEdges]);

  const copySelection = useCallback(async () => {
    if (selectedIds.size === 0) {
      toast.error("Select nodes to copy");
      return;
    }
    const snap = serializeSelection(nodes, edges, selectedIds);
    await writeClipboard(snap);
    toast.success("Copied to clipboard");
  }, [selectedIds, nodes, edges]);

  const pasteSelection = useCallback(async () => {
    const snap = await readClipboard();
    if (!snap) {
      toast.error("Nothing to paste");
      return;
    }
    pushHistory();
    const pasted = pasteSnapshot(snap);
    setNodes((prev) => [...prev, ...pasted.nodes]);
    setEdges((prev) => [...prev, ...pasted.edges]);
    setSelectedIds(new Set(pasted.nodes.map((n) => n.id)));
    toast.success("Pasted");
  }, [pushHistory, setNodes, setEdges]);

  const tidyWorkflow = useCallback(async () => {
    try {
      const result = await layoutWorkflowGraph({ nodes, edges });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      // One undo entry for the whole Tidy (positions only).
      pushHistory();
      setNodes((prev) =>
        prev.map((n) => {
          const pos = result.positions[n.id];
          if (!pos) return n;
          return { ...n, position: { x: pos.x, y: pos.y } };
        })
      );

      // Positions are UI-only — do not invalidate editor execution cache.
      window.requestAnimationFrame(() => {
        void fitView({ padding: 0.18, duration: 280, maxZoom: 1.15 });
      });
      toast.success("Workflow tidied");
    } catch {
      toast.error("Couldn't tidy this workflow.");
    }
  }, [nodes, edges, pushHistory, setNodes, fitView]);

  const deleteEdge = useCallback(
    (edgeId: string) => {
      const edge = edges.find((e) => e.id === edgeId);
      pushHistory();
      setEdges((prev) => prev.filter((e) => e.id !== edgeId));
      setSelectedEdgeId(null);
      if (edge?.target) {
        void invalidateEditorCache({
          type: "edge",
          targetNodeId: edge.target,
        });
      }
      toast.success("Connection removed");
    },
    [pushHistory, setEdges, edges, invalidateEditorCache]
  );

  const insertNodeOnEdge = useCallback(
    (edgeId: string, libraryNode: LibraryNode) => {
      const edge = edges.find((e) => e.id === edgeId);
      if (!edge) return;
      pushHistory();
      const source = nodes.find((n) => n.id === edge.source);
      const target = nodes.find((n) => n.id === edge.target);
      if (!source || !target) return;

      const engineType = resolveEngineType(libraryNode);
      const id = `${engineType}-${Date.now()}`;
      const position = {
        x: (source.position.x + target.position.x) / 2,
        y: (source.position.y + target.position.y) / 2,
      };
      const data =
        engineType === "switch"
          ? normalizeSwitchRules(dataFromLibraryNode(libraryNode), id)
          : dataFromLibraryNode(libraryNode);

      setNodes((prev) => [...prev, { id, type: engineType, position, data }]);
      setEdges((prev) => [
        ...prev.filter((e) => e.id !== edgeId),
        {
          id: uniqueEdgeId(edge.source, id, edge.sourceHandle),
          source: edge.source,
          target: id,
          sourceHandle: edge.sourceHandle,
          type: "workflow",
        },
        {
          id: uniqueEdgeId(id, edge.target, edge.targetHandle),
          source: id,
          target: edge.target,
          targetHandle: edge.targetHandle,
          type: "workflow",
        },
      ]);
      setSelected(id);
      setPickerTarget(null);
      setSelectedEdgeId(null);
      toast.message(
        "Step inserted — downstream now receives this node's output unless you reference upstream explicitly."
      );
      void invalidateEditorCache({
        type: "insert_node",
        newNodeId: id,
        downstreamTargets: [edge.target],
      });
      openNodeDialog();
    },
    [edges, nodes, pushHistory, setNodes, setEdges, setSelected, openNodeDialog, invalidateEditorCache]
  );

  const appendNodeAfter = useCallback(
    (sourceId: string, libraryNode: LibraryNode, sourceHandle?: string | null) => {
      const source = nodes.find((n) => n.id === sourceId);
      if (!source) return;
      pushHistory();
      const engineType = resolveEngineType(libraryNode);
      const id = `${engineType}-${Date.now()}`;
      const position = {
        x: source.position.x + 280,
        y: source.position.y,
      };
      const data =
        engineType === "switch"
          ? normalizeSwitchRules(dataFromLibraryNode(libraryNode), id)
          : dataFromLibraryNode(libraryNode);
      setNodes((prev) => [...prev, { id, type: engineType, position, data }]);
      setEdges((prev) => [
        ...prev,
        {
          id: uniqueEdgeId(sourceId, id, sourceHandle),
          source: sourceId,
          target: id,
          sourceHandle: sourceHandle || undefined,
          type: "workflow",
        },
      ]);
      setSelected(id);
      setPickerTarget(null);
      toast.success(`Added ${libraryNode.name}`);
      openNodeDialog();
    },
    [nodes, pushHistory, setNodes, setEdges, setSelected, openNodeDialog]
  );

  const handlePickerPick = useCallback(
    (libraryNode: LibraryNode) => {
      if (!pickerTarget) return;
      if (pickerTarget.kind === "insert") {
        insertNodeOnEdge(pickerTarget.edgeId, libraryNode);
      } else {
        appendNodeAfter(
          pickerTarget.sourceId,
          libraryNode,
          pickerTarget.sourceHandle
        );
      }
    },
    [pickerTarget, insertNodeOnEdge, appendNodeAfter]
  );

  const flowEdges = useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        type: "workflow",
        className: "group",
        data: {
          ...(e.data || {}),
          onDelete: deleteEdge,
          onInsert: (id: string) =>
            setPickerTarget({ kind: "insert", edgeId: id }),
        },
        selected: e.id === selectedEdgeId,
      })),
    [edges, deleteEdge, selectedEdgeId]
  );

  const insertAiBetween = useCallback(
    (type: "ai" | "bot" = "ai") => {
      const start = nodes.find((n) => START_TYPES.has(String(n.type)));
      const result = nodes.find((n) => n.type === "result");
      if (!start || !result) {
        toast.error("Need both a start node and Result");
        return;
      }

      const id = `${type}-${Date.now()}`;
      const data = defaultDataForType(type);
      const position = {
        x: (start.position.x + result.position.x) / 2,
        y: start.position.y,
      };

      setNodes((prev) => [
        ...prev.map((n) =>
          n.type === "result"
            ? { ...n, data: { ...n.data, mapFrom: `{{steps.${id}.text}}` } }
            : n
        ),
        { id, type, position, data },
      ]);
      setEdges((eds) => {
        const withoutDirect = eds.filter(
          (e) => !(e.source === start.id && e.target === result.id)
        );
        return [
          ...withoutDirect,
          { id: uniqueEdgeId(start.id, id), source: start.id, target: id },
          { id: uniqueEdgeId(id, result.id), source: id, target: result.id },
        ];
      });
      setSelected(id);
      setLocalError(null);
      toast.success(
        type === "bot"
          ? "Bot node inserted — pick a Keyword Assistant in Settings"
          : "AI node inserted — it runs on the default model"
      );
    },
    [nodes, setNodes, setEdges, setSelected]
  );

  const applyAiTemplate = () => {
    if (
      nodes.length > 0 &&
      !confirm("Replace the current canvas with Trigger → AI → Result?")
    ) {
      return;
    }
    const tpl = aiTemplateDefinition();
    setNodes(toFlowNodes(tpl));
    setEdges(toFlowEdges(tpl));
    setSelected("ai-1");
    setLocalError(null);
    toast.success("Applied AI workflow template");
  };

  const applyEmailTemplate = () => {
    if (
      nodes.length > 0 &&
      !confirm(
        "Replace the current canvas with Schedule → AI → Email → Result?"
      )
    ) {
      return;
    }
    const tpl = emailTemplateDefinition();
    setNodes(toFlowNodes(tpl));
    setEdges(toFlowEdges(tpl));
    setSelected("ai-1");
    setLocalError(null);
    toast.success("Applied schedule + email template");
  };

  const deleteSelected = useCallback(() => {
    const id = selectedIdRef.current || selectedId;
    if (!id) {
      toast.error("Click a node on the canvas first, then delete");
      return;
    }
    const node = nodes.find((n) => n.id === id);
    if (!node) {
      toast.error("Selected node not found");
      return;
    }

    // Triggers/schedules/webhooks are deletable — Execute will require a start node later.
    pushHistory();
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.source !== id && e.target !== id));
    setSelected(null);
    setLocalError(null);
    void invalidateEditorCache({ type: "delete", nodeId: id });
    toast.success(`Deleted “${String(node.data?.label || node.type)}”`);
  }, [selectedId, nodes, setNodes, setEdges, setSelected, pushHistory, invalidateEditorCache]);

  const canvasActions = useMemo(
    () => ({
      getNodeActions: (nodeId: string) => ({
        onExecuteStep: () => void executeNodeStep(nodeId),
        onToggleDisable: () => toggleDisableNode(nodeId),
        onDelete: () => {
          setSelected(nodeId);
          selectedIdRef.current = nodeId;
          deleteSelected();
        },
        onDuplicate: duplicateSelection,
        onCopy: () => void copySelection(),
        onRename: () => setRenameNodeId(nodeId),
        onOpen: () => {
          setSelected(nodeId);
          openNodeDialog();
        },
        onTidy: tidyWorkflow,
        onSelectAll: () => setSelectedIds(new Set(nodes.map((n) => n.id))),
        onClearSelection: () => setSelectedIds(new Set()),
      }),
      onAddNextStep: (nodeId: string, sourceHandle?: string | null) => {
        setPickerTarget({ kind: "append", sourceId: nodeId, sourceHandle });
      },
    }),
    [
      executeNodeStep,
      toggleDisableNode,
      duplicateSelection,
      copySelection,
      deleteSelected,
      setSelected,
      openNodeDialog,
      tidyWorkflow,
      nodes,
    ]
  );

  const clearSelected = useCallback(() => {
    const id = selectedIdRef.current || selectedId;
    if (!id) {
      toast.error("Select a node first");
      return;
    }
    const node = nodes.find((n) => n.id === id);
    if (!node) {
      toast.error("Selected node not found");
      return;
    }

    const data = (node.data || {}) as WorkflowNodeData;
    const configured =
      Boolean(data.assistantId) ||
      Boolean(data.url) ||
      Boolean(data.to) ||
      Boolean(data.documentId) ||
      Boolean(data.prompt && data.prompt !== "{{input}}") ||
      (Array.isArray(data.mappings) &&
        data.mappings.some((m) => m.key || (m.value && m.value !== "{{input}}")));

    if (
      configured &&
      !confirm(
        `Clear configuration for “${String(data.label || node.type)}”? This resets fields but keeps the node and connections.`
      )
    ) {
      return;
    }

    const engineType = (node.type || "noop") as WorkflowNodeType;
    const reset = defaultDataForType(engineType);
    setNodes((prev) =>
      prev.map((n) =>
        n.id === id
          ? {
              ...n,
              data: {
                ...reset,
                libraryId: data.libraryId,
                libraryCategory: data.libraryCategory,
                libraryProvider: data.libraryProvider,
                available: data.available,
                label: data.label || reset.label,
              },
            }
          : n
      )
    );
    setLocalError(null);
    toast.success("Node configuration cleared");
  }, [selectedId, nodes, setNodes]);

  const addLibraryNode = (libraryNode: LibraryNode) => {
    setLocalError(null);
    if (!libraryNode.available) {
      toast.message(`${libraryNode.name} isn't available yet`);
      return;
    }
    const engineType = resolveEngineType(libraryNode);

    // Dropping an AI/Bot into a bare Start → Result flow should splice it in.
    if ((engineType === "ai" || engineType === "bot") && isSimplePassThrough) {
      insertAiBetween(engineType);
      setRightPanel(null);
      openNodeDialog();
      return;
    }

    const id = `${engineType}-${Date.now()}`;
    setNodes((prev) => [
      ...prev,
      {
        id,
        type: engineType,
        position: { x: 160 + prev.length * 36, y: 120 + prev.length * 28 },
        data: dataFromLibraryNode(libraryNode),
      },
    ]);
    setSelected(id);
    setRightPanel(null);
    openNodeDialog();
    toast.success(`Added ${libraryNode.name}`);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key === "c") {
        e.preventDefault();
        void copySelection();
        return;
      }
      if (mod && e.key === "v") {
        e.preventDefault();
        void pasteSelection();
        return;
      }
      if (mod && e.key === "d") {
        e.preventDefault();
        duplicateSelection();
        return;
      }
      if (mod && e.key === "a") {
        e.preventDefault();
        setSelectedIds(new Set(nodes.map((n) => n.id)));
        return;
      }
      if (mod && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        const prev = history.undo({ nodes, edges });
        if (prev) {
          setNodes(prev.nodes);
          setEdges(prev.edges);
        }
        return;
      }
      if ((mod && e.key === "y") || (mod && e.shiftKey && e.key === "z")) {
        e.preventDefault();
        const next = history.redo({ nodes, edges });
        if (next) {
          setNodes(next.nodes);
          setEdges(next.edges);
        }
        return;
      }
      if (e.key === "F2" && selectedId) {
        e.preventDefault();
        setRenameNodeId(selectedId);
        return;
      }
      if (e.shiftKey && e.altKey && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        void tidyWorkflow();
        return;
      }
      if (e.key === "Escape") {
        setSelectedIds(new Set());
        setRenameNodeId(null);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        if (selectedEdgeId) {
          deleteEdge(selectedEdgeId);
          return;
        }
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    deleteSelected,
    copySelection,
    pasteSelection,
    duplicateSelection,
    nodes,
    edges,
    history,
    setNodes,
    setEdges,
    selectedId,
    selectedEdgeId,
    deleteEdge,
    pushHistory,
    tidyWorkflow,
  ]);

  const updateSelectedData = (patch: WorkflowNodeData) => {
    if (!selectedId) return;
    const prev = (selectedNode?.data || {}) as WorkflowNodeData;
    const selectedType = String(selectedNode?.type || prev.nodeType || "");
    let nextPatch = patch;

    if (selectedType === "switch") {
      const merged = prunePinnedPortOutputs(
        normalizeSwitchRules({ ...prev, ...patch }, selectedId),
        selectedId
      );
      nextPatch = merged;
      const pruned = pruneInvalidSwitchEdges(edges, selectedId, merged);
      if (pruned.length !== edges.length) {
        setEdges(pruned);
      }
    }

    if (isExecutionAffectingPatch(nextPatch)) {
      if (
        prev.pinned &&
        patch.pinnedOutput !== undefined &&
        patch.pinnedOutput !== prev.pinnedOutput
      ) {
        void invalidateEditorCache({
          type: "pin",
          nodeId: selectedId,
          pinContentChanged: true,
        });
      } else {
        void invalidateEditorCache({ type: "params", nodeId: selectedId });
      }
    }
    setNodes((prevNodes) =>
      prevNodes.map((n) =>
        n.id === selectedId ? { ...n, data: { ...n.data, ...nextPatch } } : n
      )
    );
  };

  const validateForRun = (): string | null => {
    if (!nodes.some((n) => START_TYPES.has(String(n.type)))) {
      return "Add a Trigger, Schedule, or Webhook start node before Execute";
    }
    if (!nodes.some((n) => n.type === "result")) {
      return "Add a Result node to finish the workflow";
    }
    if (edges.length === 0) {
      return "Connect nodes by dragging from one handle to another";
    }
    if (isSimplePassThrough) {
      return "This only echoes input. Insert an AI node (or use a template) for a real reply.";
    }

    const loopCheck = validateLoopGraph(nodes, edges);
    if (!loopCheck.ok) {
      return loopCheck.message || "Invalid Loop topology";
    }

    for (const n of nodes) {
      const data = (n.data || {}) as WorkflowNodeData;
      if (n.type === "integration" || data.available === false) {
        return `${String(data.label || n.type)} is not executable yet — remove it or replace with an available node`;
      }
      const issues = getNodeConfigIssues(n.type as WorkflowNodeType, data);
      if (issues.length > 0) {
        const label = String(data.label || n.type || "node");
        return `${label}: ${issues[0]}`;
      }
    }
    return null;
  };

  const handleSave = async () => {
    try {
      setLocalError(null);
      if (isSimplePassThrough) {
        toast.message("Saved — tip: insert AI for a real reply");
      }
      const def = buildDefinition();
      setNodes(toFlowNodes(def, latestRun));
      await onSave(def);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save workflow";
      setLocalError(message);
      toast.error(message);
    }
  };

  const handleRun = async () => {
    try {
      setLocalError(null);
      const err = validateForRun();
      if (err) {
        setLocalError(err);
        toast.error(err);
        const incomplete = nodes.find((n) =>
          nodeHasMissingConfig(
            n.type as WorkflowNodeType,
            (n.data || {}) as WorkflowNodeData
          )
        );
        if (incomplete) setSelected(incomplete.id);
        return;
      }

      let input: Record<string, unknown> = {};
      const raw = runInput.trim();
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          input =
            parsed && typeof parsed === "object" && !Array.isArray(parsed)
              ? (parsed as Record<string, unknown>)
              : { message: parsed };
        } catch {
          input = { message: raw };
        }
      }

      const def = buildDefinition();
      setNodes(toFlowNodes(def, latestRun));
      await onSave(def);
      await onRun({ ...input, source: "manual" });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to run workflow";
      setLocalError(message);
      toast.error(message);
    }
  };

  const handlePublish = async () => {
    if (!onPublish) return;
    setPublishing(true);
    try {
      const def = buildDefinition();
      await onSave(def);
      await onPublish();
      toast.success("Workflow published — schedule triggers are now active");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to publish");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="flex h-full min-h-[520px] flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[180px] flex-1">
          <Label>Workflow name</Label>
          <Input value={name} onChange={(e) => onNameChange(e.target.value)} />
        </div>
        <Button type="button" variant="outline" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
        <Button type="button" onClick={handleRun} disabled={running || saving}>
          {running ? "Executing..." : "Execute"}
        </Button>
        {onPublish && (
          <Button
            type="button"
            variant={workflowStatus === "active" ? "secondary" : "default"}
            disabled={publishing || saving || workflowStatus === "active"}
            onClick={() => void handlePublish()}
            title={
              hasScheduleTrigger
                ? "Publish to enable automatic schedule runs"
                : "Mark workflow as active"
            }
          >
            {publishing
              ? "Publishing..."
              : workflowStatus === "active"
                ? "Published"
                : "Publish"}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 gap-1"
          onClick={tidyWorkflow}
          title="Tidy workflow (Shift+Alt+T)"
        >
          <LayoutGrid className="h-4 w-4" />
          <span className="hidden sm:inline">Tidy</span>
        </Button>
        <div className="flex items-center gap-1 rounded-lg border bg-card p-0.5">
          <Button
            type="button"
            size="sm"
            variant={rightPanel === "library" ? "secondary" : "ghost"}
            className="h-8 gap-1.5"
            onClick={() => togglePanel("library")}
            title="Node Library"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Nodes</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant={resultsDialogOpen ? "secondary" : "ghost"}
            className="h-8 gap-1.5"
            onClick={() => setResultsDialogOpen((v) => !v)}
            title="Results"
          >
            <CircleDot className="h-4 w-4" />
            <span className="hidden sm:inline">Results</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant={nodeDialogOpen ? "secondary" : "ghost"}
            className="h-8 gap-1.5"
            onClick={() => {
              if (selectedId) openNodeDialog();
              else toast.message("Select a node on the canvas first");
            }}
            title="Node settings"
          >
            <Settings2 className="h-4 w-4" />
            <span className="hidden sm:inline">Node</span>
          </Button>
        </div>
      </div>

      {(hasManualTrigger || hasScheduleTrigger) && (
        <div className="rounded-lg border bg-muted/20 px-3 py-2">
          <Label className="text-xs">
            {hasManualTrigger ? "Run input (for manual trigger)" : "Optional run context"}
          </Label>
          <Textarea
            value={runInput}
            onChange={(e) => setRunInput(e.target.value)}
            rows={2}
            className="mt-1.5 min-h-[52px] resize-y bg-background text-xs"
            placeholder='Message for AI steps — e.g. "Summarize top rows"'
          />
          {hasScheduleTrigger && workflowStatus !== "active" && (
            <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-300">
              Schedule runs automatically only after you Publish. Use Execute for a manual test run.
            </p>
          )}
        </div>
      )}

      {isSimplePassThrough && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
          <div>
            <span className="font-medium">This only passes input through.</span>{" "}
            <span className="text-muted-foreground">
              Insert an AI step (or a Bot node to use a Keyword Assistant) for
              a real answer.
            </span>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              insertAiBetween();
              openNodeDialog();
            }}
          >
            Insert AI node
          </Button>
        </div>
      )}

      {(localError || (latestRun?.status === "failed" && latestRun.error)) &&
        !resultsDialogOpen && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <div className="font-medium">Error</div>
            <div className="mt-0.5 whitespace-pre-wrap">
              {localError || latestRun?.error}
            </div>
          </div>
        )}

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-background">
        <WorkflowCanvasProvider value={canvasActions}>
        <div className="workflow-canvas-shell absolute inset-0">
          <ReactFlow
            nodes={nodes.map((n) => ({
              ...n,
              selected: selectedIds.has(n.id),
            }))}
            edges={flowEdges}
            onNodesChange={(changes) => {
              const hasMove = changes.some(
                (c) => c.type === "position" && c.dragging === false
              );
              if (hasMove && !historyPushedRef.current) {
                pushHistory();
                historyPushedRef.current = true;
                setTimeout(() => {
                  historyPushedRef.current = false;
                }, 0);
              }
              onNodesChange(changes);
            }}
            onEdgesChange={onEdgesChange}
            onReconnect={onReconnect}
            edgesReconnectable
            reconnectRadius={24}
            onConnect={(c) => {
              if (!isValidWorkflowConnection(c, nodes, edges)) {
                toast.error(getConnectionRejectMessage(c, nodes, edges));
                return;
              }
              pushHistory();
              onConnect(c);
              if (c.target) {
                void invalidateEditorCache({
                  type: "edge",
                  targetNodeId: c.target,
                });
              }
            }}
            onSelectionChange={onSelectionChange}
            onEdgeClick={(_e, edge) => {
              setSelectedEdgeId(edge.id);
              setSelectedIds(new Set());
            }}
            onEdgeContextMenu={(e, edge) => {
              e.preventDefault();
              setSelectedEdgeId(edge.id);
            }}
            isValidConnection={(c) =>
              isValidWorkflowConnection(
                {
                  source: c.source ?? "",
                  target: c.target ?? "",
                  sourceHandle: c.sourceHandle ?? null,
                  targetHandle: c.targetHandle ?? null,
                },
                nodes,
                edges
              )
            }
            connectionRadius={28}
            snapToGrid
            snapGrid={[18, 18]}
            onNodeClick={(_e, node) => {
              setSelectedEdgeId(null);
              setSelected(node.id);
              openNodeDialog();
            }}
            onPaneClick={() => {
              setSelectedIds(new Set());
              setSelectedEdgeId(null);
            }}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            fitView
            deleteKeyCode={null}
            multiSelectionKeyCode="Shift"
            selectionOnDrag
            panOnDrag={[1, 2]}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={18} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
        </WorkflowCanvasProvider>

        {/* Floating open control when panels closed (mobile-friendly) */}
        {rightPanel == null && (
          <Button
            type="button"
            className="absolute bottom-4 right-4 z-20 gap-1.5 shadow-lg sm:hidden"
            onClick={() => setRightPanel("library")}
          >
            <Plus className="h-4 w-4" />
            Nodes
          </Button>
        )}

        <NodeLibrarySidebar
          open={rightPanel === "library"}
          onClose={() => setRightPanel(null)}
          onAddLibraryNode={addLibraryNode}
          onApplyAiTemplate={applyAiTemplate}
          onApplyEmailTemplate={applyEmailTemplate}
        />
      </div>

      <WorkflowResultsDialog
        open={resultsDialogOpen}
        onOpenChange={setResultsDialogOpen}
        latestRun={latestRun}
        formatStepOutput={formatStepOutput}
        onSelectStepNode={(nodeId) => {
          setSelected(nodeId);
          setResultsDialogOpen(false);
          openNodeDialog();
        }}
        onTogglePin={togglePin}
        isPinned={(nodeId) =>
          Boolean(
            (nodes.find((n) => n.id === nodeId)?.data as WorkflowNodeData)
              ?.pinned
          )
        }
        onResumeRun={onResumeRun}
        resuming={resuming}
      />

      <WorkflowNodeDialog
        open={nodeDialogOpen}
        onOpenChange={setNodeDialogOpen}
        selectedId={selectedNode?.id || null}
        selectedType={(selectedNode?.type as WorkflowNodeType) || null}
        selectedData={(selectedNode?.data as WorkflowNodeData) || null}
        onChange={updateSelectedData}
        onClear={clearSelected}
        onDelete={deleteSelected}
        runInput={runInput}
        onRunInputChange={setRunInput}
        workspaceId={workspaceId}
        workflowId={workflowId}
        definition={buildDefinition()}
        editorSession={editorSession}
        onEditorSessionChange={setEditorSession}
        latestRun={latestRun}
        onTogglePin={togglePin}
        workflowStatus={workflowStatus}
        onExecuteWorkflow={() => void handleRun()}
      />

      <NodePickerDialog
        open={pickerTarget != null}
        onOpenChange={(open) => {
          if (!open) setPickerTarget(null);
        }}
        title={
          pickerTarget?.kind === "insert"
            ? "Insert step on connection"
            : "Add next step"
        }
        description={
          pickerTarget?.kind === "insert"
            ? "The new step will sit between the connected nodes."
            : "A new branch will be created from this output."
        }
        onPick={handlePickerPick}
      />

      {selectedEdgeId && (
        <div className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 gap-2 rounded-lg border bg-card p-2 shadow-lg">
          <span className="self-center text-xs text-muted-foreground">
            Connection selected
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() =>
              setPickerTarget({ kind: "insert", edgeId: selectedEdgeId })
            }
          >
            Insert step
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="h-7 text-xs"
            onClick={() => deleteEdge(selectedEdgeId)}
          >
            Delete connection
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setSelectedEdgeId(null)}
          >
            Cancel
          </Button>
        </div>
      )}

      {renameNodeId && (
        <div className="fixed left-1/2 top-24 z-50 w-72 -translate-x-1/2 rounded-lg border bg-card p-3 shadow-lg">
          <Label className="text-xs">Rename node</Label>
          <Input
            autoFocus
            className="mt-1 h-8"
            defaultValue={String(
              nodes.find((n) => n.id === renameNodeId)?.data?.label || ""
            )}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const val = (e.target as HTMLInputElement).value.trim();
                if (val) {
                  setNodes((prev) =>
                    prev.map((n) =>
                      n.id === renameNodeId
                        ? { ...n, data: { ...n.data, label: val } }
                        : n
                    )
                  );
                }
                setRenameNodeId(null);
              }
              if (e.key === "Escape") setRenameNodeId(null);
            }}
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Expressions using step IDs are unaffected; display name only.
          </p>
        </div>
      )}
    </div>
  );
}
