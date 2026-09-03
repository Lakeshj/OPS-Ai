/**
 * Backend mirror of frontend nodeContract.ts — engine-relevant fields only.
 * Keep in sync with frontend/src/modules/workflows/nodeContract.ts
 */

const PAIRED_ITEM_POLICY = {
  none: "noOp",
  identity1to1: "linkPositional",
  fanOut: "linkAllToSource",
  identityBySurvival: "linkByOriginalIndex",
  fanIn: "linkAllInputs",
  multiPort: "linkWithInputPort",
  routing: "linkRouted",
  manual: "requireExplicit",
};

const EXPRESSION_ERRORS = {
  brokenThread: "Info for expression missing from previous node.",
  ambiguousThread: "Multiple matching items for expression.",
};

/** Minimal contract for engine execution */
const NODE_ENGINE_CONTRACTS = {
  trigger: { cardinality: "0-to-1", pairedItemPolicy: "none", isTrigger: true, mergeInputs: 0 },
  schedule: { cardinality: "0-to-1", pairedItemPolicy: "none", isTrigger: true, mergeInputs: 0 },
  webhook: { cardinality: "0-to-1", pairedItemPolicy: "none", isTrigger: true, mergeInputs: 0 },
  set: { cardinality: "N-to-N", pairedItemPolicy: "identity1to1", mergeInputs: 1 },
  splitOut: { cardinality: "1-to-N", pairedItemPolicy: "fanOut", mergeInputs: 1 },
  filter: { cardinality: "N-to-leqN", pairedItemPolicy: "identityBySurvival", mergeInputs: 1 },
  limit: { cardinality: "N-to-leqN", pairedItemPolicy: "identityBySurvival", mergeInputs: 1 },
  sort: { cardinality: "N-to-N-reorder", pairedItemPolicy: "identityBySurvival", mergeInputs: 1 },
  removeDuplicates: { cardinality: "N-to-leqN", pairedItemPolicy: "identityBySurvival", mergeInputs: 1, isStateful: true },
  aggregate: { cardinality: "N-to-1", pairedItemPolicy: "fanIn", mergeInputs: 1 },
  merge: { cardinality: "N-to-N", pairedItemPolicy: "multiPort", mergeInputs: 2, blocking: true },
  switch: { cardinality: "N-split-branches", pairedItemPolicy: "routing", mergeInputs: 1, dynamicOutputs: true },
  code: { cardinality: "arbitrary", pairedItemPolicy: "manual", mergeInputs: 1 },
  condition: { cardinality: "N-split-branches", pairedItemPolicy: "routing", mergeInputs: 1, outputs: ["true", "false"] },
  document: { cardinality: "N-to-N", pairedItemPolicy: "identity1to1", mergeInputs: 1 },
  spreadsheet: { cardinality: "1-to-N", pairedItemPolicy: "fanOut", mergeInputs: 1 },
  email: { cardinality: "N-to-N", pairedItemPolicy: "identity1to1", mergeInputs: 1, isSideEffecting: true },
  http: { cardinality: "N-to-N", pairedItemPolicy: "identity1to1", mergeInputs: 1, isSideEffecting: true },
  wait: { cardinality: "N-to-N", pairedItemPolicy: "identity1to1", mergeInputs: 1 },
  loop: {
    cardinality: "N-to-N",
    pairedItemPolicy: "identity1to1",
    mergeInputs: 2,
    blocking: true,
    runtimeEnabled: true,
    inputs: ["items", "continue"],
    outputs: ["batch", "done"],
  },
  result: { cardinality: "N-to-0", pairedItemPolicy: "none", isTerminal: true, mergeInputs: 1 },
  noop: { cardinality: "N-to-N", pairedItemPolicy: "identity1to1", mergeInputs: 1 },
  integration: { cardinality: "N-to-N", pairedItemPolicy: "identity1to1", mergeInputs: 1 },
  ai: { cardinality: "N-to-N", pairedItemPolicy: "identity1to1", mergeInputs: 1, isSideEffecting: true },
  bot: { cardinality: "N-to-N", pairedItemPolicy: "identity1to1", mergeInputs: 1, isSideEffecting: true, typedPorts: true },
};

const getEngineContract = (nodeType) =>
  NODE_ENGINE_CONTRACTS[nodeType] || NODE_ENGINE_CONTRACTS.noop;

const getPairedItemLinker = (nodeType) => {
  const policy = getEngineContract(nodeType).pairedItemPolicy;
  return PAIRED_ITEM_POLICY[policy] || "linkPositional";
};

/** Normalize legacy schedule rule fields to n8n names */
const normalizeScheduleRule = (rule) => {
  if (!rule || typeof rule !== "object") return { triggerInterval: "weeks" };
  const triggerInterval = rule.triggerInterval || rule.field || "weeks";
  const intervalKey = {
    seconds: "secondsInterval",
    minutes: "minutesInterval",
    hours: "hoursInterval",
    days: "daysInterval",
    weeks: "weeksInterval",
    months: "monthsInterval",
  }[triggerInterval];
  const out = { ...rule, triggerInterval };
  if (rule.every != null && intervalKey && out[intervalKey] == null) {
    out[intervalKey] = rule.every;
  }
  if (rule.expression && !out.cronExpression) {
    out.cronExpression = rule.expression;
  }
  return out;
};

/** Intervals that cannot be expressed as simple cron — use anchor-date math */
const requiresAnchorScheduling = (rule) => {
  const {
    requiresAnchorScheduling: requiresAnchor,
  } = require("../utils/scheduleRecurrence");
  return requiresAnchor(rule);
};

module.exports = {
  NODE_ENGINE_CONTRACTS,
  PAIRED_ITEM_POLICY,
  EXPRESSION_ERRORS,
  getEngineContract,
  getPairedItemLinker,
  normalizeScheduleRule,
  requiresAnchorScheduling,
};
