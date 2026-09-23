/**
 * Error / warning codes for GA4 MCP Tools.
 * Intelligence missing-dim behavior is Step 4; codes are reserved here.
 */

const ERROR = Object.freeze({
  GA4_VALIDATION: "GA4_VALIDATION",
  GA4_UPSTREAM_REQUIRED: "GA4_UPSTREAM_REQUIRED",
  GA4_CAPABILITY_REQUIRED: "GA4_CAPABILITY_REQUIRED",
  GA4_UNKNOWN_CAPABILITY: "GA4_UNKNOWN_CAPABILITY",
  GA4_DIMS_MISSING: "GA4_DIMS_MISSING",
  GA4_METRICS_MISSING: "GA4_METRICS_MISSING",
  GA4_METRIC_UNAVAILABLE: "GA4_METRIC_UNAVAILABLE",
  GA4_ACQUISITION_DIM_MISSING: "GA4_ACQUISITION_DIM_MISSING",
  GA4_EVENT_CROSS_METRIC_RISK: "GA4_EVENT_CROSS_METRIC_RISK",
  GA4_NO_MATCHES: "GA4_NO_MATCHES",
  GA4_LANDING_PROXY_PAGEPATH: "GA4_LANDING_PROXY_PAGEPATH",
  GA4_LANDING_ENTITY_UNRESOLVED: "GA4_LANDING_ENTITY_UNRESOLVED",
  GA4_CAPABILITY_NOT_IMPLEMENTED: "GA4_CAPABILITY_NOT_IMPLEMENTED",
  GA4_MALFORMED_ROWS: "GA4_MALFORMED_ROWS",
  GA4_GOOGLE_API_FORBIDDEN: "GA4_GOOGLE_API_FORBIDDEN",
});

class PluginError extends Error {
  constructor(message, code, meta = {}) {
    super(message);
    this.name = "Ga4McpPluginError";
    this.code = code || ERROR.GA4_VALIDATION;
    this.meta = meta;
  }
}

const normalizeResult = (capabilityId, payload, extra = {}) => {
  if (payload && typeof payload === "object" && payload.ok === false) {
    return {
      capability: capabilityId,
      ok: false,
      data: null,
      warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
      error: payload.error || {
        code: ERROR.GA4_VALIDATION,
        message: String(payload.message || "GA4 capability failed"),
      },
      ...extra,
    };
  }
  return {
    capability: capabilityId,
    ok: true,
    data: payload?.data !== undefined ? payload.data : payload,
    warnings: Array.isArray(payload?.warnings) ? payload.warnings : [],
    ...extra,
  };
};

/**
 * Structured warning object (envelope + per-capability).
 * @param {{ code: string, message: string, capability?: string, requiredDimensions?: string[], availableDimensions?: string[], requiredMetrics?: string[], availableMetrics?: string[], [k: string]: any }} fields
 */
const buildWarning = (fields = {}) => {
  const out = {
    code: String(fields.code || ERROR.GA4_VALIDATION),
    message: String(fields.message || ""),
  };
  if (fields.capability) out.capability = fields.capability;
  if (Array.isArray(fields.requiredDimensions)) {
    out.requiredDimensions = [...fields.requiredDimensions];
  }
  if (Array.isArray(fields.availableDimensions)) {
    out.availableDimensions = [...fields.availableDimensions];
  }
  if (Array.isArray(fields.requiredMetrics)) {
    out.requiredMetrics = [...fields.requiredMetrics];
  }
  if (Array.isArray(fields.availableMetrics)) {
    out.availableMetrics = [...fields.availableMetrics];
  }
  for (const [k, v] of Object.entries(fields)) {
    if (out[k] !== undefined) continue;
    if (["code", "message", "capability"].includes(k)) continue;
    out[k] = v;
  }
  return out;
};

module.exports = { ERROR, PluginError, normalizeResult, buildWarning };
