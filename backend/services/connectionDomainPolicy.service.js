/**
 * Connection allowed-host policy for HTTP Request auth injection.
 * Hostnames only — never logs secrets.
 */

const ERROR = Object.freeze({
  DOMAIN_DENIED: "HTTP_CONNECTION_DOMAIN_DENIED",
});

class ConnectionDomainError extends Error {
  constructor(message, code = ERROR.DOMAIN_DENIED) {
    super(message);
    this.name = "ConnectionDomainError";
    this.code = code;
  }
}

const normalizeHost = (value) => {
  let raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\*\./, "");
  if (!raw) return "";
  try {
    if (/^https?:\/\//i.test(raw)) raw = new URL(raw).hostname;
  } catch {
    raw = raw.split("/")[0];
  }
  return raw.replace(/\.$/, "").split(":")[0];
};

const parseAllowedHosts = (list) => {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeHost).filter(Boolean);
};

const hostMatchesAllowlist = (hostname, allowedHosts) => {
  const host = normalizeHost(hostname);
  if (!host) return false;
  const allowed = parseAllowedHosts(allowedHosts);
  if (!allowed.length) return true;
  return allowed.some((d) => host === d || host.endsWith(`.${d}`));
};

const assertUrlAllowed = (rawUrl, allowedHosts) => {
  const allowed = parseAllowedHosts(allowedHosts);
  if (!allowed.length) return;
  let host = "";
  try {
    host = new URL(String(rawUrl || "")).hostname;
  } catch {
    throw new ConnectionDomainError(
      "HTTP destination is not allowed for this connection."
    );
  }
  if (!hostMatchesAllowlist(host, allowed)) {
    throw new ConnectionDomainError(
      "This connection cannot be used with that destination host."
    );
  }
};

module.exports = {
  ERROR,
  ConnectionDomainError,
  normalizeHost,
  parseAllowedHosts,
  hostMatchesAllowlist,
  assertUrlAllowed,
};
