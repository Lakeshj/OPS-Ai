/** Part 14D.5.1 — credential vs resource helpers. Mirror of backend/services/resourceLocator.js */

export const SHEETS_BROWSE_REQUIRES_DRIVE_SCOPE = true;

export type LocatorMode = "account" | "manual" | "expression";

export type ResourceOption = {
  id: string;
  label: string;
  kind?: string;
};

export const isExpressionValue = (value: unknown) =>
  typeof value === "string" && /\{\{[\s\S]+\}\}/.test(value);

export const inferLocatorMode = (
  value: unknown,
  allowed: LocatorMode[] = ["account", "manual", "expression"]
): LocatorMode => {
  if (isExpressionValue(value) && allowed.includes("expression")) return "expression";
  if (String(value || "").trim() && allowed.includes("manual")) return "manual";
  if (allowed.includes("account")) return "account";
  return allowed[0] || "manual";
};

export const classifyGscProperty = (siteUrl: string) => {
  const id = String(siteUrl || "").trim();
  if (!id) return { kind: "unknown" as const, id: "", label: "" };
  if (/^sc-domain:/i.test(id)) {
    return { kind: "domain" as const, id, label: `Domain property · ${id}` };
  }
  if (/^https?:\/\//i.test(id)) {
    return { kind: "urlPrefix" as const, id, label: `URL prefix · ${id}` };
  }
  return { kind: "unknown" as const, id, label: id };
};

export const isGa4PropertyId = (value: string) =>
  /^\d{5,20}$/.test(String(value || "").trim());

export const parseSpreadsheetRef = (value: string) => {
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

export const filterResourceOptions = (
  options: ResourceOption[],
  query: string
) => {
  const list = Array.isArray(options) ? options : [];
  const q = String(query || "").trim().toLowerCase();
  if (!q) return list;
  return list.filter((opt) => {
    const hay = `${opt.id || ""} ${opt.label || ""} ${opt.kind || ""}`.toLowerCase();
    return hay.includes(q);
  });
};

export const classifyResourceLoadError = (err: {
  code?: string;
  status?: number;
  statusCode?: number;
  message?: string;
} | null) => {
  if (!err) return "ok" as const;
  const code = String(err.code || err.statusCode || "");
  const status = Number(err.status || err.statusCode || 0);
  const msg = String(err.message || "").toLowerCase();
  if (
    code === "GOOGLE_CREDENTIAL_REQUIRED" ||
    code === "GOOGLE_CREDENTIAL_TYPE" ||
    /select a google credential|credential is required|missing credential|connect google .+ to continue/.test(msg)
  ) {
    return "missing_credential" as const;
  }
  if (
    code === "GOOGLE_UNAUTHORIZED" ||
    status === 401 ||
    /revoked|expired|invalid_grant|reconnect/.test(msg)
  ) {
    return "unauthorized" as const;
  }
  if (
    code === "GOOGLE_FORBIDDEN" ||
    status === 403 ||
    /permission|access denied|forbidden/.test(msg)
  ) {
    return "permission_denied" as const;
  }
  if (code === "GOOGLE_WORKSPACE_DENIED") return "permission_denied" as const;
  return "provider_error" as const;
};

export const staleResourceState = (value: string, options: ResourceOption[]) => {
  const id = String(value || "").trim();
  if (!id || isExpressionValue(id)) return { stale: false, retained: id };
  const list = Array.isArray(options) ? options : [];
  if (!list.length) return { stale: false, retained: id };
  return { stale: !list.some((opt) => String(opt.id) === id), retained: id };
};

export const normalizeLabelIds = (value: unknown): string[] | string => {
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

export const suggestedAiModels = (provider: string): ResourceOption[] => {
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
