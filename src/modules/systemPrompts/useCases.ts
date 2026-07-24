export const SYSTEM_PROMPT_USE_CASES = [
  {
    key: "workspace_summary",
    label: "Workspace Knowledge Evaluator",
    description:
      "Runs after workspace summary generation or update to score knowledge quality.",
    builtIn: true,
  },
  {
    key: "document_classification",
    label: "Document Classification",
    description: "Future: classify uploaded documents by type or purpose.",
    builtIn: false,
  },
  {
    key: "content_moderation",
    label: "Content Moderation",
    description: "Future: moderate generated or user content.",
    builtIn: false,
  },
] as const;

export type SystemPromptUseCaseKey =
  (typeof SYSTEM_PROMPT_USE_CASES)[number]["key"];

export const getUseCaseLabel = (key: string) =>
  SYSTEM_PROMPT_USE_CASES.find((item) => item.key === key)?.label || key;
