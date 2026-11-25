/**
 * Perigon social usage from GET /v1/limits.
 * Do not invent percentages when requestLimit is null/absent.
 */

const { createPerigonClient, extractApiKey } = require("./client");
const { LIMITS_PATH, LIMITS_TIMEOUT_MS } = require("./constants");
const { CODE } = require("./errors");
const AppError = require("../../../utils/AppError");

const USAGE_CACHE_TTL_MS = 60 * 1000;
const usageCache = new Map();

const roundPct = (n) => Math.round(Number(n) * 10) / 10;

const percentPair = (used, limit) => {
  if (limit == null || !Number.isFinite(limit) || limit <= 0) {
    return { usedPercent: null, remainingPercent: null, infinite: true };
  }
  const usedPct = Math.min(100, Math.max(0, (used / limit) * 100));
  return {
    usedPercent: roundPct(usedPct),
    remainingPercent: roundPct(100 - usedPct),
    infinite: false,
  };
};

const buildSocialUsage = (limitsBody) => {
  const body = limitsBody && typeof limitsBody === "object" ? limitsBody : {};
  const social = body.social;
  const refreshedAt = new Date().toISOString();

  if (social == null) {
    return {
      available: false,
      connected: true,
      reason:
        "Social usage is unavailable for this Perigon organization (no social object on /v1/limits). LinkedIn Social access may not be enabled.",
      social: null,
      free: null,
      paid: null,
      refreshedAt,
      provider: "perigon",
    };
  }

  const used = Number(social.requestsUsed);
  const limitRaw = social.requestLimit;
  const limit =
    limitRaw == null || limitRaw === ""
      ? null
      : Number.isFinite(Number(limitRaw))
        ? Number(limitRaw)
        : null;
  const usedSafe = Number.isFinite(used) ? used : 0;
  const pct = percentPair(usedSafe, limit);
  const remaining =
    limit == null ? null : Math.max(0, limit - usedSafe);

  const bucket = {
    label: "Perigon social requests",
    available: true,
    requestsUsed: usedSafe,
    requestsRemaining: remaining,
    requestLimit: limit,
    usedPercent: pct.usedPercent,
    remainingPercent: pct.remainingPercent,
    infinite: pct.infinite,
    periodStart: social.since || null,
    periodEnd: social.resetAt || null,
    lastMadeAt: social.lastMadeAt || null,
    // Compatibility with UsageProgressBar (requests, not USD)
    usedUsd: usedSafe,
    remainingUsd: remaining,
    limitUsd: limit,
    reason: pct.infinite
      ? "Social request limit is uncapped for this organization — showing usage without a percentage."
      : undefined,
  };

  return {
    available: true,
    connected: true,
    provider: "perigon",
    social: {
      requestsUsed: usedSafe,
      requestLimit: limit,
      since: social.since || null,
      resetAt: social.resetAt || null,
      lastMadeAt: social.lastMadeAt || null,
    },
    // Single social quota — no Apify-style Free/Paid split.
    free: bucket,
    paid: null,
    refreshedAt,
    allowanceNote:
      "Perigon social requests are a separate quota from news API requests. Each LinkedIn page fetch counts as one social request.",
  };
};

const getUsageStatus = async ({
  credential,
  forceRefresh = false,
  fetchImpl,
  perigonClient,
} = {}) => {
  const apiKey = extractApiKey(credential);
  if (!apiKey) {
    return {
      available: false,
      connected: false,
      reason: "Select a Perigon API key credential to view social usage.",
      social: null,
      free: null,
      paid: null,
      provider: "perigon",
    };
  }

  const cacheKey = String(credential?.id || apiKey.slice(0, 8));
  const cached = usageCache.get(cacheKey);
  if (
    !forceRefresh &&
    cached &&
    Date.now() - cached.at < USAGE_CACHE_TTL_MS
  ) {
    return cached.value;
  }

  const client =
    perigonClient ||
    createPerigonClient({ apiKey, fetchImpl });

  try {
    const res = await client.get(LIMITS_PATH, {
      timeoutMs: LIMITS_TIMEOUT_MS,
      retries: 1,
    });
    const value = buildSocialUsage(res.body);
    usageCache.set(cacheKey, { at: Date.now(), value });
    return value;
  } catch (err) {
    if (err instanceof AppError && err.code === CODE.KEY_INVALID) {
      return {
        available: false,
        connected: false,
        reason: err.message,
        code: err.code,
        social: null,
        free: null,
        paid: null,
        provider: "perigon",
      };
    }
    return {
      available: false,
      connected: Boolean(apiKey),
      reason: err?.message || "Unable to load Perigon usage.",
      code: err?.code || null,
      social: null,
      free: null,
      paid: null,
      provider: "perigon",
    };
  }
};

module.exports = {
  getUsageStatus,
  buildSocialUsage,
  percentPair,
};
