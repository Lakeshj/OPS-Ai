const SECRET_KEY_RE =
  /(access[_-]?token|refresh[_-]?token|client[_-]?secret|developer[_-]?token|api[_-]?key|^password$|^authorization$|^secret$|^token$|appsecret|proof|credential)/i;

const DETAIL_ALLOW = new Set([
  "httpStatus",
  "errorCode",
  "googleCode",
  "errorType",
  "googleStatus",
  "customerId",
  "loginCustomerId",
  "reportType",
  "apiVersion",
  "requestId",
  "graphCode",
  "graphSubcode",
  "resource",
  "tool",
  "adAccountId",
  "level",
  "breakdowns",
]);

export type NodeFailureDetails = Record<string, string | number | boolean>;

export type NodeFailureDisplay = {
  title: string;
  message: string;
  code: string | null;
  details: NodeFailureDetails | null;
  preview: string;
  toast: string;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function sanitizeFailureDetails(
  details: unknown
): NodeFailureDetails | null {
  const rec = asRecord(details);
  if (!rec) return null;
  const out: NodeFailureDetails = {};
  for (const [key, value] of Object.entries(rec)) {
    if (SECRET_KEY_RE.test(key) || key === "developerHeaderSent") continue;
    if (value == null || value === "") continue;
    if (typeof value === "object") continue;
    const text = String(value);
    if (SECRET_KEY_RE.test(text)) continue;
    if (!DETAIL_ALLOW.has(key)) continue;
    out[key] = typeof value === "number" || typeof value === "boolean" ? value : text;
  }
  return Object.keys(out).length ? out : null;
}

export function nodeFailureDisplay(result: {
  error?: unknown;
  output?: unknown;
} | null | undefined): NodeFailureDisplay {
  const output = asRecord(result?.output);
  const nested = asRecord(output?.error);
  const rawError = result?.error;
  const fromString = typeof rawError === "string" ? rawError : "";
  const fromObject =
    asRecord(rawError) && typeof asRecord(rawError)?.message === "string"
      ? String(asRecord(rawError)?.message)
      : "";
  const title = nested?.title ? String(nested.title).trim() : "";
  const message = String(
    (nested?.message && String(nested.message).trim()) ||
      fromObject ||
      fromString ||
      ""
  ).trim();
  const code = nested?.code
    ? String(nested.code)
    : asRecord(rawError)?.code
      ? String(asRecord(rawError)?.code)
      : null;
  const details = sanitizeFailureDetails(nested?.details);
  const firstLine =
    message
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || "";
  const preview =
    title && firstLine && firstLine !== title
      ? `${title} — ${firstLine}`
      : title || firstLine || "Execution failed";
  const toast =
    title && message && !message.startsWith(title)
      ? `${title}\n${message}`
      : message || title || "Execution failed";
  return { title, message, code, details, preview, toast };
}

export function formatFailureOutput(output: unknown): string | null {
  const rec = asRecord(output);
  if (!rec || rec.ok !== false) return null;
  return nodeFailureDisplay({ output: rec, error: rec.error }).preview;
}
