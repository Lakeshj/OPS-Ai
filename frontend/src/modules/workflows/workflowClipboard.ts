import type { Edge, Node } from "@xyflow/react";
import type { WorkflowDefinition, WorkflowNodeData } from "./types";
import {
  duplicateSwitchNodeData,
  normalizeSwitchRules,
} from "./dynamicPorts";

export type WorkflowSnapshot = {
  nodes: Node[];
  edges: Edge[];
};

const CLIPBOARD_MIME = "application/x-opsai-workflow-nodes";

const isSwitchNode = (n: Node) =>
  n.type === "switch" || (n.data as WorkflowNodeData)?.nodeType === "switch";

const preparePastedSwitchNode = (
  node: Node,
  newNodeId: string
): { node: Node; ruleIdMap: Map<string, string> } => {
  const normalized = normalizeSwitchRules(
    (node.data || {}) as WorkflowNodeData,
    node.id
  );
  const duplicated = duplicateSwitchNodeData(normalized);
  const oldRules = (normalized.rules || []) as { id: string }[];
  const newRules = (duplicated.rules || []) as { id: string }[];
  const ruleIdMap = new Map<string, string>();
  oldRules.forEach((rule, index) => {
    if (newRules[index]?.id) ruleIdMap.set(rule.id, newRules[index].id);
  });
  return {
    node: {
      ...node,
      id: newNodeId,
      data: duplicated,
    },
    ruleIdMap,
  };
};

export const serializeSelection = (
  nodes: Node[],
  edges: Edge[],
  selectedIds: Set<string>
): WorkflowSnapshot => {
  const selectedNodes = nodes.filter((n) => selectedIds.has(n.id));
  const idSet = new Set(selectedNodes.map((n) => n.id));
  const internalEdges = edges.filter(
    (e) => idSet.has(e.source) && idSet.has(e.target)
  );
  return { nodes: selectedNodes, edges: internalEdges };
};

export const pasteSnapshot = (
  snapshot: WorkflowSnapshot,
  offset = { x: 40, y: 40 }
): WorkflowSnapshot => {
  const idMap = new Map<string, string>();
  const ruleIdMaps = new Map<string, Map<string, string>>();
  const ts = Date.now();
  snapshot.nodes.forEach((n, i) => {
    idMap.set(n.id, `${n.type || "node"}-${ts}-${i}`);
  });

  const nodes = snapshot.nodes.map((n) => {
    const newId = idMap.get(n.id)!;
    if (isSwitchNode(n)) {
      const { node, ruleIdMap } = preparePastedSwitchNode(n, newId);
      ruleIdMaps.set(n.id, ruleIdMap);
      return {
        ...node,
        position: {
          x: (Number(n.position?.x) || 0) + offset.x,
          y: (Number(n.position?.y) || 0) + offset.y,
        },
        selected: true,
        data: {
          ...node.data,
          runStatus: undefined,
          runPreview: undefined,
        },
      };
    }
    return {
      ...n,
      id: newId,
      position: {
        x: (Number(n.position?.x) || 0) + offset.x,
        y: (Number(n.position?.y) || 0) + offset.y,
      },
      selected: true,
      data: {
        ...n.data,
        runStatus: undefined,
        runPreview: undefined,
        pinned: undefined,
        pinnedOutput: undefined,
        pinnedItems: undefined,
        pinnedPortOutputs: undefined,
      },
    };
  });

  const remapSourceHandle = (
    sourceNodeId: string,
    handle: string | null | undefined
  ) => {
    if (!handle) return handle;
    const ruleMap = ruleIdMaps.get(sourceNodeId);
    if (!ruleMap) return handle;
    return ruleMap.get(handle) || handle;
  };

  const edges = snapshot.edges.map((e, i) => ({
    ...e,
    id: `e-paste-${ts}-${i}`,
    source: idMap.get(e.source)!,
    target: idMap.get(e.target)!,
    sourceHandle: remapSourceHandle(e.source, e.sourceHandle) ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
  }));

  return { nodes, edges };
};

export const duplicateSnapshot = (
  nodes: Node[],
  edges: Edge[],
  selectedIds: Set<string>
): WorkflowSnapshot => pasteSnapshot(serializeSelection(nodes, edges, selectedIds));

export const writeClipboard = async (snapshot: WorkflowSnapshot) => {
  const payload = JSON.stringify(snapshot);
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(payload);
  }
  if (typeof window !== "undefined") {
    (window as unknown as { __workflowClipboard?: string }).__workflowClipboard =
      payload;
  }
};

export const readClipboard = async (): Promise<WorkflowSnapshot | null> => {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
      const text = await navigator.clipboard.readText();
      if (text?.startsWith("{")) {
        const parsed = JSON.parse(text) as WorkflowSnapshot;
        if (Array.isArray(parsed.nodes)) return parsed;
      }
    }
  } catch {
    // fall through
  }
  const cached = (window as unknown as { __workflowClipboard?: string })
    .__workflowClipboard;
  if (cached) {
    try {
      return JSON.parse(cached) as WorkflowSnapshot;
    } catch {
      return null;
    }
  }
  return null;
};

export const snapshotToDefinition = (
  snapshot: WorkflowSnapshot
): Pick<WorkflowDefinition, "nodes" | "edges"> => ({
  nodes: snapshot.nodes.map((n, index) => {
    const x = Number(n.position?.x);
    const y = Number(n.position?.y);
    return {
      id: n.id,
      type: (n.type || "ai") as WorkflowDefinition["nodes"][0]["type"],
      position: {
        x: Number.isFinite(x) ? x : 40 + index * 36,
        y: Number.isFinite(y) ? y : 120 + index * 28,
      },
      data: n.data as WorkflowDefinition["nodes"][0]["data"],
    };
  }),
  edges: snapshot.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
  })),
});

export { CLIPBOARD_MIME };
