/**
 * Hard forbid list — Google / remote MCP surfaces must never appear in this plugin.
 * Used by smoke tests and createPlugin assertions.
 */
const FORBIDDEN_MODULES = Object.freeze([
  "googleapis",
  "google-auth-library",
  "@google-analytics/data",
  "google-ads-api",
]);

/** Patterns that indicate a live Google / OAuth call site (not docs). */
const FORBIDDEN_SOURCE_PATTERNS = Object.freeze([
  /analyticsdata\.googleapis\.com/i,
  /oauth2\.googleapis\.com/i,
  /accounts\.google\.com\/o\/oauth2/i,
  /\.runReport\s*\(/,
  /BetaAnalyticsDataClient/,
  /google-auth-library/,
  /from\s+['"]googleapis['"]/,
]);

module.exports = {
  FORBIDDEN_MODULES,
  FORBIDDEN_SOURCE_PATTERNS,
};
