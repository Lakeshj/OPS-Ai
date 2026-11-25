/**
 * Apify account usage + Free/Paid entitlement gates.
 * Free and Paid share one monthly platform allowance — not separate quotas.
 */

const AppError = require("../../../utils/AppError");
const { ACTOR_PRICING, ACTOR_ID, ACTOR_URL } = require("./constants");

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

const isFreePlan = (me) => {
  const plan = me?.plan || {};
  const id = String(plan.id || plan.name || "").toLowerCase();
  if (id.includes("free")) return true;
  const base = Number(plan.monthlyBasePriceUsd);
  if (Number.isFinite(base) && base <= 0) return true;
  return false;
};

const buildUsageSnapshot = ({ me, limits }) => {
  const data = limits?.data || limits || {};
  const cycle = data.monthlyUsageCycle || null;
  const current = data.current || {};
  const caps = data.limits || {};
  const plan = me?.data?.plan || me?.plan || {};
  const usedUsd = Number(current.monthlyUsageUsd);
  const includedUsd = Number(
    plan.monthlyUsageCreditsUsd != null
      ? plan.monthlyUsageCreditsUsd
      : caps.maxMonthlyUsageUsd
  );
  const maxUsd = Number(caps.maxMonthlyUsageUsd);
  const used = Number.isFinite(usedUsd) ? usedUsd : 0;
  const included = Number.isFinite(includedUsd) ? includedUsd : null;
  const maxLimit = Number.isFinite(maxUsd) ? maxUsd : null;
  const freePlan = isFreePlan(me?.data || me);
  const includedPct = percentPair(used, included);
  const maxPct = percentPair(used, maxLimit);
  const refreshedAt = new Date().toISOString();

  // Shared allowance: Free bar = included prepaid credits; Paid bar = hard account max.
  // On Free plans, included ≈ max — both describe the same shared pool.
  const freeBucket =
    included == null
      ? null
      : {
          label: freePlan ? "Free plan included allowance" : "Included prepaid allowance",
          usedUsd: used,
          remainingUsd: Math.max(0, included - used),
          limitUsd: included,
          usedPercent: includedPct.usedPercent,
          remainingPercent: includedPct.remainingPercent,
          periodStart: cycle?.startAt || null,
          periodEnd: cycle?.endAt || null,
          sharedAllowance: true,
        };

  let paidBucket = null;
  if (freePlan) {
    paidBucket = {
      label: "Paid entitlement",
      available: false,
      reason:
        "This Apify account is on the Free plan. Paid mode requires a paid Apify subscription.",
      usedUsd: used,
      remainingUsd: null,
      limitUsd: null,
      usedPercent: null,
      remainingPercent: null,
      periodStart: cycle?.startAt || null,
      periodEnd: cycle?.endAt || null,
      sharedAllowance: true,
    };
  } else if (maxLimit == null || maxPct.infinite) {
    paidBucket = {
      label: "Paid account usage",
      available: true,
      usedUsd: used,
      remainingUsd: null,
      limitUsd: null,
      usedPercent: null,
      remainingPercent: null,
      infinite: true,
      periodStart: cycle?.startAt || null,
      periodEnd: cycle?.endAt || null,
      sharedAllowance: true,
      reason: "No finite paid usage ceiling reported for this account.",
    };
  } else {
    paidBucket = {
      label: "Paid account limit",
      available: true,
      usedUsd: used,
      remainingUsd: Math.max(0, maxLimit - used),
      limitUsd: maxLimit,
      usedPercent: maxPct.usedPercent,
      remainingPercent: maxPct.remainingPercent,
      periodStart: cycle?.startAt || null,
      periodEnd: cycle?.endAt || null,
      sharedAllowance: true,
    };
  }

  return {
    available: true,
    connected: true,
    refreshedAt,
    planId: plan.id || plan.name || null,
    freePlan,
    sharedAllowance: true,
    allowanceNote: ACTOR_PRICING.note,
    cycle,
    free: freeBucket,
    paid: paidBucket,
    actorId: ACTOR_ID,
    actorUrl: ACTOR_URL,
    pricingModel: ACTOR_PRICING.model,
  };
};

const getCachedUsage = (cacheKey) => {
  const hit = usageCache.get(cacheKey);
  if (!hit) return null;
  if (Date.now() - hit.at > USAGE_CACHE_TTL_MS) {
    usageCache.delete(cacheKey);
    return null;
  }
  return hit.value;
};

const setCachedUsage = (cacheKey, value) => {
  usageCache.set(cacheKey, { at: Date.now(), value });
};

const clearUsageCache = (cacheKey) => {
  if (cacheKey) usageCache.delete(cacheKey);
  else usageCache.clear();
};

const fetchUsageStatus = async (client, { forceRefresh = false, cacheKey } = {}) => {
  const key = cacheKey || "default";
  if (!forceRefresh) {
    const cached = getCachedUsage(key);
    if (cached) return { ...cached, fromCache: true };
  }
  try {
    const [meRes, limitsRes] = await Promise.all([
      client.getMe(),
      client.getLimits(),
    ]);
    const snapshot = buildUsageSnapshot({
      me: meRes.body,
      limits: limitsRes.body,
    });
    setCachedUsage(key, snapshot);
    return { ...snapshot, fromCache: false };
  } catch (err) {
    if (err instanceof AppError && err.code === "LINKEDIN_LEAD_APIFY_CREDENTIAL_INVALID") {
      throw err;
    }
    return {
      available: false,
      connected: true,
      reason:
        err?.message ||
        "Apify usage APIs are temporarily unavailable. Progress bars are not fabricated.",
      free: null,
      paid: null,
      actorId: ACTOR_ID,
      actorUrl: ACTOR_URL,
      refreshedAt: new Date().toISOString(),
    };
  }
};

/**
 * Enforce Free/Paid selection before starting a chargeable Actor run.
 */
const assertBillingModeAllowed = (usage, billingMode) => {
  const mode = String(billingMode || "free").toLowerCase() === "paid" ? "paid" : "free";
  if (!usage?.available) {
    throw new AppError(
      usage?.reason ||
        "Cannot verify Apify usage entitlement. Refresh usage status and try again.",
      402,
      "LINKEDIN_LEAD_APIFY_USAGE_UNAVAILABLE"
    );
  }

  const minCharge =
    ACTOR_PRICING.events.actorStartUsd + ACTOR_PRICING.events.datasetItemUsd;

  if (mode === "free") {
    const free = usage.free;
    if (!free || free.limitUsd == null) {
      throw new AppError(
        "Free mode cannot be enforced: included allowance was not reported by Apify.",
        402,
        "LINKEDIN_LEAD_APIFY_FREE_UNENFORCEABLE"
      );
    }
    if (free.remainingUsd != null && free.remainingUsd < minCharge) {
      throw new AppError(
        "Free Apify allowance is exhausted for this billing period. Wait for the next cycle or switch to Paid only if you have a paid Apify plan — never switched automatically.",
        402,
        "LINKEDIN_LEAD_APIFY_FREE_EXHAUSTED"
      );
    }
    return { mode, maxTotalChargeUsd: Math.max(free.remainingUsd, minCharge) };
  }

  // Paid
  if (usage.freePlan) {
    throw new AppError(
      "Paid mode requires a paid Apify subscription. This account is on the Free plan.",
      402,
      "LINKEDIN_LEAD_APIFY_PAID_UNAVAILABLE"
    );
  }
  const paid = usage.paid;
  if (paid?.available === false) {
    throw new AppError(
      paid.reason || "Paid Apify entitlement is unavailable.",
      402,
      "LINKEDIN_LEAD_APIFY_PAID_UNAVAILABLE"
    );
  }
  if (
    paid?.limitUsd != null &&
    paid.remainingUsd != null &&
    paid.remainingUsd < minCharge
  ) {
    throw new AppError(
      "Apify paid usage limit reached for this billing period.",
      402,
      "LINKEDIN_LEAD_APIFY_USAGE_LIMIT"
    );
  }
  return {
    mode,
    maxTotalChargeUsd:
      paid?.remainingUsd != null && Number.isFinite(paid.remainingUsd)
        ? paid.remainingUsd
        : undefined,
  };
};

module.exports = {
  buildUsageSnapshot,
  fetchUsageStatus,
  assertBillingModeAllowed,
  clearUsageCache,
  isFreePlan,
  USAGE_CACHE_TTL_MS,
};
