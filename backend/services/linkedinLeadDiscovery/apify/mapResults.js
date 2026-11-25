/**
 * Map Apify LinkedIn post scraper dataset items → common lead schema rows.
 * Never fabricates missing fields.
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

const mapApifyItem = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const authorObj =
    raw.author && typeof raw.author === "object" ? raw.author : null;
  const authorName =
    asString(raw.authorFullName) ||
    asString(raw.authorName) ||
    (authorObj
      ? [authorObj.firstName, authorObj.lastName].filter(Boolean).join(" ")
      : null) ||
    null;
  const author = authorName || raw.authorProfileUrl || authorObj
    ? {
        name: authorName,
        headline: asString(
          raw.authorHeadline || raw.authorTitle || authorObj?.occupation
        ),
        profileUrl: asString(raw.authorProfileUrl),
        company: asString(raw.authorCompany || authorObj?.company),
      }
    : null;

  const likes = asNumber(
    raw.likeCount ?? raw.numLikes ?? raw.likes ?? raw.socialDetail?.totalSocialActivityCounts?.numLikes
  );
  const comments = asNumber(
    raw.commentCount ??
      raw.numComments ??
      raw.comments ??
      raw.socialDetail?.totalSocialActivityCounts?.numComments
  );
  const reposts = asNumber(
    raw.repostCount ??
      raw.shareCount ??
      raw.numShares ??
      raw.reposts ??
      raw.socialDetail?.totalSocialActivityCounts?.numShares
  );
  const hasEngagement = [likes, comments, reposts].some((v) => v != null);

  const content = asString(raw.text || raw.content || raw.commentary);
  const publishedAt =
    asString(raw.postedAtISO) ||
    (raw.postedAtTimestamp
      ? new Date(Number(raw.postedAtTimestamp)).toISOString()
      : null);

  return {
    sourcePostId: asString(raw.urn || raw.id || raw.activityId),
    sourcePostUrl: asString(raw.url || raw.postUrl || raw.linkedinUrl),
    content,
    contentKind: content ? "full" : "missing",
    publishedAt,
    publishedAtVerified: Boolean(publishedAt),
    author,
    engagement: hasEngagement
      ? { likes, comments, reposts }
      : null,
    _sourceAdapter: "apify_linkedin_post_search_scraper",
    _fixture: false,
  };
};

const mapApifyItems = (rows) =>
  (Array.isArray(rows) ? rows : []).map(mapApifyItem).filter(Boolean);

module.exports = {
  mapApifyItem,
  mapApifyItems,
};
