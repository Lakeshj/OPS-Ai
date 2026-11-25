/**
 * Bounded HTTP helper for the authorized opportunity feed.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseRetryAfterMs = (header) => {
  if (!header) return null;
  const asInt = Number(header);
  if (Number.isFinite(asInt)) return Math.max(0, asInt * 1000);
  const when = Date.parse(header);
  if (Number.isFinite(when)) return Math.max(0, when - Date.now());
  return null;
};

const fetchJson = async (
  url,
  { method = "POST", headers = {}, body, timeoutMs = 15000, signal } = {}
) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const contentType = res.headers.get("content-type") || "";
    const parsed = contentType.includes("application/json")
      ? await res.json().catch(() => null)
      : await res.text().catch(() => null);
    return {
      status: res.status,
      ok: res.ok,
      body: parsed,
      retryAfterMs: parseRetryAfterMs(res.headers.get("retry-after")),
      rateLimited: res.status === 429,
    };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
};

const fetchJsonWithRetries = async (url, options = {}, { maxRetries = 2 } = {}) => {
  let attempt = 0;
  let last;
  while (attempt <= maxRetries) {
    attempt += 1;
    try {
      last = await fetchJson(url, options);
      const retryable = last.rateLimited || last.status >= 500;
      if (!retryable || attempt > maxRetries) return last;
      const wait =
        last.retryAfterMs != null
          ? last.retryAfterMs
          : Math.min(8000, 400 * attempt * attempt);
      await sleep(wait);
    } catch (err) {
      const aborted = err?.name === "AbortError";
      if (aborted || attempt > maxRetries) throw err;
      await sleep(Math.min(8000, 400 * attempt * attempt));
    }
  }
  return last;
};

module.exports = {
  fetchJson,
  fetchJsonWithRetries,
  sleep,
};
