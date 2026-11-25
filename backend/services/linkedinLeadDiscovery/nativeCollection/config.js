/**
 * OpsAi Native LinkedIn collection configuration (M10.2).
 */

const asPositiveInt = (raw, fallback, { min = 1, max = 1000 } = {}) => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
};

const truthyEnv = (name) => {
  const v = String(process.env[name] || "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes";
};

const getNativeCollectionConfig = (overrides = {}) => {
  const feedUrl = String(
    overrides.feedUrl != null
      ? overrides.feedUrl
      : process.env.OPSAI_LINKEDIN_FEED_URL || ""
  ).trim();
  const feedToken = String(
    overrides.feedToken != null
      ? overrides.feedToken
      : process.env.OPSAI_LINKEDIN_FEED_TOKEN || ""
  ).trim();

  return {
    feedUrl: feedUrl.replace(/\/$/, ""),
    feedToken: feedToken || null,
    feedConfigured: Boolean(feedUrl),
    queryBatchSize: asPositiveInt(
      overrides.queryBatchSize ?? process.env.OPSAI_LINKEDIN_QUERY_BATCH_SIZE,
      10,
      { min: 1, max: 50 }
    ),
    concurrency: asPositiveInt(
      overrides.concurrency ?? process.env.OPSAI_LINKEDIN_CONCURRENCY,
      3,
      { min: 1, max: 8 }
    ),
    requestTimeoutMs: asPositiveInt(
      overrides.requestTimeoutMs ??
        process.env.OPSAI_LINKEDIN_REQUEST_TIMEOUT_MS,
      15000,
      { min: 1000, max: 120000 }
    ),
    maxRetries: asPositiveInt(
      overrides.maxRetries ?? process.env.OPSAI_LINKEDIN_MAX_RETRIES,
      2,
      { min: 0, max: 5 }
    ),
    allowFixtures:
      overrides.allowFixtures != null
        ? Boolean(overrides.allowFixtures)
        : truthyEnv("OPSAI_LINKEDIN_ALLOW_FIXTURES"),
    isProduction: String(process.env.NODE_ENV || "").toLowerCase() === "production",
  };
};

module.exports = {
  getNativeCollectionConfig,
};
