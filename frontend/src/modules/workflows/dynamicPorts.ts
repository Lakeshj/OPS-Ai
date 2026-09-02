/**
 * Dynamic output port resolution (Part 6 — Switch).
 */

import type { NodePortDef } from "./nodeContract";
import type { WorkflowNodeData, WorkflowNodeType } from "./types";
import { NODE_CONTRACTS } from "./nodeContract";

export const SWITCH_FALLBACK_HANDLE = "fallback";
export const SWITCH_OUTPUT_RESOLVER = "switchOutputs";

export type DynamicOutputResolverId = typeof SWITCH_OUTPUT_RESOLVER;

export interface SwitchRule {
  id: string;
  left?: string;
  operator?: string;
  right?: string;
  label?: string;
}

const generateRuleId = (): string =>
  `rule_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;

/** Deterministic legacy ID when a rule has no persisted id (nodeId + index). */
export const legacyStableRuleId = (nodeId: string, index: number): string => {
  const input = `${nodeId}:${index}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `rule_${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

export const normalizeSwitchRules = (
  nodeData: WorkflowNodeData = {},
  nodeId?: string
): WorkflowNodeData => {
  const rawRules = Array.isArray(nodeData.rules)
    ? (nodeData.rules as SwitchRule[])
    : [];
  const rules = rawRules.map((rule, index) => {
    const entry = { ...rule };
    if (!entry.id) {
      entry.id = nodeId
        ? legacyStableRuleId(nodeId, index)
        : generateRuleId();
    }
    if (!entry.label) entry.label = `Rule ${index + 1}`;
    return entry;
  });
  return {
    ...nodeData,
    rules: rules as WorkflowNodeData["rules"],
    enableFallback: nodeData.enableFallback !== false,
    routingMode: nodeData.routingMode || "firstMatch",
  };
};

export const resolveSwitchOutputPorts = (
  nodeData: WorkflowNodeData = {},
  nodeId?: string
): NodePortDef[] => {
  const data = normalizeSwitchRules(nodeData, nodeId);
  const rules = (data.rules || []) as SwitchRule[];
  const ports: NodePortDef[] = rules.map((rule, index) => ({
    id: rule.id,
    kind: "main",
    direction: "out",
    label: rule.label || `Rule ${index + 1}`,
  }));
  if (data.enableFallback !== false) {
    ports.push({
      id: SWITCH_FALLBACK_HANDLE,
      kind: "fallback",
      direction: "out",
      label: "Fallback",
    });
  }
  return ports;
};

export const getSwitchOutputPortIds = (
  nodeData: WorkflowNodeData = {},
  nodeId?: string
): string[] => resolveSwitchOutputPorts(nodeData, nodeId).map((p) => p.id);

export const isValidSwitchSourceHandle = (
  handle: string | null | undefined,
  nodeData: WorkflowNodeData = {},
  nodeId?: string
): boolean => {
  if (!handle) return false;
  return getSwitchOutputPortIds(nodeData, nodeId).includes(String(handle));
};

export const resolveNodeOutputPorts = (
  nodeType: WorkflowNodeType,
  nodeData: WorkflowNodeData = {},
  nodeId?: string
): NodePortDef[] => {
  const contract = NODE_CONTRACTS[nodeType];
  const resolver = contract.dynamicOutputs?.resolver;
  if (resolver === SWITCH_OUTPUT_RESOLVER) {
    return resolveSwitchOutputPorts(nodeData, nodeId);
  }
  return contract.outputs.filter(
    (p) =>
      p.direction === "out" &&
      (p.kind === "main" ||
        p.kind === "true" ||
        p.kind === "false" ||
        p.kind === "fallback" ||
        p.kind === "error")
  );
};

export const pruneInvalidSwitchEdges = <
  T extends { source: string; sourceHandle?: string | null }
>(
  edges: T[],
  nodeId: string,
  nodeData: WorkflowNodeData
): T[] => {
  const valid = new Set(getSwitchOutputPortIds(nodeData, nodeId));
  return edges.filter((edge) => {
    if (edge.source !== nodeId) return true;
    if (!edge.sourceHandle) return false;
    return valid.has(String(edge.sourceHandle));
  });
};

export const prunePinnedPortOutputs = (
  nodeData: WorkflowNodeData,
  nodeId?: string
): WorkflowNodeData => {
  if (!nodeData.pinnedPortOutputs) return nodeData;
  const valid = new Set(getSwitchOutputPortIds(nodeData, nodeId));
  const pruned = Object.fromEntries(
    Object.entries(nodeData.pinnedPortOutputs).filter(([portId]) =>
      valid.has(portId)
    )
  );
  return { ...nodeData, pinnedPortOutputs: pruned };
};

export const duplicateSwitchNodeData = (
  nodeData: WorkflowNodeData
): WorkflowNodeData => {
  const normalized = normalizeSwitchRules(nodeData);
  const rules = ((normalized.rules || []) as SwitchRule[]).map((rule, index) => ({
    ...rule,
    id: generateRuleId(),
    label: rule.label || `Rule ${index + 1}`,
  }));
  return {
    ...normalized,
    rules: rules as WorkflowNodeData["rules"],
    pinned: false,
    pinnedOutput: undefined,
    pinnedItems: undefined,
    pinnedPortOutputs: undefined,
  };
};

/** Normalize all Switch nodes in a workflow definition (load/save). */
export const normalizeDefinitionSwitchNodes = <
  T extends { id: string; type?: string; data?: WorkflowNodeData }
>(
  nodes: T[]
): T[] =>
  nodes.map((n) => {
    const nodeType = n.type || n.data?.nodeType;
    if (nodeType !== "switch") return n;
    return {
      ...n,
      data: normalizeSwitchRules(n.data || {}, n.id),
    };
  });
