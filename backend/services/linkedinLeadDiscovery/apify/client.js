/**
 * Minimal Apify REST client (injectable for tests). Never logs tokens.
 */

const AppError = require("../../../utils/AppError");
const { APIFY_API_BASE, ACTOR_ID, DEFAULT_RUN } = require("./constants");

const extractToken = (credential) => {
  const secret = credential?.secret || {};
  return String(
    secret.apiToken || secret.token || secret.accessToken || ""
  ).trim();
};

const createApifyClient = ({
  token,
  fetchImpl = fetch,
  baseUrl = APIFY_API_BASE,
  actorId = ACTOR_ID,
} = {}) => {
  if (!token) {
    throw new AppError(
      "Apify is not connected. Add an Apify API token credential and select it on this node.",
      400,
      "LINKEDIN_LEAD_APIFY_NOT_CONNECTED"
    );
  }

  const request = async (method, path, { query, body, signal, timeoutMs } = {}) => {
    const url = new URL(`${baseUrl.replace(/\/$/, "")}${path}`);
    if (query && typeof query === "object") {
      for (const [k, v] of Object.entries(query)) {
        if (v == null || v === "") continue;
        url.searchParams.set(k, String(v));
      }
    }
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
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(body != null ? { "content-type": "application/json" } : {}),
        },
        body: body == null ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch (_) {
        parsed = text;
      }
      if (res.status === 401) {
        // HTTP 400 (not 401): OpsAi session 401 must stay reserved for JWT auth.
        throw new AppError(
          "Apify credentials are invalid or revoked. Edit or reconnect your Apify API token.",
          400,
          "LINKEDIN_LEAD_APIFY_CREDENTIAL_INVALID"
        );
      }
      if (res.status === 403) {
        throw new AppError(
          "Apify denied this request (permission or plan). Check the token scopes and Apify account access.",
          403,
          "LINKEDIN_LEAD_APIFY_PERMISSION_DENIED"
        );
      }
      if (res.status === 429) {
        throw new AppError(
          "Apify rate limit reached. Wait and retry.",
          429,
          "LINKEDIN_LEAD_APIFY_RATE_LIMITED"
        );
      }
      if (!res.ok) {
        const message =
          (parsed && parsed.error && parsed.error.message) ||
          (parsed && parsed.message) ||
          `Apify API returned HTTP ${res.status}.`;
        throw new AppError(
          message,
          res.status >= 400 && res.status < 600 ? res.status : 502,
          "LINKEDIN_LEAD_APIFY_API_ERROR"
        );
      }
      return { status: res.status, body: parsed, headers: res.headers };
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err?.name === "AbortError") {
        throw new AppError(
          "Apify request timed out or was cancelled.",
          408,
          "LINKEDIN_LEAD_APIFY_TIMEOUT"
        );
      }
      throw new AppError(
        err?.message || "Apify request failed.",
        502,
        "LINKEDIN_LEAD_APIFY_API_ERROR"
      );
    } finally {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  };

  return {
    tokenPresent: true,
    actorId,
    getMe: () => request("GET", "/users/me"),
    getLimits: () => request("GET", "/users/me/limits"),
    getMonthlyUsage: () => request("GET", "/users/me/usage/monthly"),
    getActor: () => request("GET", `/acts/${actorId}`),
    startRun: (input, options = {}) =>
      request("POST", `/acts/${actorId}/runs`, {
        query: {
          timeout: options.timeoutSecs ?? DEFAULT_RUN.timeoutSecs,
          memory: options.memoryMbytes ?? DEFAULT_RUN.memoryMbytes,
          build: options.build || "latest",
          maxItems: options.maxItems,
          maxTotalChargeUsd: options.maxTotalChargeUsd,
        },
        body: input,
        signal: options.signal,
        timeoutMs: options.requestTimeoutMs || 30000,
      }),
    getRun: (runId, options = {}) =>
      request("GET", `/actor-runs/${runId}`, {
        signal: options.signal,
        timeoutMs: options.requestTimeoutMs || 15000,
      }),
    abortRun: (runId, options = {}) =>
      request("POST", `/actor-runs/${runId}/abort`, {
        signal: options.signal,
        timeoutMs: 15000,
      }),
    listDatasetItems: (datasetId, { offset = 0, limit = 100, signal } = {}) =>
      request("GET", `/datasets/${datasetId}/items`, {
        query: { offset, limit, clean: 1, format: "json" },
        signal,
        timeoutMs: 60000,
      }),
  };
};

module.exports = {
  extractToken,
  createApifyClient,
};
