/**
 * Safe node-failure presentation. User-facing message stays on `message`;
 * technical fields live on `details` and must never include secrets.
 */

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

const sanitizeFailureDetails = (details) => {
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  const out = {};
  for (const [key, value] of Object.entries(details)) {
    if (SECRET_KEY_RE.test(key)) continue;
    if (key === "developerHeaderSent") continue;
    if (value == null || value === "") continue;
    if (typeof value === "object") continue;
    const text = String(value);
    if (SECRET_KEY_RE.test(text)) continue;
    if (DETAIL_ALLOW.has(key) || !SECRET_KEY_RE.test(key)) {
      if (!DETAIL_ALLOW.has(key)) continue;
      out[key] = typeof value === "number" || typeof value === "boolean" ? value : text;
    }
  }
  return Object.keys(out).length ? out : undefined;
};

const presentNodeFailure = (failure) => {
  const message =
    failure instanceof Error
      ? String(failure.message || "Execution failed")
      : String(failure || "Execution failed");
  const presented = {
    code: failure && failure.code ? String(failure.code) : "NODE_FAILED",
    message,
  };
  if (failure && failure.title) presented.title = String(failure.title);
  if (failure && failure.provider) presented.provider = String(failure.provider);
  if (failure && failure.retryable === true) presented.retryable = true;
  const rawDetails = failure && (failure.details || failure.googleAds);
  const details = sanitizeFailureDetails(rawDetails);
  if (details) presented.details = details;
  return presented;
};

const failurePreview = (presented) => {
  if (!presented || typeof presented !== "object") return "";
  const title = presented.title ? String(presented.title).trim() : "";
  const firstLine = String(presented.message || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
  if (title && firstLine && firstLine !== title) return `${title} — ${firstLine}`;
  return title || firstLine || "Execution failed";
};

module.exports = {
  sanitizeFailureDetails,
  presentNodeFailure,
  failurePreview,
};
