/**
 * Map OpsAi LinkedIn Lead Discovery queries → Apify actor input.
 * Actor input schema (verified): urls[], cookie?, deepScrape, rawData, minDelay,
 * maxDelay, limitPerSource, scrapeUntilDate, proxy, userAgent.
 */

const datePostedFacet = (publicationPeriod) => {
  const period = String(publicationPeriod || "past-week");
  if (period === "past-24h") return "past-24h";
  if (period === "past-month") return "past-month";
  if (period === "past-year") return "past-year";
  return "past-week";
};

const buildSearchUrl = (keyword, publicationPeriod, sortBy) => {
  const q = encodeURIComponent(String(keyword || "").trim());
  const datePosted = encodeURIComponent(`"${datePostedFacet(publicationPeriod)}"`);
  const sort =
    String(sortBy || "recent") === "relevant"
      ? ""
      : "&sortBy=%22date_posted%22";
  return `https://www.linkedin.com/search/results/content/?keywords=${q}&datePosted=${datePosted}&origin=FACETED_SEARCH${sort}`;
};

const buildActorInput = (spec = {}) => {
  const queries = Array.isArray(spec.queries) ? spec.queries.map(String) : [];
  const urls = [];

  if (spec.operation === "get_post_details") {
    const postUrl = String(spec.postUrl || "").trim();
    const postId = String(spec.postId || "").trim();
    if (postUrl) urls.push(postUrl);
    else if (postId) {
      urls.push(
        postId.startsWith("http")
          ? postId
          : `https://www.linkedin.com/feed/update/${postId}`
      );
    }
  } else {
    for (const kw of queries) {
      if (!String(kw || "").trim()) continue;
      urls.push(
        buildSearchUrl(kw, spec.publicationPeriod, spec.sortBy)
      );
    }
  }

  const limitPerSource = Math.min(
    Math.max(Number(spec.limitPerSource || spec.maxResults || 25), 1),
    100
  );

  const input = {
    urls,
    deepScrape: spec.deepScrape === true,
    rawData: false,
    minDelay: 2,
    maxDelay: 4,
    limitPerSource,
    proxy: {
      useApifyProxy: true,
    },
  };

  // Optional LinkedIn session cookies from encrypted credential — never from node JSON.
  const cookies = spec.linkedinCookies;
  if (Array.isArray(cookies) && cookies.length) {
    input.cookie = cookies;
  } else if (typeof cookies === "string" && cookies.trim()) {
    try {
      const parsed = JSON.parse(cookies);
      if (Array.isArray(parsed)) input.cookie = parsed;
    } catch (_) {
      // ignore malformed optional cookies
    }
  }

  if (spec.scrapeUntilDate) {
    input.scrapeUntilDate = String(spec.scrapeUntilDate);
  }

  return {
    input,
    urlCount: urls.length,
    queriesMapped: queries.length,
  };
};

module.exports = {
  buildActorInput,
  buildSearchUrl,
  datePostedFacet,
};
