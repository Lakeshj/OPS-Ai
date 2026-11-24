/**
 * Facebook Page Native — Meta Graph provider settings.
 * Reuses centralized Graph host/version from metaGraph (provider utility only).
 * Does not import Meta Ads or Instagram business services.
 */

const config = require("./index");
const {
  API_VERSION,
  GRAPH_HOST,
  graphBaseUrl,
  dialogUrl,
  tokenUrl,
} = require("./metaGraph");

/** V1 organic Page scopes — derived from Page/Post/Insights/Publish ops. */
const OAUTH_SCOPES = Object.freeze([
  "pages_show_list",
  "pages_read_engagement",
  "read_insights",
  "pages_manage_posts",
]);

const resolveRedirectUri = () => {
  const configured = String(
    process.env.FACEBOOK_PAGE_OAUTH_REDIRECT_URI || ""
  ).trim();
  const localhost = !configured || /localhost|127\.0\.0\.1/i.test(configured);
  const publicOrigin = String(config.cors?.origin || "")
    .split(",")
    .map((part) => part.trim().replace(/\/$/, ""))
    .find(
      (part) => /^https:\/\//i.test(part) && !/localhost|127\.0\.0\.1/i.test(part)
    );
  if (localhost && publicOrigin) {
    return `${publicOrigin}/api/facebook-page-oauth/callback`;
  }
  return (
    configured || "http://localhost:5013/api/facebook-page-oauth/callback"
  );
};

/**
 * Prefer FACEBOOK_PAGE_APP_*. Fall back to META_APP_* then INSTAGRAM_APP_*
 * when the same Meta developer app serves organic Page + Ads + IG.
 */
const appCredentials = () => {
  const pageId = String(process.env.FACEBOOK_PAGE_APP_ID || "").trim();
  const pageSecret = String(process.env.FACEBOOK_PAGE_APP_SECRET || "").trim();
  const metaId = String(process.env.META_APP_ID || "").trim();
  const metaSecret = String(process.env.META_APP_SECRET || "").trim();
  const igId = String(process.env.INSTAGRAM_APP_ID || "").trim();
  const igSecret = String(process.env.INSTAGRAM_APP_SECRET || "").trim();
  const appId = pageId || metaId || igId;
  const appSecret = pageSecret || metaSecret || igSecret;
  let credentialSource = "none";
  if (pageId && pageSecret) credentialSource = "facebook_page";
  else if (metaId && metaSecret) credentialSource = "meta_app_fallback";
  else if (appId && appSecret && (igId || igSecret)) {
    credentialSource = "instagram_app_fallback";
  } else if (appId && appSecret) credentialSource = "partial";
  return {
    appId,
    appSecret,
    redirectUri: resolveRedirectUri(),
    credentialSource,
  };
};

const getFacebookPageIntegrationStatus = () => {
  const pageId = String(process.env.FACEBOOK_PAGE_APP_ID || "").trim();
  const pageSecret = String(process.env.FACEBOOK_PAGE_APP_SECRET || "").trim();
  const metaId = String(process.env.META_APP_ID || "").trim();
  const metaSecret = String(process.env.META_APP_SECRET || "").trim();
  const igId = String(process.env.INSTAGRAM_APP_ID || "").trim();
  const igSecret = String(process.env.INSTAGRAM_APP_SECRET || "").trim();
  const hasAppId = Boolean(pageId || metaId || igId);
  const hasAppSecret = Boolean(pageSecret || metaSecret || igSecret);
  const configured = hasAppId && hasAppSecret;
  const missingConfigKeys = [];
  if (!hasAppId) missingConfigKeys.push("FACEBOOK_PAGE_APP_ID");
  if (!hasAppSecret) missingConfigKeys.push("FACEBOOK_PAGE_APP_SECRET");
  const app = appCredentials();
  return {
    facebookPageIntegrationConfigured: configured,
    missingConfigKeys,
    preferredEnvKeys: [
      "FACEBOOK_PAGE_APP_ID",
      "FACEBOOK_PAGE_APP_SECRET",
      "FACEBOOK_PAGE_OAUTH_REDIRECT_URI",
    ],
    sharedProviderFallbackKeys: [
      "META_APP_ID",
      "META_APP_SECRET",
      "INSTAGRAM_APP_ID",
      "INSTAGRAM_APP_SECRET",
    ],
    hasExplicitFacebookPageAppCreds: Boolean(pageId && pageSecret),
    credentialSource: app.credentialSource,
    redirectUriConfigured: Boolean(
      String(process.env.FACEBOOK_PAGE_OAUTH_REDIRECT_URI || "").trim()
    ),
    resolvedRedirectUri: resolveRedirectUri(),
    oauthScopesConfigured: [...OAUTH_SCOPES],
    apiVersion: API_VERSION,
  };
};

module.exports = {
  API_VERSION,
  GRAPH_HOST,
  OAUTH_SCOPES,
  graphBaseUrl,
  dialogUrl,
  tokenUrl,
  appCredentials,
  resolveRedirectUri,
  getFacebookPageIntegrationStatus,
};
