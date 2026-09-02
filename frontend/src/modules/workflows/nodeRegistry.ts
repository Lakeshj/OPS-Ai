/**
 * Runtime node registry — derived from nodeContract.ts (single source of truth).
 */

import type { WorkflowNodeType } from "./types";
import {
  NODE_CONTRACTS,
  type NodeCapability,
  type NodePortDef,
  nodeSupportsCapability,
  getNodeContract,
  hasInputPanel,
  hasOutputPanel,
  isTriggerNode,
  getPairedItemPolicy,
  getApplicableSettings,
  getStaticOutputSchema,
  getInputPortCount,
  PAIRED_ITEM_LINKERS,
  EXPRESSION_ERRORS,
} from "./nodeContract";

export type { NodeCapability, NodePortDef };

export interface NodeRegistryEntry {
  type: WorkflowNodeType;
  version: number;
  category: string;
  label: string;
  capabilities: NodeCapability[];
  inputs: NodePortDef[];
  outputs: NodePortDef[];
  isTrigger?: boolean;
  isTerminal?: boolean;
}

/** Legacy shape for components that import NODE_REGISTRY */
export const NODE_REGISTRY: Record<WorkflowNodeType, NodeRegistryEntry> =
  Object.fromEntries(
    Object.entries(NODE_CONTRACTS).map(([type, c]) => [
      type,
      {
        type: c.type,
        version: c.version,
        category: c.category,
        label: c.label,
        capabilities: c.capabilities,
        inputs: c.inputs,
        outputs: c.outputs,
        isTrigger: c.isTrigger,
        isTerminal: c.isTerminal,
      },
    ])
  ) as Record<WorkflowNodeType, NodeRegistryEntry>;

export const getNodeCapabilities = (type: WorkflowNodeType): NodeCapability[] =>
  NODE_REGISTRY[type]?.capabilities ?? ["notes"];

export const nodeSupports = (
  type: WorkflowNodeType,
  capability: NodeCapability
): boolean => nodeSupportsCapability(type, capability);

export {
  NODE_CONTRACTS,
  getNodeContract,
  hasInputPanel,
  hasOutputPanel,
  isTriggerNode,
  getPairedItemPolicy,
  getApplicableSettings,
  getStaticOutputSchema,
  getInputPortCount,
  nodeSupportsCapability,
  PAIRED_ITEM_LINKERS,
  EXPRESSION_ERRORS,
};
export {
  resolveNodeOutputPorts,
  normalizeSwitchRules,
  getSwitchOutputPortIds,
  isValidSwitchSourceHandle,
  pruneInvalidSwitchEdges,
  duplicateSwitchNodeData,
  SWITCH_FALLBACK_HANDLE,
} from "./dynamicPorts";
