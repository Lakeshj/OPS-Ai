/**
 * Part 9C — occurrence selection helpers for Loop / body inspectors.
 *
 * Also owns resolveLatestNodeResult — the single source of truth for
 * OUTPUT panel and AI/expression Preview (avoids session vs latestRun drift).
 */

import type {
  WorkflowEditorNodeResult,
  WorkflowEditorOccurrence,
  WorkflowEditorSession,
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
    updatedAt: latest.finishedAt || latest.startedAt || undefined,
    occurrences: occurrences.length > 1 ? occurrences : undefined,
  };
}

function timestampMs(value: unknown): number {
  if (!value) return 0;
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? t : 0;
}

function runStepTimestamp(
  run: WorkflowRun | null | undefined,
  nodeId: string
): number {
  const steps = (run?.steps || []).filter((s) => s.nodeId === nodeId);
  if (!steps.length) return 0;
  let max = 0;
  for (const s of steps) {
    max = Math.max(max, timestampMs(s.finishedAt), timestampMs(s.startedAt));
  }
  return max || timestampMs(run?.finishedAt) || timestampMs(run?.startedAt);
}

/**
 * Canonical resolver for OUTPUT + Preview.
 * Prefers the freshest successful execution (editor step vs production run).
 * When the editor cache is dirty (config changed), hides prior items so the
 * inspector cannot present stale opportunities as current.
 */
export function resolveLatestNodeResult(options: {
  nodeId: string;
  sessionResult?: WorkflowEditorNodeResult | null;
  run?: WorkflowRun | null;
  dirty?: boolean;
}): WorkflowEditorNodeResult | null {
  const { nodeId, sessionResult, run, dirty } = options;
  const fromRun = nodeResultFromRunSteps(nodeId, run?.steps);
  const fromSession = sessionResult || null;

  if (fromRun?.occurrences && fromRun.occurrences.length > 1) {
    return applyDirtyGate(fromRun, dirty);
  }
  if (
    fromSession?.occurrences &&
    fromSession.occurrences.length > 1 &&
    !fromRun
  ) {
    return applyDirtyGate(fromSession, dirty);
  }

  const sessionTs = timestampMs(fromSession?.updatedAt);
  const runTs = runStepTimestamp(run, nodeId);

  let chosen: WorkflowEditorNodeResult | null = null;
  if (fromSession && fromRun) {
    // Fresher editor step wins over an older production run (and vice versa).
    chosen = sessionTs >= runTs ? fromSession : fromRun;
  } else {
    chosen = fromSession || fromRun || null;
  }

  return applyDirtyGate(chosen, dirty);
}

function applyDirtyGate(
  result: WorkflowEditorNodeResult | null,
  dirty?: boolean
): WorkflowEditorNodeResult | null {
  if (!result) return null;
  if (!dirty) return result;
  return {
    ...result,
    cacheState: "dirty",
    items: [],
    output: {
      stale: true,
      message:
        "Configuration changed since this output was produced. Run the step again to refresh.",
    },
    error: undefined,
    status: "succeeded",
  };
}

/**
 * Prefer the latest production run step over a stale editor-session cache.
 * Multi-occurrence Loop results still prefer the richer multi-occ source.
 * @deprecated Prefer resolveLatestNodeResult (handles dirty + timestamps).
 */
export function mergeSessionWithRun(
  sessionResult: WorkflowEditorNodeResult | null | undefined,
  run: WorkflowRun | null | undefined,
  nodeId: string
): WorkflowEditorNodeResult | null {
  return resolveLatestNodeResult({
    nodeId,
    sessionResult,
    run,
    dirty: false,
  });
}

/** Build steps/stepItems maps for expression + AI preview from the same resolver. */
export function buildResolvedStepMaps(options: {
  session?: WorkflowEditorSession | null;
  run?: WorkflowRun | null;
  definitionNodes?: Array<{ id: string; data?: Record<string, unknown> }>;
}): {
  steps: Record<string, unknown>;
  stepItems: Record<string, WorkflowItem[]>;
  diagnostics: Record<
    string,
    { source: "session" | "run" | "pin" | "none"; dirty: boolean; itemCount: number }
  >;
} {
  const { session, run, definitionNodes } = options;
  const steps: Record<string, unknown> = {};
  const stepItems: Record<string, WorkflowItem[]> = {};
  const diagnostics: Record<
    string,
    { source: "session" | "run" | "pin" | "none"; dirty: boolean; itemCount: number }
  > = {};

  const nodeIds = new Set<string>();
  if (session?.nodeResults) {
    for (const id of Object.keys(session.nodeResults)) nodeIds.add(id);
  }
  for (const step of run?.steps || []) {
    if (step?.nodeId) nodeIds.add(step.nodeId);
  }
  for (const n of definitionNodes || []) nodeIds.add(n.id);

  for (const nodeId of nodeIds) {
    const dirty = Boolean(session?.dirtyNodes?.[nodeId]?.dirty);
    const sessionResult = session?.nodeResults?.[nodeId] || null;
    const resolved = resolveLatestNodeResult({
      nodeId,
      sessionResult,
      run,
      dirty,
    });

    const pinnedNode = definitionNodes?.find((n) => n.id === nodeId);
    const pinned =
      pinnedNode?.data?.pinned && pinnedNode.data.pinnedOutput !== undefined;

    if (pinned) {
      steps[nodeId] = pinnedNode!.data!.pinnedOutput;
      if (Array.isArray(pinnedNode!.data!.pinnedItems)) {
        stepItems[nodeId] = pinnedNode!.data!.pinnedItems as WorkflowItem[];
      }
      diagnostics[nodeId] = {
        source: "pin",
        dirty: false,
        itemCount: Array.isArray(stepItems[nodeId]) ? stepItems[nodeId].length : 0,
      };
      continue;
    }

    if (!resolved || dirty) {
      diagnostics[nodeId] = {
        source: "none",
        dirty,
        itemCount: 0,
      };
      continue;
    }

    if (resolved.output !== undefined) steps[nodeId] = resolved.output;
    if (Array.isArray(resolved.items) && resolved.items.length) {
      stepItems[nodeId] = resolved.items;
    } else {
      const fromOut = extractItemsFromOutput(resolved.output);
      if (fromOut.length) stepItems[nodeId] = fromOut;
    }

    const sessionTs = timestampMs(sessionResult?.updatedAt);
    const runTs = runStepTimestamp(run, nodeId);
    diagnostics[nodeId] = {
      source:
        sessionResult && sessionTs >= runTs
          ? "session"
          : runTs > 0
            ? "run"
            : sessionResult
              ? "session"
              : "none",
      dirty: false,
      itemCount: stepItems[nodeId]?.length || 0,
    };
  }

  return { steps, stepItems, diagnostics };
}

export function loopBatchOccurrences(
  result: WorkflowEditorNodeResult | null | undefined
): WorkflowEditorOccurrence[] {
  const list = result?.occurrences || [];
  const batches = list.filter(
    (o) =>
      o.executionContext?.phase === "batch" ||
      (o.output && (o.output as { batch?: boolean }).batch)
  );
  if (batches.length > 0) return batches;
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
