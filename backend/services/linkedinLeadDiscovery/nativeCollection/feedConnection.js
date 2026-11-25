/**
 * Authorized feed URL validation + connection test (SSRF-safe).
 */

const AppError = require("../../../utils/AppError");
const {
  assertSafeHttpUrl,
  HttpSecurityError,
} = require("../../workflowHttpSecurity.service");
const { fetchJsonWithRetries } = require("./httpUtil");

const normalizeFeedBaseUrl = (raw) =>
  String(raw || "")
    .trim()
    .replace(/\/$/, "");

const resolveFeedToken = (credential) => {
  const secret = credential?.secret || {};
  return String(
    secret.token ||
      secret.apiToken ||
      secret.accessToken ||
      secret.value ||
      ""
  ).trim();
};

/**
 * Detect LinkedIn *webpage* URLs that are not OpsAi authorized feed API bases.
 * A post/search/profile/short link is not POST {base}/search contract.
 */
const classifyLinkedInWebpageUrl = (rawUrl) => {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || "").trim());
  } catch (_) {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  const isLinkedInHost =
    host === "linkedin.com" ||
    host.endsWith(".linkedin.com") ||
    host === "lnkd.in" ||
    host.endsWith(".lnkd.in");
  if (!isLinkedInHost) return null;

  if (host === "lnkd.in" || host.endsWith(".lnkd.in")) {
    return {
      kind: "short_link",
      message:
        "LinkedIn short links (lnkd.in) are not authorized feed API endpoints. Paste a licensed OpsAi/partner feed base URL that implements POST /search and POST /post, or use Get Post Details / User Dataset / Apify for post URLs.",
    };
  }
  if (
    path.includes("/posts/") ||
    path.includes("/feed/update/") ||
    path.includes("/pulse/")
  ) {
    return {
      kind: "post_url",
      message:
        "A LinkedIn post webpage URL is not an authorized feed API endpoint. Use operation Get Post Details with Apify (or supply the post in a User Dataset / Previous Node), or configure a real feed API base URL — not linkedin.com/posts/…",
    };
  }
  if (path.includes("/search/results/") || path.includes("/search/")) {
    return {
      kind: "search_url",
      message:
        "A LinkedIn search webpage URL is not an authorized feed API endpoint. Keyword discovery requires a licensed feed API or the optional Apify provider — not pasting linkedin.com/search URLs into Feed URL.",
    };
  }
  if (path.includes("/in/") || path.includes("/company/")) {
    return {
      kind: "profile_url",
      message:
        "A LinkedIn profile/company webpage URL is not an authorized feed API endpoint.",
    };
  }
  return {
    kind: "linkedin_webpage",
    message:
      "LinkedIn website URLs are not OpsAi Native feed APIs. The Feed URL must be an authorized HTTP API base that implements POST /search and POST /post (or use User Dataset / Previous Node / Apify).",
  };
};

const validateAndNormalizeFeedUrl = async (rawUrl) => {
  const feedUrl = normalizeFeedBaseUrl(rawUrl);
  if (!feedUrl) {
    throw new AppError(
      "Authorized feed URL is required.",
      400,
      "LINKEDIN_LEAD_NATIVE_FEED_URL_REQUIRED"
    );
  }
  const linkedInPage = classifyLinkedInWebpageUrl(feedUrl);
  if (linkedInPage) {
    throw new AppError(
      linkedInPage.message,
      400,
      "LINKEDIN_LEAD_NATIVE_FEED_URL_IS_LINKEDIN_PAGE"
    );
  }
  try {
    await assertSafeHttpUrl(feedUrl);
  } catch (err) {
    if (err instanceof HttpSecurityError) {
      throw new AppError(
        err.message || "Feed URL failed security validation.",
        400,
        err.code || "LINKEDIN_LEAD_NATIVE_FEED_UNSAFE_URL"
      );
    }
    throw err;
  }
  return feedUrl;
};

/**
 * Probe POST {feed}/search with an empty/minimal body to confirm contract reachability.
 * Does not invent results. SSRF-safe via assertSafeHttpUrl.
 */
const testFeedConnection = async ({
  feedUrl,
  feedToken,
  credential,
  fetchImpl,
  timeoutMs = 12000,
} = {}) => {
  const base = await validateAndNormalizeFeedUrl(feedUrl);
  const token = feedToken || resolveFeedToken(credential) || null;
  const url = `${base}/search`;
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (token) headers.authorization = `Bearer ${token}`;

  try {
    const doFetch = fetchImpl || fetchJsonWithRetries;
    const res = await doFetch(
      url,
      {
        method: "POST",
        headers,
        body: {
          queries: ["__opsai_feed_probe__"],
          maxResults: 1,
          operation: "search_posts",
          probe: true,
        },
        timeoutMs,
      },
      { maxRetries: 0 }
    );

    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        status: "connection_failed",
        code: "LINKEDIN_LEAD_NATIVE_FEED_AUTH_FAILED",
        message:
          "Feed rejected authentication. Check the optional feed credential / token.",
        httpStatus: res.status,
      };
    }
    if (res.status === 404) {
      return {
        ok: false,
        status: "connection_failed",
        code: "LINKEDIN_LEAD_NATIVE_FEED_CONTRACT_MISSING",
        message:
          "Feed /search endpoint was not found. The authorized feed must implement POST /search.",
        httpStatus: res.status,
      };
    }
    if (!res.ok && res.status >= 500) {
      return {
        ok: false,
        status: "connection_failed",
        code: "LINKEDIN_LEAD_NATIVE_FEED_ERROR",
        message: `Feed returned HTTP ${res.status}.`,
        httpStatus: res.status,
      };
    }
    // 200/4xx (other) still means the host is reachable and likely contract-shaped.
    return {
      ok: true,
      status: "connected",
      message: "Authorized feed is reachable.",
      httpStatus: res.status,
      feedUrl: base,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    return {
      ok: false,
      status: "connection_failed",
      code: "LINKEDIN_LEAD_NATIVE_FEED_ERROR",
      message: err?.message || "Feed connection test failed.",
    };
  }
};

module.exports = {
  normalizeFeedBaseUrl,
  resolveFeedToken,
  classifyLinkedInWebpageUrl,
  validateAndNormalizeFeedUrl,
  testFeedConnection,
};
