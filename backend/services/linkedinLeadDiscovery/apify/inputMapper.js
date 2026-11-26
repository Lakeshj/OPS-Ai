/**
 * Map OpsAi LinkedIn Lead Discovery queries → Apify actor input.
 *
 * Actor: scrapeforge/linkedin-all-in-one (M10.3.9)
 * Required by OpenAPI: mode
 * Search: search, postedLimit, sortBy, maxPosts
 * Post details: mode=post-detail, postUrls[]
 *
 * Never sends LinkedIn session cookies or fabricated auth values.
 */

const AppError = require("../../../utils/AppError");

const postedLimitFacet = (publicationPeriod) => {
  const period = String(publicationPeriod || "past-week");
  if (period === "past-24h") return "24h";
  if (period === "past-month") return "month";
  if (period === "past-year") return ""; // Actor has no year facet
  return "week";
};

const sortFacet = (sortBy) =>
  String(sortBy || "recent") === "relevant" ? "relevance" : "date";

const INTENTISH_RE =
  /^(looking for|need(?: an?)?|seeking|hiring|recommend|suggest|outsourcing|require)/i;

const buildSearchQuery = (queries, { preferIntentFirst = false } = {}) => {
  let parts = (Array.isArray(queries) ? queries : [])
    .map((q) => String(q || "").trim())
    .filter(Boolean);
  if (!parts.length) return "";
  if (preferIntentFirst && parts.length > 1) {
    parts = [
      ...parts.filter((q) => INTENTISH_RE.test(q)),
      ...parts.filter((q) => !INTENTISH_RE.test(q)),
    ];
  }
  if (parts.length === 1) return parts[0];
  // Boolean OR keeps multi-keyword batches in one authorized Actor run.
  // Actor-supported operators only — no unsupported LinkedIn search syntax.
  return parts.map((q) => (/\s/.test(q) ? `"${q}"` : q)).join(" OR ");
};

/**
 * Validate mapped input before calling Apify (avoid repeated invalid runs).
 */
const validateActorInput = (input, { operation } = {}) => {
  const body = input && typeof input === "object" ? input : {};
  if (Object.prototype.hasOwnProperty.call(body, "cookie")) {
    throw new AppError(
      "LinkedIn session cookies are not supported. OpsAi uses a no-cookie Apify Actor. Remove any cookie configuration and retry.",
      400,
      "LINKEDIN_LEAD_APIFY_INPUT_INVALID"
    );
  }
  const mode = String(body.mode || "").trim();
  if (!mode) {
    throw new AppError(
      "Apify Actor input is incomplete: mode is required.",
      400,
      "LINKEDIN_LEAD_APIFY_INPUT_INVALID"
    );
  }
  if (mode === "post-search") {
    if (!String(body.search || "").trim()) {
      throw new AppError(
        "Apify Actor input is incomplete: search keywords are required for post discovery. Select service categories or enter custom keywords.",
        400,
        "LINKEDIN_LEAD_APIFY_INPUT_INVALID"
      );
    }
  } else if (mode === "post-detail") {
    const urls = Array.isArray(body.postUrls) ? body.postUrls.filter(Boolean) : [];
    if (!urls.length) {
      throw new AppError(
        "Apify Actor input is incomplete: a LinkedIn post URL is required for Get Post Details.",
        400,
        "LINKEDIN_LEAD_APIFY_INPUT_INVALID"
      );
    }
  } else if (operation === "get_post_details") {
    throw new AppError(
      `Apify Actor mode "${mode}" cannot load post details. Use post-detail.`,
      400,
      "LINKEDIN_LEAD_APIFY_INPUT_INVALID"
    );
  }
  return true;
};

const buildActorInput = (spec = {}) => {
  const queries = Array.isArray(spec.queries) ? spec.queries.map(String) : [];
  const maxPosts = Math.min(
    Math.max(Number(spec.limitPerSource || spec.maxResults || 25), 1),
    100
  );

  let input;
  if (spec.operation === "get_post_details") {
    const postUrl = String(spec.postUrl || "").trim();
    const postId = String(spec.postId || "").trim();
    const urls = [];
    if (postUrl) urls.push(postUrl);
    else if (postId) {
      urls.push(
        postId.startsWith("http")
          ? postId
          : `https://www.linkedin.com/feed/update/${postId}`
      );
    }
    input = {
      mode: "post-detail",
      postUrls: urls,
      maxPosts: Math.min(Math.max(urls.length, 1), 100),
    };
  } else {
    const preferIntentFirst =
      String(spec.sortBy || "recent").toLowerCase() === "relevant";
    const search = buildSearchQuery(queries, { preferIntentFirst });
    input = {
      mode: "post-search",
      search,
      postedLimit: postedLimitFacet(spec.publicationPeriod),
      sortBy: sortFacet(spec.sortBy),
      maxPosts,
    };
  }

  validateActorInput(input, { operation: spec.operation });

  return {
    input,
    urlCount: Array.isArray(input.postUrls) ? input.postUrls.length : 0,
    queriesMapped: queries.length,
    search: input.search || null,
  };
};

module.exports = {
  buildActorInput,
  validateActorInput,
  buildSearchQuery,
  postedLimitFacet,
  sortFacet,
};
