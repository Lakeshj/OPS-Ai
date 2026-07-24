export const SCORING_CATEGORY_CATALOG = [
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
  { key: "objectives", label: "Objectives", weight: null, group: "classic" },
  { key: "persona", label: "Persona", weight: null, group: "classic" },
  {
    key: "completeness",
    label: "Completeness",
    weight: null,
    group: "classic",
  },
  { key: "tone", label: "Tone", weight: null, group: "classic" },
  { key: "clarity", label: "Clarity", weight: null, group: "classic" },
  {
    key: "deliverables",
    label: "Deliverables",
    weight: null,
    group: "classic",
  },
] as const;

export const DEFAULT_WORKSPACE_SUMMARY_CATEGORIES = [
  "business_intelligence",
  "customer_intelligence",
  "brand_intelligence",
  "marketing_intelligence",
  "operational_intelligence",
  "constraints",
  "coverage",
] as const;

export const getScoringCategoryLabel = (key: string) =>
  SCORING_CATEGORY_CATALOG.find((item) => item.key === key)?.label ||
  key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
