/**
 * Part 9C — client-side Loop topology checks (mirrors backend controlled-cycle rules).
 * Used at connect time so invalid Loops fail before save/run.
 */

import type { Connection, Edge, Node } from "@xyflow/react";

export const LOOP_PORTS = {
  ITEMS: "items",
  CONTINUE: "continue",
  BATCH: "batch",
  DONE: "done",
} as const;

export type LoopValidationResult = {
  ok: boolean;
  message?: string;
};

const nodeTypeOf = (node: Node | undefined) =>
  String(node?.type || (node?.data as { nodeType?: string } | undefined)?.nodeType || "");

const isLoopNode = (node: Node | undefined) => nodeTypeOf(node) === "loop";

const edgeKey = (e: {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}) =>
  e.id ||
  `${e.source}->${e.target}#${e.sourceHandle || ""}→${e.targetHandle || ""}`;

function collectBatchDescendants(
  nodes: Node[],
  edges: Edge[],
  loopId: string
): Set<string> {
  const outgoing = new Map<string, Edge[]>();
  for (const e of edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source)!.push(e);
  }
  const body = new Set<string>();
  const stack: string[] = [];
  for (const e of outgoing.get(loopId) || []) {
    if (String(e.sourceHandle || "") === LOOP_PORTS.BATCH) stack.push(e.target);
  }
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === loopId || body.has(id)) continue;
    body.add(id);
    for (const e of outgoing.get(id) || []) {
      if (e.target === loopId) continue;
      stack.push(e.target);
    }
  }
  return body;
}

function canReachContinue(
  edges: Edge[],
  body: Set<string>,
  fromId: string,
  continueSource: string,
  loopId: string
): boolean {
  if (fromId === continueSource) return true;
  const outgoing = new Map<string, Edge[]>();
  for (const e of edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source)!.push(e);
  }
  const seen = new Set<string>();
  const stack = [fromId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (id === continueSource) return true;
    for (const e of outgoing.get(id) || []) {
      if (e.target === loopId) continue;
      if (!body.has(e.target) && e.target !== continueSource) continue;
      stack.push(e.target);
    }
  }
  return false;
}

/** User-facing message for a proposed connection (or null if OK). */
export function getLoopConnectionError(
  connection: Connection,
  nodes: Node[],
  edges: Edge[]
): string | null {
  if (!connection.source || !connection.target) return null;

  const sourceNode = nodes.find((n) => n.id === connection.source);
  const targetNode = nodes.find((n) => n.id === connection.target);
  if (!sourceNode || !targetNode) return null;

  const sourceType = nodeTypeOf(sourceNode);
  const targetType = nodeTypeOf(targetNode);
  const th = String(connection.targetHandle || "");
  const sh = String(connection.sourceHandle || "");

  // Multi-output Loop must use an explicit source handle
  if (sourceType === "loop" && !connection.sourceHandle) {
    return "Choose Batch or Done when connecting from Loop.";
  }
  // Multi-input Loop must use an explicit target handle
  if (targetType === "loop" && !connection.targetHandle) {
    return "Choose Items or Continue when connecting to Loop.";
  }

  // Nested Loop: Loop.batch → Loop
  if (sourceType === "loop" && targetType === "loop") {
    return "Nested Loops aren't supported yet.";
  }

  // Continue port rules
  if (targetType === "loop" && th === LOOP_PORTS.CONTINUE) {
    const body = collectBatchDescendants(nodes, edges, targetNode.id);
    if (connection.source === targetNode.id) {
      return "Loop cannot connect directly into its own Continue port.";
    }
    if (!body.has(connection.source!)) {
      return "Continue must connect from the end of this Loop's body.";
    }
    const existingContinue = edges.filter(
      (e) =>
        e.target === targetNode.id &&
        String(e.targetHandle || "") === LOOP_PORTS.CONTINUE
    );
    if (existingContinue.length >= 1) {
      return "Only one Continue connection is supported.";
    }
    // Wait as continue source
    if (nodeTypeOf(sourceNode) === "wait") {
      return "Wait nodes aren't supported inside Loop yet.";
    }
  }

  // Body → items (wrong port)
  if (targetType === "loop" && th === LOOP_PORTS.ITEMS) {
    const body = collectBatchDescendants(nodes, edges, targetNode.id);
    if (body.has(connection.source!)) {
      return "Body nodes must return to Continue, not Items.";
    }
  }

  // Wait inside body: connecting Wait from batch path
  if (sourceType === "loop" && sh === LOOP_PORTS.BATCH) {
    if (targetType === "wait") {
      return "Wait nodes aren't supported inside Loop yet.";
    }
    if (targetType === "loop") {
      return "Nested Loops aren't supported yet.";
    }
  }

  // Connecting Wait as a child of a body node (side path into wait)
  if (targetType === "wait") {
    for (const n of nodes) {
      if (!isLoopNode(n)) continue;
      const body = collectBatchDescendants(nodes, edges, n.id);
      if (body.has(connection.source!)) {
        return "Wait nodes aren't supported inside Loop yet.";
      }
    }
  }

  // Side exit: body → node outside body (not Loop)
  for (const n of nodes) {
    if (!isLoopNode(n)) continue;
    const body = collectBatchDescendants(nodes, edges, n.id);
    if (!body.has(connection.source!)) continue;
    if (connection.target === n.id) continue;
    if (body.has(connection.target!)) continue;
    // Allow if target is Loop continue (handled above)
    if (
      isLoopNode(targetNode) &&
      th === LOOP_PORTS.CONTINUE &&
      targetNode.id === n.id
    ) {
      continue;
    }
    return "Loop body must exit through Continue or stay inside the body (use Loop.done for downstream).";
  }

  // Ordinary cycle A→B→A (non-sanctioned)
  if (wouldCreateOrdinaryCycle(connection, nodes, edges)) {
    return "That connection would create an invalid cycle. Only Loop Continue back-edges are allowed.";
  }

  return null;
}

function wouldCreateOrdinaryCycle(
  connection: Connection,
  nodes: Node[],
  edges: Edge[]
): boolean {
  const source = connection.source!;
  const target = connection.target!;
  // Sanctioned Loop continue is allowed
  const targetNode = nodes.find((n) => n.id === target);
  if (
    isLoopNode(targetNode) &&
    String(connection.targetHandle || "") === LOOP_PORTS.CONTINUE
  ) {
    return false;
  }

  // Can we already reach source from target? Then adding target←source closes a cycle.
  const outgoing = new Map<string, string[]>();
  for (const e of edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source)!.push(e.target);
  }
  if (!outgoing.has(source)) outgoing.set(source, []);
  // Tentatively add
  const list = [...(outgoing.get(source) || [])];
  if (!list.includes(target)) list.push(target);
  outgoing.set(source, list);

  const seen = new Set<string>();
  const stack = [target];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === source) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of outgoing.get(id) || []) stack.push(next);
  }
  return false;
}

/** Full-graph Loop validation (for save / execute). */
export function validateLoopGraph(
  nodes: Node[],
  edges: Edge[]
): LoopValidationResult {
  const loops = nodes.filter(isLoopNode);
  for (const loop of loops) {
    const body = collectBatchDescendants(nodes, edges, loop.id);
    const continueEdges = edges.filter(
      (e) =>
        e.target === loop.id &&
        String(e.targetHandle || "") === LOOP_PORTS.CONTINUE
    );
    const batchEdges = edges.filter(
      (e) =>
        e.source === loop.id &&
        String(e.sourceHandle || "") === LOOP_PORTS.BATCH
    );

    if (continueEdges.length === 0) {
      return {
        ok: false,
        message: `Loop "${String((loop.data as { label?: string })?.label || loop.id)}" needs a Continue connection from its body.`,
      };
    }
    if (continueEdges.length > 1) {
      return { ok: false, message: "Only one Continue connection is supported." };
    }
    if (batchEdges.length === 0) {
      return {
        ok: false,
        message: `Loop "${String((loop.data as { label?: string })?.label || loop.id)}" needs at least one Batch connection.`,
      };
    }

    const continueSource = continueEdges[0].source;
    if (!body.has(continueSource)) {
      return {
        ok: false,
        message: "Continue must connect from the end of this Loop's body.",
      };
    }

    for (const bodyId of body) {
      const bn = nodes.find((n) => n.id === bodyId);
      if (nodeTypeOf(bn) === "wait") {
        return {
          ok: false,
          message: "Wait nodes aren't supported inside Loop yet.",
        };
      }
      if (nodeTypeOf(bn) === "loop") {
        return { ok: false, message: "Nested Loops aren't supported yet." };
      }
      if (!canReachContinue(edges, body, bodyId, continueSource, loop.id)) {
        return {
          ok: false,
          message: `Node in Loop body does not converge to Continue (${bodyId}).`,
        };
      }
    }

    const batchSize = Number(
      (loop.data as { batchSize?: number; parameters?: { batchSize?: number } })
        ?.batchSize ??
        (loop.data as { parameters?: { batchSize?: number } })?.parameters
          ?.batchSize ??
        1
    );
    if (!Number.isInteger(batchSize) || batchSize < 1) {
      return {
        ok: false,
        message: "Loop batch size must be an integer ≥ 1.",
      };
    }
  }

  // Generic cycles excluding sanctioned continue
  const forwardEdges = edges.filter((e) => {
    const t = nodes.find((n) => n.id === e.target);
    return !(
      isLoopNode(t) && String(e.targetHandle || "") === LOOP_PORTS.CONTINUE
    );
  });
  if (hasCycle(nodes, forwardEdges)) {
    return {
      ok: false,
      message:
        "Graph contains an invalid cycle. Only Loop Continue back-edges are allowed.",
    };
  }

  return { ok: true };
}

function hasCycle(nodes: Node[], edges: Edge[]): boolean {
  const outgoing = new Map<string, string[]>();
  for (const e of edges) {
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

export function isLoopContinueEdge(
  edge: Edge,
  nodes: Node[]
): boolean {
  const target = nodes.find((n) => n.id === edge.target);
  return (
    isLoopNode(target) &&
    String(edge.targetHandle || "") === LOOP_PORTS.CONTINUE
  );
}

export function findLoopRegionForNode(
  nodeId: string,
  nodes: Node[],
  edges: Edge[]
): { loopId: string; body: Set<string> } | null {
  for (const n of nodes) {
    if (!isLoopNode(n)) continue;
    if (n.id === nodeId) return { loopId: n.id, body: collectBatchDescendants(nodes, edges, n.id) };
    const body = collectBatchDescendants(nodes, edges, n.id);
    if (body.has(nodeId)) return { loopId: n.id, body };
  }
  return null;
}

export { edgeKey, isLoopNode, collectBatchDescendants };
