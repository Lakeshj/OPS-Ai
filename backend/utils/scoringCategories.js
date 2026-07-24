/**
 * Selectable scoring categories for Workspace Knowledge Evaluator.
 * Admins pick which pillars to score; evaluation JSON and UI follow this list.
 */

const SCORING_CATEGORY_CATALOG = [
  {
    key: "business_intelligence",
    label: "Business Intelligence",
    weight: 20,
    group: "ai_readiness",
  },
  {
    key: "customer_intelligence",
    label: "Customer Intelligence",
    weight: 15,
    group: "ai_readiness",
  },
  {
    key: "brand_intelligence",
    label: "Brand Intelligence",
    weight: 15,
    group: "ai_readiness",
  },
  {
    key: "marketing_intelligence",
    label: "Marketing Intelligence",
    weight: 15,
    group: "ai_readiness",
  },
  {
    key: "operational_intelligence",
    label: "Operational Intelligence",
    weight: 15,
    group: "ai_readiness",
  },
  {
    key: "constraints",
    label: "Constraints / Guardrails",
    weight: 10,
    group: "ai_readiness",
  },
  {
    key: "coverage",
    label: "Chat Coverage",
    weight: 10,
    group: "ai_readiness",
  },
  {
    key: "objectives",
    label: "Objectives",
    weight: null,
    group: "classic",
  },
  {
    key: "persona",
    label: "Persona",
    weight: null,
    group: "classic",
  },
  {
    key: "completeness",
    label: "Completeness",
    weight: null,
    group: "classic",
  },
  {
    key: "tone",
    label: "Tone",
    weight: null,
    group: "classic",
  },
  {
    key: "clarity",
    label: "Clarity",
    weight: null,
    group: "classic",
  },
  {
    key: "deliverables",
    label: "Deliverables",
    weight: null,
    group: "classic",
  },
];

const DEFAULT_WORKSPACE_SUMMARY_CATEGORIES = [
  "business_intelligence",
  "customer_intelligence",
  "brand_intelligence",
  "marketing_intelligence",
  "operational_intelligence",
  "constraints",
  "coverage",
];

const catalogByKey = Object.fromEntries(
  SCORING_CATEGORY_CATALOG.map((item) => [item.key, item])
);

const normalizeScoringCategories = (rawKeys) => {
  const keys = Array.isArray(rawKeys) ? rawKeys : DEFAULT_WORKSPACE_SUMMARY_CATEGORIES;
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
  return unique.length > 0 ? unique : [...DEFAULT_WORKSPACE_SUMMARY_CATEGORIES];
};

const resolveScoringCategories = (keys) =>
  normalizeScoringCategories(keys).map((key) => ({
    key,
    label: catalogByKey[key].label,
    weight: catalogByKey[key].weight,
  }));

module.exports = {
  SCORING_CATEGORY_CATALOG,
  DEFAULT_WORKSPACE_SUMMARY_CATEGORIES,
  normalizeScoringCategories,
  resolveScoringCategories,
  catalogByKey,
};
