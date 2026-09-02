import type { Edge, Node } from "@xyflow/react";
import type { WorkflowDefinition } from "./types";

export type WorkflowSnapshot = {
  nodes: Node[];
  edges: Edge[];
};

const CLIPBOARD_MIME = "application/x-opsai-workflow-nodes";

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
  const ts = Date.now();
  snapshot.nodes.forEach((n, i) => {
    idMap.set(n.id, `${n.type || "node"}-${ts}-${i}`);
  });

  const nodes = snapshot.nodes.map((n) => ({
    ...n,
    id: idMap.get(n.id)!,
    position: {
      x: n.position.x + offset.x,
      y: n.position.y + offset.y,
    },
    selected: true,
    data: {
      ...n.data,
      runStatus: undefined,
      runPreview: undefined,
      pinned: undefined,
      pinnedOutput: undefined,
      pinnedItems: undefined,
    },
  }));

  const edges = snapshot.edges.map((e, i) => ({
    ...e,
    id: `e-paste-${ts}-${i}`,
    source: idMap.get(e.source)!,
    target: idMap.get(e.target)!,
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
  nodes: snapshot.nodes.map((n) => ({
    id: n.id,
    type: (n.type || "ai") as WorkflowDefinition["nodes"][0]["type"],
    position: n.position,
    data: n.data as WorkflowDefinition["nodes"][0]["data"],
  })),
  edges: snapshot.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
  })),
});

export { CLIPBOARD_MIME };
