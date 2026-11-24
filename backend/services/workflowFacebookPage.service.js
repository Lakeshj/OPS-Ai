/**
 * Facebook Page Native domain service (organic Pages).
 * Independent of Meta Ads and Instagram business services.
 */

const crypto = require("crypto");
const AppError = require("../utils/AppError");
const { decryptSecret } = require("./secretBox.service");
const { pool } = require("../config/database");
const {
  API_VERSION,
  graphBaseUrl,
  appCredentials,
} = require("../config/facebookPageGraph");
const {
  resolvePageInsightsRequest,
  resolvePostInsightsRequest,
} = require("./facebookPageInsightsCatalog");

const DEFAULT_ENTITY_LIMIT = 25;
const MAX_ENTITY_LIMIT = 100;
const MAX_ENTITY_RETURN_ALL = 500;
const ENTITY_PAGE_SIZE = 25;
const MAX_ENTITY_PAGES = 20;

const PAGE_FIELDS = Object.freeze([
  "id",
  "name",
  "username",
  "link",
  "category",
  "about",
  "description",
  "fan_count",
  "followers_count",
  "picture.type(large)",
]);

const POST_FIELDS = Object.freeze([
  "id",
  "message",
  "created_time",
  "permalink_url",
  "full_picture",
  "attachments{media_type,title,url,media,unshimmed_url}",
  "shares",
  "reactions.summary(true).limit(0)",
  "comments.summary(true).limit(0)",
]);

const COMMENT_FIELDS = Object.freeze([
  "id",
  "message",
  "created_time",
  "from",
  "like_count",
  "comment_count",
]);

const SECRET_QUERY_RE =
  /((?:access_token|appsecret_proof|client_secret|fb_exchange_token|code|authorization)=)[^&\s]+/gi;

const hooks = {
  transport: null,
  now: () => Date.now(),
  loadCredential: null,
};

const withFacebookPageTestHooks = async (overrides, fn) => {
  const prev = { ...hooks };
  Object.assign(hooks, overrides || {});
  try {
    return await fn();
  } finally {
    Object.assign(hooks, prev);
  }
};

const pageError = (message, code, statusCode = 400) =>
  new AppError(message, statusCode, code);

const stripSecrets = (value) =>
  String(value || "")
    .replace(SECRET_QUERY_RE, "$1[redacted]")
    .replace(/EAA[A-Za-z0-9]+/g, "[redacted]")
    .slice(0, 400);

const SECRET_KEY_RE =
  /(access[_-]?token|refresh[_-]?token|client[_-]?secret|app[_-]?secret|appsecret[_-]?(proof|time)|^password$|^authorization$|^secret$|^token$|^code$)/i;

const stripSecretKeys = (value) => {
  if (Array.isArray(value)) return value.map(stripSecretKeys);
  if (!value || typeof value !== "object") return value;
  const next = {};
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEY_RE.test(key)) continue;
    next[key] = stripSecretKeys(nested);
  }
  return next;
};

const sanitizeFacebookPageNodeData = (data) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const next = stripSecretKeys(data);
  if (next.pageId != null) next.pageId = String(next.pageId).trim();
  if (next.postId != null) next.postId = String(next.postId).trim();
  return next;
};

const appSecretProof = (accessToken) => {
  const { appSecret } = appCredentials();
  if (!appSecret) {
    throw pageError(
      "Facebook Page app credentials are not configured on the server.",
      "FACEBOOK_PAGE_APP_NOT_CONFIGURED",
      500
    );
  }
  return {
    appsecret_proof: crypto
      .createHmac("sha256", appSecret)
      .update(String(accessToken || ""))
      .digest("hex"),
  };
};

const mapFacebookPageError = (status, body) => {
  const error = body && typeof body === "object" ? body.error || body : {};
  const code = Number(error.code);
  const message = stripSecrets(error.message || error.error_user_msg || "");
  if (code === 190) {
    return pageError(
      "Facebook login expired or was revoked. Reconnect Facebook Page.",
      "FACEBOOK_PAGE_TOKEN_INVALID",
      401
    );
  }
  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return pageError(
      "Facebook rate limit reached. Wait and try again.",
      "FACEBOOK_PAGE_RATE_LIMIT",
      429
    );
  }
  if (code === 10 || code === 200 || code === 230) {
    if (/permission|(#200)|(#10)/i.test(message)) {
      return pageError(
        "Facebook denied this Page action. Check Page permissions and tasks.",
        "FACEBOOK_PAGE_PERMISSION_DENIED",
        403
      );
    }
  }
  if (code === 100) {
    if (/nonexisting field|unknown metric|invalid metric|not supported/i.test(message)) {
      return pageError(
        "That Facebook Insights metric is not supported for this Page or post.",
        "FACEBOOK_PAGE_METRIC_UNSUPPORTED"
      );
    }
    if (/period/i.test(message)) {
      return pageError(
        "That Insights period is not valid for the selected metrics.",
        "FACEBOOK_PAGE_PERIOD_UNSUPPORTED"
      );
    }
  }
  if (/does not have sufficient permissions|pages_manage_posts/i.test(message)) {
    return pageError(
      "Publishing requires pages_manage_posts and a Page role that can create content.",
      "FACEBOOK_PAGE_PUBLISH_DENIED",
      403
    );
  }
  if (status === 401) {
    return pageError(
      "Facebook login expired or was revoked. Reconnect Facebook Page.",
      "FACEBOOK_PAGE_TOKEN_INVALID",
      401
    );
  }
  return pageError(
    message || "Facebook Page request failed.",
    "FACEBOOK_PAGE_GRAPH_ERROR",
    status || 400
  );
};

const defaultTransport = async (url, options) => {
  const res = await fetch(url, options);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: { message: "Facebook returned a non-JSON response" } };
  }
  return { ok: res.ok, status: res.status, body };
};

const loadCredentialRow = async (credentialId, workspaceId) => {
  if (hooks.loadCredential) return hooks.loadCredential(credentialId, workspaceId);
  const [rows] = await pool.execute(
    `SELECT * FROM workflow_credentials WHERE id = ?`,
    [credentialId]
  );
  if (!rows.length) return null;
  if (workspaceId && rows[0].workspace_id !== workspaceId) return null;
  return {
    id: rows[0].id,
    type: rows[0].type,
    name: rows[0].name,
    workspaceId: rows[0].workspace_id,
    secret: decryptSecret(rows[0].secret_json) || {},
    config: (() => {
      try {
        return JSON.parse(rows[0].config_json || "{}");
      } catch {
        return {};
      }
    })(),
  };
};

const assertUsableUserToken = (secret) => {
  const token = String(secret?.accessToken || "").trim();
  if (!token) {
    throw pageError(
      "Connect a Facebook Page account first.",
      "FACEBOOK_PAGE_CREDENTIAL_REQUIRED"
    );
  }
  const expiresAt = secret.expiresAt ? Date.parse(secret.expiresAt) : NaN;
  if (Number.isFinite(expiresAt) && expiresAt <= hooks.now()) {
    throw pageError(
      "Facebook login expired. Reconnect Facebook Page.",
      "FACEBOOK_PAGE_TOKEN_INVALID",
      401
    );
  }
  return token;
};

const resolvePageAccessToken = (secret, pageId) => {
  const id = String(pageId || "").trim();
  if (!id) {
    throw pageError("Select a Facebook Page.", "FACEBOOK_PAGE_REQUIRED");
  }
  const pages = secret?.pages && typeof secret.pages === "object" ? secret.pages : {};
  const entry = pages[id];
  const token = String(entry?.accessToken || "").trim();
  if (!token) {
    throw pageError(
      "This Facebook Page is not available on the connected login. Reconnect and select the Page.",
      "FACEBOOK_PAGE_NOT_ACCESSIBLE",
      403
    );
  }
  return { pageId: id, accessToken: token, tasks: entry.tasks || [] };
};

const facebookGraphRequest = async ({
  accessToken,
  path,
  query = {},
  method = "GET",
  body,
}) => {
  const token = String(accessToken || "").trim();
  if (!token) {
    throw pageError(
      "A Facebook Page credential is required.",
      "FACEBOOK_PAGE_CREDENTIAL_REQUIRED"
    );
  }
  const proof = appSecretProof(token);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === "") continue;
    params.set(key, String(value));
  }
  params.set("access_token", token);
  params.set("appsecret_proof", proof.appsecret_proof);
  const url = `${graphBaseUrl()}/${String(path || "").replace(/^\//, "")}?${params.toString()}`;
  const transport = hooks.transport || defaultTransport;
  const upper = String(method || "GET").toUpperCase();
  let res;
  try {
    res = await transport(url, {
      method: upper,
      headers:
        upper === "POST"
          ? { "Content-Type": "application/json" }
          : undefined,
      body: upper === "POST" && body != null ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw pageError(
      stripSecrets(err?.message) || "Facebook Page request failed.",
      "FACEBOOK_PAGE_GRAPH_ERROR"
    );
  }
  if (!res?.ok) throw mapFacebookPageError(res?.status, res?.body);
  return res.body;
};

const entityRowLimits = ({ limit, returnAll } = {}) => {
  const all = returnAll === true || returnAll === "true";
  const requested = Number(limit);
  const ceiling = all ? MAX_ENTITY_RETURN_ALL : MAX_ENTITY_LIMIT;
  const maxRows = all
    ? ceiling
    : Math.min(
        Math.max(
          Number.isFinite(requested) && requested > 0
            ? Math.floor(requested)
            : DEFAULT_ENTITY_LIMIT,
          1
        ),
        ceiling
      );
  return {
    returnAll: all,
    maxRows,
    maxPages: MAX_ENTITY_PAGES,
    pageSize: ENTITY_PAGE_SIZE,
  };
};

const collectEntityPages = async ({
  accessToken,
  path,
  fields,
  maxRows,
  maxPages,
  pageSize,
  returnAll,
  afterCursor,
  extraQuery = {},
}) => {
  const rows = [];
  let after = afterCursor ? String(afterCursor) : "";
  let pages = 0;
  let more = false;
  let nextAfter = "";
  while (rows.length < maxRows && pages < maxPages) {
    const remaining = maxRows - rows.length;
    const size = Math.min(pageSize, remaining);
    pages += 1;
    const query = {
      ...extraQuery,
      fields: Array.isArray(fields) ? fields.join(",") : String(fields || ""),
      limit: String(size),
    };
    if (after) query.after = after;
    const body = await facebookGraphRequest({
      accessToken,
      path,
      query,
    });
    const data = Array.isArray(body?.data) ? body.data : [];
    for (const row of data) {
      rows.push(row);
      if (rows.length >= maxRows) break;
    }
    nextAfter = String(body?.paging?.cursors?.after || "");
    if (!nextAfter || data.length === 0) {
      more = false;
      break;
    }
    more = true;
    after = nextAfter;
    if (!returnAll) break;
    if (rows.length >= maxRows) break;
  }
  const truncated = Boolean(
    more && (rows.length >= maxRows || (returnAll && pages >= MAX_ENTITY_PAGES))
  );
  return {
    rows,
    truncated,
    paging: {
      after: more ? nextAfter || null : null,
      hasMore: more,
    },
  };
};

const exprValue = (value, context, item) => {
  if (value == null || typeof value !== "string" || !value.includes("{{")) {
    return value;
  }
  const { interpolate } = require("./workflowNodes.service");
  const payload =
    item && typeof item === "object" && item.json && typeof item.json === "object"
      ? item.json
      : item;
  return interpolate(value, {
    input: payload ?? context?.input,
    steps: context?.steps,
    item,
    items: context?.items,
  });
};

const presentPage = (row) => {
  const picture =
    row?.picture && typeof row.picture === "object"
      ? row.picture.data?.url || row.picture.url || null
      : null;
  return {
    pageId: row?.id == null ? "" : String(row.id),
    name: row?.name == null ? "" : String(row.name),
    username: row?.username == null ? "" : String(row.username),
    link: row?.link == null ? "" : String(row.link),
    category: row?.category == null ? "" : String(row.category),
    about: row?.about == null ? "" : String(row.about),
    description: row?.description == null ? "" : String(row.description),
    fanCount: row?.fan_count != null ? Number(row.fan_count) : null,
    followersCount:
      row?.followers_count != null ? Number(row.followers_count) : null,
    pictureUrl: picture ? String(picture) : null,
  };
};

const presentPost = (row) => {
  const reactions =
    row?.reactions?.summary?.total_count != null
      ? Number(row.reactions.summary.total_count)
      : null;
  const comments =
    row?.comments?.summary?.total_count != null
      ? Number(row.comments.summary.total_count)
      : null;
  const shares =
    row?.shares?.count != null ? Number(row.shares.count) : null;
  return {
    postId: row?.id == null ? "" : String(row.id),
    message: row?.message == null ? "" : String(row.message),
    createdTime: row?.created_time || null,
    permalinkUrl: row?.permalink_url == null ? "" : String(row.permalink_url),
    fullPicture: row?.full_picture == null ? "" : String(row.full_picture),
    attachments: row?.attachments || null,
    shares,
    reactionsCount: reactions,
    commentsCount: comments,
  };
};

const presentComment = (row) => ({
  commentId: row?.id == null ? "" : String(row.id),
  message: row?.message == null ? "" : String(row.message),
  createdTime: row?.created_time || null,
  fromName: row?.from?.name == null ? "" : String(row.from.name),
  fromId: row?.from?.id == null ? "" : String(row.from.id),
  likeCount: row?.like_count != null ? Number(row.like_count) : null,
  commentCount: row?.comment_count != null ? Number(row.comment_count) : null,
});

const metaBase = (resource, operation, pageId, extra = {}) => ({
  provider: "facebook_page",
  resource,
  operation,
  pageId: String(pageId || ""),
  apiVersion: API_VERSION,
  ...extra,
});

const requireCredential = async (data, context) => {
  const credentialId = String(data?.credentialId || "").trim();
  if (!credentialId) {
    throw pageError(
      "Connect a Facebook Page account first.",
      "FACEBOOK_PAGE_CREDENTIAL_REQUIRED"
    );
  }
  const cred = await loadCredentialRow(credentialId, context?.workspaceId);
  if (!cred || cred.type !== "facebook_page") {
    throw pageError(
      "A Facebook Page credential is required.",
      "FACEBOOK_PAGE_CREDENTIAL_REQUIRED"
    );
  }
  assertUsableUserToken(cred.secret);
  return cred;
};

const executeGetPage = async ({ data, context, first }) => {
  const cred = await requireCredential(data, context);
  const pageId = String(
    exprValue(data.pageId, context, first) ||
      cred.config?.selectedPageId ||
      ""
  ).trim();
  const pageAuth = resolvePageAccessToken(cred.secret, pageId);
  const row = await facebookGraphRequest({
    accessToken: pageAuth.accessToken,
    path: pageAuth.pageId,
    query: { fields: PAGE_FIELDS.join(",") },
  });
  const presented = presentPage(row);
  return {
    items: [
      {
        json: {
          ...presented,
          _meta: metaBase("page", "get", pageAuth.pageId),
        },
        pairedItem: { item: 0, inputItemIndex: 0 },
      },
    ],
    output: {
      resource: "page",
      operation: "get",
      pageId: pageAuth.pageId,
      rowCount: 1,
    },
  };
};

const executeListPosts = async ({ data, context, first }) => {
  const cred = await requireCredential(data, context);
  const pageId = String(
    exprValue(data.pageId, context, first) ||
      cred.config?.selectedPageId ||
      ""
  ).trim();
  const pageAuth = resolvePageAccessToken(cred.secret, pageId);
  const limits = entityRowLimits({
    limit: data.limit,
    returnAll: data.returnAll,
  });
  const fetched = await collectEntityPages({
    accessToken: pageAuth.accessToken,
    path: `${pageAuth.pageId}/published_posts`,
    fields: POST_FIELDS,
    maxRows: limits.maxRows,
    maxPages: limits.maxPages,
    pageSize: limits.pageSize,
    returnAll: limits.returnAll,
    afterCursor: exprValue(data.after, context, first),
  });
  const items = fetched.rows.map((row, index) => ({
    json: {
      ...presentPost(row),
      _meta: metaBase("post", "list", pageAuth.pageId, {
        paging: fetched.paging,
      }),
    },
    pairedItem: { item: 0, inputItemIndex: index },
  }));
  return {
    items,
    output: {
      resource: "post",
      operation: "list",
      pageId: pageAuth.pageId,
      rowCount: items.length,
      truncated: fetched.truncated,
      paging: fetched.paging,
    },
  };
};

const executeGetPost = async ({ data, context, first }) => {
  const cred = await requireCredential(data, context);
  const pageId = String(
    exprValue(data.pageId, context, first) ||
      cred.config?.selectedPageId ||
      ""
  ).trim();
  const postId = String(exprValue(data.postId, context, first) || "").trim();
  if (!postId) {
    throw pageError("Select a Facebook post.", "FACEBOOK_PAGE_POST_REQUIRED");
  }
  const pageAuth = resolvePageAccessToken(cred.secret, pageId);
  const row = await facebookGraphRequest({
    accessToken: pageAuth.accessToken,
    path: postId,
    query: { fields: POST_FIELDS.join(",") },
  });
  return {
    items: [
      {
        json: {
          ...presentPost(row),
          _meta: metaBase("post", "get", pageAuth.pageId, { postId }),
        },
        pairedItem: { item: 0, inputItemIndex: 0 },
      },
    ],
    output: {
      resource: "post",
      operation: "get",
      pageId: pageAuth.pageId,
      postId,
      rowCount: 1,
    },
  };
};

const executeListComments = async ({ data, context, first }) => {
  const cred = await requireCredential(data, context);
  const pageId = String(
    exprValue(data.pageId, context, first) ||
      cred.config?.selectedPageId ||
      ""
  ).trim();
  const postId = String(exprValue(data.postId, context, first) || "").trim();
  if (!postId) {
    throw pageError("Select a Facebook post.", "FACEBOOK_PAGE_POST_REQUIRED");
  }
  const pageAuth = resolvePageAccessToken(cred.secret, pageId);
  const limits = entityRowLimits({
    limit: data.limit,
    returnAll: data.returnAll,
  });
  const fetched = await collectEntityPages({
    accessToken: pageAuth.accessToken,
    path: `${postId}/comments`,
    fields: COMMENT_FIELDS,
    maxRows: limits.maxRows,
    maxPages: limits.maxPages,
    pageSize: limits.pageSize,
    returnAll: limits.returnAll,
    afterCursor: exprValue(data.after, context, first),
    extraQuery: { filter: "stream", order: "reverse_chronological" },
  });
  const items = fetched.rows.map((row, index) => ({
    json: {
      ...presentComment(row),
      postId,
      _meta: metaBase("comments", "list", pageAuth.pageId, {
        postId,
        paging: fetched.paging,
      }),
    },
    pairedItem: { item: 0, inputItemIndex: index },
  }));
  return {
    items,
    output: {
      resource: "comments",
      operation: "list",
      pageId: pageAuth.pageId,
      postId,
      rowCount: items.length,
      truncated: fetched.truncated,
      paging: fetched.paging,
    },
  };
};

const normalizeInsightRows = (body, labels) => {
  const data = Array.isArray(body?.data) ? body.data : [];
  if (!data.length) {
    return {
      available: false,
      reason: "no_eligible_insight_data",
      metrics: [],
      message:
        "Facebook returned no eligible insight data for this Page/post and timeframe.",
    };
  }
  const metrics = data.map((entry) => {
    const key = String(entry.name || "");
    const values = Array.isArray(entry.values) ? entry.values : [];
    const latest = values.length ? values[values.length - 1] : null;
    return {
      metric: key,
      label: labels[key] || key,
      period: entry.period || null,
      value: latest?.value ?? null,
      endTime: latest?.end_time || null,
      values,
    };
  });
  return { available: true, metrics };
};

const executeInsights = async ({ data, context, first }) => {
  const cred = await requireCredential(data, context);
  const pageId = String(
    exprValue(data.pageId, context, first) ||
      cred.config?.selectedPageId ||
      ""
  ).trim();
  const pageAuth = resolvePageAccessToken(cred.secret, pageId);
  const level = String(data.insightsLevel || data.level || "page")
    .trim()
    .toLowerCase();
  const operation = String(data.operation || "").trim();

  if (
    level === "post" ||
    operation === "post" ||
    operation === "post_insights"
  ) {
    const postId = String(exprValue(data.postId, context, first) || "").trim();
    if (!postId) {
      throw pageError("Select a Facebook post.", "FACEBOOK_PAGE_POST_REQUIRED");
    }
    // Post insights are lifetime-only in the curated catalog.
    const postPeriodRaw = String(data.period || data.timeframe || "").trim();
    const spec = resolvePostInsightsRequest({
      reportType: data.reportType || data.insightsReport,
      metrics: data.metrics,
      period: postPeriodRaw === "lifetime" ? postPeriodRaw : undefined,
    });
    const body = await facebookGraphRequest({
      accessToken: pageAuth.accessToken,
      path: `${postId}/insights`,
      query: {
        metric: spec.metrics.join(","),
        period: spec.period,
      },
    });
    const normalized = normalizeInsightRows(body, spec.labels);
    return {
      items: [
        {
          json: {
            insightsLevel: "post",
            reportType: spec.reportType,
            period: spec.period,
            postId,
            ...normalized,
            _meta: metaBase("insights", "post", pageAuth.pageId, {
              postId,
              reportType: spec.reportType,
              period: spec.period,
            }),
          },
          pairedItem: { item: 0, inputItemIndex: 0 },
        },
      ],
      output: {
        resource: "insights",
        operation: "post",
        pageId: pageAuth.pageId,
        postId,
        available: normalized.available,
        rowCount: 1,
      },
    };
  }

  const spec = resolvePageInsightsRequest({
    reportType: data.reportType || data.insightsReport,
    metrics: data.metrics,
    period: data.period || data.timeframe,
  });
  const query = {
    metric: spec.metrics.join(","),
    period: spec.period,
  };
  if (data.since) query.since = String(exprValue(data.since, context, first));
  if (data.until) query.until = String(exprValue(data.until, context, first));
  const body = await facebookGraphRequest({
    accessToken: pageAuth.accessToken,
    path: `${pageAuth.pageId}/insights`,
    query,
  });
  const normalized = normalizeInsightRows(body, spec.labels);
  return {
    items: [
      {
        json: {
          insightsLevel: "page",
          reportType: spec.reportType,
          period: spec.period,
          ...normalized,
          _meta: metaBase("insights", "page", pageAuth.pageId, {
            reportType: spec.reportType,
            period: spec.period,
          }),
        },
        pairedItem: { item: 0, inputItemIndex: 0 },
      },
    ],
    output: {
      resource: "insights",
      operation: "page",
      pageId: pageAuth.pageId,
      available: normalized.available,
      rowCount: 1,
    },
  };
};

const executePublish = async ({ data, context, first }) => {
  const cred = await requireCredential(data, context);
  const pageId = String(
    exprValue(data.pageId, context, first) ||
      cred.config?.selectedPageId ||
      ""
  ).trim();
  const pageAuth = resolvePageAccessToken(cred.secret, pageId);
  const operation = String(data.operation || "create_text_post").trim();
  const message = String(exprValue(data.message, context, first) || "").trim();
  const link = String(exprValue(data.link, context, first) || "").trim();

  if (operation === "create_link_post") {
    if (!link) {
      throw pageError("A link URL is required.", "FACEBOOK_PAGE_LINK_REQUIRED");
    }
    const body = await facebookGraphRequest({
      accessToken: pageAuth.accessToken,
      path: `${pageAuth.pageId}/feed`,
      method: "POST",
      query: {
        message: message || undefined,
        link,
      },
    });
    return {
      items: [
        {
          json: {
            postId: body?.id == null ? "" : String(body.id),
            link,
            message,
            _meta: metaBase("publish", "create_link_post", pageAuth.pageId),
          },
          pairedItem: { item: 0, inputItemIndex: 0 },
        },
      ],
      output: {
        resource: "publish",
        operation: "create_link_post",
        pageId: pageAuth.pageId,
        postId: body?.id == null ? "" : String(body.id),
        rowCount: 1,
      },
    };
  }

  if (operation !== "create_text_post") {
    throw pageError(
      "Facebook Page publishing supports Create Text Post and Create Link Post in V1. Photo/video publishing is deferred.",
      "FACEBOOK_PAGE_FIELD_UNSUPPORTED"
    );
  }
  if (!message) {
    throw pageError(
      "A message is required for a text post.",
      "FACEBOOK_PAGE_MESSAGE_REQUIRED"
    );
  }
  const body = await facebookGraphRequest({
    accessToken: pageAuth.accessToken,
    path: `${pageAuth.pageId}/feed`,
    method: "POST",
    query: { message },
  });
  return {
    items: [
      {
        json: {
          postId: body?.id == null ? "" : String(body.id),
          message,
          _meta: metaBase("publish", "create_text_post", pageAuth.pageId),
        },
        pairedItem: { item: 0, inputItemIndex: 0 },
      },
    ],
    output: {
      resource: "publish",
      operation: "create_text_post",
      pageId: pageAuth.pageId,
      postId: body?.id == null ? "" : String(body.id),
      rowCount: 1,
    },
  };
};

const executeFacebookPageNode = async (node, context) => {
  const data = sanitizeFacebookPageNodeData(node?.data || {});
  const resource = String(data.resource || "page").trim();
  const operation = String(data.operation || "get").trim();
  const itemsIn = Array.isArray(context?.inputItems)
    ? context.inputItems
    : Array.isArray(context?.items)
      ? context.items
      : [{ json: {} }];
  const first = itemsIn[0] || { json: {} };

  if (resource === "page") {
    if (operation !== "get" && operation !== "get_page") {
      throw pageError("Page supports Get Page only.", "FACEBOOK_PAGE_FIELD_UNSUPPORTED");
    }
    return executeGetPage({ data, context, first });
  }
  if (resource === "post") {
    if (operation === "list" || operation === "list_posts") {
      return executeListPosts({ data, context, first });
    }
    if (operation === "get" || operation === "get_post") {
      return executeGetPost({ data, context, first });
    }
    throw pageError("Post supports List Posts and Get Post.", "FACEBOOK_PAGE_FIELD_UNSUPPORTED");
  }
  if (resource === "comments") {
    if (operation !== "list" && operation !== "list_comments") {
      throw pageError(
        "Comments supports List Comments only in V1.",
        "FACEBOOK_PAGE_FIELD_UNSUPPORTED"
      );
    }
    return executeListComments({ data, context, first });
  }
  if (resource === "insights") {
    return executeInsights({ data, context, first });
  }
  if (resource === "publish") {
    return executePublish({ data, context, first });
  }
  throw pageError("Unsupported Facebook Page resource.", "FACEBOOK_PAGE_FIELD_UNSUPPORTED");
};

/** Bounded recent posts for UI picker (display/lookup only). */
const listFacebookPagePostOptions = async (
  credentialId,
  pageId,
  authUser,
  options = {}
) => {
  const cred = await loadCredentialRow(credentialId);
  if (!cred || cred.type !== "facebook_page") {
    throw pageError("Facebook Page credential not found", "NOT_FOUND", 404);
  }
  const { assertWorkspaceAccess } = require("./authorization.service");
  await assertWorkspaceAccess(authUser, cred.workspaceId);
  const pageAuth = resolvePageAccessToken(
    cred.secret,
    pageId || cred.config?.selectedPageId
  );
  const limit = Math.min(Math.max(Number(options.limit) || 10, 1), 25);
  const fetched = await collectEntityPages({
    accessToken: pageAuth.accessToken,
    path: `${pageAuth.pageId}/published_posts`,
    fields: ["id", "message", "created_time", "permalink_url"],
    maxRows: limit,
    maxPages: 1,
    pageSize: limit,
    returnAll: false,
  });
  return {
    pageId: pageAuth.pageId,
    posts: fetched.rows.map((row) => ({
      postId: String(row.id || ""),
      label: String(row.message || "")
        .trim()
        .slice(0, 80) || `Post ${row.id}`,
      createdTime: row.created_time || null,
      permalinkUrl: row.permalink_url || "",
    })),
    paging: fetched.paging,
  };
};

module.exports = {
  API_VERSION,
  DEFAULT_ENTITY_LIMIT,
  MAX_ENTITY_LIMIT,
  withFacebookPageTestHooks,
  stripSecrets,
  sanitizeFacebookPageNodeData,
  appSecretProof,
  mapFacebookPageError,
  facebookGraphRequest,
  loadCredentialRow,
  presentPage,
  presentPost,
  presentComment,
  executeFacebookPageNode,
  listFacebookPagePostOptions,
  resolvePageAccessToken,
};
