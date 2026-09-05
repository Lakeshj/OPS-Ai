/**
 * UX Phase B — graph-aware workflow layout (pure, UI-only).
 * Uses ELK layered LEFT→RIGHT on the forward DAG (Loop Continue excluded from ranking).
 */

import ELK, { type ElkExtendedEdge, type ElkNode } from "elkjs/lib/elk.bundled.js";
import type { Edge, Node } from "@xyflow/react";
import { getNodeContract } from "./nodeContract";
import { resolveNodeOutputPorts } from "./dynamicPorts";
import type { WorkflowNodeData, WorkflowNodeType } from "./types";
import { LOOP_PORTS, isLoopContinueEdge } from "./loopValidation";
import { isAuxiliaryEdge } from "./connectionPorts";

export type LayoutPositionMap = Record<string, { x: number; y: number }>;

export type LayoutWorkflowResult =
  | { ok: true; positions: LayoutPositionMap }
  | { ok: false; message: string };

export type LayoutNodeSize = { width: number; height: number };

const DEFAULT_SIZE: LayoutNodeSize = { width: 200, height: 88 };
const LAYER_GAP = 220;
const NODE_GAP = 100;

const nodeTypeOf = (node: Node) =>
  String(node.type || (node.data as { nodeType?: string } | undefined)?.nodeType || "");

const START_TYPES = new Set([
  "trigger",
  "schedule",
  "webhook",
  "workflowTrigger",
  "errorTrigger",
]);

function hasForwardCycle(nodes: Node[], forwardEdges: Edge[]): boolean {
  const outgoing = new Map<string, string[]>();
  for (const e of forwardEdges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source)!.push(e.target);
  }
  const color = new Map<string, number>();
  const visit = (id: string): boolean => {
    const c = color.get(id) || 0;
    if (c === 1) return true;
    if (c === 2) return false;
    color.set(id, 1);
    for (const next of outgoing.get(id) || []) {
      if (visit(next)) return true;
    }
    color.set(id, 2);
    return false;
  };
  for (const n of nodes) {
    if (!color.has(n.id) && visit(n.id)) return true;
  }
  return false;
}

/**
 * Forward edges for ELK ranking = execution DAG only.
 * Excludes Loop.continue and Part 12A auxiliary resource edges.
 */
export function projectForwardEdges(nodes: Node[], edges: Edge[]): {
  forwardEdges: Edge[];
  loopBackEdges: Edge[];
  auxiliaryEdges: Edge[];
} {
  const forwardEdges: Edge[] = [];
  const loopBackEdges: Edge[] = [];
  const auxiliaryEdges: Edge[] = [];
  for (const e of edges) {
    if (isLoopContinueEdge(e, nodes)) loopBackEdges.push(e);
    else if (isAuxiliaryEdge(e, nodes)) auxiliaryEdges.push(e);
    else forwardEdges.push(e);
  }
  return { forwardEdges, loopBackEdges, auxiliaryEdges };
}

function measureNode(node: Node): LayoutNodeSize {
  const measured = node as Node & {
    measured?: { width?: number; height?: number };
    width?: number;
    height?: number;
  };
  const w = measured.measured?.width ?? measured.width;
  const h = measured.measured?.height ?? measured.height;
  if (typeof w === "number" && typeof h === "number" && w > 0 && h > 0) {
    return { width: w, height: h };
  }
  const t = nodeTypeOf(node);
  if (t === "switch") return { width: 200, height: 120 };
  if (t === "loop" || t === "merge" || t === "condition") {
    return { width: 200, height: 100 };
  }
  return { ...DEFAULT_SIZE };
}

function outputPortOrder(node: Node): string[] {
  const type = nodeTypeOf(node) as WorkflowNodeType;
  const data = (node.data || {}) as WorkflowNodeData;
  try {
    if (type === "condition") return ["true", "false"];
    const ports = resolveNodeOutputPorts(type, data, node.id);
    return ports
      .filter((p) => p.direction === "out")
      .map((p) => p.id);
  } catch {
    return [];
  }
}

function inputPortOrder(node: Node): string[] {
  const type = nodeTypeOf(node) as WorkflowNodeType;
  try {
    const contract = getNodeContract(type);
    return contract.inputs
      .filter((p) => p.direction === "in")
      .map((p) => p.id);
  } catch {
    return [];
  }
}

function buildElkGraph(
  nodes: Node[],
  forwardEdges: Edge[]
): ElkNode {
  const children: ElkNode[] = nodes.map((node) => {
    const size = measureNode(node);
    const outPorts = outputPortOrder(node);
    const inPorts = inputPortOrder(node);
    const ports = [
      ...inPorts.map((id, index) => ({
        id: `${node.id}::in::${id}`,
        width: 8,
        height: 8,
        properties: {
          "port.side": "WEST",
          "port.index": String(index),
        },
      })),
      ...outPorts.map((id, index) => ({
        id: `${node.id}::out::${id}`,
        width: 8,
        height: 8,
        properties: {
          "port.side": "EAST",
          "port.index": String(index),
        },
      })),
    ];

    // Always provide a default east/west port so unhandled edges still connect
    if (outPorts.length === 0) {
      ports.push({
        id: `${node.id}::out::default`,
        width: 8,
        height: 8,
        properties: { "port.side": "EAST", "port.index": "0" },
      });
    }
    if (inPorts.length === 0) {
      ports.push({
        id: `${node.id}::in::default`,
        width: 8,
        height: 8,
        properties: { "port.side": "WEST", "port.index": "0" },
      });
    }

    return {
      id: node.id,
      width: size.width,
      height: size.height,
      ports,
      layoutOptions: {
        "org.eclipse.elk.portConstraints": "FIXED_ORDER",
      },
    };
  });

  const resolvePort = (
    nodeId: string,
    side: "in" | "out",
    handle: string | null | undefined
  ): string => {
    const ports = children.find((c) => c.id === nodeId)?.ports || [];
    const handleId = String(handle || "").trim();
    if (handleId) {
      const exact = `${nodeId}::${side}::${handleId}`;
      if (ports.some((p) => p.id === exact)) return exact;
    }
    // Prefer real contract ports over synthetic defaults when handle is missing/unknown.
    const sidePorts = ports.filter((p) =>
      String(p.id || "").startsWith(`${nodeId}::${side}::`)
    );
    const nonDefault = sidePorts.find(
      (p) => !String(p.id || "").endsWith("::default")
    );
    if (nonDefault?.id) return nonDefault.id;
    if (sidePorts[0]?.id) return sidePorts[0].id;
    return `${nodeId}::${side}::default`;
  };

  const elkEdges: ElkExtendedEdge[] = forwardEdges.map((e) => ({
    id: e.id || `${e.source}->${e.target}`,
    sources: [resolvePort(e.source, "out", e.sourceHandle)],
    targets: [resolvePort(e.target, "in", e.targetHandle)],
  }));

  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": String(NODE_GAP),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(LAYER_GAP),
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.separateConnectedComponents": "true",
      "elk.spacing.componentComponent": "160",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.padding": "[top=40,left=40,bottom=40,right=40]",
    },
    children,
    edges: elkEdges,
  };
}

/**
 * Prefer packing order: component with a start/trigger first, then by
 * original min (x,y), then stable node id.
 */
function orderHintForComponents(nodes: Node[]): string {
  const withStart = nodes.filter((n) => START_TYPES.has(nodeTypeOf(n)));
  if (withStart.length > 0) {
    const ids = withStart.map((n) => n.id).sort();
    return `start:${ids[0]}`;
  }
  let best = nodes[0];
  for (const n of nodes) {
    const bx = best?.position?.x ?? 0;
    const by = best?.position?.y ?? 0;
    const nx = n.position?.x ?? 0;
    const ny = n.position?.y ?? 0;
    if (ny < by || (ny === by && nx < bx) || (ny === by && nx === bx && n.id < best.id)) {
      best = n;
    }
  }
  return `pos:${best?.id || ""}`;
}

/**
 * Layout workflow nodes. Does not mutate edges or node data.
 */
export async function layoutWorkflowGraph(options: {
  nodes: Node[];
  edges: Edge[];
}): Promise<LayoutWorkflowResult> {
  const { nodes, edges } = options;
  if (nodes.length === 0) {
    return { ok: true, positions: {} };
  }

  const { forwardEdges, auxiliaryEdges } = projectForwardEdges(nodes, edges);

  if (hasForwardCycle(nodes, forwardEdges)) {
    return {
      ok: false,
      message: "Fix invalid workflow connections before using Tidy.",
    };
  }

  // Stable child order hint for ELK component packing
  const sortedNodes = [...nodes].sort((a, b) => {
    const ha = orderHintForComponents([a]);
    const hb = orderHintForComponents([b]);
    if (ha !== hb) return ha.localeCompare(hb);
    const ay = a.position?.y ?? 0;
    const by = b.position?.y ?? 0;
    if (ay !== by) return ay - by;
    const ax = a.position?.x ?? 0;
    const bx = b.position?.x ?? 0;
    if (ax !== bx) return ax - bx;
    return a.id.localeCompare(b.id);
  });

  const graph = buildElkGraph(sortedNodes, forwardEdges);
  const elk = new ELK();

  try {
    const laid = await elk.layout(graph);
    const positions: LayoutPositionMap = {};
    for (const child of laid.children || []) {
      if (child.id && typeof child.x === "number" && typeof child.y === "number") {
        positions[child.id] = {
          x: Math.round(child.x),
          y: Math.round(child.y),
        };
      }
    }
    for (const n of nodes) {
      if (!positions[n.id]) {
        positions[n.id] = {
          x: Math.round(n.position?.x ?? 0),
          y: Math.round(n.position?.y ?? 0),
        };
      }
    }

    // Part 12A: place auxiliary providers near their consumer (not in execution rank).
    const byConsumer = new Map<string, string[]>();
    for (const e of auxiliaryEdges) {
      if (!byConsumer.has(e.target)) byConsumer.set(e.target, []);
      byConsumer.get(e.target)!.push(e.source);
    }
    for (const [consumerId, providerIds] of byConsumer) {
      const consumerPos = positions[consumerId];
      if (!consumerPos) continue;
      const unique = [...new Set(providerIds)].sort();
      unique.forEach((providerId, index) => {
        const size = measureNode(nodes.find((n) => n.id === providerId)! || { id: providerId } as Node);
        positions[providerId] = {
          x: Math.round(consumerPos.x + index * (size.width + 24) - ((unique.length - 1) * (size.width + 24)) / 2),
          y: Math.round(consumerPos.y - (size.height + 56)),
        };
      });
    }

    return { ok: true, positions };
  } catch {
    return { ok: false, message: "Couldn't tidy this workflow." };
  }
}

/** Sync helper for tests that need deterministic projection checks. */
export function assertNoNodeOverlap(
  positions: LayoutPositionMap,
  nodes: Node[],
  pad = 4
): boolean {
  const boxes = nodes.map((n) => {
    const size = measureNode(n);
    const p = positions[n.id] || n.position;
    return {
      id: n.id,
      x1: p.x,
      y1: p.y,
      x2: p.x + size.width,
      y2: p.y + size.height,
    };
  });
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const overlap =
        a.x1 < b.x2 - pad &&
        a.x2 > b.x1 + pad &&
        a.y1 < b.y2 - pad &&
        a.y2 > b.y1 + pad;
      if (overlap) return false;
    }
  }
  return true;
}

export { LOOP_PORTS, measureNode, hasForwardCycle };
