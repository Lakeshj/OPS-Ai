/**
 * Part 9A — execution occurrence model.
 * One workflow node may execute multiple times in one run (future Loop).
 * Non-loop workflows use runIndex 0 only.
 */

const OCCURRENCE_REACH = Object.freeze({
  NONE: "none",
  ONE: "one",
  MANY: "many",
});

/** Create empty canonical runData map. */
const createRunData = () => ({});

const ensureNodeBucket = (runData, nodeId) => {
  if (!runData[nodeId]) runData[nodeId] = [];
  return runData[nodeId];
};

const nextRunIndex = (runData, nodeId) => {
  const list = runData?.[nodeId];
  if (!Array.isArray(list) || list.length === 0) return 0;
  return list.length;
};

/**
 * Append a new execution occurrence. Does not overwrite prior occurrences.
 * @returns the recorded occurrence
 */
const recordOccurrence = (
  runData,
  {
    nodeId,
    runIndex = null,
    status = "succeeded",
    items = [],
    output = null,
    portOutputs = null,
    inputSources = null,
    startedAt = null,
    completedAt = null,
    error = null,
    stepId = null,
  }
) => {
  if (!nodeId) throw new Error("recordOccurrence requires nodeId");
  const bucket = ensureNodeBucket(runData, nodeId);
  const index = runIndex == null ? bucket.length : runIndex;
  const occurrence = {
    runIndex: index,
    status,
    items: Array.isArray(items) ? items : [],
    output: output ?? null,
    portOutputs: portOutputs && typeof portOutputs === "object" ? portOutputs : null,
    inputSources:
      inputSources && typeof inputSources === "object" ? inputSources : null,
    startedAt: startedAt || null,
    completedAt: completedAt || null,
    error: error || null,
    stepId: stepId || null,
  };
  // Append if new; replace only when same runIndex already exists (retry of same occurrence)
  const existing = bucket.findIndex((o) => o.runIndex === index);
  if (existing >= 0) bucket[existing] = occurrence;
  else bucket.push(occurrence);
  bucket.sort((a, b) => a.runIndex - b.runIndex);
  return occurrence;
};

const getOccurrence = (runData, nodeId, runIndex = 0) => {
  const list = runData?.[nodeId];
  if (!Array.isArray(list)) return null;
  return list.find((o) => o.runIndex === runIndex) || null;
};

const getLatestOccurrence = (runData, nodeId) => {
  const list = runData?.[nodeId];
  if (!Array.isArray(list) || list.length === 0) return null;
  return list[list.length - 1];
};

const getLatestNodeItems = (runData, nodeId) => {
  const occ = getLatestOccurrence(runData, nodeId);
  return occ?.items || null;
};

const getOccurrenceItems = (runData, nodeId, runIndex) => {
  const occ = getOccurrence(runData, nodeId, runIndex);
  return occ?.items || null;
};

const classifyOccurrenceReach = (runData, nodeId) => {
  const list = runData?.[nodeId];
  if (!Array.isArray(list) || list.length === 0) return OCCURRENCE_REACH.NONE;
  if (list.length === 1) return OCCURRENCE_REACH.ONE;
  return OCCURRENCE_REACH.MANY;
};

/**
 * Sync compatibility latest-view maps from runData.
 * Existing code reads context.items[nodeId] / steps / portOutputs.
 */
const applyLatestView = (context) => {
  const runData = context.runData || {};
  if (!context.items) context.items = {};
  if (!context.steps) context.steps = {};
  if (!context.portOutputs) context.portOutputs = {};
  for (const nodeId of Object.keys(runData)) {
    const latest = getLatestOccurrence(runData, nodeId);
    if (!latest) continue;
    context.items[nodeId] = latest.items;
    if (latest.output !== undefined) context.steps[nodeId] = latest.output;
    if (latest.portOutputs) context.portOutputs[nodeId] = latest.portOutputs;
  }
  return context;
};

/**
 * Build inputSources for a node about to execute, from latest upstream occurrences.
 */
const buildInputSources = (graph, nodeId, runData) => {
  const sources = {};
  const edges = graph?.incoming?.get(nodeId) || [];
  for (const edge of edges) {
    const portId = String(edge.targetHandle || "main");
    const latest = getLatestOccurrence(runData, edge.source);
    sources[portId] = {
      nodeId: edge.source,
      runIndex: latest?.runIndex ?? 0,
      outputPort: String(edge.sourceHandle || "main"),
    };
  }
  return sources;
};

/**
 * Legacy Wait / context maps → runData with occurrence 0 per node.
 */
const fromLegacyContext = (legacy = {}) => {
  const runData = createRunData();
  const nodeIds = new Set([
    ...Object.keys(legacy.items || {}),
    ...Object.keys(legacy.steps || {}),
    ...Object.keys(legacy.portOutputs || {}),
  ]);
  for (const nodeId of nodeIds) {
    recordOccurrence(runData, {
      nodeId,
      runIndex: 0,
      status: "succeeded",
      items: Array.isArray(legacy.items?.[nodeId]) ? legacy.items[nodeId] : [],
      output: legacy.steps?.[nodeId] ?? null,
      portOutputs: legacy.portOutputs?.[nodeId] ?? null,
    });
  }
  return runData;
};

/** Deep-clone runData for Wait snapshots (JSON-safe). */
const serializeRunData = (runData) => {
  if (!runData || typeof runData !== "object") return {};
  const out = {};
  for (const [nodeId, list] of Object.entries(runData)) {
    if (!Array.isArray(list)) continue;
    out[nodeId] = list.map((o) => ({
      runIndex: o.runIndex,
      status: o.status,
      items: o.items,
      output: o.output,
      portOutputs: o.portOutputs,
      inputSources: o.inputSources,
      startedAt: o.startedAt,
      completedAt: o.completedAt,
      error: o.error,
      stepId: o.stepId,
    }));
  }
  return out;
};

const deserializeRunData = (raw) => {
  if (!raw || typeof raw !== "object") return createRunData();
  const runData = createRunData();
  for (const [nodeId, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue;
    runData[nodeId] = list.map((o) => ({
      runIndex: Number(o.runIndex) || 0,
      status: o.status || "succeeded",
      items: Array.isArray(o.items) ? o.items : [],
      output: o.output ?? null,
      portOutputs: o.portOutputs ?? null,
      inputSources: o.inputSources ?? null,
      startedAt: o.startedAt || null,
      completedAt: o.completedAt || null,
      error: o.error || null,
      stepId: o.stepId || null,
    }));
  }
  return runData;
};

/**
 * Resolve which predecessor occurrence supplied an input port.
 * Falls back to latest when inputSources absent (occurrence-0 workflows).
 */
const resolveSourceOccurrence = (runData, inputSources, portId, fallbackNodeId) => {
  const key = portId != null ? String(portId) : "main";
  const src =
    (inputSources && (inputSources[key] || inputSources.main)) || null;
  const nodeId = src?.nodeId || fallbackNodeId;
  if (!nodeId) return null;
  const runIndex = src?.runIndex != null ? src.runIndex : null;
  if (runIndex != null) {
    return getOccurrence(runData, nodeId, runIndex);
  }
  return getLatestOccurrence(runData, nodeId);
};

module.exports = {
  OCCURRENCE_REACH,
  createRunData,
  nextRunIndex,
  recordOccurrence,
  getOccurrence,
  getLatestOccurrence,
  getLatestNodeItems,
  getOccurrenceItems,
  classifyOccurrenceReach,
  applyLatestView,
  buildInputSources,
  fromLegacyContext,
  serializeRunData,
  deserializeRunData,
  resolveSourceOccurrence,
};
