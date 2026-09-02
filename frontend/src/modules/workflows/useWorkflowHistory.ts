import { useCallback, useRef, useState } from "react";
import type { Edge, Node } from "@xyflow/react";

const MAX_HISTORY = 50;

export type HistoryState = { nodes: Node[]; edges: Edge[] };

export function useWorkflowHistory(initial: HistoryState) {
  const pastRef = useRef<HistoryState[]>([]);
  const futureRef = useRef<HistoryState[]>([]);
  const [tick, setTick] = useState(0);

  const snapshot = useCallback(
    (nodes: Node[], edges: Edge[]) =>
      JSON.parse(JSON.stringify({ nodes, edges })) as HistoryState,
    []
  );

  const push = useCallback(
    (nodes: Node[], edges: Edge[]) => {
      pastRef.current = [
        ...pastRef.current.slice(-(MAX_HISTORY - 1)),
        snapshot(nodes, edges),
      ];
      futureRef.current = [];
      setTick((t) => t + 1);
    },
    [snapshot]
  );

  const undo = useCallback((current: HistoryState): HistoryState | null => {
    if (pastRef.current.length === 0) return null;
    const prev = pastRef.current.pop()!;
    futureRef.current.push(snapshot(current.nodes, current.edges));
    setTick((t) => t + 1);
    return prev;
  }, [snapshot]);

  const redo = useCallback((current: HistoryState): HistoryState | null => {
    if (futureRef.current.length === 0) return null;
    const next = futureRef.current.pop()!;
    pastRef.current.push(snapshot(current.nodes, current.edges));
    setTick((t) => t + 1);
    return next;
  }, [snapshot]);

  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;

  return {
    push,
    undo,
    redo,
    canUndo,
    canRedo,
    tick,
  };
}
