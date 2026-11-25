/**
 * Map Perigon LinkedIn Social search results → OpsAi common lead rows.
 * Do not fabricate missing fields.
 */

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

const mapAuthor = (author) => {
  if (!author || typeof author !== "object") return null;
  const name = asString(
    author.fullName || author.name || author.username || author.publicIdentifier
  );
  const profileUrl = asString(author.url);
  const headline = asString(
    author.title || author.occupation || author.headline
  );
  if (!name && !profileUrl) return null;
  return {
    name,
    headline,
    profileUrl,
    company: null,
    username: asString(author.username || author.publicIdentifier),
    type: asString(author.type),
  };
};

const mapEngagement = (row) => {
  const likes = asNumber(row.likes);
  const comments = asNumber(row.comments);
  const reactions = asNumber(row.reactions);
  const reposts = asNumber(row.shares ?? row.reposts);
  const engagement = {
    likes: likes ?? reactions,
    comments,
    reposts,
  };
  if (Object.values(engagement).every((v) => v == null)) return null;
  return engagement;
};

/**
 * @param {object} row - Perigon result item
 * @param {{ matchedKeywords?: string[] }} context
 */
const mapPerigonPost = (row, context = {}) => {
  if (!row || typeof row !== "object") return null;
  const content = asString(row.text || row.content);
  const sourcePostId = asString(row.urn || row.id);
  const sourcePostUrl = asString(row.url || row.shareUrl || row.postUrl);
  if (!sourcePostId && !sourcePostUrl && !content) return null;

  const publishedAt = asString(row.postedAt || row.createdAt || row.publishedAt);

  return {
    sourcePostId,
    sourcePostUrl,
    content,
    contentKind: content ? "full" : "missing",
    publishedAt,
    publishedAtVerified: Boolean(publishedAt),
    matchedKeywords: Array.isArray(context.matchedKeywords)
      ? context.matchedKeywords.map(String)
      : [],
    author: mapAuthor(row.author),
    engagement: mapEngagement(row),
    _sourceAdapter: "perigon",
    _perigon: {
      reposted: row.reposted === true || row.isRepost === true ? true : undefined,
      reactionsByType:
        row.empathy != null ||
        row.appreciation != null ||
        row.praise != null ||
        row.interest != null ||
        row.funny != null ||
        row.maybe != null
          ? {
              empathy: asNumber(row.empathy),
              appreciation: asNumber(row.appreciation),
              praise: asNumber(row.praise),
              interest: asNumber(row.interest),
              funny: asNumber(row.funny),
              maybe: asNumber(row.maybe),
            }
          : undefined,
    },
  };
};

const mapPerigonPosts = (results, context = {}) =>
  (Array.isArray(results) ? results : [])
    .map((row) => mapPerigonPost(row, context))
    .filter(Boolean);

module.exports = {
  mapPerigonPost,
  mapPerigonPosts,
};
