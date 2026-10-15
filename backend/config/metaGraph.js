/**
 * Meta Graph / Marketing API settings.
 * The version string lives only in this module.
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

const appCredentials = () => ({
  appId: String(process.env.META_APP_ID || "").trim(),
  appSecret: String(process.env.META_APP_SECRET || "").trim(),
  redirectUri: resolveRedirectUri(),
});

module.exports = {
  API_VERSION,
  OAUTH_SCOPES,
  GRAPH_HOST,
  graphBaseUrl,
  dialogUrl,
  tokenUrl,
  appCredentials,
  resolveRedirectUri,
};
