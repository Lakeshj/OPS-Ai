/**
 * Common LinkedIn Lead Discovery result normalization.
 * Never fabricates unavailable fields.
 */

const { matchKeywordsInText, matchCategoriesForKeywords } = require("./keywordEngine");
const { CATEGORY_BY_ID } = require("./keywordLibrary");

const asString = (value) => {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
};

const asNumber = (value) => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const normalizeLeadItem = (raw, context = {}) => {
  const provider = context.provider || "opsai_native";
  const queries = context.queries || [];
  const collectedAt = context.collectedAt || new Date().toISOString();
  const content = asString(raw.content || raw.text || raw.postContent);
  const matchedKeywords =
    Array.isArray(raw.matchedKeywords) && raw.matchedKeywords.length
      ? raw.matchedKeywords.map(String)
      : matchKeywordsInText(content || "", queries);
  const matchedCategoryIds =
    Array.isArray(raw.matchedCategoryIds) && raw.matchedCategoryIds.length
      ? raw.matchedCategoryIds.map(String)
      : matchCategoriesForKeywords(matchedKeywords);
  const matchedCategories = matchedCategoryIds
    .map((id) => CATEGORY_BY_ID[id]?.label || id)
    .filter(Boolean);
  const matchedIntentIds = Array.isArray(raw.matchedIntentIds)
    ? raw.matchedIntentIds.map(String)
    : [];

  const author =
    raw.author && typeof raw.author === "object"
      ? {
          name: asString(raw.author.name),
          headline: asString(raw.author.headline || raw.author.title),
          profileUrl: asString(raw.author.profileUrl || raw.author.url),
          company: asString(raw.author.company),
        }
      : null;

  const engagement = {
    likes: asNumber(raw.engagement?.likes ?? raw.likes ?? raw.numLikes),
    comments: asNumber(
      raw.engagement?.comments ?? raw.comments ?? raw.numComments
    ),
    reposts: asNumber(
      raw.engagement?.reposts ?? raw.reposts ?? raw.numShares
    ),
  };

  const hasEngagement = Object.values(engagement).some((v) => v != null);

  const publishedAt = asString(
    raw.publishedAt || raw.postedAtISO || raw.publishedAtISO || raw.date
  );
  let contentKind = asString(raw.contentKind);
  if (!contentKind) {
    if (content) contentKind = "full";
    else contentKind = "missing";
  }

  return {
    sourcePostId: asString(raw.sourcePostId || raw.urn || raw.id),
    sourcePostUrl: asString(raw.sourcePostUrl || raw.url || raw.postUrl),
    content,
    contentKind,
    publishedAt,
    publishedAtVerified:
      publishedAt == null
        ? false
        : raw.publishedAtVerified === true
          ? true
          : false,
    matchedKeywords,
    matchedCategoryIds,
    matchedCategories,
    matchedIntentIds,
    author: author && (author.name || author.profileUrl) ? author : null,
    engagement: hasEngagement ? engagement : null,
    dataProvider: provider,
    collectedAt,
    candidateOpportunity: true,
    qualifiedLead: false,
    sourceAdapter: asString(raw._sourceAdapter) || null,
    _meta: {
      provider: "linkedin_lead_discovery",
      dataProvider: provider,
      resource: context.resource || "lead",
      operation: context.operation || null,
      fixture: Boolean(raw._fixture || context.fixture),
      contentKind,
      publishedAtVerified:
        publishedAt == null ? false : raw.publishedAtVerified === true,
      sourceAdapter: asString(raw._sourceAdapter) || null,
    },
  };
};

const normalizeLeadItems = (rows, context = {}) =>
  (Array.isArray(rows) ? rows : []).map((row) => normalizeLeadItem(row, context));

module.exports = {
  normalizeLeadItem,
  normalizeLeadItems,
};
