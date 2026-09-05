/**
 * Shared #workflow mention helpers for OpsAi Chat and Workflow Copilot.
 * Shared: search, picker insert, workflowId tokens.
 * Separate conversation state: Chat threads vs Copilot turns must never merge.
 * NOT shared: conversation/thread/planning state (keep Chat vs Copilot separate).
 */

export const MAX_COPILOT_WORKFLOW_REFERENCES = 5;

export type WorkflowMentionOption = {
  workflowId: string;
  name: string;
  status?: string;
};

export type ResolvedWorkflowMention = {
  workflowId: string;
  name: string;
  /** Inclusive start index in composer text (of '#') */
  start: number;
  /** Exclusive end index */
  end: number;
};

/** Detect active `#query` token at cursor for picker. */
export function getActiveHashtagQuery(
  text: string,
  cursor: number
): { start: number; query: string } | null {
  const before = text.slice(0, Math.max(0, cursor));
  const match = before.match(/(^|[\s([{])#([^\s#]*)$/);
  if (!match) return null;
  const hashIndex = before.lastIndexOf("#");
  if (hashIndex < 0) return null;
  return {
    start: hashIndex,
    query: match[2] || "",
  };
}

export function filterWorkflowMentions(
  options: WorkflowMentionOption[],
  query: string
): WorkflowMentionOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options.slice(0, 40);
  return options
    .filter((o) => o.name.toLowerCase().includes(q))
    .slice(0, 40);
}

/**
 * Insert a picker-selected mention. Ordinary typed `#urgent` without selection
 * is NOT a workflow reference.
 */
export function insertWorkflowMention(
  text: string,
  cursor: number,
  option: WorkflowMentionOption,
  existing: ResolvedWorkflowMention[]
): {
  text: string;
  cursor: number;
  mentions: ResolvedWorkflowMention[];
} {
  const active = getActiveHashtagQuery(text, cursor);
  if (!active) {
    return { text, cursor, mentions: existing };
  }
  const display = `#${option.name}`;
  const before = text.slice(0, active.start);
  const after = text.slice(cursor);
  const nextText = `${before}${display}${after}`;
  const start = active.start;
  const end = start + display.length;
  const shifted = existing
    .filter((m) => m.end <= start || m.start >= cursor)
    .map((m) =>
      m.start >= cursor
        ? {
            ...m,
            start: m.start - (cursor - active.start) + display.length,
            end: m.end - (cursor - active.start) + display.length,
          }
        : m
    );
  const mentions = [
    ...shifted,
    {
      workflowId: option.workflowId,
      name: option.name,
      start,
      end,
    },
  ].slice(0, MAX_COPILOT_WORKFLOW_REFERENCES);
  return {
    text: nextText,
    cursor: end,
    mentions,
  };
}

/** Structured refs for API — IDs only. */
export function mentionsToWorkflowReferences(
  mentions: ResolvedWorkflowMention[]
): Array<{ workflowId: string }> {
  const seen = new Set<string>();
  const out: Array<{ workflowId: string }> = [];
  for (const m of mentions) {
    if (!m.workflowId || seen.has(m.workflowId)) continue;
    seen.add(m.workflowId);
    out.push({ workflowId: m.workflowId });
    if (out.length >= MAX_COPILOT_WORKFLOW_REFERENCES) break;
  }
  return out;
}

export function starterPrompts(args: {
  empty: boolean;
  failedRun: boolean;
  waitingRun: boolean;
  selectedNode: boolean;
}): string[] {
  if (args.waitingRun) return ["Why is this workflow waiting?"];
  if (args.failedRun) return ["Why did this fail?", "Help me fix it"];
  if (args.selectedNode) {
    return ["Explain this node", "Modify this node", "Check this node"];
  }
  if (args.empty) return ["Build a workflow", "Help me get started"];
  return ["Explain this workflow", "Add something", "Check for problems"];
}
