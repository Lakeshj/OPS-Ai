/**
 * Local include/exclude matching for LinkedIn discovery (M10.3.14).
 * Exclusion is applied to returned posts — never as extra billable searches.
 */

const normalizeText = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[_/\\]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const parseKeywordList = (raw) => {
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s || "").trim()).filter(Boolean);
  }
  if (raw == null || raw === "") return [];
  return String(raw)
    .split(/\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
};

const itemHaystack = (row) => {
  const json =
    row && typeof row === "object" && row.json && typeof row.json === "object"
      ? row.json
      : row || {};
  const author = json.author && typeof json.author === "object" ? json.author : {};
  return normalizeText(
    [
      json.content,
      json.sourcePostId,
      author.name,
      author.headline,
      author.company,
      Array.isArray(json.matchedKeywords) ? json.matchedKeywords.join(" ") : "",
    ]
      .filter(Boolean)
      .join(" ")
  );
};

const matchesKeyword = (haystack, keyword, mode) => {
  const needle = normalizeText(keyword);
  if (!needle || !haystack) return false;
  if (mode === "contains") {
    return haystack.includes(needle);
  }
  const pattern = new RegExp(
    `(^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`
  );
  return pattern.test(haystack);
};

/**
 * Remove posts that match any exclude keyword.
 * Discovery operations only — caller decides.
 */
const applyExcludeKeywords = (
  items,
  { excludeKeywords, excludeMatchMode = "phrase" } = {}
) => {
  const list = parseKeywordList(excludeKeywords);
  if (!list.length) {
    return {
      items: Array.isArray(items) ? items : [],
      excludedCount: 0,
      excludeKeywords: [],
      excludeMatchMode: excludeMatchMode === "contains" ? "contains" : "phrase",
    };
  }
  const mode = excludeMatchMode === "contains" ? "contains" : "phrase";
  const kept = [];
  let excludedCount = 0;
  for (const row of Array.isArray(items) ? items : []) {
    const hay = itemHaystack(row);
    const hit = list.some((kw) => matchesKeyword(hay, kw, mode));
    if (hit) {
      excludedCount += 1;
      continue;
    }
    kept.push(row);
  }
  return {
    items: kept,
    excludedCount,
    excludeKeywords: list,
    excludeMatchMode: mode,
  };
};

module.exports = {
  normalizeText,
  parseKeywordList,
  applyExcludeKeywords,
  matchesKeyword,
};
