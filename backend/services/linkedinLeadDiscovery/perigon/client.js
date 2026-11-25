/**
 * Minimal Perigon REST client. Never logs API keys.
 */

const AppError = require("../../../utils/AppError");
const {
  PERIGON_API_BASE,
  DEFAULT_TIMEOUT_MS,
  MAX_RETRIES,
  RETRY_BASE_MS,
} = require("./constants");
const {
  CODE,
  classifyHttpError,
  isPermanentAuthOrEntitlement,
} = require("./errors");

const extractApiKey = (credential) => {
  const secret = credential?.secret || {};
  return String(
    secret.apiKey || secret.api_key || secret.token || secret.accessToken || ""
  ).trim();
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createPerigonClient = ({
  apiKey,
  fetchImpl = fetch,
  baseUrl = PERIGON_API_BASE,
} = {}) => {
  if (!apiKey) {
    throw new AppError(
      "Perigon is not connected. Add a Perigon API key credential and select it on this node.",
      400,
      CODE.NOT_CONNECTED
    );
  }

  const request = async (
    method,
    path,
    { query, signal, timeoutMs = DEFAULT_TIMEOUT_MS, retries = MAX_RETRIES } = {}
  ) => {
    const url = new URL(`${String(baseUrl).replace(/\/$/, "")}${path}`);
    if (query && typeof query === "object") {
      for (const [k, v] of Object.entries(query)) {
        if (v == null || v === "") continue;
        url.searchParams.set(k, String(v));
      }
    }

    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const controller = new AbortController();
      const timer =
        timeoutMs != null
          ? setTimeout(() => controller.abort(), timeoutMs)
          : null;
      const onAbort = () => controller.abort();
      if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }
      try {
        const res = await fetchImpl(url.toString(), {
          method,
          headers: {
            "x-api-key": apiKey,
            accept: "application/json",
          },
          signal: controller.signal,
        });
        const text = await res.text();
        let parsed = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch (_) {
          parsed = text;
        }
        if (!res.ok) {
          const err = classifyHttpError(res.status, parsed, {
            context: path,
          });
          const retryable =
            (res.status === 429 || res.status >= 500) &&
            !isPermanentAuthOrEntitlement(err) &&
            attempt < retries;
          if (retryable) {
            attempt += 1;
            const retryAfter = Number(res.headers?.get?.("retry-after"));
            const waitMs = Number.isFinite(retryAfter)
              ? Math.min(Math.max(retryAfter * 1000, RETRY_BASE_MS), 30_000)
              : RETRY_BASE_MS * attempt;
            await sleep(waitMs);
            continue;
          }
          throw err;
        }
        return {
          status: res.status,
          body: parsed,
          headers: res.headers,
        };
      } catch (err) {
        if (err instanceof AppError) throw err;
        if (err?.name === "AbortError") {
          if (signal?.aborted) {
            throw new AppError(
              "Perigon request was cancelled.",
              499,
              CODE.TIMEOUT
            );
          }
          throw new AppError(
            "Perigon request timed out. LinkedIn Social searches can take tens of seconds — try again or raise the workflow step timeout.",
            408,
            CODE.TIMEOUT
          );
        }
        throw new AppError(
          "Perigon provider is unavailable. Check network connectivity and retry.",
          502,
          CODE.UNAVAILABLE
        );
      } finally {
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
      }
    }
  };

  return {
    request,
    get: (path, opts) => request("GET", path, opts),
  };
};

module.exports = {
  extractApiKey,
  createPerigonClient,
};
