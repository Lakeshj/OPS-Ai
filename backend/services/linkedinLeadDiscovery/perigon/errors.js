/**
 * Classify Perigon HTTP errors into actionable OpsAi codes.
 * Never include API keys in messages.
 */

const AppError = require("../../../utils/AppError");

const CODE = Object.freeze({
  NOT_CONNECTED: "LINKEDIN_LEAD_PERIGON_NOT_CONNECTED",
  KEY_MISSING: "LINKEDIN_LEAD_PERIGON_KEY_MISSING",
  KEY_INVALID: "LINKEDIN_LEAD_PERIGON_KEY_INVALID",
  LINKEDIN_NOT_ENABLED: "LINKEDIN_LEAD_PERIGON_LINKEDIN_NOT_ENABLED",
  QUOTA_EXHAUSTED: "LINKEDIN_LEAD_PERIGON_QUOTA_EXHAUSTED",
  RATE_LIMITED: "LINKEDIN_LEAD_PERIGON_RATE_LIMITED",
  TIMEOUT: "LINKEDIN_LEAD_PERIGON_TIMEOUT",
  UNAVAILABLE: "LINKEDIN_LEAD_PERIGON_UNAVAILABLE",
  BAD_REQUEST: "LINKEDIN_LEAD_PERIGON_BAD_REQUEST",
  UNSUPPORTED_OPERATION: "LINKEDIN_LEAD_PERIGON_UNSUPPORTED_OPERATION",
  API_ERROR: "LINKEDIN_LEAD_PERIGON_API_ERROR",
});

const stripSecrets = (text) =>
  String(text || "")
    .replace(/x-api-key\s*[:=]\s*\S+/gi, "x-api-key: [redacted]")
    .replace(/api[_-]?key[=:]\s*\S+/gi, "apiKey=[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");

const messageFromBody = (body) => {
  if (!body) return "";
  if (typeof body === "string") return stripSecrets(body).slice(0, 400);
  const msg = body.message || body.error || body.detail || "";
  return stripSecrets(msg).slice(0, 400);
};

const classifyHttpError = (status, body, { context = "request" } = {}) => {
  const raw = messageFromBody(body);
  const lower = raw.toLowerCase();

  if (status === 401) {
    return new AppError(
      raw ||
        "Perigon API key is invalid or missing. Reconnect with a valid key from the Perigon Developers section.",
      401,
      CODE.KEY_INVALID
    );
  }

  if (status === 403) {
    if (
      /social requests? (is |are )?exceeded/i.test(raw) ||
      /allowed social requests/i.test(raw) ||
      /quota/i.test(raw)
    ) {
      return new AppError(
        raw ||
          "Perigon social request quota is exhausted for this billing period. Wait for reset or contact Perigon support.",
        403,
        CODE.QUOTA_EXHAUSTED
      );
    }
    if (
      /does not include access/i.test(raw) ||
      /linkedin/i.test(lower) ||
      /social data/i.test(lower) ||
      /not (enabled|available|included)/i.test(lower)
    ) {
      return new AppError(
        raw ||
          "LinkedIn Social API access is not enabled for this Perigon organization. Contact support@perigon.io to enable LinkedIn, then retest.",
        403,
        CODE.LINKEDIN_NOT_ENABLED
      );
    }
    return new AppError(
      raw ||
        "Perigon refused this request (403). Confirm the API key and that LinkedIn Social access is enabled.",
      403,
      CODE.LINKEDIN_NOT_ENABLED
    );
  }

  if (status === 429) {
    return new AppError(
      raw ||
        "Perigon rate limit reached (social endpoints allow ~5 req/s per organization). Wait and retry.",
      429,
      CODE.RATE_LIMITED
    );
  }

  if (status === 400) {
    return new AppError(
      raw || "Invalid Perigon search parameters.",
      400,
      CODE.BAD_REQUEST
    );
  }

  if (status >= 500) {
    return new AppError(
      raw ||
        "Perigon social data provider failed. Try again later.",
      status,
      CODE.UNAVAILABLE
    );
  }

  return new AppError(
    raw || `Perigon ${context} failed with HTTP ${status}.`,
    status >= 400 && status < 600 ? status : 502,
    CODE.API_ERROR
  );
};

const isPermanentAuthOrEntitlement = (err) => {
  const code = err?.code;
  return (
    code === CODE.KEY_INVALID ||
    code === CODE.KEY_MISSING ||
    code === CODE.NOT_CONNECTED ||
    code === CODE.LINKEDIN_NOT_ENABLED ||
    code === CODE.QUOTA_EXHAUSTED ||
    code === CODE.UNSUPPORTED_OPERATION ||
    code === CODE.BAD_REQUEST
  );
};

module.exports = {
  CODE,
  stripSecrets,
  messageFromBody,
  classifyHttpError,
  isPermanentAuthOrEntitlement,
};
