/**
 * Perigon LinkedIn Social connection probe.
 * Connected only after a successful LinkedIn posts probe — never on key save alone.
 */

const AppError = require("../../../utils/AppError");
const { createPerigonClient, extractApiKey } = require("./client");
const {
  LIMITS_PATH,
  LINKEDIN_POSTS_PATH,
  LIMITS_TIMEOUT_MS,
  TEST_TIMEOUT_MS,
} = require("./constants");
const { CODE } = require("./errors");
const { getUsageStatus } = require("./usage");

/**
 * Test Perigon API key + LinkedIn Social entitlement.
 * @returns {{ ok, status, code?, message, linkedInAccess?, usage? }}
 */
const testPerigonConnection = async ({
  credential,
  apiKey: apiKeyOverride,
  fetchImpl,
  perigonClient,
} = {}) => {
  const apiKey = String(apiKeyOverride || extractApiKey(credential) || "").trim();
  if (!apiKey) {
    return {
      ok: false,
      status: "not_configured",
      code: CODE.KEY_MISSING,
      message:
        "Perigon API key is required. Add a Perigon connection and paste your API key.",
    };
  }

  const client =
    perigonClient ||
    createPerigonClient({ apiKey, fetchImpl });

  // 1) Validate API key via /v1/limits (does not consume social quota).
  let limitsBody = null;
  try {
    const limitsRes = await client.get(LIMITS_PATH, {
      timeoutMs: LIMITS_TIMEOUT_MS,
      retries: 1,
    });
    limitsBody = limitsRes.body;
  } catch (err) {
    if (err instanceof AppError && err.code === CODE.KEY_INVALID) {
      return {
        ok: false,
        status: "invalid_api_key",
        code: err.code,
        message: err.message,
      };
    }
    return {
      ok: false,
      status: "connection_failed",
      code: err?.code || CODE.UNAVAILABLE,
      message: err?.message || "Unable to reach Perigon /v1/limits.",
    };
  }

  const social = limitsBody && typeof limitsBody === "object" ? limitsBody.social : null;

  // 2) Probe LinkedIn keyword search — proves LinkedIn entitlement.
  try {
    const probe = await client.get(LINKEDIN_POSTS_PATH, {
      query: {
        q: '"linkedin"',
        sortBy: "DATE_POSTED",
        datePosted: "PAST_MONTH",
        page: 1,
      },
      timeoutMs: TEST_TIMEOUT_MS,
      retries: 0,
    });
    const numResults = Number(probe.body?.numResults);
    const usage = await getUsageStatus({
      credential: credential || { secret: { apiKey } },
      forceRefresh: true,
      fetchImpl,
      perigonClient: client,
    }).catch(() => null);

    return {
      ok: true,
      status: "connected",
      code: "LINKEDIN_LEAD_PERIGON_CONNECTED",
      message:
        "Connected to Perigon LinkedIn Social API. Keyword search is available.",
      linkedInAccess: true,
      socialQuotaPresent: social != null,
      probeNumResults: Number.isFinite(numResults) ? numResults : null,
      usage: usage || undefined,
    };
  } catch (err) {
    if (err instanceof AppError) {
      if (err.code === CODE.KEY_INVALID) {
        return {
          ok: false,
          status: "invalid_api_key",
          code: err.code,
          message: err.message,
        };
      }
      if (err.code === CODE.LINKEDIN_NOT_ENABLED) {
        return {
          ok: false,
          status: "linkedin_not_enabled",
          code: err.code,
          message: err.message,
          linkedInAccess: false,
          socialQuotaPresent: social != null,
        };
      }
      if (err.code === CODE.QUOTA_EXHAUSTED) {
        return {
          ok: false,
          status: "quota_exhausted",
          code: err.code,
          message: err.message,
          linkedInAccess: true,
          socialQuotaPresent: social != null,
        };
      }
      return {
        ok: false,
        status: "connection_failed",
        code: err.code,
        message: err.message,
        linkedInAccess: social != null ? null : false,
        socialQuotaPresent: social != null,
      };
    }
    return {
      ok: false,
      status: "connection_failed",
      code: CODE.UNAVAILABLE,
      message: err?.message || "Perigon LinkedIn probe failed.",
    };
  }
};

module.exports = {
  testPerigonConnection,
  extractApiKey,
};
