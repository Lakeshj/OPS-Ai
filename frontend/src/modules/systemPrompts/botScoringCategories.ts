export const BOT_SCORING_CATEGORY_CATALOG = [
  {
    key: "role_clarity",
    label: "Role Clarity",
    weight: 20,
    group: "bot_design",
  },
  {
    key: "prompt_quality",
    label: "Prompt Quality",
    weight: 25,
    group: "bot_design",
  },
  {
    key: "capability_fit",
    label: "Capability Fit",
    weight: 15,
    group: "bot_design",
  },
  {
    key: "instruction_strength",
    label: "Instruction Strength",
    weight: 15,
    group: "bot_design",
  },
  {
    key: "workspace_usefulness",
    label: "Workspace Usefulness",
    weight: 15,
    group: "bot_design",
  },
  {
    key: "safety_guardrails",
    label: "Safety / Guardrails",
    weight: 10,
    group: "bot_design",
  },
] as const;

export const DEFAULT_BOT_DESIGN_CATEGORIES = [
  "role_clarity",
  "prompt_quality",
  "capability_fit",
  "instruction_strength",
  "workspace_usefulness",
  "safety_guardrails",
] as const;

export const getBotScoringCategoryLabel = (key: string) =>
  BOT_SCORING_CATEGORY_CATALOG.find((item) => item.key === key)?.label ||
  key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
