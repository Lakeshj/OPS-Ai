/**
 * Map Apify LinkedIn post scraper dataset items → common lead schema rows.
 * Supports scrapeforge/linkedin-all-in-one output and legacy curious_coder shapes.
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

  // scrapeforge post rows use author{} + engagement{}; ignore reaction/profile rows.
  const source = asString(raw.source);
  if (
    source &&
    source !== "post-search" &&
    source !== "post-detail" &&
    source !== "profile-posts" &&
    source !== "company-posts" &&
    source !== "group-posts"
  ) {
    return null;
  }

  const authorObj =
    raw.author && typeof raw.author === "object" ? raw.author : null;
  const engObj =
    raw.engagement && typeof raw.engagement === "object" ? raw.engagement : null;

  const authorName =
    asString(raw.authorFullName) ||
    asString(raw.authorName) ||
    asString(authorObj?.name) ||
    (authorObj
      ? [authorObj.firstName, authorObj.lastName].filter(Boolean).join(" ")
      : null) ||
    null;

  const author = authorName || raw.authorProfileUrl || authorObj?.url || authorObj
    ? {
        name: authorName,
        headline: asString(
          raw.authorHeadline ||
            raw.authorTitle ||
            authorObj?.occupation ||
            authorObj?.position ||
            authorObj?.headline
        ),
        profileUrl: asString(raw.authorProfileUrl || authorObj?.url),
        company: asString(
          raw.authorCompany || authorObj?.company || authorObj?.companyName
        ),
      }
    : null;

  const likes = asNumber(
    engObj?.likes ??
      raw.likeCount ??
      raw.numLikes ??
      raw.likes ??
      raw.socialDetail?.totalSocialActivityCounts?.numLikes
  );
  const comments = asNumber(
    engObj?.comments ??
      raw.commentCount ??
      raw.numComments ??
      raw.comments ??
      raw.socialDetail?.totalSocialActivityCounts?.numComments
  );
  const reposts = asNumber(
    engObj?.shares ??
      engObj?.reposts ??
      raw.repostCount ??
      raw.shareCount ??
      raw.numShares ??
      raw.reposts ??
      raw.socialDetail?.totalSocialActivityCounts?.numShares
  );
  const hasEngagement = [likes, comments, reposts].some((v) => v != null);

  const content = asString(raw.content || raw.text || raw.commentary);
  const publishedAt =
    asString(raw.postedAt) ||
    asString(raw.postedAtISO) ||
    (raw.postedTimestamp
      ? new Date(Number(raw.postedTimestamp)).toISOString()
      : raw.postedAtTimestamp
        ? new Date(Number(raw.postedAtTimestamp)).toISOString()
        : null);

  const sourcePostId = asString(
    raw.postId || raw.urn || raw.id || raw.activityId
  );
  const sourcePostUrl = asString(
    raw.url || raw.postUrl || raw.linkedinUrl
  );

  // Skip empty non-post payloads.
  if (!sourcePostId && !sourcePostUrl && !content) return null;

  return {
    sourcePostId,
    sourcePostUrl,
    content,
    contentKind: content ? "full" : "missing",
    publishedAt,
    publishedAtVerified: Boolean(publishedAt),
    author,
    engagement: hasEngagement ? { likes, comments, reposts } : null,
    _sourceAdapter: "apify_linkedin_all_in_one",
    _fixture: false,
  };
};

const mapApifyItems = (rows) =>
  (Array.isArray(rows) ? rows : []).map(mapApifyItem).filter(Boolean);

module.exports = {
  mapApifyItem,
  mapApifyItems,
};
