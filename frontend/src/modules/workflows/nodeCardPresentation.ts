/**
 * Canvas node card presentation — unified look for all available engine types.
 * Visual-only; does not change ports, contracts, or execution.
 */
import type { LucideIcon } from "lucide-react";
import {
  AlertCircle,
  BarChart3,
  Bot,
  Calculator,
  CalendarClock,
  Circle,
  Code2,
  Copy,
  FileSpreadsheet,
  FileText,
  Filter,
  Flag,
  GitBranch,
  Globe,
  Hash,
  Layers,
  Link2,
  Mail,
  Merge,
  Pause,
  Play,
  Reply,
  Repeat,
  Search,
  Sheet,
  Sparkles,
  Split,
  SwitchCamera,
  Webhook,
  Workflow,
  ArrowUpDown,
  LineChart,
  Table2,
  Wand2,
} from "lucide-react";
import { nodeLibraryCatalog } from "./nodeLibrary";
import type { WorkflowNodeData, WorkflowNodeType } from "./types";

export type NodeVisualBucket =
  | "triggers_flow"
  | "core_data"
  | "files_google_email"
  | "ai";

export type NodeVisualCategory = {
  bucket: NodeVisualBucket;
  label: string;
  /** Border + glow + tag color tokens */
  borderClass: string;
  glowClass: string;
  tagClass: string;
  iconWrapClass: string;
  dashed?: boolean;
};

const TRIGGERS_FLOW = new Set<string>([
  "trigger",
  "schedule",
  "webhook",
  "workflowTrigger",
  "errorTrigger",
  "gmailTrigger",
  "respondToWebhook",
  "wait",
  "loop",
  "executeWorkflow",
  "noop",
]);

const FILES_GOOGLE_EMAIL = new Set<string>([
  "googleSearchConsole",
  "googleAnalytics",
  "googleSheets",
  "gmail",
  "email",
  "gscMcp",
]);

const AI = new Set<string>([
  "ai",
  "aiGenerate",
  "aiAgent",
  "aiChatModel",
  "aiCalculatorTool",
  "aiHttpTool",
  "bot",
  "gscMcpTool",
  "ga4McpTool",
  "aiModelProviderTest",
  "aiToolProviderTest",
  "aiMemoryProviderTest",
  "aiAgentTest",
]);

const AUX_DASHED = new Set<string>([
  "aiChatModel",
  "aiCalculatorTool",
  "aiHttpTool",
  "aiModelProviderTest",
  "aiToolProviderTest",
  "aiMemoryProviderTest",
]);

const BUCKET_STYLES: Record<NodeVisualBucket, Omit<NodeVisualCategory, "bucket" | "dashed">> = {
  triggers_flow: {
    label: "TRIGGERS / FLOW",
    borderClass: "border-emerald-500/70",
    glowClass: "shadow-[0_0_18px_rgba(16,185,129,0.28)]",
    tagClass: "text-emerald-400",
    iconWrapClass: "bg-emerald-500/15 text-emerald-400",
  },
  core_data: {
    label: "CORE / DATA",
    borderClass: "border-sky-500/70",
    glowClass: "shadow-[0_0_18px_rgba(14,165,233,0.28)]",
    tagClass: "text-sky-400",
    iconWrapClass: "bg-sky-500/15 text-sky-400",
  },
  files_google_email: {
    label: "FILES / GOOGLE / EMAIL",
    borderClass: "border-amber-500/70",
    glowClass: "shadow-[0_0_18px_rgba(245,158,11,0.28)]",
    tagClass: "text-amber-400",
    iconWrapClass: "bg-amber-500/15 text-amber-400",
  },
  ai: {
    label: "AI",
    borderClass: "border-violet-500/70",
    glowClass: "shadow-[0_0_18px_rgba(139,92,246,0.32)]",
    tagClass: "text-violet-400",
    iconWrapClass: "bg-violet-500/15 text-violet-400",
  },
};

export function getNodeVisualCategory(engineType: string): NodeVisualCategory {
  let bucket: NodeVisualBucket = "core_data";
  if (TRIGGERS_FLOW.has(engineType)) bucket = "triggers_flow";
  else if (FILES_GOOGLE_EMAIL.has(engineType)) bucket = "files_google_email";
  else if (AI.has(engineType)) bucket = "ai";

  const base = BUCKET_STYLES[bucket];
  return {
    bucket,
    ...base,
    dashed: AUX_DASHED.has(engineType),
  };
}

const ICON_BY_TYPE: Record<string, LucideIcon> = {
  trigger: Play,
  schedule: CalendarClock,
  webhook: Webhook,
  gmailTrigger: Mail,
  respondToWebhook: Reply,
  executeWorkflow: Workflow,
  workflowTrigger: Link2,
  errorTrigger: AlertCircle,
  wait: Pause,
  noop: Circle,
  http: Globe,
  code: Code2,
  set: Layers,
  condition: GitBranch,
  switch: SwitchCamera,
  merge: Merge,
  loop: Repeat,
  splitOut: Split,
  filter: Filter,
  sort: ArrowUpDown,
  limit: Hash,
  removeDuplicates: Copy,
  aggregate: Layers,
  document: FileText,
  spreadsheet: FileSpreadsheet,
  result: BarChart3,
  xlsxBuilder: Table2,
  googleSearchConsole: Search,
  googleAnalytics: LineChart,
  googleSheets: Sheet,
  gmail: Mail,
  email: Mail,
  gscMcp: Search,
  ai: Sparkles,
  aiGenerate: Wand2,
  aiAgent: Bot,
  aiChatModel: Sparkles,
  aiCalculatorTool: Calculator,
  aiHttpTool: Globe,
  bot: Bot,
  gscMcpTool: Link2,
  ga4McpTool: BarChart3,
  integration: Circle,
  migrationUnsupported: AlertCircle,
};

const FALLBACK_BLURBS: Record<string, string> = {
  trigger: "Start the workflow manually",
  schedule: "Run on a schedule",
  webhook: "Start from an HTTP webhook",
  gmailTrigger: "Start when new mail arrives",
  respondToWebhook: "Send the webhook response",
  executeWorkflow: "Call another workflow",
  workflowTrigger: "Entry for sub-workflows",
  errorTrigger: "Start when a parent fails",
  wait: "Pause until resumed",
  noop: "Pass items through unchanged",
  http: "Call an external API",
  code: "Run custom JavaScript",
  set: "Edit fields on each item",
  condition: "Branch on true / false",
  switch: "Route by matching rules",
  merge: "Combine multiple inputs",
  loop: "Iterate over items",
  splitOut: "Expand arrays into items",
  filter: "Keep matching items",
  sort: "Reorder items",
  limit: "Cap how many items continue",
  removeDuplicates: "Drop duplicate items",
  aggregate: "Roll items into one",
  document: "Read a workspace document",
  spreadsheet: "Read spreadsheet rows",
  result: "End with a final value",
  xlsxBuilder: "Build an Excel file",
  googleSearchConsole: "Pull Search Console data",
  googleAnalytics: "Pull Analytics reports",
  googleSheets: "Read or write Sheets",
  gmail: "Send or read Gmail",
  email: "Send an email",
  ai: "Generate text with a model",
  aiGenerate: "One model call per item",
  aiAgent: "Agent with tools and model",
  aiChatModel: "Provide a chat model",
  aiCalculatorTool: "Math tool for agents",
  aiHttpTool: "HTTP tool for agents",
  bot: "Run a Keyword Assistant",
  gscMcpTool: "Process GSC rows with intelligence",
  ga4McpTool: "Process GA4 rows with intelligence",
};

const libraryByEngine = (() => {
  const map = new Map<string, { description: string; name: string; icon: string }>();
  for (const n of nodeLibraryCatalog.nodes) {
    if (!n.engineType || !n.available) continue;
    if (!map.has(n.engineType)) {
      map.set(n.engineType, {
        description: n.description,
        name: n.name,
        icon: n.icon,
      });
    }
  }
  return map;
})();

export function getNodeCardIcon(engineType: string): LucideIcon {
  return ICON_BY_TYPE[engineType] || Circle;
}

export function getNodeCardTitle(
  engineType: string,
  data?: WorkflowNodeData | null
): string {
  const custom = String(data?.label || "").trim();
  if (custom) return custom;
  const fromLib = libraryByEngine.get(engineType)?.name;
  if (fromLib) return fromLib;
  return engineType;
}

/**
 * Prefer a short static blurb; use run preview only when it is compact and useful
 * (e.g. failed message, GSC intelligence summary). Avoid dumping raw JSON keys.
 */
export function getNodeCardDescription(
  engineType: string,
  data?: WorkflowNodeData | null,
  preview?: string
): string {
  if (data?.notesInFlow && data.notes) {
    return String(data.notes).trim();
  }

  const failed = data?.runStatus === "failed" && preview;
  if (failed) return `Failed · ${preview}`;

  // Resource providers: show model/tool subtitle when present
  if (
    engineType === "aiChatModel" ||
    engineType === "aiCalculatorTool" ||
    engineType === "aiHttpTool"
  ) {
    if (preview && preview.length < 80) return preview;
  }

  if (preview && preview.length > 0 && preview.length <= 72) {
    // Prefer live preview when short (capability summaries, counts, etc.)
    if (
      /GSC intelligence|item|opportunit|result|sent|HTTP|Model|Tools:/i.test(
        preview
      )
    ) {
      return preview;
    }
  }

  const lib = libraryByEngine.get(engineType)?.description;
  if (lib) {
    const oneLine = lib.replace(/\s+/g, " ").trim();
    return oneLine.length > 64 ? `${oneLine.slice(0, 61)}…` : oneLine;
  }

  return FALLBACK_BLURBS[engineType] || "Workflow step";
}

export function isAuxiliaryResourceType(engineType: string): boolean {
  return AUX_DASHED.has(engineType);
}

export type { WorkflowNodeType };
