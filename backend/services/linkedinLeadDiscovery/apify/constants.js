/**
 * Verified Apify actor constants for LinkedIn Lead Discovery (M10.3).
 * Actor: curious_coder/linkedin-post-search-scraper
 * Console: https://console.apify.com/actors/kfiWbq3boy3dWKbiL
 */

const ACTOR_ID = "kfiWbq3boy3dWKbiL";
const ACTOR_USERNAME_NAME = "curious_coder~linkedin-post-search-scraper";
const ACTOR_URL =
  "https://apify.com/curious_coder/linkedin-post-search-scraper";
const APIFY_API_BASE = "https://api.apify.com/v2";

/** Current Store pricing model (verified 2026-11 via public Actor API). */
const ACTOR_PRICING = Object.freeze({
  model: "PAY_PER_EVENT",
  events: Object.freeze({
    actorStartUsd: 0.0005,
    datasetItemUsd: 0.0005,
  }),
  note:
    "Free and Paid are Apify account plan modes sharing one monthly usage allowance — not separate Actors or separate quotas.",
});

const DEFAULT_RUN = Object.freeze({
  timeoutSecs: 600,
  memoryMbytes: 512,
  pollIntervalMs: 2000,
  maxPollMs: 10 * 60 * 1000,
  datasetPageSize: 100,
});

module.exports = {
  ACTOR_ID,
  ACTOR_USERNAME_NAME,
  ACTOR_URL,
  APIFY_API_BASE,
  ACTOR_PRICING,
  DEFAULT_RUN,
};
