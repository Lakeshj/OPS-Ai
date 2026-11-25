/**
 * User-provided dataset adapter — matches keywords against posts already in the workflow.
 * Does not fetch LinkedIn HTML.
 */

const { matchKeywordsInText, matchCategoriesForKeywords, normalizeKey } =
  require("../keywordEngine");

const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : null;

const extractCandidate = (item) => {
  const json = asRecord(item?.json) || asRecord(item) || null;
  if (!json) return null;
  const content =
    json.content || json.text || json.postContent || json.excerpt || null;
  const sourcePostUrl =
    json.sourcePostUrl || json.url || json.postUrl || json.permalink || null;
  const sourcePostId = json.sourcePostId || json.urn || json.id || null;
  const looksLinkedIn =
    Boolean(json._meta?.provider === "linkedin_lead_discovery") ||
    (sourcePostUrl && /linkedin\.com/i.test(String(sourcePostUrl))) ||
    Boolean(content && (sourcePostId || sourcePostUrl));
  if (!looksLinkedIn && !content) return null;
  let contentKind = json.contentKind || null;
  if (!contentKind) {
    if (json.content || json.text || json.postContent) contentKind = "full";
    else if (json.excerpt) contentKind = "excerpt";
    else contentKind = content ? "full" : "missing";
  }
  return {
    sourcePostId: sourcePostId ? String(sourcePostId) : null,
    sourcePostUrl: sourcePostUrl ? String(sourcePostUrl) : null,
    content: content != null ? String(content) : null,
    contentKind,
    publishedAt: json.publishedAt || json.postedAtISO || json.date || null,
    publishedAtVerified: json.publishedAtVerified === true,
    author: asRecord(json.author),
    engagement: asRecord(json.engagement),
    matchedKeywords: Array.isArray(json.matchedKeywords)
      ? json.matchedKeywords.map(String)
      : [],
    matchedCategoryIds: Array.isArray(json.matchedCategoryIds)
      ? json.matchedCategoryIds.map(String)
      : [],
    _sourceAdapter: "user_provided_dataset",
    _fixture: false,
  };
};

const collectDatasetRows = (inputItems, datasetPosts) => {
  const rows = [];
  for (const item of inputItems || []) {
    const row = extractCandidate(item);
    if (row) rows.push(row);
  }
  for (const post of datasetPosts || []) {
    const row = extractCandidate(post);
    if (row) rows.push(row);
  }
  return rows;
};

const searchLocal = ({
  inputItems,
  datasetPosts,
  queries,
  maxResults = 25,
}) => {
  const all = collectDatasetRows(inputItems, datasetPosts);
  if (!all.length) {
    return { rows: [], queryCount: (queries || []).length, emptyDataset: true };
  }
  const q = Array.isArray(queries) ? queries : [];
  const matched = [];
  for (const row of all) {
    const hits = matchKeywordsInText(row.content || "", q);
    if (!q.length || hits.length) {
      const matchedKeywords = hits.length
        ? hits
        : row.matchedKeywords || [];
      matched.push({
        ...row,
        matchedKeywords,
        matchedCategoryIds: matchCategoriesForKeywords(matchedKeywords),
        _matchedQueries: hits,
      });
    }
  }
  const limit = Math.min(Math.max(Number(maxResults) || 25, 1), 100);
  return {
    rows: matched.slice(0, limit),
    queryCount: q.length,
    emptyDataset: false,
    datasetSize: all.length,
  };
};

const getPostLocal = ({ inputItems, datasetPosts, postUrl, postId }) => {
  const all = collectDatasetRows(inputItems, datasetPosts);
  const needleUrl = normalizeKey(postUrl);
  const needleId = normalizeKey(postId);
  const row = all.find((p) => {
    if (needleId && normalizeKey(p.sourcePostId) === needleId) return true;
    if (needleUrl && normalizeKey(p.sourcePostUrl) === needleUrl) return true;
    if (needleUrl && normalizeKey(p.sourcePostUrl).includes(needleUrl)) return true;
    return false;
  });
  return row ? { rows: [row] } : { rows: [] };
};

module.exports = {
  id: "user_provided_dataset",
  extractCandidate,
  collectDatasetRows,
  searchLocal,
  getPostLocal,
};
