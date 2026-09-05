/**
 * Part 13A — AI HTTP Tool executor.
 *
 * Reuses HTTP node primitives (fetch + credentials) without converting the
 * normal HTTP Request step into a tool.
 *
 * Tool-argument syntax (scoped to this resolver only — not global expressions):
 *   {{tool.<argName>}}
 *
 * Security:
 * - Method, credentialId, and base URL come from node config only
 * - After resolving tool args, URL origin must match the configured URL origin
 * - Non-http(s) schemes rejected; cloud-metadata host blocked
 * - Redirects are not followed (manual) to avoid open-redirect SSRF
 *
 * Lazy-requires sibling services to avoid circular module init.
 */

const TOOL_ARG_RE = /\{\{\s*tool\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const ALLOWED_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
]);
const BLOCKED_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "169.254.169.254",
]);

const getAi = () => require("./workflowAiResources.service");
const getHttp = () => require("./workflowNodes.service");
const getDebug = () => require("../utils/workflowDebug");

const validateHttpToolName = (name) => {
  const { AiRuntimeError, AI_ERROR } = getAi();
  const n = String(name || "").trim();
  if (!n) {
    throw new AiRuntimeError(
      "HTTP Tool name is required.",
      AI_ERROR.TOOL_SCHEMA_INVALID,
      { field: "toolName" }
    );
  }
  if (n.length > 64) {
    throw new AiRuntimeError(
      "HTTP Tool name is too long (max 64).",
      AI_ERROR.TOOL_SCHEMA_INVALID,
      { field: "toolName" }
    );
  }
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(n)) {
    throw new AiRuntimeError(
      "HTTP Tool name must start with a letter and use only letters, numbers, and underscores.",
      AI_ERROR.TOOL_SCHEMA_INVALID,
      { field: "toolName" }
    );
  }
  return n;
};

/**
 * Resolve {{tool.x}} placeholders only. Does not evaluate {{input}} / {{steps.*}}.
 */
const resolveToolTemplate = (template, toolArgs) => {
  if (template == null) return "";
  if (typeof template !== "string") {
    try {
      return JSON.stringify(template);
    } catch {
      return String(template);
    }
  }
  return template.replace(TOOL_ARG_RE, (_, key) => {
    const v = toolArgs?.[key];
    if (v == null) return "";
    if (typeof v === "object") {
      try {
        return JSON.stringify(v);
      } catch {
        return String(v);
      }
    }
    return String(v);
  });
};

const configuredOrigin = (urlTemplate) => {
  const { AiRuntimeError, AI_ERROR } = getAi();
  const stripped = String(urlTemplate || "").replace(TOOL_ARG_RE, "x");
  let u;
  try {
    u = new URL(stripped);
  } catch {
    throw new AiRuntimeError(
      "HTTP Tool URL is invalid.",
      AI_ERROR.TOOL_FAILED,
      { url: String(urlTemplate || "").slice(0, 200) }
    );
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new AiRuntimeError(
      "HTTP Tool URL must use http or https.",
      AI_ERROR.TOOL_FAILED,
      { protocol: u.protocol }
    );
  }
  return u.origin;
};

const assertUrlOriginPreserved = (urlTemplate, resolvedUrl) => {
  const { AiRuntimeError, AI_ERROR } = getAi();
  const expected = configuredOrigin(urlTemplate);
  let actual;
  try {
    actual = new URL(resolvedUrl);
  } catch {
    throw new AiRuntimeError(
      "Resolved HTTP Tool URL is invalid.",
      AI_ERROR.TOOL_FAILED
    );
  }
  if (actual.protocol !== "http:" && actual.protocol !== "https:") {
    throw new AiRuntimeError(
      "HTTP Tool URL must use http or https.",
      AI_ERROR.TOOL_FAILED,
      { protocol: actual.protocol }
    );
  }
  if (actual.origin !== expected) {
    throw new AiRuntimeError(
      "HTTP Tool arguments cannot change the configured URL host.",
      AI_ERROR.TOOL_FAILED,
      { expected, actual: actual.origin }
    );
  }
  const host = actual.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) {
    throw new AiRuntimeError(
      "HTTP Tool URL host is not allowed.",
      AI_ERROR.TOOL_FAILED,
      { host }
    );
  }
};

const parseInputSchema = (raw) => {
  const { AiRuntimeError, AI_ERROR } = getAi();
  if (raw == null || raw === "") {
    return { type: "object", properties: {}, required: [] };
  }
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      throw new AiRuntimeError(
        "HTTP Tool input schema must be valid JSON.",
        AI_ERROR.TOOL_SCHEMA_INVALID
      );
    }
  }
  throw new AiRuntimeError(
    "HTTP Tool input schema must be a JSON object.",
    AI_ERROR.TOOL_SCHEMA_INVALID
  );
};

const boundResponseBody = (body) => {
  const { MAX_TOOL_RESULT_CHARS } = getAi();
  let text;
  try {
    text = typeof body === "string" ? body : JSON.stringify(body);
  } catch {
    text = String(body);
  }
  if (text.length > MAX_TOOL_RESULT_CHARS) {
    return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}…[truncated]`;
  }
  if (typeof body === "string") return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/**
 * @param {object} opts
 * @param {object} opts.nodeData — HTTP Tool node.data (method/url/… fixed by author)
 * @param {object} opts.args — model tool-call arguments
 * @param {object} opts.context — { workspaceId, runId, nodeId }
 */
const executeHttpTool = async ({ nodeData, args, context }) => {
  const { AiRuntimeError, AI_ERROR } = getAi();
  const { buildUrl, applyCredential, fetchWithRateLimitRetry } = getHttp();
  const { redactHeaders } = getDebug();

  const data = nodeData || {};
  const toolName = validateHttpToolName(
    data.toolName || data.name || "http_tool"
  );

  const method = String(data.method || "GET").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    throw new AiRuntimeError(
      `HTTP Tool method "${method}" is not allowed.`,
      AI_ERROR.TOOL_FAILED,
      { toolName, method }
    );
  }

  const urlTemplate = String(data.url || "").trim();
  if (!urlTemplate) {
    throw new AiRuntimeError(
      "HTTP Tool requires a configured URL.",
      AI_ERROR.TOOL_FAILED,
      { toolName }
    );
  }

  const credentialId =
    data.credentialId != null && String(data.credentialId).trim()
      ? String(data.credentialId).trim()
      : null;

  const toolArgs =
    args && typeof args === "object" && !Array.isArray(args) ? args : {};

  const resolvedPath = resolveToolTemplate(urlTemplate, toolArgs);
  const headers = {};
  if (
    data.headers &&
    typeof data.headers === "object" &&
    !Array.isArray(data.headers)
  ) {
    for (const [k, v] of Object.entries(data.headers)) {
      if (!k) continue;
      headers[k] = resolveToolTemplate(String(v ?? ""), toolArgs);
    }
  } else {
    for (const row of Array.isArray(data.headers) ? data.headers : []) {
      const key = String(row?.key || "").trim();
      if (!key) continue;
      headers[key] = resolveToolTemplate(String(row?.value ?? ""), toolArgs);
    }
  }

  const query = {};
  for (const row of Array.isArray(data.queryParams) ? data.queryParams : []) {
    const key = String(row?.key || "").trim();
    if (!key) continue;
    query[key] = resolveToolTemplate(String(row?.value ?? ""), toolArgs);
  }

  if (credentialId) {
    await applyCredential(credentialId, context || {}, headers, query);
  }

  const requestUrl = buildUrl(resolvedPath, query);
  assertUrlOriginPreserved(urlTemplate, requestUrl);

  let body;
  if (data.body != null && method !== "GET" && method !== "HEAD") {
    body =
      typeof data.body === "string"
        ? resolveToolTemplate(data.body, toolArgs)
        : resolveToolTemplate(JSON.stringify(data.body), toolArgs);
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json";
    }
  }

  const timeoutMs = Math.min(
    Math.max(Number(data.timeoutMs) || 30000, 1000),
    120000
  );

  const safeResolved = {
    method,
    url: requestUrl,
    headers: redactHeaders(headers),
    query: redactHeaders(query),
    credentialId,
    timeoutMs,
  };

  let res;
  try {
    res = await fetchWithRateLimitRetry(
      requestUrl,
      { method, headers, body },
      {
        timeoutMs,
        resolved: safeResolved,
        attempts: Number(data.rateLimitRetries ?? 0),
        redirect: "manual",
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = /timed out/i.test(msg)
      ? AI_ERROR.TOOL_TIMEOUT
      : AI_ERROR.TOOL_FAILED;
    throw new AiRuntimeError(msg, code, { toolName, ...safeResolved });
  }

  if (res.status >= 300 && res.status < 400) {
    throw new AiRuntimeError(
      `HTTP Tool refused redirect (${res.status}).`,
      AI_ERROR.TOOL_FAILED,
      { toolName, status: res.status }
    );
  }

  const failOnHttpError = data.failOnHttpError !== false;
  if (!res.ok && failOnHttpError) {
    const snippet =
      typeof res.body === "string"
        ? res.body.slice(0, 300)
        : JSON.stringify(res.body).slice(0, 300);
    throw new AiRuntimeError(
      `HTTP ${res.status}: ${snippet}`,
      AI_ERROR.TOOL_FAILED,
      { toolName, status: res.status }
    );
  }

  return {
    ok: true,
    data: {
      status: res.status,
      data: boundResponseBody(res.body),
    },
  };
};

module.exports = {
  validateHttpToolName,
  resolveToolTemplate,
  parseInputSchema,
  executeHttpTool,
  assertUrlOriginPreserved,
  configuredOrigin,
  TOOL_ARG_RE,
  ALLOWED_METHODS,
};
