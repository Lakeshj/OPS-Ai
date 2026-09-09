/**
 * Credential-dependent Google resource lists (sites, GA4 properties, labels, sheet tabs).
 * Tokens stay in googleOAuth — this module never stores resources on credentials.
 */

const { googleApiRequest } = require("./googleOAuth.service");
const { parseSpreadsheetRef, classifyGscProperty } = require("./resourceLocator");

const listGscSitesForCredential = async ({ credentialId, workspaceId }) => {
  const result = await googleApiRequest({
    credentialId,
    workspaceId,
    requiredType: "google_gsc",
    url: "https://searchconsole.googleapis.com/webmasters/v3/sites",
    method: "GET",
  });
  const sites = (result.body?.siteEntry || []).map((s) => {
    const cls = classifyGscProperty(s.siteUrl);
    return {
      siteUrl: s.siteUrl,
      permissionLevel: s.permissionLevel,
      kind: cls.kind,
      label: cls.label,
    };
  });
  return { sites };
};

const listGa4PropertiesForCredential = async ({ credentialId, workspaceId }) => {
  const result = await googleApiRequest({
    credentialId,
    workspaceId,
    requiredType: "google_ga4",
    url: "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200",
    method: "GET",
  });
  const properties = [];
  for (const account of result.body?.accountSummaries || []) {
    for (const prop of account.propertySummaries || []) {
      const propertyId = String(prop.property || "").replace(/^properties\//, "");
      if (!propertyId) continue;
      properties.push({
        propertyId,
        displayName: prop.displayName || propertyId,
        account: account.displayName || account.account || "",
      });
    }
  }
  return { properties };
};

const listGmailLabelsForCredential = async ({ credentialId, workspaceId }) => {
  const result = await googleApiRequest({
    credentialId,
    workspaceId,
    requiredType: "google_gmail",
    url: "https://gmail.googleapis.com/gmail/v1/users/me/labels",
    method: "GET",
  });
  const labels = (result.body?.labels || []).map((l) => ({
    id: String(l.id || ""),
    name: String(l.name || l.id || ""),
    type: l.type || "",
  })).filter((l) => l.id);
  return { labels };
};

const listSheetTabsForSpreadsheet = async ({
  credentialId,
  workspaceId,
  spreadsheetId,
}) => {
  const parsed = parseSpreadsheetRef(spreadsheetId);
  const id = parsed.spreadsheetId;
  if (!id || id.includes("{{")) {
    const err = new Error("Spreadsheet ID is required to list tabs");
    err.code = "GOOGLE_BAD_REQUEST";
    throw err;
  }
  const result = await googleApiRequest({
    credentialId,
    workspaceId,
    requiredType: "google_sheets",
    url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}?fields=sheets.properties`,
    method: "GET",
  });
  const sheets = (result.body?.sheets || []).map((s) => ({
    title: String(s.properties?.title || ""),
    sheetId: s.properties?.sheetId,
  })).filter((s) => s.title);
  return { spreadsheetId: id, sheets };
};

module.exports = {
  listGscSitesForCredential,
  listGa4PropertiesForCredential,
  listGmailLabelsForCredential,
  listSheetTabsForSpreadsheet,
};
