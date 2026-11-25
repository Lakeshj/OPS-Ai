/**
 * Perigon LinkedIn Social API constants (M10.3.4).
 * Contract: https://perigon.io/docs/api/social-linkedin-api
 */

const PERIGON_API_BASE = "https://api.perigon.io";
const LINKEDIN_POSTS_PATH = "/v1/social/linkedin/posts";
const LIMITS_PATH = "/v1/limits";

/** LinkedIn live fetches can take tens of seconds — docs require ≥60s. */
const DEFAULT_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 60_000;
const LIMITS_TIMEOUT_MS = 15_000;

/** Soft cap of keywords OR'd into one Perigon `q` (never drops remainder — next batch). */
const OR_GROUP_SIZE = 6;

/** Bounded retries for transient 429 / 5xx only. */
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 1500;

const SORT_BY = Object.freeze({
  DATE_POSTED: "DATE_POSTED",
  RELEVANCE: "RELEVANCE",
});

const DATE_POSTED = Object.freeze({
  PAST_24H: "PAST_24H",
  PAST_WEEK: "PAST_WEEK",
  PAST_MONTH: "PAST_MONTH",
});

module.exports = {
  PERIGON_API_BASE,
  LINKEDIN_POSTS_PATH,
  LIMITS_PATH,
  DEFAULT_TIMEOUT_MS,
  TEST_TIMEOUT_MS,
  LIMITS_TIMEOUT_MS,
  OR_GROUP_SIZE,
  MAX_RETRIES,
  RETRY_BASE_MS,
  SORT_BY,
  DATE_POSTED,
  ADAPTER_ID: "perigon",
};
