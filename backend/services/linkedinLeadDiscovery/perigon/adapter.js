/**
 * Dedicated Perigon LinkedIn Social source adapter (independent of generic feed).
 */

const AppError = require("../../../utils/AppError");
const { createPerigonClient, extractApiKey } = require("./client");
const {
  LINKEDIN_POSTS_PATH,
  DEFAULT_TIMEOUT_MS,
  ADAPTER_ID,
  OR_GROUP_SIZE,
} = require("./constants");
const { CODE, isPermanentAuthOrEntitlement } = require("./errors");
const {
  chunkIntoOrGroups,
  mapSortBy,
  mapDatePosted,
  mapOptionalFilters,
} = require("./queryBuilder");
const { mapPerigonPosts } = require("./mapResults");
const { matchKeywordsInText } = require("../keywordEngine");

const id = ADAPTER_ID;

const searchGroupPages = async ({
  client,
  q,
  keywords,
  sortBy,
  datePosted,
  optional,
  maxResults,
  signal,
  timeoutMs,
}) => {
  const rows = [];
  let page = 1;
  let pagesFetched = 0;
  const maxPages = 25;

  while (pagesFetched < maxPages && rows.length < maxResults) {
    if (signal?.aborted) {
      throw new AppError(
        "Perigon search cancelled.",
        499,
        CODE.TIMEOUT
      );
    }
    const res = await client.get(LINKEDIN_POSTS_PATH, {
      query: {
        q,
        ...(sortBy ? { sortBy } : {}),
        ...(datePosted ? { datePosted } : {}),
        ...optional,
        page,
      },
      signal,
      timeoutMs,
    });
    pagesFetched += 1;
    const body = res.body || {};
    const results = Array.isArray(body.results) ? body.results : [];
    const mapped = mapPerigonPosts(results, {
      matchedKeywords: keywords,
    }).map((row) => {
      // Prefer text match against the group's keywords for accurate matchedKeywords.
      const matched = matchKeywordsInText(row.content || "", keywords);
      return {
        ...row,
        matchedKeywords: matched.length ? matched : row.matchedKeywords,
      };
    });
    rows.push(...mapped);

    const nextPage = body.nextPage;
    if (nextPage == null || nextPage === "" || Number(nextPage) <= page) {
      break;
    }
    page = Number(nextPage);
    if (!Number.isFinite(page) || page < 1) break;
  }

  return { rows, pagesFetched };
};

/**
 * Execute keyword discovery against Perigon LinkedIn Social API.
 */
const search = async (spec = {}) => {
  const apiKey = extractApiKey(spec.credential);
  if (!apiKey) {
    throw new AppError(
      "Select a Perigon API key credential before running with the Perigon Native source.",
      400,
      CODE.NOT_CONNECTED
    );
  }

  const client =
    spec.perigonClient ||
    createPerigonClient({
      apiKey,
      fetchImpl: spec.fetchImpl,
    });

  const plan = chunkIntoOrGroups(spec.queries, spec.orGroupSize || OR_GROUP_SIZE);
  const sortBy = mapSortBy(spec.sortBy) || undefined;
  const datePosted = mapDatePosted(spec.publicationPeriod) || undefined;
  const optional = mapOptionalFilters(spec);
  const maxResults = Math.min(Math.max(Number(spec.maxResults) || 25, 1), 100);
  const timeoutMs = Math.max(
    Number(spec.timeoutMs) || DEFAULT_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS
  );

  const allRows = [];
  const partialErrors = [];
  let cancelled = false;
  let completedGroups = 0;
  let pagesFetched = 0;

  for (const group of plan.groups) {
    if (spec.signal?.aborted) {
      cancelled = true;
      break;
    }
    if (allRows.length >= maxResults) break;
    if (!group.q) continue;

    try {
      const out = await searchGroupPages({
        client,
        q: group.q,
        keywords: group.keywords,
        sortBy,
        datePosted,
        optional,
        maxResults: maxResults - allRows.length,
        signal: spec.signal,
        timeoutMs,
      });
      allRows.push(...out.rows);
      pagesFetched += out.pagesFetched;
      completedGroups += 1;
    } catch (err) {
      if (isPermanentAuthOrEntitlement(err) && completedGroups === 0) {
        throw err;
      }
      partialErrors.push({
        groupIndex: group.groupIndex,
        queries: group.keywords,
        error: {
          message: err?.message || String(err),
          code: err?.code || null,
          status: err?.status || err?.statusCode || null,
        },
      });
      // Permanent mid-run entitlement/quota → stop further spend.
      if (isPermanentAuthOrEntitlement(err)) break;
    }
  }

  if (
    !allRows.length &&
    partialErrors.length &&
    completedGroups === 0
  ) {
    const first = partialErrors[0]?.error;
    throw new AppError(
      first?.message || "All Perigon LinkedIn query groups failed.",
      first?.status || 502,
      first?.code || CODE.API_ERROR
    );
  }

  const remainingGroups = plan.groups.slice(completedGroups);
  const remainingQueries = remainingGroups.flatMap((g) => g.keywords);

  return {
    rows: allRows.slice(0, maxResults),
    coverage: {
      totalQueries: plan.totalQueries,
      completedQueryCount: plan.totalQueries - remainingQueries.length,
      remainingQueryCount: remainingQueries.length,
      remainingQueries,
      hasMore: remainingQueries.length > 0,
      continuation:
        remainingQueries.length > 0
          ? {
              remainingQueries,
              nextGroupIndex: completedGroups,
            }
          : null,
      mode: "perigon",
      groupSize: plan.groupSize,
      groupCount: plan.groupCount,
      completedGroups,
      pagesFetched,
      sortBy: sortBy || null,
      datePosted: datePosted || null,
    },
    partialErrors,
    cancelled,
  };
};

const getPostDetailsUnsupported = () => {
  throw new AppError(
    "Get Post Details is not supported for Perigon. Perigon documents LinkedIn keyword search and profile/company activity endpoints, but not a direct individual-post URL lookup. Use Authorized Data Feed, User Dataset, Previous Node, or Apify for post details.",
    400,
    CODE.UNSUPPORTED_OPERATION
  );
};

module.exports = {
  id,
  search,
  getPostDetailsUnsupported,
  extractApiKey,
};
