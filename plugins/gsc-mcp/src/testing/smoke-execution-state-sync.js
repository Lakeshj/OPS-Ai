/**
 * Regression: editor OUTPUT + AI Preview must resolve the SAME latest upstream
 * execution — never an older production run after a newer step / config change.
 *
 * Mirrors frontend/src/modules/workflows/occurrenceView.ts resolveLatestNodeResult
 * + backend workflowPreviewHeal.util (keep algorithms aligned).
 */
const assert = require("node:assert/strict");
const {
  shouldHealStalePreviewFromRun,
} = require("../../../../backend/services/workflowPreviewHeal.util");
const {
  processUpstreamItems,
  normalizeCapabilities,
} = require("../adapters/processUpstream");

const timestampMs = (value) => {
  if (!value) return 0;
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? t : 0;
};

const extractItems = (output) => {
  if (!output || typeof output !== "object" || Array.isArray(output)) return [];
  return Array.isArray(output.items) ? output.items : [];
};

/** Canonical resolver (keep in sync with occurrenceView.resolveLatestNodeResult). */
const resolveLatestUpstreamOutput = ({
  nodeId,
  sessionResult,
  run,
  dirty,
}) => {
  const steps = (run?.steps || []).filter((s) => s.nodeId === nodeId);
  let fromRun = null;
  if (steps.length) {
    const latest = steps[steps.length - 1];
    fromRun = {
      nodeId,
      status: latest.status || "succeeded",
      output: latest.output,
      items: extractItems(latest.output),
      updatedAt: latest.finishedAt || latest.startedAt,
    };
  }
  const fromSession = sessionResult || null;
  const sessionTs = timestampMs(fromSession?.updatedAt);
  const runTs = steps.reduce(
    (max, s) =>
      Math.max(max, timestampMs(s.finishedAt), timestampMs(s.startedAt)),
    0
  );

  let chosen = null;
  if (fromSession && fromRun) {
    chosen = sessionTs >= runTs ? fromSession : fromRun;
  } else {
    chosen = fromSession || fromRun || null;
  }

  if (!chosen) return null;
  if (!dirty) return chosen;
  return {
    ...chosen,
    cacheState: "dirty",
    items: [],
    output: {
      stale: true,
      message:
        "Configuration changed since this output was produced. Run the step again to refresh.",
    },
  };
};

const capabilityCounts = (items) => {
  const byCap = {};
  for (const it of items || []) {
    const row = it?.json || it;
    const cap = row && typeof row === "object" ? String(row.capability || "") : "";
    if (!cap) continue;
    byCap[cap] = (byCap[cap] || 0) + 1;
  }
  return byCap;
};

const rankingItems = () =>
  Array.from({ length: 5 }, () => ({
    json: {
      capability: "ranking_opportunities",
      opportunity_type: "ranking_opportunity",
    },
  }));

const sampleRows = [
  {
    json: {
      keys: ["best seo tools"],
      clicks: 12,
      impressions: 900,
      ctr: 0.013,
      position: 8.2,
    },
  },
  {
    json: {
      keys: ["keyword research"],
      clicks: 40,
      impressions: 2000,
      ctr: 0.02,
      position: 4.1,
    },
  },
];

console.log("smoke-execution-state-sync");

assert.deepEqual(normalizeCapabilities([], []), []);
assert.deepEqual(normalizeCapabilities(undefined, []), []);
const empty = processUpstreamItems({
  capabilities: [],
  capability: [],
  inputItems: sampleRows,
});
assert.equal(empty.ok, false);
assert.equal(empty.error?.code, "MCP_CAPABILITY_REQUIRED");
assert.equal(empty.items.length, 0);
console.log("  ok empty selection → MCP_CAPABILITY_REQUIRED, 0 items");

const oldCtrRun = {
  id: "run-old",
  steps: [
    {
      nodeId: "gsc-mcp-1",
      status: "succeeded",
      finishedAt: "2026-09-19T10:00:00.000Z",
      output: {
        items: [
          {
            json: {
              capability: "ctr_opportunities",
              opportunity_type: "ctr_opportunity",
            },
          },
          {
            json: {
              capability: "ctr_opportunities",
              opportunity_type: "ctr_opportunity",
            },
          },
        ],
      },
    },
  ],
};

const resolvedNew = resolveLatestUpstreamOutput({
  nodeId: "gsc-mcp-1",
  sessionResult: {
    nodeId: "gsc-mcp-1",
    status: "succeeded",
    updatedAt: "2026-09-19T11:00:00.000Z",
    items: rankingItems(),
    output: { items: rankingItems() },
  },
  run: oldCtrRun,
  dirty: false,
});
assert.equal(resolvedNew.items.length, 5);
assert.deepEqual(capabilityCounts(resolvedNew.items), {
  ranking_opportunities: 5,
});
assert.equal(capabilityCounts(resolvedNew.items).ctr_opportunities, undefined);
console.log("  ok AI Preview resolves NEW Ranking 5, not old CTR 2");

const multiRun = {
  id: "run-multi",
  steps: [
    {
      nodeId: "gsc-mcp-1",
      status: "succeeded",
      finishedAt: "2026-09-19T09:00:00.000Z",
      output: {
        items: [
          {
            json: {
              capability: "ctr_opportunities",
              opportunity_type: "ctr_opportunity",
            },
          },
          {
            json: {
              capability: "ranking_opportunities",
              opportunity_type: "ranking_opportunity",
            },
          },
        ],
      },
    },
  ],
};
const cleared = resolveLatestUpstreamOutput({
  nodeId: "gsc-mcp-1",
  sessionResult: {
    nodeId: "gsc-mcp-1",
    status: "succeeded",
    updatedAt: "2026-09-19T08:00:00.000Z",
    items: extractItems(multiRun.steps[0].output),
    output: multiRun.steps[0].output,
  },
  run: multiRun,
  dirty: true,
});
assert.equal(cleared.items.length, 0);
assert.equal(cleared.cacheState, "dirty");
assert.equal(cleared.output?.stale, true);
console.log("  ok empty/dirty config hides old CTR+Ranking opportunities");

const failedEmpty = resolveLatestUpstreamOutput({
  nodeId: "gsc-mcp-1",
  sessionResult: {
    nodeId: "gsc-mcp-1",
    status: "failed",
    updatedAt: "2026-09-19T12:00:00.000Z",
    error: "No GSC MCP capability selected.",
    items: undefined,
    output: undefined,
  },
  run: multiRun,
  dirty: false,
});
assert.equal(failedEmpty.status, "failed");
assert.equal((failedEmpty.items || []).length, 0);
console.log("  ok newer failed empty-cap result replaces old run rows");

assert.equal(
  shouldHealStalePreviewFromRun({
    dirtyMeta: {
      dirty: true,
      reason: "params",
      since: "2026-09-19T11:00:00.000Z",
    },
    healRun: {
      status: "succeeded",
      finishedAt: "2026-09-19T10:00:00.000Z",
    },
  }),
  false
);
assert.equal(
  shouldHealStalePreviewFromRun({
    dirtyMeta: {
      dirty: true,
      reason: "params",
      since: "2026-09-19T11:00:00.000Z",
    },
    healRun: {
      status: "succeeded",
      finishedAt: "2026-09-19T12:00:00.000Z",
    },
  }),
  true
);
console.log("  ok preview heal refuses pre-dirty runs, accepts post-dirty runs");

console.log("smoke-execution-state-sync: all passed");
