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

const validateAndNormalizeFeedUrl = async (rawUrl) => {
  const feedUrl = normalizeFeedBaseUrl(rawUrl);
  if (!feedUrl) {
    throw new AppError(
      "Authorized feed URL is required.",
      400,
      "LINKEDIN_LEAD_NATIVE_FEED_URL_REQUIRED"
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
  validateAndNormalizeFeedUrl,
  testFeedConnection,
};
