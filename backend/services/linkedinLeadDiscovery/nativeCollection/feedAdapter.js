/**
 * Authorized OpsAi LinkedIn opportunity feed adapter (M10.2 primary live source).
 *
 * Expected feed contract (operator-implemented):
 *   POST {FEED_URL}/search  { queries, maxResults, publicationPeriod, sortBy, operation }
 *   POST {FEED_URL}/post    { postUrl?, postId? }
 *
 * Response rows may include only permitted fields. Missing fields stay null.
 */

const AppError = require("../../../utils/AppError");
const { fetchJsonWithRetries } = require("./httpUtil");

const mapFeedRow = (raw, matchedQueries = []) => {
  if (!raw || typeof raw !== "object") return null;
  const content =
    raw.content != null
      ? String(raw.content)
      : raw.text != null
        ? String(raw.text)
        : raw.excerpt != null
          ? String(raw.excerpt)
          : null;
  let contentKind = raw.contentKind || null;
  if (!contentKind) {
    if (raw.content != null || raw.text != null) contentKind = "full";
    else if (raw.excerpt != null) contentKind = "excerpt";
    else contentKind = "missing";
  }
  const publishedAt =
    raw.publishedAt || raw.postedAtISO || raw.publishedAtISO || raw.date || null;
  return {
    sourcePostId: raw.sourcePostId || raw.urn || raw.id || null,
    sourcePostUrl: raw.sourcePostUrl || raw.url || raw.postUrl || null,
    content,
    contentKind,
    publishedAt: publishedAt ? String(publishedAt) : null,
    publishedAtVerified: raw.publishedAtVerified === true,
    author: raw.author && typeof raw.author === "object" ? raw.author : null,
    engagement:
      raw.engagement && typeof raw.engagement === "object" ? raw.engagement : null,
    matchedKeywords: Array.isArray(raw.matchedKeywords) ? raw.matchedKeywords : [],
    matchedCategoryIds: Array.isArray(raw.matchedCategoryIds)
      ? raw.matchedCategoryIds
      : [],
    _matchedQueries: matchedQueries,
    _sourceAdapter: "opsai_authorized_opportunity_feed",
    _fixture: false,
  };
};

const searchBatch = async ({
  config,
  queries,
  maxResults,
  publicationPeriod,
  sortBy,
  operation,
  signal,
  fetchImpl,
}) => {
  if (!config.feedConfigured) {
    throw new AppError(
      "OpsAi Native LinkedIn feed is not configured. Set OPSAI_LINKEDIN_FEED_URL to an authorized opportunity feed, or supply a user dataset / enable fixtures for development.",
      501,
      "LINKEDIN_LEAD_NATIVE_NOT_CONFIGURED"
    );
  }
  const url = `${config.feedUrl}/search`;
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (config.feedToken) {
    headers.authorization = `Bearer ${config.feedToken}`;
  }
  const doFetch = fetchImpl || fetchJsonWithRetries;
  const res = await doFetch(
    url,
    {
      method: "POST",
      headers,
      body: {
        queries,
        maxResults,
        publicationPeriod,
        sortBy,
        operation,
      },
      timeoutMs: config.requestTimeoutMs,
      signal,
    },
    { maxRetries: config.maxRetries }
  );

  if (res.rateLimited) {
    const err = new AppError(
      "Authorized LinkedIn opportunity feed rate-limited this request.",
      429,
      "LINKEDIN_LEAD_NATIVE_RATE_LIMITED"
    );
    err.retryAfterMs = res.retryAfterMs;
    throw err;
  }
  if (!res.ok) {
    throw new AppError(
      `Authorized LinkedIn opportunity feed returned HTTP ${res.status}.`,
      res.status >= 400 && res.status < 600 ? res.status : 502,
      "LINKEDIN_LEAD_NATIVE_FEED_ERROR"
    );
  }

  const body = res.body && typeof res.body === "object" ? res.body : {};
  const list = Array.isArray(body.results)
    ? body.results
    : Array.isArray(body.items)
      ? body.items
      : Array.isArray(body.data)
        ? body.data
        : [];
  const rows = list
    .map((row) => mapFeedRow(row, queries))
    .filter(Boolean);
  return {
    rows,
    queryCount: queries.length,
    paging: body.paging || null,
  };
};

const getPost = async ({
  config,
  postUrl,
  postId,
  signal,
  fetchImpl,
}) => {
  if (!config.feedConfigured) {
    throw new AppError(
      "OpsAi Native LinkedIn feed is not configured for Get Post Details. Set OPSAI_LINKEDIN_FEED_URL or provide the post in the workflow input dataset.",
      501,
      "LINKEDIN_LEAD_NATIVE_NOT_CONFIGURED"
    );
  }
  const url = `${config.feedUrl}/post`;
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (config.feedToken) {
    headers.authorization = `Bearer ${config.feedToken}`;
  }
  const doFetch = fetchImpl || fetchJsonWithRetries;
  const res = await doFetch(
    url,
    {
      method: "POST",
      headers,
      body: { postUrl, postId },
      timeoutMs: config.requestTimeoutMs,
      signal,
    },
    { maxRetries: config.maxRetries }
  );
  if (!res.ok) {
    throw new AppError(
      `Authorized LinkedIn opportunity feed returned HTTP ${res.status} for post details.`,
      res.status >= 400 && res.status < 600 ? res.status : 502,
      "LINKEDIN_LEAD_NATIVE_FEED_ERROR"
    );
  }
  const body = res.body && typeof res.body === "object" ? res.body : {};
  const raw = body.result || body.item || body.data || body;
  const row = mapFeedRow(raw, []);
  if (!row || (!row.sourcePostId && !row.sourcePostUrl && !row.content)) {
    throw new AppError(
      "Post details were not available from the authorized feed.",
      404,
      "LINKEDIN_LEAD_POST_NOT_FOUND"
    );
  }
  return { rows: [row] };
};

module.exports = {
  id: "opsai_authorized_opportunity_feed",
  searchBatch,
  getPost,
  mapFeedRow,
};
