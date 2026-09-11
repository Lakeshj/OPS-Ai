/**
 * Part 14D.5.4 — Connection type registry (predefined + generic).
 * Data-driven: HTTP Request UI/runtime look up entries; no per-provider UI branches.
 *
 * Community/custom definitions are not installed in this phase. New first-party
 * entries are added here (or later a DB/catalog loader) without changing node UI.
 */

const STATUS = Object.freeze({
  SUPPORTED: "SUPPORTED",
  COMING_SOON: "COMING_SOON",
});

const KIND = Object.freeze({
  PREDEFINED: "predefined",
  GENERIC: "generic",
  CATALOG: "catalog",
});

const GOOGLE_HOSTS = Object.freeze({
  gsc: ["searchconsole.googleapis.com", "www.googleapis.com"],
  ga4: [
    "analyticsdata.googleapis.com",
    "analyticsadmin.googleapis.com",
    "www.googleapis.com",
  ],
  gmail: ["gmail.googleapis.com", "www.googleapis.com"],
  sheets: ["sheets.googleapis.com", "www.googleapis.com"],
});

const GENERIC_METHODS = Object.freeze([
  {
    id: "basic",
    displayName: "Basic Auth",
    status: STATUS.SUPPORTED,
    dbType: "basic",
  },
  {
    id: "bearer",
    displayName: "Bearer Auth",
    status: STATUS.SUPPORTED,
    dbType: "bearer",
  },
  {
    id: "header",
    displayName: "Header Auth",
    status: STATUS.SUPPORTED,
    dbType: "api_key_header",
  },
  {
    id: "query",
    displayName: "Query Auth",
    status: STATUS.SUPPORTED,
    dbType: "query_param",
  },
  {
    id: "oauth2",
    displayName: "OAuth2",
    status: STATUS.SUPPORTED,
    dbType: "oauth2",
  },
  {
    id: "digest",
    displayName: "Digest Auth",
    status: STATUS.COMING_SOON,
    dbType: null,
  },
  {
    id: "oauth1",
    displayName: "OAuth1",
    status: STATUS.COMING_SOON,
    dbType: null,
  },
  {
    id: "custom",
    displayName: "Custom Auth",
    status: STATUS.COMING_SOON,
    dbType: null,
  },
]);

const PREDEFINED = Object.freeze([
  {
    id: "google_gsc",
    displayName: "Google Search Console",
    provider: "Google",
    category: "Google",
    authScheme: "oauth2_bearer",
    kind: KIND.PREDEFINED,
    status: STATUS.SUPPORTED,
    dbType: "google_gsc",
    allowedDomains: GOOGLE_HOSTS.gsc,
    requestApplication: { type: "bearer" },
    oauth: { managed: "google", product: "google_gsc" },
    testConnection: { kind: "google" },
    search: ["google", "search console", "gsc", "oauth2"],
  },
  {
    id: "google_ga4",
    displayName: "Google Analytics",
    provider: "Google",
    category: "Google",
    authScheme: "oauth2_bearer",
    kind: KIND.PREDEFINED,
    status: STATUS.SUPPORTED,
    dbType: "google_ga4",
    allowedDomains: GOOGLE_HOSTS.ga4,
    requestApplication: { type: "bearer" },
    oauth: { managed: "google", product: "google_ga4" },
    testConnection: { kind: "google" },
    search: ["google", "analytics", "ga4", "oauth2"],
  },
  {
    id: "google_gmail",
    displayName: "Gmail",
    provider: "Google",
    category: "Google",
    authScheme: "oauth2_bearer",
    kind: KIND.PREDEFINED,
    status: STATUS.SUPPORTED,
    dbType: "google_gmail",
    allowedDomains: GOOGLE_HOSTS.gmail,
    requestApplication: { type: "bearer" },
    oauth: { managed: "google", product: "google_gmail" },
    testConnection: { kind: "google" },
    search: ["google", "gmail", "mail", "oauth2"],
  },
  {
    id: "google_sheets",
    displayName: "Google Sheets",
    provider: "Google",
    category: "Google",
    authScheme: "oauth2_bearer",
    kind: KIND.PREDEFINED,
    status: STATUS.SUPPORTED,
    dbType: "google_sheets",
    allowedDomains: GOOGLE_HOSTS.sheets,
    requestApplication: { type: "bearer" },
    oauth: { managed: "google", product: "google_sheets" },
    testConnection: { kind: "google" },
    search: ["google", "sheets", "spreadsheet", "oauth2"],
  },
]);

/** Searchable catalog only — no execute/create until a real contract exists. */
const CATALOG_SOON = Object.freeze([
  {
    id: "openai_api",
    displayName: "OpenAI",
    provider: "OpenAI",
    category: "AI",
    authScheme: "api_key",
    kind: KIND.CATALOG,
    status: STATUS.COMING_SOON,
    search: ["openai", "api key"],
    reason: "AI Generate uses ENV_ONLY keys; not a workflow connection yet.",
  },
  {
    id: "deepseek_api",
    displayName: "DeepSeek",
    provider: "DeepSeek",
    category: "AI",
    authScheme: "api_key",
    kind: KIND.CATALOG,
    status: STATUS.COMING_SOON,
    search: ["deepseek", "api key"],
    reason: "ENV_ONLY provider key; not a workflow connection yet.",
  },
  {
    id: "gemini_api",
    displayName: "Gemini",
    provider: "Google",
    category: "AI",
    authScheme: "api_key",
    kind: KIND.CATALOG,
    status: STATUS.COMING_SOON,
    search: ["gemini", "google", "api key"],
    reason: "ENV_ONLY provider key; not a workflow connection yet.",
  },
  {
    id: "github",
    displayName: "GitHub",
    provider: "GitHub",
    category: "Developer",
    authScheme: "oauth2",
    kind: KIND.CATALOG,
    status: STATUS.COMING_SOON,
    search: ["github", "git"],
    reason: "No GitHub connection type in workflow_credentials.",
  },
]);

const byId = new Map(
  [...PREDEFINED, ...CATALOG_SOON].map((e) => [e.id, e])
);

const publicEntry = (e) => ({
  id: e.id,
  displayName: e.displayName,
  provider: e.provider || "",
  category: e.category || "",
  authScheme: e.authScheme,
  kind: e.kind,
  status: e.status,
  allowedDomains: e.allowedDomains ? [...e.allowedDomains] : undefined,
  oauthManaged: Boolean(e.oauth && e.oauth.managed === "google"),
  testConnection: Boolean(e.testConnection),
  reason: e.reason || undefined,
  searchText: [e.displayName, e.provider, e.category, e.authScheme, ...(e.search || [])]
    .join(" ")
    .toLowerCase(),
});

const listPredefined = () =>
  [...PREDEFINED, ...CATALOG_SOON].map(publicEntry);

const getById = (id) => byId.get(String(id || "")) || null;

const getSupportedPredefined = (id) => {
  const e = getById(id);
  if (!e || e.status !== STATUS.SUPPORTED || e.kind !== KIND.PREDEFINED) return null;
  return e;
};

const genericMethod = (id) =>
  GENERIC_METHODS.find((m) => m.id === String(id || "")) || null;

const dbTypeForGeneric = (genericAuthType) => {
  const m = genericMethod(genericAuthType);
  return m && m.status === STATUS.SUPPORTED ? m.dbType : null;
};

const allowedHostsForCredential = (type, config) => {
  const predefined = getSupportedPredefined(type);
  if (predefined) return [...(predefined.allowedDomains || [])];
  if (type === "oauth2") {
    return Array.isArray(config?.allowedDomains) ? [...config.allowedDomains] : [];
  }
  if (Array.isArray(config?.allowedDomains) && config.allowedDomains.length) {
    return [...config.allowedDomains];
  }
  return [];
};

const listGenericMethods = () => GENERIC_METHODS.map((m) => ({ ...m }));

module.exports = {
  STATUS,
  KIND,
  GENERIC_METHODS,
  listPredefined,
  listGenericMethods,
  getById,
  getSupportedPredefined,
  genericMethod,
  dbTypeForGeneric,
  allowedHostsForCredential,
  publicEntry,
};
