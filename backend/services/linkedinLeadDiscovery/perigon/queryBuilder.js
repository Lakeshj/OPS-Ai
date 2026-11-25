/**
 * Map OpsAi keyword batches → Perigon LinkedIn `q` Boolean expressions.
 * Compatible keywords are OR-grouped; remaining queries stay in later batches
 * (never silently dropped).
 */

const { OR_GROUP_SIZE, SORT_BY, DATE_POSTED } = require("./constants");

const escapePhrase = (raw) =>
  String(raw || "")
    .trim()
    .replace(/"/g, '\\"');

const quoteTerm = (raw) => {
  const text = escapePhrase(raw);
  if (!text) return "";
  // Already looks like a Boolean expression — pass through carefully.
  if (/\b(AND|OR|NOT)\b/.test(text) || /^".*"$/.test(text)) return text;
  if (/\s/.test(text)) return `"${text}"`;
  return `"${text}"`;
};

/**
 * Build one Perigon `q` from a small keyword group using OR.
 */
const buildOrQuery = (keywords) => {
  const parts = (Array.isArray(keywords) ? keywords : [])
    .map(quoteTerm)
    .filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  return parts.join(" OR ");
};

const chunkIntoOrGroups = (queries, groupSize = OR_GROUP_SIZE) => {
  const list = Array.isArray(queries) ? queries.map(String).filter(Boolean) : [];
  const size = Math.max(1, Number(groupSize) || OR_GROUP_SIZE);
  const groups = [];
  for (let i = 0; i < list.length; i += size) {
    const slice = list.slice(i, i + size);
    groups.push({
      groupIndex: groups.length,
      offset: i,
      keywords: slice,
      q: buildOrQuery(slice),
    });
  }
  return {
    totalQueries: list.length,
    groupSize: size,
    groupCount: groups.length,
    groups,
  };
};

const mapSortBy = (raw) => {
  const v = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/-/g, "_");
  if (v === "RELEVANCE" || v === "RELEVANT") return SORT_BY.RELEVANCE;
  if (
    v === "DATE_POSTED" ||
    v === "RECENT" ||
    v === "LATEST" ||
    v === "DATE"
  ) {
    return SORT_BY.DATE_POSTED;
  }
  // OpsAi UI values
  const lower = String(raw || "").trim().toLowerCase();
  if (lower === "relevance") return SORT_BY.RELEVANCE;
  if (lower === "recent" || lower === "date" || !lower) return SORT_BY.DATE_POSTED;
  return null;
};

const mapDatePosted = (raw) => {
  const lower = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (
    lower === "past-24h" ||
    lower === "past-day" ||
    lower === "24h" ||
    lower === "past_24h"
  ) {
    return DATE_POSTED.PAST_24H;
  }
  if (lower === "past-week" || lower === "week" || lower === "past_week") {
    return DATE_POSTED.PAST_WEEK;
  }
  if (lower === "past-month" || lower === "month" || lower === "past_month") {
    return DATE_POSTED.PAST_MONTH;
  }
  // Explicit Perigon enums
  const upper = String(raw || "").trim().toUpperCase();
  if (upper === "PAST_24H" || upper === "PAST_WEEK" || upper === "PAST_MONTH") {
    return upper;
  }
  // Unsupported custom ranges are omitted — never invent dateFrom/dateTo.
  return null;
};

const mapOptionalFilters = (spec = {}) => {
  const out = {};
  const contentType = String(spec.contentType || "").trim().toUpperCase();
  if (
    ["PHOTOS", "VIDEOS", "JOBS", "LIVE_VIDEOS", "DOCUMENTS"].includes(
      contentType
    )
  ) {
    out.contentType = contentType;
  }
  const authorTitle = String(spec.authorTitle || "").trim();
  if (authorTitle) out.authorTitle = authorTitle;
  return out;
};

module.exports = {
  quoteTerm,
  buildOrQuery,
  chunkIntoOrGroups,
  mapSortBy,
  mapDatePosted,
  mapOptionalFilters,
};
