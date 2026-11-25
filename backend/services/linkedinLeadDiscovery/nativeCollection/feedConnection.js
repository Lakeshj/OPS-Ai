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

/**
 * Detect third-party LinkedIn APIs that are not the OpsAi generic POST /search contract.
 * Do not append /search to these endpoints.
 */
const classifyUnsupportedFeedApi = (rawUrl) => {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || "").trim());
  } catch (_) {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase().replace(/\/$/, "");

  // Perigon Social API — GET /v1/social/linkedin/posts (not POST {base}/search).
  if (
    (host === "api.perigon.io" || host.endsWith(".perigon.io")) &&
    (path.includes("/v1/social/linkedin") || path.includes("/social/linkedin"))
  ) {
    return {
      kind: "perigon_linkedin_social_api",
      provider: "perigon",
      message:
        "Perigon LinkedIn Social API is not compatible with the generic OpsAi feed contract (POST /search + POST /post). It uses GET /v1/social/linkedin/posts with an API key and requires LinkedIn social access enabled on the Perigon org. A dedicated Perigon adapter is required before live integration — do not paste this URL as a generic Feed URL.",
      docsUrl: "https://perigon.io/docs/api/social-api-overview",
      expectedMethod: "GET",
      expectedPath: "/v1/social/linkedin/posts",
    };
  }

  // Any full resource path that already looks like a vendor "posts" endpoint.
  if (/\/v\d+\/.*\/posts$/i.test(path) || /\/linkedin\/posts$/i.test(path)) {
    return {
      kind: "vendor_posts_endpoint",
      provider: host,
      message:
        "This URL looks like a vendor LinkedIn posts endpoint, not an OpsAi generic feed base. The generic adapter only supports a base URL that implements POST /search and POST /post. Use a compatible feed base or a dedicated vendor adapter.",
      expectedMethod: "unknown",
    };
  }
  return null;
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
  const unsupported = classifyUnsupportedFeedApi(feedUrl);
  if (unsupported) {
    throw new AppError(
      unsupported.message,
      400,
      "LINKEDIN_LEAD_NATIVE_FEED_UNSUPPORTED_API"
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
  const raw = normalizeFeedBaseUrl(feedUrl);
  if (!raw) {
    return {
      ok: false,
      status: "not_configured",
      code: "LINKEDIN_LEAD_NATIVE_FEED_URL_REQUIRED",
      message: "Authorized feed URL is required.",
    };
  }

  const unsupportedEarly = classifyUnsupportedFeedApi(raw);
  if (unsupportedEarly) {
    return {
      ok: false,
      status: "unsupported_api",
      code: "LINKEDIN_LEAD_NATIVE_FEED_UNSUPPORTED_API",
      message: unsupportedEarly.message,
      provider: unsupportedEarly.provider || null,
      docsUrl: unsupportedEarly.docsUrl || null,
    };
  }
  const linkedInPage = classifyLinkedInWebpageUrl(raw);
  if (linkedInPage) {
    return {
      ok: false,
      status: "unsupported_api",
      code: "LINKEDIN_LEAD_NATIVE_FEED_URL_IS_LINKEDIN_PAGE",
      message: linkedInPage.message,
    };
  }

  let base;
  try {
    base = await validateAndNormalizeFeedUrl(raw);
  } catch (err) {
    if (err instanceof AppError) {
      const unsupported =
        err.code === "LINKEDIN_LEAD_NATIVE_FEED_UNSUPPORTED_API" ||
        err.code === "LINKEDIN_LEAD_NATIVE_FEED_URL_IS_LINKEDIN_PAGE";
      return {
        ok: false,
        status: unsupported ? "unsupported_api" : "connection_failed",
        code: err.code,
        message: err.message,
      };
    }
    throw err;
  }

  const token = feedToken || resolveFeedToken(credential) || null;
  // Generic OpsAi contract only — never invent vendor-specific paths.
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
          "Feed rejected authentication. Check the optional feed credential / token (feed provider Bearer — not LinkedIn OAuth / not Apify).",
        httpStatus: res.status,
      };
    }
    if (res.status === 404) {
      return {
        ok: false,
        status: "connection_failed",
        code: "LINKEDIN_LEAD_NATIVE_FEED_CONTRACT_MISSING",
        message:
          "Feed POST /search was not found. The authorized feed base must implement POST /search (and POST /post). Do not paste vendor GET endpoints such as Perigon /v1/social/linkedin/posts.",
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
    return {
      ok: true,
      status: "connected",
      message: "Authorized feed is reachable (generic POST /search contract).",
      httpStatus: res.status,
      feedUrl: base,
    };
  } catch (err) {
    if (err instanceof AppError) {
      return {
        ok: false,
        status: "connection_failed",
        code: err.code,
        message: err.message,
      };
    }
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
  classifyUnsupportedFeedApi,
  validateAndNormalizeFeedUrl,
  testFeedConnection,
};
