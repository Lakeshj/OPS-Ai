/**
 * M10.2 — Permitted LinkedIn data-source feasibility matrix.
 * Audit date references LinkedIn Marketing / Community Management docs (2026).
 */

const FEASIBILITY_MATRIX = Object.freeze([
  Object.freeze({
    id: "linkedin_community_management_posts_api",
    label: "LinkedIn Community Management Posts API",
    capability:
      "Retrieve posts only for organizations/members the app is authorized to manage (r_organization_social / restricted r_member_social).",
    keywordSearch: false,
    publicProspecting: false,
    crmLeadUse: false,
    status: "not_permitted_for_this_node",
    reason:
      "Marketing API restricted uses forbid using member/social data for sales prospecting, lead creation, CRM enrichment, or audience building. Posts API is page-management scoped, not open keyword discovery.",
  }),
  Object.freeze({
    id: "linkedin_lead_sync_api",
    label: "LinkedIn Lead Sync API",
    capability:
      "Sync Lead Form responses (sponsored/event/company forms) for authorized ad accounts.",
    keywordSearch: false,
    publicProspecting: false,
    crmLeadUse: "form_responses_only",
    status: "out_of_scope",
    reason:
      "Useful for ad-form leads, not for discovering public opportunity posts by keyword. Separate product; not M10.2.",
  }),
  Object.freeze({
    id: "linkedin_html_session_scrape",
    label: "Unauthorized LinkedIn HTML / session automation",
    capability: "Would scrape search/results via cookies or browser automation.",
    keywordSearch: true,
    publicProspecting: true,
    crmLeadUse: false,
    status: "prohibited",
    reason:
      "Violates LinkedIn terms; includes access-control bypass / unauthorized session automation. Not implemented.",
  }),
  Object.freeze({
    id: "public_search_index_scraping",
    label: "Unauthenticated public search-index scraping of LinkedIn URLs",
    capability: "Third-party SERP scraping of site:linkedin.com results.",
    keywordSearch: "partial",
    publicProspecting: "unclear",
    crmLeadUse: false,
    status: "not_approved",
    reason:
      "Publicly indexed snippets ≠ license for unrestricted CRM collection. LinkedIn ToS and indexer ToS typically restrict bulk reuse. Not enabled without legal/partner approval.",
  }),
  Object.freeze({
    id: "perigon_linkedin_social_api",
    label: "Perigon LinkedIn Social API",
    capability:
      "GET /v1/social/linkedin/posts keyword search over public LinkedIn posts via Perigon (x-api-key; org LinkedIn Social entitlement required).",
    keywordSearch: true,
    publicProspecting: true,
    crmLeadUse: "when_perigon_license_allows",
    status: "selected_primary",
    reason:
      "M10.3.4 dedicated Native source. Confirm Perigon org license permits internal discovery/CRM use before production prospecting. Get Post Details is not supported.",
  }),
  Object.freeze({
    id: "opsai_authorized_opportunity_feed",
    label: "OpsAi authorized opportunity feed (HTTP)",
    capability:
      "Query an OpsAi-operated or contractually licensed feed with keyword batches; returns permitted post records.",
    keywordSearch: true,
    publicProspecting: true,
    crmLeadUse: "when_feed_license_allows",
    status: "selected_secondary",
    reason:
      "Authorized feed path. Requires OPSAI_LINKEDIN_FEED_URL (and optional token). Feed operator must ensure rights for prospecting/CRM use.",
  }),
  Object.freeze({
    id: "user_provided_dataset",
    label: "User-provided post URLs / pinned datasets",
    capability:
      "Normalize and keyword-match posts the workspace already supplies via input items or node dataset fields.",
    keywordSearch: "local_match_only",
    publicProspecting: false,
    crmLeadUse: "user_responsibility",
    status: "selected_secondary",
    reason:
      "Permitted when the user has rights to the data they supply. No LinkedIn HTML scrape; local match/dedupe only.",
  }),
  Object.freeze({
    id: "deterministic_fixtures",
    label: "Deterministic development fixtures",
    capability: "Fixed sample posts for tests and local UI.",
    keywordSearch: true,
    publicProspecting: false,
    crmLeadUse: false,
    status: "dev_test_only",
    reason:
      "Never returned silently in production. Requires explicit useFixtures or OPSAI_LINKEDIN_ALLOW_FIXTURES outside production.",
  }),
]);

const SELECTED_METHODS = Object.freeze({
  primaryLive: "perigon_linkedin_social_api",
  secondaryLive: "opsai_authorized_opportunity_feed",
  secondary: "user_provided_dataset",
  testOnly: "deterministic_fixtures",
  explicitlyRejected: [
    "linkedin_community_management_posts_api",
    "linkedin_html_session_scrape",
    "public_search_index_scraping",
  ],
});

module.exports = {
  FEASIBILITY_MATRIX,
  SELECTED_METHODS,
};
