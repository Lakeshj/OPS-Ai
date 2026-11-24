/**
 * Meta Graph / Marketing API settings (Meta Ads domain).
 * The version string lives only in this module.
 *
 * Provider-level App ID/Secret may be shared with Instagram when both use the
 * same Meta developer app. Business logic, OAuth flows, and credential types
 * remain separate (see instagramGraph.js).
 */

const config = require("./index");

const API_VERSION = "v26.0";
const OAUTH_SCOPES = Object.freeze(["ads_read"]);
const GRAPH_HOST = "https://graph.facebook.com";
const DIALOG_HOST = "https://www.facebook.com";

const resolveRedirectUri = () => {
  const configured = String(process.env.META_OAUTH_REDIRECT_URI || "").trim();
  const localhost = !configured || /localhost|127\.0\.0\.1/i.test(configured);
  const publicOrigin = String(config.cors?.origin || "")
    .split(",")
    .map((part) => part.trim().replace(/\/$/, ""))
    .find((part) => /^https:\/\//i.test(part) && !/localhost|127\.0\.0\.1/i.test(part));
  if (localhost && publicOrigin) {
    return `${publicOrigin}/api/meta-oauth/callback`;
  }
  return configured || "http://localhost:5013/api/meta-oauth/callback";
};

const graphBaseUrl = () => `${GRAPH_HOST}/${API_VERSION}`;

const dialogUrl = () => `${DIALOG_HOST}/${API_VERSION}/dialog/oauth`;

const tokenUrl = () => `${graphBaseUrl()}/oauth/access_token`;

/**
 * Meta Ads App ID / Secret.
 * Prefer META_APP_*. When unset, fall back to INSTAGRAM_APP_* so a single Meta
 * developer app can serve both domains (provider config only — not credentials).
 */
const appCredentials = () => {
  const metaId = String(process.env.META_APP_ID || "").trim();
  const metaSecret = String(process.env.META_APP_SECRET || "").trim();
  const igId = String(process.env.INSTAGRAM_APP_ID || "").trim();
  const igSecret = String(process.env.INSTAGRAM_APP_SECRET || "").trim();
  const appId = metaId || igId;
  const appSecret = metaSecret || igSecret;
  let credentialSource = "none";
  if (metaId && metaSecret) credentialSource = "meta";
  else if (appId && appSecret && (igId || igSecret)) {
    credentialSource = "instagram_app_fallback";
  } else if (appId && appSecret) credentialSource = "meta_partial";
  return {
    appId,
    appSecret,
    redirectUri: resolveRedirectUri(),
    credentialSource,
  };
};

/**
 * Safe Meta Ads platform preflight — key NAMES only, never secret values.
 */
const getMetaAdsIntegrationStatus = () => {
  const metaId = String(process.env.META_APP_ID || "").trim();
  const metaSecret = String(process.env.META_APP_SECRET || "").trim();
  const igId = String(process.env.INSTAGRAM_APP_ID || "").trim();
  const igSecret = String(process.env.INSTAGRAM_APP_SECRET || "").trim();
  const hasAppId = Boolean(metaId || igId);
  const hasAppSecret = Boolean(metaSecret || igSecret);
  const hasExplicitMeta = Boolean(metaId && metaSecret);
  const hasRedirectEnv = Boolean(
    String(process.env.META_OAUTH_REDIRECT_URI || "").trim()
  );
  const missingConfigKeys = [];
  // Report preferred keys when neither Meta nor Instagram app creds resolve.
  if (!hasAppId) missingConfigKeys.push("META_APP_ID");
  if (!hasAppSecret) missingConfigKeys.push("META_APP_SECRET");
  // Redirect always has a localhost default; flag only when unset (ops hint).
  const configured = hasAppId && hasAppSecret;
  const app = appCredentials();
  return {
    metaAdsIntegrationConfigured: configured,
    missingConfigKeys,
    preferredEnvKeys: ["META_APP_ID", "META_APP_SECRET", "META_OAUTH_REDIRECT_URI"],
    sharedProviderFallbackKeys: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"],
    hasExplicitMetaAppCreds: hasExplicitMeta,
    usingSharedInstagramAppFallback:
      configured && !hasExplicitMeta && Boolean(igId || igSecret),
    credentialSource: app.credentialSource,
    redirectUriConfigured: hasRedirectEnv,
    resolvedRedirectUri: resolveRedirectUri(),
    oauthScopesConfigured: [...OAUTH_SCOPES],
    apiVersion: API_VERSION,
  };
};

module.exports = {
  API_VERSION,
  OAUTH_SCOPES,
  GRAPH_HOST,
  graphBaseUrl,
  dialogUrl,
  tokenUrl,
  appCredentials,
  resolveRedirectUri,
  getMetaAdsIntegrationStatus,
};
