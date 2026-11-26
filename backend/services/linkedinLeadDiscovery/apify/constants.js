/**
 * Verified Apify actor constants for LinkedIn Lead Discovery (M10.3.9).
 *
 * Previous Actor curious_coder/linkedin-post-search-scraper (kfiWbq3boy3dWKbiL)
 * build 1.3.60 requires cookie + userAgent + urls + proxy — personal LinkedIn
 * session cookies. OpsAi does not collect or fabricate those.
 *
 * Current Actor: scrapeforge/linkedin-all-in-one (no cookies / no LinkedIn login)
 * Console: https://console.apify.com/actors/kTfhD8wSCMRXlhNmE
 */

const ACTOR_ID = "kTfhD8wSCMRXlhNmE";
const ACTOR_USERNAME_NAME = "scrapeforge~linkedin-all-in-one";
const ACTOR_URL = "https://apify.com/scrapeforge/linkedin-all-in-one";
const APIFY_API_BASE = "https://api.apify.com/v2";

/** Documented legacy actor that requires LinkedIn session cookies (not used). */
const LEGACY_COOKIE_ACTOR = Object.freeze({
  id: "kfiWbq3boy3dWKbiL",
  usernameName: "curious_coder~linkedin-post-search-scraper",
  url: "https://apify.com/curious_coder/linkedin-post-search-scraper",
  requiredInput: Object.freeze(["cookie", "userAgent", "urls", "proxy"]),
  reason:
    "Requires personal LinkedIn session cookies; incompatible with OpsAi policy.",
});

/** Current Store pricing model (verified 2026-11 via public Actor API). */
const ACTOR_PRICING = Object.freeze({
  model: "PAY_PER_EVENT",
  events: Object.freeze({
    // scrapeforge charges apify-actor-start + post (primary dataset event)
    actorStartUsd: 0.00005,
    datasetItemUsd: 0.001,
  }),
  note:
    "Free and Paid are Apify account plan modes sharing one monthly usage allowance — not separate Actors or separate quotas. This Actor does not require LinkedIn cookies.",
});

const DEFAULT_RUN = Object.freeze({
  timeoutSecs: 600,
  // Actor store default is 4096; keep modest for Free-plan start charges (per GB).
  memoryMbytes: 1024,
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
  LEGACY_COOKIE_ACTOR,
};
