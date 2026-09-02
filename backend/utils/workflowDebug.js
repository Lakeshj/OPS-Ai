/**
 * Helpers for recording what a workflow node actually received and resolved,
 * so a run can be debugged from the UI without re-running it.
 */

const SENSITIVE_HEADER = /(authorization|api[-_]?key|token|secret|password|cookie)/i;

const MAX_STRING = 8000;
const MAX_ARRAY = 25;
const MAX_KEYS = 60;
const MAX_DEPTH = 6;

/** Masks credential-bearing header values while keeping the header names. */
const redactHeaders = (headers) => {
  if (!headers || typeof headers !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SENSITIVE_HEADER.test(key) ? "***redacted***" : value;
  }
  return out;
};

/**
 * Shrinks a value so step debug payloads stay readable and small enough to
 * ship to the browser. Truncation is always announced in-band.
 */
const compactValue = (value, depth = 0) => {
  if (value == null) return value;

  if (typeof value === "string") {
    return value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}\n…truncated (${value.length} chars total)`
      : value;
  }

  if (typeof value !== "object") return value;

  if (depth >= MAX_DEPTH) return "…truncated (max depth)";

  if (Array.isArray(value)) {
    const head = value.slice(0, MAX_ARRAY).map((v) => compactValue(v, depth + 1));
    if (value.length > MAX_ARRAY) {
      head.push(`…truncated (${value.length} items total)`);
    }
    return head;
  }

  const out = {};
  const entries = Object.entries(value);
  for (const [key, val] of entries.slice(0, MAX_KEYS)) {
    out[key] = compactValue(val, depth + 1);
  }
  if (entries.length > MAX_KEYS) {
    out["…truncated"] = `${entries.length} keys total`;
  }
  return out;
};

/** Attaches resolved debug info to an error so failed steps stay inspectable. */
const failWith = (message, resolved) => {
  const err = new Error(message);
  err.resolved = resolved;
  return err;
};

module.exports = { redactHeaders, compactValue, failWith };
