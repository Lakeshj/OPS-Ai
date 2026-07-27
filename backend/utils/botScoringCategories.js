/**
 * Scoring categories for AI Assistant Design Validator (bot_design use case).
 */

const BOT_SCORING_CATEGORY_CATALOG = [
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
];

const DEFAULT_BOT_DESIGN_CATEGORIES = [
  "role_clarity",
  "prompt_quality",
  "capability_fit",
  "instruction_strength",
  "workspace_usefulness",
  "safety_guardrails",
];

const catalogByKey = Object.fromEntries(
  BOT_SCORING_CATEGORY_CATALOG.map((item) => [item.key, item])
);

const normalizeBotScoringCategories = (rawKeys) => {
  const keys = Array.isArray(rawKeys) ? rawKeys : DEFAULT_BOT_DESIGN_CATEGORIES;
  const unique = [];
  for (const key of keys) {
    const normalized = String(key || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
    if (catalogByKey[normalized] && !unique.includes(normalized)) {
      unique.push(normalized);
    }
  }
  return unique.length > 0 ? unique : [...DEFAULT_BOT_DESIGN_CATEGORIES];
};

const resolveBotScoringCategories = (keys) =>
  normalizeBotScoringCategories(keys).map((key) => ({
    key,
    label: catalogByKey[key].label,
    weight: catalogByKey[key].weight,
  }));

module.exports = {
  BOT_SCORING_CATEGORY_CATALOG,
  DEFAULT_BOT_DESIGN_CATEGORIES,
  normalizeBotScoringCategories,
  resolveBotScoringCategories,
};
