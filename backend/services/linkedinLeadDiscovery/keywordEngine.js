/**
 * Keyword resolution + intent expansion for LinkedIn Lead Discovery.
 * Preserves all original selected keywords; expands via service stems only.
 */

const {
  CATEGORY_BY_ID,
  INTENT_BY_ID,
  INTENT_VARIATIONS,
  SERVICE_CATEGORIES,
} = require("./keywordLibrary");

const normalizeKey = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const uniquePreserveOrder = (values) => {
  const seen = new Set();
  const out = [];
  for (const raw of values) {
    const text = String(raw || "").trim().replace(/\s+/g, " ");
    if (!text) continue;
    const key = normalizeKey(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
};

const INTENT_PREFIX_RE =
  /^(looking for|need(?: an?)?|seeking|hiring|exploring|shortlisting|onboarding|suggest(?:ing)?|outsourcing)\b/i;

/** True when a phrase already embeds an intent-like opener (avoid double intent). */
const alreadyHasIntent = (phrase) => INTENT_PREFIX_RE.test(String(phrase || "").trim());

const applyIntentTemplate = (template, stem) => {
  const cleanStem = String(stem || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!cleanStem) return "";
  // Avoid "Looking for Looking for …" and "agency agency search".
  if (alreadyHasIntent(cleanStem)) return "";
  let filled = String(template).replace(/\{stem\}/gi, cleanStem);
  filled = filled.replace(/\s+/g, " ").trim();
  // Drop malformed doubles like "SEO agency agency search" when stem ends with agency and template adds it.
  if (/\bagency agency\b/i.test(filled)) {
    filled = filled.replace(/\bagency agency\b/i, "agency");
  }
  if (/\bpartner partner\b/i.test(filled)) {
    filled = filled.replace(/\bpartner partner\b/i, "partner");
  }
  return filled;
};

const resolveCategoryIds = (rawIds) => {
  if (rawIds === "all" || rawIds === true) {
    return SERVICE_CATEGORIES.map((c) => c.id);
  }
  const list = Array.isArray(rawIds)
    ? rawIds
    : String(rawIds || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  return list.filter((id) => CATEGORY_BY_ID[id]);
};

const resolveIntentIds = (rawIds, enabled) => {
  if (!enabled) return [];
  if (rawIds === "all" || rawIds == null || rawIds === "") {
    return INTENT_VARIATIONS.map((i) => i.id);
  }
  const list = Array.isArray(rawIds)
    ? rawIds
    : String(rawIds || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  return list.filter((id) => INTENT_BY_ID[id]);
};

/**
 * Build the executable query list for a discovery run.
 * Original library keywords are always kept when selected.
 * Intent expansion only applies to curated service stems (and short custom stems).
 */
const buildSearchQueries = ({
  mode,
  categoryIds,
  customKeywords,
  additionalKeywords,
  keywordOverrides,
  intentExpansion,
  intentIds,
  maxQueries = 500,
} = {}) => {
  const selectedCategoryIds = resolveCategoryIds(categoryIds);
  const intents = resolveIntentIds(intentIds, intentExpansion === true);
  const originals = [];
  const expanded = [];
  const matchedCategories = [];

  if (mode === "category" || mode === "discover_by_category") {
    for (const id of selectedCategoryIds) {
      const cat = CATEGORY_BY_ID[id];
      if (!cat) continue;
      matchedCategories.push(id);
      const override = keywordOverrides?.[id];
      const baseKeywords = Array.isArray(override) && override.length
        ? override.map(String)
        : [...cat.keywords];
      originals.push(...baseKeywords);
      if (intents.length) {
        for (const stem of cat.serviceStems) {
          for (const intentId of intents) {
            const intent = INTENT_BY_ID[intentId];
            if (!intent) continue;
            const q = applyIntentTemplate(intent.template, stem);
            if (q) {
              expanded.push({
                query: q,
                intentId,
                categoryId: id,
                stem,
              });
            }
          }
        }
      }
    }
  } else if (mode === "custom" || mode === "discover_by_custom_keywords") {
    const customs = Array.isArray(customKeywords)
      ? customKeywords
      : String(customKeywords || "")
          .split(/\n|,/)
          .map((s) => s.trim())
          .filter(Boolean);
    originals.push(...customs);
    if (intents.length) {
      for (const stem of customs) {
        // Only expand short stems; full sentences stay as originals.
        if (alreadyHasIntent(stem) || stem.split(/\s+/).length > 6) continue;
        for (const intentId of intents) {
          const intent = INTENT_BY_ID[intentId];
          if (!intent) continue;
          const q = applyIntentTemplate(intent.template, stem);
          if (q) expanded.push({ query: q, intentId, categoryId: null, stem });
        }
      }
    }
  } else if (mode === "search_posts") {
    const keywords = Array.isArray(customKeywords)
      ? customKeywords
      : String(customKeywords || "")
          .split(/\n|,/)
          .map((s) => s.trim())
          .filter(Boolean);
    originals.push(...keywords);
  }

  if (Array.isArray(additionalKeywords)) {
    originals.push(...additionalKeywords.map(String));
  } else if (additionalKeywords) {
    originals.push(
      ...String(additionalKeywords)
        .split(/\n|,/)
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }

  const originalQueries = uniquePreserveOrder(originals);
  const expandedQueries = uniquePreserveOrder(expanded.map((e) => e.query));
  // Prefer originals first, then expansions not already covered.
  const combined = uniquePreserveOrder([...originalQueries, ...expandedQueries]);
  const ceiling = Math.min(
    Math.max(Number(maxQueries) || 500, 1),
    2000
  );
  const truncated = combined.length > ceiling;
  const queries = truncated ? combined.slice(0, ceiling) : combined;

  return {
    categoryIds: matchedCategories,
    intentIds: intents,
    originalKeywords: originalQueries,
    expandedKeywords: expandedQueries.filter(
      (q) => !originalQueries.some((o) => normalizeKey(o) === normalizeKey(q))
    ),
    queries,
    queryCount: queries.length,
    truncated,
    maxQueries: ceiling,
  };
};

const matchKeywordsInText = (text, queries) => {
  const hay = normalizeKey(text);
  if (!hay) return [];
  return (queries || []).filter((q) => hay.includes(normalizeKey(q)));
};

const matchCategoriesForKeywords = (matchedKeywords) => {
  const ids = new Set();
  for (const cat of SERVICE_CATEGORIES) {
    for (const kw of cat.keywords) {
      if (
        matchedKeywords.some((m) => normalizeKey(m) === normalizeKey(kw)) ||
        matchedKeywords.some((m) => normalizeKey(kw).includes(normalizeKey(m)))
      ) {
        ids.add(cat.id);
      }
    }
  }
  return [...ids];
};

module.exports = {
  buildSearchQueries,
  resolveCategoryIds,
  resolveIntentIds,
  matchKeywordsInText,
  matchCategoriesForKeywords,
  uniquePreserveOrder,
  normalizeKey,
  applyIntentTemplate,
};
