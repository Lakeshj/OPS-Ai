/**
 * Dynamic output port resolution (Part 6 — Switch).
 */

const crypto = require("node:crypto");

const SWITCH_FALLBACK_HANDLE = "fallback";
const SWITCH_OUTPUT_RESOLVER = "switchOutputs";

const generateRuleId = () =>
  `rule_${crypto.randomBytes(4).toString("hex")}`;

/** Deterministic legacy ID when a rule has no persisted id (nodeId + index). */
const legacyStableRuleId = (nodeId, index) => {
  const input = `${nodeId}:${index}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `rule_${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

const normalizeSwitchRules = (nodeData = {}, options = {}) => {
  const nodeId = options.nodeId || null;
  const data = { ...nodeData };
  const rawRules = Array.isArray(data.rules) ? data.rules : [];
  const rules = rawRules.map((rule, index) => {
    const entry = { ...(rule || {}) };
    if (!entry.id || typeof entry.id !== "string") {
      entry.id = nodeId
        ? legacyStableRuleId(nodeId, index)
        : generateRuleId();
    }
    if (!entry.label) {
      entry.label = `Rule ${index + 1}`;
    }
    return entry;
  });
  data.rules = rules;
  if (data.enableFallback === undefined) {
    data.enableFallback = true;
  }
  if (!data.routingMode) {
    data.routingMode = "firstMatch";
  }
  return data;
};

const resolveSwitchOutputPorts = (nodeData = {}, options = {}) => {
  const data = normalizeSwitchRules(nodeData, options);
  const ports = (data.rules || []).map((rule, index) => ({
    id: rule.id,
    kind: "main",
    direction: "out",
    label: rule.label || `Rule ${index + 1}`,
    maxConnections: null,
  }));
  if (data.enableFallback !== false) {
    ports.push({
      id: SWITCH_FALLBACK_HANDLE,
      kind: "fallback",
      direction: "out",
      label: "Fallback",
      maxConnections: null,
    });
  }
  return ports;
};

const getSwitchOutputPortIds = (nodeData = {}, options = {}) =>
  resolveSwitchOutputPorts(nodeData, options).map((p) => p.id);

const isValidSwitchSourceHandle = (handle, nodeData = {}, options = {}) => {
  if (!handle) return false;
  return getSwitchOutputPortIds(nodeData, options).includes(String(handle));
};

const pruneInvalidSwitchEdges = (edges, nodeId, nodeData = {}, options = {}) => {
  const valid = new Set(getSwitchOutputPortIds(nodeData, options));
  return edges.filter((edge) => {
    if (edge.source !== nodeId) return true;
    if (!edge.sourceHandle) return false;
    return valid.has(String(edge.sourceHandle));
  });
};

const prunePinnedPortOutputs = (nodeData = {}, options = {}) => {
  const data = { ...nodeData };
  if (!data.pinnedPortOutputs || typeof data.pinnedPortOutputs !== "object") {
    return data;
  }
  const valid = new Set(getSwitchOutputPortIds(data, options));
  const pruned = {};
  for (const [portId, items] of Object.entries(data.pinnedPortOutputs)) {
    if (valid.has(portId)) pruned[portId] = items;
  }
  data.pinnedPortOutputs = pruned;
  return data;
};

const duplicateSwitchNodeData = (nodeData = {}) => {
  const normalized = normalizeSwitchRules(nodeData);
  const rules = (normalized.rules || []).map((rule, index) => ({
    ...rule,
    id: generateRuleId(),
    label: rule.label || `Rule ${index + 1}`,
  }));
  return {
    ...normalized,
    rules,
    pinned: false,
    pinnedOutput: undefined,
    pinnedItems: undefined,
    pinnedPortOutputs: undefined,
  };
};

const validateSwitchEdges = (definition) => {
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  const edges = Array.isArray(definition?.edges) ? definition.edges : [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const errors = [];

  for (const edge of edges) {
    const source = byId.get(edge.source);
    const sourceType = source?.type || source?.data?.nodeType;
    if (sourceType !== "switch" || !edge.sourceHandle) continue;
    const nodeData = normalizeSwitchRules(source.data || {}, {
      nodeId: source.id,
    });
    if (!isValidSwitchSourceHandle(edge.sourceHandle, nodeData)) {
      errors.push(
        `Switch edge from ${edge.source} uses invalid output handle: ${edge.sourceHandle}`
      );
    }
  }

  return errors;
};

module.exports = {
  SWITCH_FALLBACK_HANDLE,
  SWITCH_OUTPUT_RESOLVER,
  generateRuleId,
  legacyStableRuleId,
  normalizeSwitchRules,
  resolveSwitchOutputPorts,
  getSwitchOutputPortIds,
  isValidSwitchSourceHandle,
  pruneInvalidSwitchEdges,
  prunePinnedPortOutputs,
  duplicateSwitchNodeData,
  validateSwitchEdges,
};
