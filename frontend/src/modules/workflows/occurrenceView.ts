/**
 * Part 9C — occurrence selection helpers for Loop / body inspectors.
 */

import type {
  WorkflowEditorNodeResult,
  WorkflowEditorOccurrence,
  WorkflowItem,
  WorkflowRun,
  WorkflowRunStep,
} from "./types";

export type LoopPortView = "batch" | "done";

export function extractItemsFromOutput(output: unknown): WorkflowItem[] {
  if (!output || typeof output !== "object" || Array.isArray(output)) return [];
  const record = output as Record<string, unknown>;
  if (!Array.isArray(record.items)) return [];
  return record.items.map((entry) => {
    if (
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      (entry as WorkflowItem).json != null
    ) {
      return entry as WorkflowItem;
    }
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      return { json: entry as Record<string, unknown> };
    }
    return { json: { value: entry } };
  });
}

/** Build a node result from production run steps (multiple execution_index). */
export function nodeResultFromRunSteps(
  nodeId: string,
  steps: WorkflowRunStep[] | undefined
): WorkflowEditorNodeResult | null {
  if (!steps?.length) return null;
  const mine = steps
    .filter((s) => s.nodeId === nodeId)
    .sort((a, b) => (a.executionIndex ?? 0) - (b.executionIndex ?? 0));
  if (mine.length === 0) return null;
  const latest = mine[mine.length - 1];
  const occurrences: WorkflowEditorOccurrence[] = mine.map((s) => {
    const loopMeta =
      s.input &&
      typeof s.input === "object" &&
      !Array.isArray(s.input) &&
      (s.input as { loopMeta?: WorkflowEditorOccurrence["executionContext"] })
        .loopMeta
        ? (s.input as { loopMeta: WorkflowEditorOccurrence["executionContext"] })
            .loopMeta
        : null;
    const items = extractItemsFromOutput(s.output);
    return {
      runIndex: s.executionIndex ?? 0,
      status: s.status,
      output: s.output,
      items,
      error: s.error,
      executionContext: loopMeta,
      startedAt: s.startedAt,
      completedAt: s.finishedAt,
    };
  });
  return {
    nodeId,
    status: (latest.status as WorkflowEditorNodeResult["status"]) || "succeeded",
    output: latest.output,
    items: extractItemsFromOutput(latest.output),
    error: latest.error,
    executionIndex: latest.executionIndex ?? 0,
    occurrences: occurrences.length > 1 ? occurrences : undefined,
  };
}

export function mergeSessionWithRun(
  sessionResult: WorkflowEditorNodeResult | null | undefined,
  run: WorkflowRun | null | undefined,
  nodeId: string
): WorkflowEditorNodeResult | null {
  if (
    sessionResult?.occurrences &&
    sessionResult.occurrences.length > 1
  ) {
    return sessionResult;
  }
  const fromRun = nodeResultFromRunSteps(nodeId, run?.steps);
  if (fromRun?.occurrences && fromRun.occurrences.length > 1) {
    return fromRun;
  }
  return sessionResult || fromRun;
}

export function loopBatchOccurrences(
  result: WorkflowEditorNodeResult | null | undefined
): WorkflowEditorOccurrence[] {
  const list = result?.occurrences || [];
  const batches = list.filter(
    (o) => o.executionContext?.phase === "batch" || o.output && (o.output as { batch?: boolean }).batch
  );
  if (batches.length > 0) return batches;
  // Fallback: all but last when last looks like done
  if (list.length > 1) {
    const last = list[list.length - 1];
    if (
      last.executionContext?.phase === "done" ||
      (last.output && (last.output as { done?: boolean }).done)
    ) {
      return list.slice(0, -1);
    }
  }
  return list.length > 1 ? list : [];
}

export function loopDoneOccurrence(
  result: WorkflowEditorNodeResult | null | undefined
): WorkflowEditorOccurrence | null {
  const list = result?.occurrences || [];
  const done = [...list]
    .reverse()
    .find(
      (o) =>
        o.executionContext?.phase === "done" ||
        (o.output && (o.output as { done?: boolean }).done)
    );
  if (done) return done;
  if (list.length === 0) return null;
  return list[list.length - 1];
}

export function resolveOccurrenceInputItems(
  occurrence: WorkflowEditorOccurrence | null | undefined,
  nodeResults: Record<string, WorkflowEditorNodeResult> | undefined
): WorkflowItem[] {
  if (!occurrence?.inputSources || !nodeResults) return [];
  const collected: WorkflowItem[] = [];
  for (const src of Object.values(occurrence.inputSources)) {
    if (!src || typeof src !== "object") continue;
    const entry = src as {
      nodeId?: string;
      runIndex?: number;
      outputPort?: string;
      mode?: string;
    };
    if (entry.mode === "perItem" || !entry.nodeId) continue;
    const nr = nodeResults[entry.nodeId];
    const occ =
      nr?.occurrences?.find((o) => o.runIndex === (entry.runIndex ?? 0)) ||
      (nr && (entry.runIndex ?? 0) === (nr.executionIndex ?? 0) ? nr : null);
    if (!occ && nr) {
      // treat latest compat as single occurrence
      if (Array.isArray(nr.items)) collected.push(...nr.items);
      continue;
    }
    const sourceOcc = occ as WorkflowEditorOccurrence | WorkflowEditorNodeResult;
    const portOutputs = (sourceOcc as WorkflowEditorOccurrence).portOutputs;
    if (entry.outputPort && portOutputs?.[entry.outputPort]) {
      collected.push(...portOutputs[entry.outputPort]);
    } else if (Array.isArray((sourceOcc as WorkflowEditorOccurrence).items)) {
      collected.push(...((sourceOcc as WorkflowEditorOccurrence).items || []));
    } else if (Array.isArray((sourceOcc as WorkflowEditorNodeResult).items)) {
      collected.push(...((sourceOcc as WorkflowEditorNodeResult).items || []));
    }
  }
  return collected;
}

export function occurrenceLabel(
  runIndex: number,
  insideLoop: boolean
): string {
  return insideLoop ? `Iteration ${runIndex + 1}` : `Run ${runIndex + 1}`;
}
