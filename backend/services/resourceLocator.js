/**
 * Part 14D.5.1 — Credential vs resource helpers (no secrets).
 * Credential = authorized account. Resource = site / property / sheet / label / model on the NODE.
 */

const SHEETS_BROWSE_REQUIRES_DRIVE_SCOPE = true;

const DRIVE_SCOPE_MARKERS = Object.freeze([
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
]);

const LOCATOR_MODES = Object.freeze(["account", "manual", "expression"]);

const isExpressionValue = (value) =>
  typeof value === "string" && /\{\{[\s\S]+\}\}/.test(value);

const inferLocatorMode = (value, allowed = LOCATOR_MODES) => {
  if (isExpressionValue(value) && allowed.includes("expression")) return "expression";
  if (String(value || "").trim() && allowed.includes("manual")) return "manual";
  if (allowed.includes("account")) return "account";
  return allowed[0] || "manual";
};

const classifyGscProperty = (siteUrl) => {
  const id = String(siteUrl || "").trim();
  if (!id) return { kind: "unknown", id: "", label: "" };
  if (/^sc-domain:/i.test(id)) {
    return { kind: "domain", id, label: `Domain property · ${id}` };
  }
  if (/^https?:\/\//i.test(id)) {
    return { kind: "urlPrefix", id, label: `URL prefix · ${id}` };
  }
  return { kind: "unknown", id, label: id };
};

const isGa4PropertyId = (value) => /^\d{5,20}$/.test(String(value || "").trim());

const parseSpreadsheetRef = (value) => {
  const raw = String(value || "").trim();
  if (!raw || isExpressionValue(raw)) {
    return { spreadsheetId: raw, fromUrl: false };
  }
  const urlMatch = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/i);
  if (urlMatch) {
    return { spreadsheetId: urlMatch[1], fromUrl: true };
  }
  return { spreadsheetId: raw, fromUrl: false };
};

const filterResourceOptions = (options, query) => {
  const list = Array.isArray(options) ? options : [];
  const q = String(query || "").trim().toLowerCase();
  if (!q) return list;
  return list.filter((opt) => {
    const hay = `${opt.id || ""} ${opt.label || ""} ${opt.kind || ""}`.toLowerCase();
    return hay.includes(q);
  });
};

const classifyResourceLoadError = (err) => {
  if (!err) return "ok";
  const code = String(err.code || err.statusCode || "");
  const status = Number(err.status || err.statusCode || 0);
  const msg = String(err.message || "").toLowerCase();
  if (
    code === "GOOGLE_CREDENTIAL_REQUIRED" ||
    code === "GOOGLE_CREDENTIAL_TYPE" ||
    /select a google credential|credential is required|missing credential/.test(msg)
  ) {
    return "missing_credential";
  }
  if (
    code === "GOOGLE_UNAUTHORIZED" ||
    status === 401 ||
    /revoked|expired|invalid_grant|reconnect/.test(msg)
  ) {
    return "unauthorized";
  }
  if (code === "GOOGLE_FORBIDDEN" || status === 403 || /permission|access denied|forbidden/.test(msg)) {
    return "permission_denied";
  }
  if (code === "GOOGLE_WORKSPACE_DENIED") return "permission_denied";
  return "provider_error";
};

const staleResourceState = (value, options) => {
  const id = String(value || "").trim();
  if (!id || isExpressionValue(id)) {
    return { stale: false, retained: id };
  }
  const list = Array.isArray(options) ? options : [];
  if (!list.length) return { stale: false, retained: id };
  const found = list.some((opt) => String(opt.id) === id);
  return { stale: !found, retained: id };
};

const normalizeLabelIds = (value) => {
  if (Array.isArray(value)) {
    return value.map((v) => String(v || "").trim()).filter(Boolean);
  }
  if (value == null || value === "") return [];
  if (typeof value === "string" && isExpressionValue(value)) return value;
  return String(value)
    .split(/[,\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);
};

const suggestedAiModels = (provider) => {
  const p = String(provider || "openai").toLowerCase();
  if (p === "openai") {
    return [
      { id: "gpt-4o-mini", label: "gpt-4o-mini" },
      { id: "gpt-4o", label: "gpt-4o" },
      { id: "gpt-4.1-mini", label: "gpt-4.1-mini" },
      { id: "gpt-4.1", label: "gpt-4.1" },
    ];
  }
  if (p === "deepseek") {
    return [
      { id: "deepseek-chat", label: "deepseek-chat" },
      { id: "deepseek-reasoner", label: "deepseek-reasoner" },
    ];
  }
  if (p === "gemini") {
    return [
      { id: "gemini-2.0-flash", label: "gemini-2.0-flash" },
      { id: "gemini-1.5-flash", label: "gemini-1.5-flash" },
      { id: "gemini-1.5-pro", label: "gemini-1.5-pro" },
    ];
  }
  return [];
};

const scopesIncludeDrive = (scopes) => {
  const list = Array.isArray(scopes) ? scopes : String(scopes || "").split(/\s+/);
  return list.some((s) => DRIVE_SCOPE_MARKERS.includes(String(s).trim()));
};

const extractExplicitGscSite = (text) => {
  const raw = String(text || "");
  const domain = raw.match(/\bsc-domain:[a-z0-9.-]+/i);
  if (domain) return domain[0];
  const url = raw.match(/https?:\/\/[^\s,;]+/i);
  if (url) return url[0].replace(/[)\].,;]+$/, "");
  return "";
};

const usesWorkflowInputResources = (text) =>
  /\b(passed into this workflow|use the (site|ga4 property|ga property)|workflow input)\b/i.test(
    String(text || "")
  );

module.exports = {
  SHEETS_BROWSE_REQUIRES_DRIVE_SCOPE,
  DRIVE_SCOPE_MARKERS,
  LOCATOR_MODES,
  isExpressionValue,
  inferLocatorMode,
  classifyGscProperty,
  isGa4PropertyId,
  parseSpreadsheetRef,
  filterResourceOptions,
  classifyResourceLoadError,
  staleResourceState,
  normalizeLabelIds,
  suggestedAiModels,
  scopesIncludeDrive,
  extractExplicitGscSite,
  usesWorkflowInputResources,
};
