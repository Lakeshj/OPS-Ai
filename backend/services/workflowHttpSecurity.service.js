/**
 * Part 13B — Shared HTTP network security for HTTP Request + HTTP Tool.
 *
 * V1 SaaS policy (default-deny):
 * - http/https only
 * - block loopback, link-local, cloud metadata, RFC1918 / ULA private ranges
 * - validate resolved IPs (not hostname strings alone)
 * - redirects: manual follow with per-hop revalidation + cross-origin auth strip
 *
 * Tests may inject a temporary policy via withHttpSecurityTestPolicy — never
 * weaken production defaults for fixtures.
 */

const dns = require("node:dns").promises;
const net = require("node:net");
const { URL } = require("node:url");

const MAX_HTTP_REDIRECTS = 5;

const ERROR = Object.freeze({
  DESTINATION_BLOCKED: "HTTP_DESTINATION_BLOCKED",
  REDIRECT_BLOCKED: "HTTP_REDIRECT_BLOCKED",
  PROTOCOL_BLOCKED: "HTTP_PROTOCOL_BLOCKED",
  REDIRECT_LIMIT: "HTTP_REDIRECT_LIMIT",
});

/** @type {null | {
 *   allowLoopback?: boolean,
 *   allowPrivate?: boolean,
 *   dnsLookup?: (hostname: string) => Promise<Array<{address:string,family:number}>>,
 * }} */
let testPolicy = null;

const withHttpSecurityTestPolicy = async (policy, fn) => {
  const prev = testPolicy;
  testPolicy = policy || null;
  try {
    return await fn();
  } finally {
    testPolicy = prev;
  }
};

class HttpSecurityError extends Error {
  constructor(message, code, meta = {}) {
    super(message);
    this.name = "HttpSecurityError";
    this.code = code;
    this.meta = meta;
  }
}

const ipv4ToInt = (ip) => {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
};

const inCidrV4 = (ip, base, prefix) => {
  const a = ipv4ToInt(ip);
  const b = ipv4ToInt(base);
  if (a == null || b == null) return false;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (a & mask) === (b & mask);
};

const isLoopbackIp = (ip) => {
  if (ip === "::1" || ip === "0:0:0:0:0:0:0:1") return true;
  if (net.isIPv4(ip) && inCidrV4(ip, "127.0.0.0", 8)) return true;
  // IPv4-mapped IPv6 ::ffff:127.0.0.1
  const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isLoopbackIp(mapped[1]);
  return false;
};

const isLinkLocalIp = (ip) => {
  if (net.isIPv4(ip) && inCidrV4(ip, "169.254.0.0", 16)) return true;
  const lower = ip.toLowerCase();
  if (lower.startsWith("fe80:")) return true;
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isLinkLocalIp(mapped[1]);
  return false;
};

const isPrivateIp = (ip) => {
  if (net.isIPv4(ip)) {
    if (inCidrV4(ip, "10.0.0.0", 8)) return true;
    if (inCidrV4(ip, "172.16.0.0", 12)) return true;
    if (inCidrV4(ip, "192.168.0.0", 16)) return true;
    if (inCidrV4(ip, "100.64.0.0", 10)) return true; // CGNAT
    if (ip === "0.0.0.0") return true;
  }
  const lower = String(ip).toLowerCase();
  // Unique local IPv6 fc00::/7
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1]);
  return false;
};

const isBlockedHostname = (hostname) => {
  const h = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "metadata.google.internal" || h === "metadata.goog") return true;
  if (h === "169.254.169.254") return true;
  return false;
};

const policyAllowsLoopback = () => Boolean(testPolicy?.allowLoopback);
const policyAllowsPrivate = () => Boolean(testPolicy?.allowPrivate);

const assertIpAllowed = (ip, urlForMeta) => {
  if (isLoopbackIp(ip) && !policyAllowsLoopback()) {
    throw new HttpSecurityError(
      "HTTP destination resolves to a blocked loopback address.",
      ERROR.DESTINATION_BLOCKED,
      { url: String(urlForMeta || "").slice(0, 200), address: ip }
    );
  }
  if (isLinkLocalIp(ip)) {
    throw new HttpSecurityError(
      "HTTP destination resolves to a blocked link-local address.",
      ERROR.DESTINATION_BLOCKED,
      { url: String(urlForMeta || "").slice(0, 200), address: ip }
    );
  }
  if (isPrivateIp(ip) && !policyAllowsPrivate()) {
    throw new HttpSecurityError(
      "HTTP destination resolves to a blocked private-network address.",
      ERROR.DESTINATION_BLOCKED,
      { url: String(urlForMeta || "").slice(0, 200), address: ip }
    );
  }
};

const lookupAddresses = async (hostname) => {
  if (typeof testPolicy?.dnsLookup === "function") {
    return testPolicy.dnsLookup(hostname);
  }
  return dns.lookup(hostname, { all: true, verbatim: true });
};

/**
 * Validate a fully resolved URL string against V1 SSRF policy.
 * @returns {URL}
 */
const assertSafeHttpUrl = async (rawUrl) => {
  let u;
  try {
    u = new URL(String(rawUrl || ""));
  } catch {
    throw new HttpSecurityError(
      "HTTP URL is invalid.",
      ERROR.DESTINATION_BLOCKED,
      { url: String(rawUrl || "").slice(0, 200) }
    );
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new HttpSecurityError(
      `HTTP protocol "${u.protocol}" is not allowed.`,
      ERROR.PROTOCOL_BLOCKED,
      { protocol: u.protocol }
    );
  }
  const host = u.hostname;
  if (isBlockedHostname(host) && !(policyAllowsLoopback() && (host === "localhost" || host.endsWith(".localhost")))) {
    throw new HttpSecurityError(
      "HTTP destination host is not allowed.",
      ERROR.DESTINATION_BLOCKED,
      { host }
    );
  }
  if (net.isIP(host)) {
    assertIpAllowed(host, u.href);
    return u;
  }
  let records;
  try {
    records = await lookupAddresses(host);
  } catch (err) {
    throw new HttpSecurityError(
      `HTTP DNS lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      ERROR.DESTINATION_BLOCKED,
      { host }
    );
  }
  if (!Array.isArray(records) || records.length === 0) {
    throw new HttpSecurityError(
      "HTTP DNS lookup returned no addresses.",
      ERROR.DESTINATION_BLOCKED,
      { host }
    );
  }
  for (const r of records) {
    assertIpAllowed(r.address, u.href);
  }
  return u;
};

const SENSITIVE_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie)$/i;

const stripSensitiveHeaders = (headers) => {
  const out = { ...(headers || {}) };
  for (const key of Object.keys(out)) {
    if (SENSITIVE_HEADER.test(key)) delete out[key];
  }
  return out;
};

const resolveRedirectUrl = (baseUrl, location) => {
  try {
    return new URL(String(location || ""), baseUrl).href;
  } catch {
    throw new HttpSecurityError(
      "HTTP redirect Location is invalid.",
      ERROR.REDIRECT_BLOCKED
    );
  }
};

/**
 * Secure fetch with SSRF checks and bounded redirect revalidation.
 * Auth headers are stripped on cross-origin redirects.
 */
const secureHttpFetch = async (
  url,
  { method, headers, body } = {},
  { timeoutMs = 30000, signal, maxRedirects = MAX_HTTP_REDIRECTS } = {}
) => {
  let currentUrl = String(url);
  let currentHeaders = { ...(headers || {}) };
  let currentBody = body;
  let currentMethod = String(method || "GET").toUpperCase();

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    await assertSafeHttpUrl(currentUrl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    try {
      const res = await fetch(currentUrl, {
        method: currentMethod,
        headers: currentHeaders,
        body: currentBody,
        signal: controller.signal,
        redirect: "manual",
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          throw new HttpSecurityError(
            `HTTP redirect (${res.status}) missing Location.`,
            ERROR.REDIRECT_BLOCKED,
            { status: res.status }
          );
        }
        if (hop >= maxRedirects) {
          throw new HttpSecurityError(
            `HTTP redirect limit exceeded (${maxRedirects}).`,
            ERROR.REDIRECT_LIMIT
          );
        }
        const nextUrl = resolveRedirectUrl(currentUrl, location);
        const prev = new URL(currentUrl);
        const next = new URL(nextUrl);
        if (next.protocol !== "http:" && next.protocol !== "https:") {
          throw new HttpSecurityError(
            `HTTP redirect protocol "${next.protocol}" is not allowed.`,
            ERROR.REDIRECT_BLOCKED,
            { protocol: next.protocol }
          );
        }
        // Revalidate destination before following
        await assertSafeHttpUrl(nextUrl);
        if (prev.origin !== next.origin) {
          currentHeaders = stripSensitiveHeaders(currentHeaders);
        }
        // RFC: 303 switches to GET; 301/302 historically treated as GET for non-GET
        if (
          res.status === 303 ||
          ((res.status === 301 || res.status === 302) &&
            currentMethod !== "GET" &&
            currentMethod !== "HEAD")
        ) {
          currentMethod = "GET";
          currentBody = undefined;
        }
        currentUrl = nextUrl;
        continue;
      }

      const contentType = res.headers.get("content-type") || "";
      const parsed = contentType.includes("application/json")
        ? await res.json().catch(() => null)
        : await res.text();

      return {
        status: res.status,
        ok: res.ok,
        body: parsed,
        url: currentUrl,
        headers: res.headers,
      };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }

  throw new HttpSecurityError(
    `HTTP redirect limit exceeded (${maxRedirects}).`,
    ERROR.REDIRECT_LIMIT
  );
};

module.exports = {
  MAX_HTTP_REDIRECTS,
  ERROR,
  HttpSecurityError,
  withHttpSecurityTestPolicy,
  assertSafeHttpUrl,
  secureHttpFetch,
  stripSensitiveHeaders,
  isLoopbackIp,
  isLinkLocalIp,
  isPrivateIp,
  isBlockedHostname,
};
