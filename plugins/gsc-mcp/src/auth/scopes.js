/** Scope requirements vs OpsAi google_gsc grants. */
const WEBMASTERS_READONLY =
  "https://www.googleapis.com/auth/webmasters.readonly";
const WEBMASTERS = "https://www.googleapis.com/auth/webmasters";

const TOOL_SCOPE_NEEDS = Object.freeze({
  inspect_url_enhanced: [WEBMASTERS_READONLY, WEBMASTERS],
  inspect_url: [WEBMASTERS_READONLY, WEBMASTERS],
  batch_url_inspection: [WEBMASTERS_READONLY, WEBMASTERS],
  batch_inspect_urls: [WEBMASTERS_READONLY, WEBMASTERS],
  check_indexing_issues: [WEBMASTERS_READONLY, WEBMASTERS],
  manage_sitemaps: [WEBMASTERS],
  submit_sitemap: [WEBMASTERS],
  delete_sitemap: [WEBMASTERS],
});

const hasAnyScope = (granted = [], needed = []) => {
  if (!needed.length) return true;
  const set = new Set((granted || []).map((s) => String(s)));
  // If no scopes recorded, allow read tools (legacy credentials).
  if (!set.size) return !needed.includes(WEBMASTERS) || needed.length > 1;
  return needed.some((s) => set.has(s));
};

module.exports = {
  WEBMASTERS_READONLY,
  WEBMASTERS,
  TOOL_SCOPE_NEEDS,
  hasAnyScope,
};
