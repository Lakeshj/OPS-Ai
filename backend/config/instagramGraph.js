/**
 * Instagram API with Unified Login (Facebook Login for Business config_id).
 *
 * Newer Meta apps no longer use Instagram Login (graph.instagram.com +
 * instagram_business_* scopes). OpsAi uses Unified Login:
 * - authorize: www.facebook.com/dialog/oauth?config_id=...
 * - token exchange: graph.facebook.com/oauth/access_token
 * - Graph calls: graph.facebook.com (Instagram account id paths)
 *
 * V1 permissions (configured in Meta login configuration — not sent as scope):
 * instagram_basic, instagram_content_publish, instagram_manage_comments,
 * instagram_manage_insights
 *
 * Never include: instagram_manage_messages, ads_management, ads_read.
 * Meta Ads Graph (metaGraph.js) stays separate.
 */

const config = require("./index");

/** Facebook Graph version for Unified Login Instagram calls. */
const API_VERSION = "v26.0";
const GRAPH_HOST = "https://graph.facebook.com";
const OAUTH_DIALOG_HOST = "https://www.facebook.com";

const TOKEN_KIND_UNIFIED = "unified_system_user";
const AUTH_MODE_UNIFIED = "unified_login";

const SCOPE_BASIC = "instagram_basic";
const SCOPE_PUBLISH = "instagram_content_publish";
const SCOPE_COMMENTS = "instagram_manage_comments";
const SCOPE_INSIGHTS = "instagram_manage_insights";

/**
 * Permissions OpsAi V1 expects from the Unified Login configuration.
 * These are NOT sent as OAuth `scope` — Meta config_id owns consent.
 */
const OAUTH_SCOPES = Object.freeze([
  SCOPE_BASIC,
  SCOPE_PUBLISH,
  SCOPE_COMMENTS,
  SCOPE_INSIGHTS,
]);

const REQUIRED_SCOPE = SCOPE_BASIC;

/**
 * Map legacy Instagram Login granted names → Unified Login canonical names.
 * Also accept historical aliases so reconnectRequired / missingPermissions stay useful.
 */
const SCOPE_GRANT_ALIASES = Object.freeze({
  instagram_business_basic: SCOPE_BASIC,
  business_basic: SCOPE_BASIC,
  instagram_business_content_publishing: SCOPE_PUBLISH,
  instagram_business_content_publish: SCOPE_PUBLISH,
  business_content_publish: SCOPE_PUBLISH,
  instagram_business_manage_comments: SCOPE_COMMENTS,
  business_manage_comments: SCOPE_COMMENTS,
  instagram_business_manage_insights: SCOPE_INSIGHTS,
  business_manage_insights: SCOPE_INSIGHTS,
});

const normalizeGrantedScope = (raw) => {
  const value = String(raw || "").trim();
  if (!value) return "";
  return SCOPE_GRANT_ALIASES[value] || value;
};

const loginConfigId = () =>
  String(process.env.INSTAGRAM_LOGIN_CONFIG_ID || "").trim();

/**
 * Prefer explicit INSTAGRAM_OAUTH_REDIRECT_URI (must match Meta dashboard).
 * When unset or localhost-only and a public https CORS origin exists, derive
 * https://<origin>/api/instagram-oauth/callback for tunnel/dev convenience.
 */
const resolveRedirectUri = () => {
  const configured = String(process.env.INSTAGRAM_OAUTH_REDIRECT_URI || "").trim();
  if (configured && !/localhost|127\.0\.0\.1/i.test(configured)) {
    return configured;
  }
  const localhost = !configured || /localhost|127\.0\.0\.1/i.test(configured);
  const publicOrigin = String(config.cors?.origin || "")
    .split(",")
    .map((part) => part.trim().replace(/\/$/, ""))
    .find((part) => /^https:\/\//i.test(part) && !/localhost|127\.0\.0\.1/i.test(part));
  if (localhost && publicOrigin) {
    return `${publicOrigin}/api/instagram-oauth/callback`;
  }
  return configured || "http://localhost:5013/api/instagram-oauth/callback";
};

const graphBaseUrl = () => `${GRAPH_HOST}/${API_VERSION}`;

/** Unified Login dialog — config_id selects permissions/assets (no scope list). */
const authorizeUrl = () => `${OAUTH_DIALOG_HOST}/dialog/oauth`;

const shortLivedTokenUrl = () => `${GRAPH_HOST}/${API_VERSION}/oauth/access_token`;

/** Unified SUAT has no ig_exchange_token hop — kept for API shape only. */
const longLivedTokenUrl = () => `${GRAPH_HOST}/${API_VERSION}/oauth/access_token`;

const refreshTokenUrl = () => `${GRAPH_HOST}/${API_VERSION}/oauth/access_token`;

/**
 * Instagram App ID / Secret. Falls back to META_APP_* only when Instagram-specific
 * env is unset (same Meta app). Login config id is Instagram-only (no Meta Ads reuse).
 */
const appCredentials = () => ({
  appId: String(
    process.env.INSTAGRAM_APP_ID || process.env.META_APP_ID || ""
  ).trim(),
  appSecret: String(
    process.env.INSTAGRAM_APP_SECRET || process.env.META_APP_SECRET || ""
  ).trim(),
  redirectUri: resolveRedirectUri(),
  loginConfigId: loginConfigId(),
});

/**
 * Safe platform preflight — key NAMES only, never secret values.
 */
const getInstagramIntegrationStatus = () => {
  // Prefer Instagram-specific vars; empty string means explicitly unset (tests).
  const igAppId = String(process.env.INSTAGRAM_APP_ID || "").trim();
  const igAppSecret = String(process.env.INSTAGRAM_APP_SECRET || "").trim();
  const hasAppId = Boolean(
    igAppId || String(process.env.META_APP_ID || "").trim()
  );
  const hasAppSecret = Boolean(
    igAppSecret || String(process.env.META_APP_SECRET || "").trim()
  );
  const hasRedirect = Boolean(
    String(process.env.INSTAGRAM_OAUTH_REDIRECT_URI || "").trim() ||
      resolveRedirectUri()
  );
  const hasLoginConfig = Boolean(loginConfigId());
  const missingConfigKeys = [];
  if (!hasAppId) missingConfigKeys.push("INSTAGRAM_APP_ID");
  if (!hasAppSecret) missingConfigKeys.push("INSTAGRAM_APP_SECRET");
  if (!String(process.env.INSTAGRAM_OAUTH_REDIRECT_URI || "").trim()) {
    // Require explicit redirect for Unified Login (Meta dashboard must match).
    missingConfigKeys.push("INSTAGRAM_OAUTH_REDIRECT_URI");
  }
  if (!hasLoginConfig) missingConfigKeys.push("INSTAGRAM_LOGIN_CONFIG_ID");
  const configured = missingConfigKeys.length === 0;
  return {
    instagramIntegrationConfigured: configured,
    unifiedLoginConfigured: configured && hasLoginConfig,
    missingConfigKeys,
    redirectUriConfigured: hasRedirect,
    resolvedRedirectUri: resolveRedirectUri(),
    authMode: AUTH_MODE_UNIFIED,
    tokenKind: TOKEN_KIND_UNIFIED,
  };
};

module.exports = {
  API_VERSION,
  GRAPH_HOST,
  OAUTH_SCOPES,
  REQUIRED_SCOPE,
  SCOPE_BASIC,
  SCOPE_PUBLISH,
  SCOPE_COMMENTS,
  SCOPE_INSIGHTS,
  SCOPE_GRANT_ALIASES,
  TOKEN_KIND_UNIFIED,
  AUTH_MODE_UNIFIED,
  normalizeGrantedScope,
  loginConfigId,
  graphBaseUrl,
  authorizeUrl,
  shortLivedTokenUrl,
  longLivedTokenUrl,
  refreshTokenUrl,
  appCredentials,
  resolveRedirectUri,
  getInstagramIntegrationStatus,
};
