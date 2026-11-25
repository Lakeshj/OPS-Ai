/**
 * Deduplicate LinkedIn opportunity rows across keywords / intents / categories / batches.
 * Merge matched keywords and categories onto the surviving unique post.
 */

const normalizeKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const identityKey = (row) => {
  const id = normalizeKey(row?.sourcePostId || row?.urn || row?.id);
  if (id) return `id:${id}`;
  const url = normalizeKey(row?.sourcePostUrl || row?.url || row?.postUrl);
  if (url) return `url:${url}`;
  const content = normalizeKey(row?.content || row?.text || "");
  if (content) return `content:${content.slice(0, 160)}`;
  return null;
};

const uniqueStrings = (values) => {
  const seen = new Set();
  const out = [];
  for (const raw of values || []) {
    const text = String(raw || "").trim();
    if (!text) continue;
    const key = normalizeKey(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
};

const mergeRow = (existing, incoming) => {
  const next = { ...existing };
  // Prefer fuller content over excerpt / missing.
  const rank = { full: 3, excerpt: 2, missing: 1 };
  const existingKind = existing.contentKind || (existing.content ? "full" : "missing");
  const incomingKind = incoming.contentKind || (incoming.content ? "full" : "missing");
  if ((rank[incomingKind] || 0) > (rank[existingKind] || 0)) {
    next.content = incoming.content;
    next.contentKind = incomingKind;
  } else if (!next.content && incoming.content) {
    next.content = incoming.content;
    next.contentKind = incomingKind;
  }
  if (!next.publishedAt && incoming.publishedAt) {
    next.publishedAt = incoming.publishedAt;
    next.publishedAtVerified = incoming.publishedAtVerified;
  } else if (
    incoming.publishedAtVerified === true &&
    existing.publishedAtVerified !== true
  ) {
    next.publishedAt = incoming.publishedAt;
    next.publishedAtVerified = true;
  }
  if (!next.author && incoming.author) next.author = incoming.author;
  if (!next.engagement && incoming.engagement) next.engagement = incoming.engagement;
  if (!next.sourcePostUrl && incoming.sourcePostUrl) {
    next.sourcePostUrl = incoming.sourcePostUrl;
  }
  if (!next.sourcePostId && incoming.sourcePostId) {
    next.sourcePostId = incoming.sourcePostId;
  }
  next.matchedKeywords = uniqueStrings([
    ...(existing.matchedKeywords || []),
    ...(incoming.matchedKeywords || []),
  ]);
  next.matchedCategoryIds = uniqueStrings([
    ...(existing.matchedCategoryIds || []),
    ...(incoming.matchedCategoryIds || []),
  ]);
  next.matchedIntentIds = uniqueStrings([
    ...(existing.matchedIntentIds || []),
    ...(incoming.matchedIntentIds || []),
  ]);
  next._matchedQueries = uniqueStrings([
    ...(existing._matchedQueries || []),
    ...(incoming._matchedQueries || []),
  ]);
  return next;
};

const dedupeRows = (rows) => {
  const map = new Map();
  let dropped = 0;
  for (const row of rows || []) {
    if (!row || typeof row !== "object") continue;
    const key = identityKey(row);
    if (!key) {
      map.set(`anon:${map.size}`, row);
      continue;
    }
    if (!map.has(key)) {
      map.set(key, { ...row });
    } else {
      map.set(key, mergeRow(map.get(key), row));
      dropped += 1;
    }
  }
  return {
    rows: [...map.values()],
    uniqueCount: map.size,
    duplicateMerges: dropped,
  };
};

module.exports = {
  identityKey,
  dedupeRows,
  uniqueStrings,
  mergeRow,
};
