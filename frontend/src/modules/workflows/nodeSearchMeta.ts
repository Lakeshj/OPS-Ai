/**
 * UX Phase A — UI-only search aliases/keywords for Node Library discovery.
 * Not used by the workflow engine.
 */

export type NodeSearchMeta = {
  aliases?: string[];
  keywords?: string[];
};

/** Keyed by library node id. */
export const NODE_SEARCH_META: Record<string, NodeSearchMeta> = {
  "manual-trigger": {
    aliases: ["start", "manual", "run"],
    keywords: ["trigger", "begin"],
  },
  "schedule-trigger": {
    aliases: ["cron", "schedule", "timer"],
    keywords: ["trigger", "recurring"],
  },
  webhook: {
    aliases: ["webhook", "hook", "incoming"],
    keywords: ["http", "api", "trigger", "endpoint"],
  },
  "workflow-trigger": {
    aliases: [
      "subworkflow",
      "child workflow",
      "call workflow",
      "run workflow",
      "workflow",
      "when executed",
    ],
    keywords: ["trigger", "callable", "sub-workflow"],
  },
  "error-trigger": {
    aliases: [
      "error",
      "failure",
      "failed workflow",
      "on error",
      "error handler",
      "incident",
    ],
    keywords: ["trigger", "error", "failure", "handler", "alert"],
  },
  "execute-workflow": {
    aliases: [
      "subworkflow",
      "child workflow",
      "call workflow",
      "run workflow",
      "workflow",
    ],
    keywords: ["execute", "invoke", "callable"],
  },
  wait: {
    aliases: ["pause", "delay", "sleep"],
    keywords: ["resume", "signal", "time"],
  },
  "http-request": {
    aliases: ["api", "rest", "request", "fetch", "endpoint", "http"],
    keywords: ["web", "integration", "url", "get", "post"],
  },
  switch: {
    aliases: ["route", "router", "case"],
    keywords: ["branch", "rules", "logic"],
  },
  merge: {
    aliases: ["join", "combine", "union"],
    keywords: ["branch", "paths", "logic"],
  },
  "loop-over-items": {
    aliases: ["loop", "iterate", "foreach", "batch"],
    keywords: ["items", "iteration", "repeat"],
  },
  "split-out": {
    aliases: ["split", "explode", "unlist"],
    keywords: ["array", "items"],
  },
  filter: {
    aliases: ["where", "keep", "filter"],
    keywords: ["condition", "match"],
  },
  sort: {
    aliases: ["order", "sort"],
    keywords: ["asc", "desc"],
  },
  "edit-fields-set": {
    aliases: ["set", "edit", "map", "fields"],
    keywords: ["transform", "assign"],
  },
  code: {
    aliases: ["js", "javascript", "script"],
    keywords: ["function", "custom"],
  },
  "send-email": {
    aliases: ["mail", "smtp", "send", "email"],
    keywords: ["message", "inbox", "notification"],
  },
  gmail: {
    aliases: ["mail", "gmail", "google mail"],
    keywords: ["email", "google"],
  },
  outlook: {
    aliases: ["mail", "outlook", "hotmail"],
    keywords: ["email", "microsoft"],
  },
  "microsoft-outlook": {
    aliases: ["mail", "outlook", "hotmail"],
    keywords: ["email", "microsoft"],
  },
  "spreadsheet-file": {
    aliases: ["excel", "xlsx", "csv", "sheet", "spreadsheet"],
    keywords: ["rows", "table", "import", "export"],
  },
  result: {
    aliases: ["output", "end", "finish"],
    keywords: ["response", "final"],
  },
  document: {
    aliases: ["file", "pdf", "doc"],
    keywords: ["extract", "upload"],
  },
  "ai-model": {
    aliases: ["llm", "gpt", "openai", "model", "ai", "legacy model"],
    keywords: ["prompt", "chat", "completion"],
  },
  "ai-bot": {
    aliases: ["assistant", "bot", "keyword assistant"],
    keywords: ["keyword", "chat", "legacy"],
  },
  "ai-agent": {
    aliases: ["agent", "ai agent", "basic ai agent", "llm", "chat", "assistant"],
    keywords: ["tools", "model", "prompt", "basic"],
  },
  "ai-chat-model": {
    aliases: [
      "model",
      "chat model",
      "llm",
      "openai",
      "gemini",
      "deepseek",
    ],
    keywords: ["provider", "temperature", "resource"],
  },
  "ai-calculator-tool": {
    aliases: ["calculator", "math", "tool", "ai tool"],
    keywords: ["arithmetic", "add", "divide"],
  },
};

/** Display labels for category chips (canonical category id unchanged). */
export const CATEGORY_DISPLAY_LABELS: Record<string, string> = {
  "Data Transformation": "Data",
  "HTTP / API": "HTTP",
  "AI Model Providers": "AI Providers",
  "AI Agents": "Agents",
  "Developer Tools": "Dev Tools",
  "Social Media": "Social",
  "Other Integrations": "Other",
};

/** Primary chips shown before "More". */
export const PRIMARY_LIBRARY_CATEGORIES = [
  "Triggers",
  "Core",
  "Logic",
  "Data Transformation",
  "AI",
] as const;
