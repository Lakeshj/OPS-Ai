/**
 * Instagram native node — account/media reads (M3) + insights (M4).
 * Unified Login Graph (graph.facebook.com). Separate from Meta Ads.
 * IGUser path: /{instagramUserId} — never request Instagram-Login-only fields
 * such as user_id on the IGUser node.
 */

const AppError = require("../utils/AppError");
const {
  API_VERSION,
  SCOPE_BASIC,
  SCOPE_INSIGHTS,
} = require("../config/instagramGraph");
const {
  withInstagramAuthTestHooks,
  loadCredentialRow,
  instagramGraphGet,
  missingPermissions,
  stripSecrets,
  resolveInstagramUserId,
  presentInstagramAccount,
  unwrapMePayload,
  markCredentialReconnectRequired,
} = require("./workflowInstagramAuth.service");
const insightsCatalog = require("./instagramInsightsCatalog");

/** Default Media → List page size (M8.14). Do not exhaust Graph pages by default. */
const DEFAULT_LIMIT = 25;
const PAGE_SIZE = 50;
const MAX_ROWS = 500;
const MAX_PAGES = 20;
const MAX_LIMIT = 100;

/** Unified Login IGUser fields (graph.facebook.com). No user_id / account_type. */
const PROFILE_FIELDS_REQUIRED = "id,username";
const PROFILE_FIELDS_OPTIONAL =
  "name,biography,website,profile_picture_url,followers_count,follows_count,media_count,ig_id";
const PROFILE_FIELDS = `${PROFILE_FIELDS_REQUIRED},${PROFILE_FIELDS_OPTIONAL}`;

const MEDIA_FIELDS_CORE =
  "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,username";
const MEDIA_FIELDS_OPTIONAL =
  "owner,comments_count,like_count,children{id,media_type,media_url,thumbnail_url,permalink}";
const MEDIA_FIELDS = `${MEDIA_FIELDS_CORE},${MEDIA_FIELDS_OPTIONAL}`;

const SECRET_KEY_RE =
  /(access[_-]?token|refresh[_-]?token|client[_-]?secret|app[_-]?secret|appsecret[_-]?(proof|time)|^password$|^authorization$|^secret$|^token$|^code$)/i;
const PAGING_URL_RE = /access_token=|appsecret_proof=/i;

const hooks = {
  now: () => Date.now(),
};

const withInstagramNodeTestHooks = async (overrides, fn) => {
  const prevNow = hooks.now;
  if (overrides?.now) hooks.now = overrides.now;
  try {
    return await withInstagramAuthTestHooks(overrides || {}, fn);
  } finally {
    hooks.now = prevNow;
  }
};

const igError = (message, code, status = 400) =>
  new AppError(stripSecrets(message), status, code);

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

/** Only explicit true/"true" enables full history — missing/undefined/false → false. */
const isExplicitReturnAll = (value) =>
  value === true || value === "true";

/**
 * Normalize Media → List pagination for Run Step / saved workflows.
 * Legacy nodes often omit limit/returnAll/after — never treat missing returnAll as true.
 */
const normalizeListMediaExecutionParams = (data = {}) => {
  const next =
    data && typeof data === "object" && !Array.isArray(data) ? { ...data } : {};
  next.resource = "media";
  next.operation = "list_media";
  next.returnAll = isExplicitReturnAll(next.returnAll);

  const cursor = String(next.afterCursor || next.after || "").trim();
  next.after = cursor;
  if (Object.prototype.hasOwnProperty.call(next, "afterCursor")) {
    next.afterCursor = cursor;
  }

  if (next.returnAll) {
    return next;
  }

  const requested = Number(next.limit);
  next.limit =
    Number.isFinite(requested) && requested > 0
      ? Math.min(Math.floor(requested), MAX_LIMIT)
      : DEFAULT_LIMIT;
  return next;
};

const sanitizeInstagramNodeData = (data) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const next = stripSecretKeys(data);
  if (next.credentialId != null) next.credentialId = String(next.credentialId).trim();
  if (next.mediaId != null) next.mediaId = String(next.mediaId).trim();
  if (next.resource != null) next.resource = String(next.resource).trim();
  if (next.operation != null) next.operation = String(next.operation).trim();
  if (next.insightsPreset != null) {
    next.insightsPreset = String(next.insightsPreset).trim();
  }
  if (next.mediaInsightsPreset != null) {
    next.mediaInsightsPreset = String(next.mediaInsightsPreset).trim();
  }
  if (next.period != null) next.period = String(next.period).trim();
  if (next.breakdown != null) next.breakdown = String(next.breakdown).trim();
  if (next.timeframe != null) next.timeframe = String(next.timeframe).trim();
  if (next.metricType != null) next.metricType = String(next.metricType).trim();
  if (next.mediaType != null) next.mediaType = String(next.mediaType).trim();
  if (next.dateRange != null) next.dateRange = String(next.dateRange).trim();
  if (next.since != null) next.since = String(next.since).trim();
  if (next.until != null) next.until = String(next.until).trim();
  if (next.metrics != null) next.metrics = insightsCatalog.listOf(next.metrics);
  // M8.13.1 — strip stale hidden Insights params before execution.
  if (
    String(next.resource || "") === "insights" &&
    String(next.operation || "") === "account_insights"
  ) {
    Object.assign(next, insightsCatalog.normalizeAccountInsightsData(next));
  }
  if (next.imageUrl != null) next.imageUrl = String(next.imageUrl).trim();
  if (next.videoUrl != null) next.videoUrl = String(next.videoUrl).trim();
  if (next.mediaUrl != null) next.mediaUrl = String(next.mediaUrl).trim();
  if (next.coverUrl != null) next.coverUrl = String(next.coverUrl).trim();
  if (next.caption != null) next.caption = String(next.caption);
  if (next.altText != null) next.altText = String(next.altText).trim();
  if (next.publishKey != null) next.publishKey = String(next.publishKey).trim();
  if (next.storyMediaType != null) {
    next.storyMediaType = String(next.storyMediaType).trim();
  }
  if (next.commentId != null) next.commentId = String(next.commentId).trim();
  if (next.message != null) next.message = String(next.message);
  if (next.replyMessage != null) next.replyMessage = String(next.replyMessage);
  if (next.afterCursor != null && next.after == null) {
    next.after = next.afterCursor;
  }
  if (next.after != null) next.after = String(next.after).trim();
  if (next.afterCursor != null) next.afterCursor = String(next.afterCursor).trim();
  // M8.14.2 — Media List defaults must apply on the execution path for legacy nodes.
  if (
    String(next.resource || "") === "media" &&
    String(next.operation || "") === "list_media"
  ) {
    Object.assign(next, normalizeListMediaExecutionParams(next));
  } else {
    if (next.returnAll != null) {
      next.returnAll = isExplicitReturnAll(next.returnAll);
    }
    if (next.limit != null && next.limit !== "") {
      const n = Number(next.limit);
      if (Number.isFinite(n)) next.limit = Math.floor(n);
    }
  }
  return next;
};

const assertNoSecretLeak = (value) => {
  const json = JSON.stringify(value);
  if (PAGING_URL_RE.test(json)) {
    throw igError(
      "Instagram response contained a secret-bearing URL.",
      "INSTAGRAM_GRAPH_ERROR"
    );
  }
  return value;
};

const rowLimits = ({ limit, returnAll }) => {
  const all = isExplicitReturnAll(returnAll);
  const requested = Number(limit);
  const maxRows = all
    ? MAX_ROWS
    : Math.min(
        Math.max(
          Number.isFinite(requested) && requested > 0
            ? Math.floor(requested)
            : DEFAULT_LIMIT,
          1
        ),
        MAX_LIMIT
      );
  return { returnAll: all, maxRows, maxPages: MAX_PAGES, pageSize: PAGE_SIZE };
};

/** Opaque Meta paging cursor — never accept URLs or token-bearing strings. */
const sanitizeAfterCursor = (raw) => {
  const value = String(raw == null ? "" : raw).trim();
  if (!value) return "";
  if (
    value.length > 512 ||
    /https?:\/\//i.test(value) ||
    /access_token|appsecret_proof/i.test(value)
  ) {
    throw igError(
      "After cursor must be a Meta paging cursor, not a URL.",
      "INSTAGRAM_PAGING_CURSOR_INVALID"
    );
  }
  return value;
};

const buildPagingMeta = ({ after, hasNext }) => {
  const cursor = String(after || "").trim();
  const paging = {
    hasNext: Boolean(hasNext && cursor),
  };
  if (cursor) {
    paging.cursors = { after: cursor };
  }
  return paging;
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

const isUnsupportedFieldError = (err) => {
  const msg = String(err?.message || "");
  const code = String(err?.code || "");
  return (
    (code === "INSTAGRAM_GRAPH_ERROR" ||
      code === "INSTAGRAM_INVALID_GRAPH_FIELD") &&
    /nonexisting field|unknown field|unsupported field|invalid field|\(#100\)/i.test(
      msg
    )
  );
};

const sanitizeInvalidFieldError = (err, { resource, operation } = {}) => {
  const msg = String(err?.message || "");
  const fieldMatch =
    msg.match(/nonexisting field\s*\(([^)]+)\)/i) ||
    msg.match(/unsupported field\s*\(([^)]+)\)/i) ||
    msg.match(/rejected unsupported field\s*\(([^)]+)\)/i);
  const field = fieldMatch ? fieldMatch[1] : "";
  const op = [resource, operation].filter(Boolean).join("/");
  return igError(
    field
      ? `Instagram ${op || "request"} used an unsupported Graph field (${field}).`
      : `Instagram ${op || "request"} used an unsupported Graph field contract.`,
    "INSTAGRAM_INVALID_GRAPH_FIELD",
    400
  );
};

const asOptionalNumber = (value) => {
  if (value == null || value === "") return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const normalizeAccountType = (raw) => {
  const value = String(raw || "").trim();
  if (!value) return undefined;
  const lower = value.toLowerCase();
  if (lower === "business") return "Business";
  if (lower === "media_creator" || lower === "creator") return "Media_Creator";
  return value;
};

const buildMeta = ({
  resource,
  operation,
  instagramUserId,
  mediaId,
  truncated,
  paging,
}) => {
  const meta = {
    provider: "instagram",
    resource: String(resource || ""),
    operation: String(operation || ""),
    instagramUserId: String(instagramUserId || ""),
    apiVersion: API_VERSION,
  };
  if (mediaId) meta.mediaId = String(mediaId);
  if (truncated === true) meta.truncated = true;
  if (paging && typeof paging === "object") {
    meta.paging = {
      hasNext: Boolean(paging.hasNext),
      ...(paging.cursors && paging.cursors.after
        ? { cursors: { after: String(paging.cursors.after) } }
        : {}),
    };
  }
  return meta;
};

const normalizeProfile = (row, provenance = {}) => {
  // IGUser.id is the professional account id under Unified Login.
  // Accept legacy user_id if a response still includes it; never require requesting it.
  const id = resolveInstagramUserId(row);
  const username = String(row?.username || "").trim();
  if (!id || !username) {
    throw igError(
      "Could not read the Instagram professional account. Try reconnecting.",
      "INSTAGRAM_ACCOUNT_DISCOVERY_FAILED"
    );
  }
  const json = {
    id,
    instagramUserId: id,
    username,
  };
  const name = String(row?.name || "").trim();
  if (name) json.name = name;
  const accountType =
    normalizeAccountType(row?.account_type) ||
    normalizeAccountType(provenance.accountType);
  if (accountType) json.accountType = accountType;
  const biography = String(row?.biography || "").trim();
  if (biography) json.biography = biography;
  const website = String(row?.website || "").trim();
  if (website) json.website = website;
  const picture = String(row?.profile_picture_url || "").trim();
  if (picture) json.profilePictureUrl = picture;
  const followers = asOptionalNumber(row?.followers_count);
  if (followers !== undefined) json.followersCount = followers;
  const follows = asOptionalNumber(row?.follows_count);
  if (follows !== undefined) json.followsCount = follows;
  const mediaCount = asOptionalNumber(row?.media_count);
  if (mediaCount !== undefined) json.mediaCount = mediaCount;
  const igId = String(row?.ig_id || "").trim();
  if (igId) json.igId = igId;
  json._meta = buildMeta({
    resource: "account",
    operation: "get_profile",
    instagramUserId: provenance.instagramUserId || id,
  });
  return assertNoSecretLeak(json);
};

const normalizeMediaChild = (child) => {
  if (!child || typeof child !== "object") return null;
  const id = String(child.id || "").trim();
  if (!id) return null;
  const out = { id };
  if (child.media_type != null) out.mediaType = String(child.media_type);
  if (child.media_url != null) out.mediaUrl = String(child.media_url);
  if (child.thumbnail_url != null) out.thumbnailUrl = String(child.thumbnail_url);
  if (child.permalink != null) out.permalink = String(child.permalink);
  return out;
};

const normalizeMedia = (row, provenance = {}) => {
  const id = String(row?.id || "").trim();
  if (!id) {
    throw igError("Instagram media is missing an id.", "INSTAGRAM_MEDIA_INVALID");
  }
  const json = { id, mediaId: id };
  if (row.caption != null && String(row.caption).length) {
    json.caption = String(row.caption);
  }
  if (row.media_type != null) json.mediaType = String(row.media_type);
  if (row.media_product_type != null) {
    json.mediaProductType = String(row.media_product_type);
  }
  if (row.media_url != null) json.mediaUrl = String(row.media_url);
  if (row.thumbnail_url != null) json.thumbnailUrl = String(row.thumbnail_url);
  if (row.permalink != null) json.permalink = String(row.permalink);
  if (row.timestamp != null) json.timestamp = String(row.timestamp);
  if (row.username != null) json.username = String(row.username);
  if (row.owner != null) {
    const ownerId =
      typeof row.owner === "object"
        ? String(row.owner.id || "").trim()
        : String(row.owner).trim();
    if (ownerId) json.ownerId = ownerId;
  }
  const comments = asOptionalNumber(row.comments_count);
  if (comments !== undefined) json.commentsCount = comments;
  const likes = asOptionalNumber(row.like_count);
  if (likes !== undefined) json.likeCount = likes;
  const childrenRaw = Array.isArray(row.children?.data)
    ? row.children.data
    : Array.isArray(row.children)
      ? row.children
      : null;
  if (childrenRaw) {
    const children = childrenRaw.map(normalizeMediaChild).filter(Boolean);
    if (children.length) json.children = children;
  }
  json._meta = buildMeta({
    resource: "media",
    operation: provenance.operation || "get_media",
    instagramUserId: provenance.instagramUserId,
    mediaId: id,
    truncated: provenance.truncated,
    paging: provenance.paging,
  });
  return assertNoSecretLeak(json);
};

const validateMediaId = (raw) => {
  const mediaId = String(raw == null ? "" : raw).trim();
  if (!mediaId) {
    throw igError("Enter a media id.", "INSTAGRAM_MEDIA_INVALID");
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(mediaId)) {
    throw igError("Media id must be a safe Instagram media identifier.", "INSTAGRAM_MEDIA_INVALID");
  }
  return mediaId;
};

const grantedPermissionsOf = (cred) => {
  if (Array.isArray(cred?.secret?.grantedPermissions)) {
    return cred.secret.grantedPermissions;
  }
  if (Array.isArray(cred?.config?.grantedPermissions)) {
    return cred.config.grantedPermissions;
  }
  return null;
};

const assertBasicPermission = (cred) => {
  const granted = grantedPermissionsOf(cred);
  if (!granted || !granted.length) return;
  const missing = missingPermissions(granted, [SCOPE_BASIC]);
  if (missing.length) {
    throw igError(
      "Instagram denied this request. A required permission is missing — reconnect and grant access.",
      "INSTAGRAM_PERMISSION_DENIED",
      403
    );
  }
};

const assertInsightsPermission = (cred) => {
  assertBasicPermission(cred);
  const granted = grantedPermissionsOf(cred);
  if (!granted || !granted.length) return;
  const missing = missingPermissions(granted, [SCOPE_INSIGHTS]);
  if (missing.length) {
    throw igError(
      "Insights access is not enabled for this Instagram connection. Reconnect Instagram and grant Insights access.",
      "PERMISSION_NOT_GRANTED",
      403
    );
  }
};

const resolveCredentialContext = async ({ credentialId, workspaceId }) => {
  const id = String(credentialId || "").trim();
  if (!id) {
    throw igError(
      "Connect an Instagram account first.",
      "INSTAGRAM_CREDENTIAL_REQUIRED"
    );
  }
  const cred = await loadCredentialRow(id, workspaceId);
  if (!cred || cred.type !== "instagram") {
    throw igError(
      "Connect an Instagram account first.",
      "INSTAGRAM_CREDENTIAL_REQUIRED"
    );
  }
  if (cred.config?.reconnectRequired || cred.secret?.revoked) {
    await markCredentialReconnectRequired(id, cred.secret?.revoked ? "revoked" : "expired");
    throw igError(
      "Instagram login expired. Reconnect Instagram.",
      "INSTAGRAM_TOKEN_INVALID",
      401
    );
  }
  assertBasicPermission(cred);
  const instagramUserId = String(
    cred.config?.instagramUserId ||
      cred.secret?.instagramUserId ||
      ""
  ).trim();
  if (!instagramUserId || !/^\d{5,32}$/.test(instagramUserId)) {
    throw igError(
      "Could not read the Instagram professional account. Try reconnecting.",
      "INSTAGRAM_ACCOUNT_DISCOVERY_FAILED"
    );
  }
  return { cred, credentialId: id, instagramUserId };
};

const graphGetWithFieldFallback = async ({
  credentialId,
  workspaceId,
  path,
  fullFields,
  coreFields,
  query = {},
}) => {
  try {
    return await instagramGraphGet({
      credentialId,
      workspaceId,
      path,
      query: { ...query, fields: fullFields },
    });
  } catch (err) {
    if (!isUnsupportedFieldError(err)) throw err;
    return instagramGraphGet({
      credentialId,
      workspaceId,
      path,
      query: { ...query, fields: coreFields },
    });
  }
};

const getProfile = async ({
  credentialId,
  workspaceId,
  instagramUserId,
  accountTypeHint,
}) => {
  let body;
  try {
    body = await graphGetWithFieldFallback({
      credentialId,
      workspaceId,
      path: String(instagramUserId),
      fullFields: PROFILE_FIELDS,
      coreFields: PROFILE_FIELDS_REQUIRED,
    });
  } catch (err) {
    if (isUnsupportedFieldError(err)) {
      throw sanitizeInvalidFieldError(err, {
        resource: "account",
        operation: "get_profile",
      });
    }
    throw err;
  }
  const row = unwrapMePayload(body);
  const presented = presentInstagramAccount({
    ...row,
    account_type: row?.account_type || accountTypeHint,
  });
  const type = String(presented.accountType || "").toLowerCase();
  // Unified Login IGUser often omits account_type; OAuth already proved professional.
  if (type && type !== "business" && type !== "media_creator") {
    throw igError(
      "Connect an Instagram professional account (Business or Creator).",
      "INSTAGRAM_ACCOUNT_UNSUPPORTED",
      403
    );
  }
  return normalizeProfile(row, {
    instagramUserId,
    accountType: accountTypeHint || presented.accountType,
  });
};

const collectMediaPages = async ({
  credentialId,
  workspaceId,
  instagramUserId,
  maxRows,
  maxPages,
  pageSize,
  returnAll,
  after: afterStart,
}) => {
  const rows = [];
  const seen = new Set();
  let after = sanitizeAfterCursor(afterStart);
  let pages = 0;
  let more = false;

  // returnAll=false: only enough Graph pages to satisfy limit (never exhaust history).
  const pageBudget = returnAll
    ? maxPages
    : Math.max(1, Math.ceil(maxRows / Math.max(pageSize, 1)));

  while (rows.length < maxRows && pages < pageBudget && pages < maxPages) {
    const remaining = maxRows - rows.length;
    const size = Math.min(pageSize, remaining);
    pages += 1;
    const query = { limit: String(size) };
    if (after) query.after = after;
    let body;
    try {
      body = await graphGetWithFieldFallback({
        credentialId,
        workspaceId,
        path: `${instagramUserId}/media`,
        fullFields: MEDIA_FIELDS,
        coreFields: MEDIA_FIELDS_CORE,
        query,
      });
    } catch (err) {
      if (rows.length > 0) {
        // Partial page failure: surface error rather than fabricating completeness.
        throw err;
      }
      throw err;
    }
    const data = Array.isArray(body?.data) ? body.data : [];
    for (const row of data) {
      const id = String(row?.id || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      rows.push(row);
      if (rows.length >= maxRows) break;
    }
    after = String(body?.paging?.cursors?.after || "").trim();
    const hasNextUrl = Boolean(
      body?.paging && Object.prototype.hasOwnProperty.call(body.paging, "next")
    );
    // Never return paging.next downstream — only follow cursor server-side.
    if (data.length === 0) {
      more = false;
      after = "";
      break;
    }
    if (!after) {
      more = false;
      break;
    }
    if (!returnAll && rows.length >= maxRows) {
      // Filled the requested limit; keep cursor for workflow pagination.
      more = true;
      break;
    }
    if (!returnAll && data.length < size) {
      // Short Graph page: honor Meta's next hint when present.
      more = Boolean(hasNextUrl);
      if (!more) after = "";
      break;
    }
    if (returnAll && !hasNextUrl && !after) {
      more = false;
      break;
    }
    more = true;
    if (rows.length >= maxRows) break;
  }

  const hasNext = Boolean(more && after);
  const truncated = hasNext;
  const paging = buildPagingMeta({ after: hasNext ? after : "", hasNext });
  return { rows, truncated, paging, after: hasNext ? after : "" };
};

const listMedia = async ({
  credentialId,
  workspaceId,
  instagramUserId,
  limit,
  returnAll,
  after,
  afterCursor,
}) => {
  const normalized = normalizeListMediaExecutionParams({
    resource: "media",
    operation: "list_media",
    limit,
    returnAll,
    after,
    afterCursor,
  });
  const limits = rowLimits({
    limit: normalized.limit,
    returnAll: normalized.returnAll,
  });
  const fetched = await collectMediaPages({
    credentialId,
    workspaceId,
    instagramUserId,
    maxRows: limits.maxRows,
    maxPages: limits.maxPages,
    pageSize: limits.pageSize,
    returnAll: limits.returnAll,
    after: normalized.after,
  });
  // Hard safety: never emit more than the bounded page when returnAll is off.
  let rows = fetched.rows;
  let paging = fetched.paging;
  let truncated = fetched.truncated;
  let nextAfter = fetched.after || "";
  if (!limits.returnAll && rows.length > limits.maxRows) {
    const overflow = rows.length > limits.maxRows;
    rows = rows.slice(0, limits.maxRows);
    if (overflow || nextAfter) {
      truncated = true;
      // Prefer Meta cursor; if Graph over-returned without cursor, mark hasNext.
      paging = buildPagingMeta({
        after: nextAfter,
        hasNext: Boolean(nextAfter) || overflow,
      });
      if (!nextAfter) nextAfter = "";
    }
  }
  return {
    rows: rows.map((row) =>
      normalizeMedia(row, {
        operation: "list_media",
        instagramUserId,
        truncated,
        paging,
      })
    ),
    truncated,
    paging,
    after: paging?.hasNext ? nextAfter || undefined : undefined,
    limit: limits.maxRows,
    returnAll: limits.returnAll,
  };
};

const getMedia = async ({
  credentialId,
  workspaceId,
  instagramUserId,
  mediaId,
}) => {
  const id = validateMediaId(mediaId);
  const body = await graphGetWithFieldFallback({
    credentialId,
    workspaceId,
    path: id,
    fullFields: MEDIA_FIELDS,
    coreFields: MEDIA_FIELDS_CORE,
  });
  return normalizeMedia(body, {
    operation: "get_media",
    instagramUserId,
  });
};

const mapInsightsProviderError = (err) => {
  const msg = String(err?.message || "");
  if (
    /not enough viewers|threshold|insufficient|not available for this|reduce the amount/i.test(
      msg
    )
  ) {
    return igError(
      stripSecrets(msg) ||
        "Instagram insights are unavailable for this metric or audience size.",
      "INSTAGRAM_INSIGHTS_UNAVAILABLE",
      400
    );
  }
  return err;
};

const fetchInsightsPages = async ({
  credentialId,
  workspaceId,
  path,
  query,
}) => {
  const rows = [];
  let after = "";
  let pages = 0;
  while (pages < MAX_PAGES) {
    pages += 1;
    const pageQuery = { ...query };
    if (after) pageQuery.after = after;
    let body;
    try {
      body = await instagramGraphGet({
        credentialId,
        workspaceId,
        path,
        query: pageQuery,
      });
    } catch (err) {
      throw mapInsightsProviderError(err);
    }
    const data = Array.isArray(body?.data) ? body.data : [];
    for (const row of data) rows.push(row);
    after = String(body?.paging?.cursors?.after || "").trim();
    if (!after || data.length === 0) break;
  }
  return rows;
};

/**
 * Preserve null/missing vs genuine 0. Never invent zeros.
 */
const readInsightValue = (raw) => {
  if (raw == null) return { status: "missing", value: undefined };
  if (typeof raw === "object" && !Array.isArray(raw)) {
    if (Object.prototype.hasOwnProperty.call(raw, "value")) {
      if (raw.value == null) return { status: "missing", value: undefined };
      const num = Number(raw.value);
      if (Number.isFinite(num)) return { status: "ok", value: num };
      return { status: "ok", value: raw.value };
    }
  }
  if (raw === "") return { status: "missing", value: undefined };
  const num = Number(raw);
  if (Number.isFinite(num) && String(raw).trim() !== "") {
    return { status: "ok", value: num };
  }
  return { status: "ok", value: raw };
};

const DEMOGRAPHIC_METRICS = new Set([
  "follower_demographics",
  "engaged_audience_demographics",
  "reached_audience_demographics",
]);

/**
 * Meta total_value metrics often omit `values[]` and return `total_value` instead.
 * Do not treat that shape as unavailable.
 */
const insightValuePoints = (metricRow) => {
  const values = Array.isArray(metricRow?.values) ? metricRow.values : [];
  if (values.length) return { points: values, source: "values" };
  const total = metricRow?.total_value;
  if (total != null && typeof total === "object" && !Array.isArray(total)) {
    return { points: [total], source: "total_value" };
  }
  if (total != null && typeof total !== "object") {
    return { points: [{ value: total }], source: "total_value" };
  }
  return { points: [], source: "none" };
};

const demographicUnavailableMessage =
  "Audience demographic data is not available for this account or selected timeframe.";

const normalizeInsightRows = ({
  metricRows,
  operation,
  instagramUserId,
  mediaId,
  mediaType,
  period,
  dateStart,
  dateEnd,
  breakdown,
  timeframe,
}) => {
  const items = [];
  for (const metricRow of metricRows || []) {
    const metric = String(metricRow?.name || metricRow?.metric || "").trim();
    if (!metric) continue;
    const title = String(metricRow?.title || "").trim() || undefined;
    const description = String(metricRow?.description || "").trim() || undefined;
    const isDemographic = DEMOGRAPHIC_METRICS.has(metric);
    const rowBreakdown = isDemographic
      ? String(breakdown || "").trim() || undefined
      : undefined;
    const rowTimeframe = isDemographic
      ? String(timeframe || "").trim() || undefined
      : undefined;
    const { points } = insightValuePoints(metricRow);
    const periodName = String(metricRow?.period || period || "").trim() || undefined;

    if (!points.length) {
      const json = assertNoSecretLeak({
        metric,
        period: periodName,
        status: "unavailable",
        title,
        description,
        dateStart: dateStart || undefined,
        dateEnd: dateEnd || undefined,
        breakdown: rowBreakdown,
        timeframe: rowTimeframe,
        mediaId: mediaId || undefined,
        mediaType: mediaType || undefined,
        unavailableReason: isDemographic
          ? demographicUnavailableMessage
          : undefined,
        _meta: buildMeta({
          resource: "insights",
          operation,
          instagramUserId,
          mediaId,
        }),
      });
      items.push(json);
      continue;
    }

    // Sort time-series chronologically by end_time when present.
    const ordered = [...points].sort((a, b) => {
      const ta = Date.parse(String(a?.end_time || a?.endTime || "")) || 0;
      const tb = Date.parse(String(b?.end_time || b?.endTime || "")) || 0;
      return ta - tb;
    });

    for (const point of ordered) {
      const endTime = String(point?.end_time || point?.endTime || "").trim() || undefined;
      const nestedBreakdowns =
        point && typeof point === "object" && Array.isArray(point.breakdowns)
          ? point.breakdowns
          : undefined;
      const dimensionValues =
        point && typeof point === "object" && point.dimension_values
          ? point.dimension_values
          : undefined;

      let value;
      let status;
      let breakdownValues;

      if (nestedBreakdowns) {
        const hasResults = nestedBreakdowns.some(
          (b) => Array.isArray(b?.results) && b.results.length > 0
        );
        if (!hasResults) {
          status = "unavailable";
          value = undefined;
        } else {
          status = "ok";
          breakdownValues = nestedBreakdowns;
          value = undefined;
        }
      } else {
        const parsed = readInsightValue(point);
        value = parsed.value;
        status = parsed.status;
        if (
          parsed.status === "ok" &&
          value &&
          typeof value === "object" &&
          !Array.isArray(value)
        ) {
          // Keep demographic maps as breakdown payload; value stays undefined (not 0).
          breakdownValues = value;
          value = undefined;
          status = "ok";
        }
      }

      if (status === "missing" && isDemographic) {
        status = "unavailable";
      }

      const json = {
        metric,
        period: periodName,
        title,
        description,
        dateStart: dateStart || undefined,
        dateEnd: dateEnd || endTime || undefined,
        endTime,
        breakdown: rowBreakdown,
        timeframe: rowTimeframe,
        mediaId: mediaId || undefined,
        mediaType: mediaType || undefined,
        status,
        _meta: buildMeta({
          resource: "insights",
          operation,
          instagramUserId,
          mediaId,
        }),
      };
      if (status === "unavailable" && isDemographic) {
        json.unavailableReason = demographicUnavailableMessage;
      }
      if (status === "ok" && value !== undefined) {
        json.value = value;
      }
      if (status === "ok" && breakdownValues != null) {
        json.breakdownValues = breakdownValues;
      }
      if (dimensionValues != null) json.dimensionValues = dimensionValues;
      items.push(assertNoSecretLeak(json));
    }
  }
  return items;
};

const runAccountInsights = async ({
  credentialId,
  workspaceId,
  instagramUserId,
  cred,
  data,
  nowMs,
}) => {
  assertInsightsPermission(cred);
  const built = insightsCatalog.buildAccountInsightRequests({
    preset: data.insightsPreset || data.preset || "overview",
    metrics: data.metrics,
    period: data.period,
    dateRange: data.dateRange,
    since: data.since,
    until: data.until,
    breakdown: data.breakdown,
    timeframe: data.timeframe,
    metricType: data.metricType,
    nowMs,
  });

  const metricRows = [];
  for (const group of built.groups) {
    const query = {
      metric: group.metrics.join(","),
      period: group.period,
    };
    if (group.metricType) query.metric_type = group.metricType;
    if (group.breakdown) query.breakdown = group.breakdown;
    if (group.timeframe) query.timeframe = group.timeframe;
    if (group.sinceUnix != null) query.since = String(group.sinceUnix);
    if (group.untilUnix != null) query.until = String(group.untilUnix);

    const rows = await fetchInsightsPages({
      credentialId,
      workspaceId,
      path: `${instagramUserId}/insights`,
      query,
    });
    metricRows.push(...rows);
  }

  const jsonRows = normalizeInsightRows({
    metricRows,
    operation: "account_insights",
    instagramUserId,
    period: data.period || "lifetime",
    dateStart: built.range?.since,
    dateEnd: built.range?.until,
    breakdown: data.breakdown,
    timeframe: built.timeframe || data.timeframe,
  });

  return {
    rows: jsonRows,
    metrics: built.metrics,
    range: built.range,
    timeframe: built.timeframe || data.timeframe,
  };
};

const resolveMediaTypeForInsights = async ({
  credentialId,
  workspaceId,
  mediaId,
  mediaTypeHint,
  inputItem,
}) => {
  const fromNode = insightsCatalog.normalizeMediaType(mediaTypeHint);
  if (fromNode) return fromNode;
  const fromInput = insightsCatalog.normalizeMediaType(
    inputItem?.json?.mediaType || inputItem?.json?.media_type
  );
  if (fromInput) return fromInput;
  const body = await instagramGraphGet({
    credentialId,
    workspaceId,
    path: mediaId,
    query: { fields: "id,media_type,media_product_type" },
  });
  const product = String(body?.media_product_type || "").toUpperCase();
  if (product === "REELS") return "REELS";
  if (product === "STORY") return "STORY";
  return insightsCatalog.normalizeMediaType(body?.media_type);
};

const runMediaInsights = async ({
  credentialId,
  workspaceId,
  instagramUserId,
  cred,
  data,
  inputItem,
}) => {
  assertInsightsPermission(cred);
  const mediaId = validateMediaId(
    data.mediaId || inputItem?.json?.mediaId || inputItem?.json?.id
  );
  const mediaType = await resolveMediaTypeForInsights({
    credentialId,
    workspaceId,
    mediaId,
    mediaTypeHint: data.mediaType,
    inputItem,
  });
  if (!mediaType) {
    throw igError(
      "Could not determine Instagram media type for insights.",
      "INSTAGRAM_MEDIA_TYPE_REQUIRED"
    );
  }

  const built = insightsCatalog.buildMediaInsightRequest({
    preset: data.mediaInsightsPreset || data.insightsPreset || data.preset || "overview",
    metrics: data.metrics,
    mediaType,
  });

  const query = { metric: built.metrics.join(",") };
  const metricRows = await fetchInsightsPages({
    credentialId,
    workspaceId,
    path: `${mediaId}/insights`,
    query,
  });

  const jsonRows = normalizeInsightRows({
    metricRows,
    operation: "media_insights",
    instagramUserId,
    mediaId,
    mediaType: built.mediaType,
  });

  return {
    rows: jsonRows,
    metrics: built.metrics,
    rejected: built.rejected || [],
    mediaId,
    mediaType: built.mediaType,
  };
};

const executeInstagramNode = async (node, context) => {
  const data = sanitizeInstagramNodeData(node?.data || {});
  const resource = String(data.resource || "account").trim();
  const operation = String(data.operation || "get_profile").trim();
  const { credentialId, instagramUserId, cred } = await resolveCredentialContext({
    credentialId: data.credentialId,
    workspaceId: context?.workspaceId,
  });

  const itemsIn = Array.isArray(context?.inputItems)
    ? context.inputItems
    : Array.isArray(context?.items)
      ? context.items
      : [{ json: {} }];
  const first = itemsIn[0] || { json: {} };

  if (resource === "account" && operation === "get_profile") {
    try {
      const json = await getProfile({
        credentialId,
        workspaceId: context?.workspaceId,
        instagramUserId,
        accountTypeHint: cred?.config?.accountType || cred?.secret?.accountType,
      });
      return {
        items: [{ json, pairedItem: { item: 0 } }],
        output: {
          resource,
          operation,
          instagramUserId,
          rowCount: 1,
        },
      };
    } catch (err) {
      if (isUnsupportedFieldError(err)) {
        throw sanitizeInvalidFieldError(err, { resource, operation });
      }
      throw err;
    }
  }

  if (resource === "media" && operation === "list_media") {
    // Re-normalize after expression resolution (legacy nodes + Run Step entrypoint).
    const listParams = normalizeListMediaExecutionParams({
      ...data,
      limit: exprValue(data.limit, context, first) ?? data.limit,
      returnAll: data.returnAll,
      after: exprValue(data.after, context, first) ?? data.after,
      afterCursor:
        exprValue(data.afterCursor, context, first) ?? data.afterCursor,
    });
    const fetched = await listMedia({
      credentialId,
      workspaceId: context?.workspaceId,
      instagramUserId,
      limit: listParams.limit,
      returnAll: listParams.returnAll,
      after: listParams.after,
      afterCursor: listParams.afterCursor,
    });
    const items = fetched.rows.map((json, index) => ({
      json,
      pairedItem: { item: 0, inputItemIndex: index },
    }));
    return {
      items,
      output: {
        resource,
        operation,
        instagramUserId,
        rowCount: items.length,
        limit: fetched.limit,
        returnAll: fetched.returnAll,
        truncated: fetched.truncated,
        // Collection-level cursor only — never paging.next URL (token-bearing).
        paging: fetched.paging,
        after: fetched.after || undefined,
      },
    };
  }

  if (resource === "media" && operation === "get_media") {
    const mediaId = exprValue(data.mediaId, context, first);
    const json = await getMedia({
      credentialId,
      workspaceId: context?.workspaceId,
      instagramUserId,
      mediaId,
    });
    return {
      items: [{ json, pairedItem: { item: 0 } }],
      output: {
        resource,
        operation,
        instagramUserId,
        mediaId: json.mediaId,
        rowCount: 1,
      },
    };
  }

  if (resource === "insights" && operation === "account_insights") {
    const fetched = await runAccountInsights({
      credentialId,
      workspaceId: context?.workspaceId,
      instagramUserId,
      cred,
      data: {
        ...data,
        since: exprValue(data.since, context, first) ?? data.since,
        until: exprValue(data.until, context, first) ?? data.until,
      },
      nowMs: hooks.now(),
    });
    const items = fetched.rows.map((json, index) => ({
      json,
      pairedItem: { item: 0, inputItemIndex: index },
    }));
    return {
      items,
      output: {
        resource,
        operation,
        instagramUserId,
        metrics: fetched.metrics,
        since: fetched.range?.since,
        until: fetched.range?.until,
        rowCount: items.length,
      },
    };
  }

  if (resource === "insights" && operation === "media_insights") {
    const mediaId = exprValue(data.mediaId, context, first);
    const fetched = await runMediaInsights({
      credentialId,
      workspaceId: context?.workspaceId,
      instagramUserId,
      cred,
      data: { ...data, mediaId },
      inputItem: first,
    });
    const items = fetched.rows.map((json, index) => ({
      json,
      pairedItem: { item: 0, inputItemIndex: index },
    }));
    return {
      items,
      output: {
        resource,
        operation,
        instagramUserId,
        mediaId: fetched.mediaId,
        mediaType: fetched.mediaType,
        metrics: fetched.metrics,
        rowCount: items.length,
      },
    };
  }

  if (
    resource === "publish" &&
    [
      "publish_image",
      "publish_carousel",
      "publish_reel",
      "publish_story",
    ].includes(operation)
  ) {
    const {
      executePublishOperation,
    } = require("./workflowInstagramPublish.service");
    // One input item → one publish result (no dataset semantics).
    const item = first;
    const resolved = {
      ...data,
      imageUrl: exprValue(data.imageUrl, context, item) ?? data.imageUrl,
      videoUrl: exprValue(data.videoUrl, context, item) ?? data.videoUrl,
      mediaUrl: exprValue(data.mediaUrl, context, item) ?? data.mediaUrl,
      coverUrl: exprValue(data.coverUrl, context, item) ?? data.coverUrl,
      caption: exprValue(data.caption, context, item) ?? data.caption,
      altText: exprValue(data.altText, context, item) ?? data.altText,
      publishKey: exprValue(data.publishKey, context, item) ?? data.publishKey,
    };
    const published = await executePublishOperation({
      operation,
      cred,
      credentialId,
      workspaceId: context?.workspaceId,
      instagramUserId,
      data: resolved,
      context: {
        workspaceId: context?.workspaceId,
        workflowId: context?.workflowId,
        nodeId: node?.id || context?.nodeId,
        runId: context?.runId,
      },
      item,
    });
    return {
      items: [{ json: published.json, pairedItem: { item: 0 } }],
      output: {
        resource,
        operation,
        instagramUserId,
        mediaId: published.json.mediaId,
        status: published.json.status,
        rowCount: 1,
        idempotentReplay: Boolean(published.replayed),
      },
    };
  }

  if (
    resource === "comments" &&
    ["list_comments", "list_replies", "reply_comment"].includes(operation)
  ) {
    const {
      executeCommentsOperation,
    } = require("./workflowInstagramComments.service");
    const item = first;
    const resolved = {
      ...data,
      mediaId: exprValue(data.mediaId, context, item) ?? data.mediaId,
      commentId: exprValue(data.commentId, context, item) ?? data.commentId,
      message:
        exprValue(data.message, context, item) ??
        exprValue(data.replyMessage, context, item) ??
        data.message ??
        data.replyMessage,
      limit: exprValue(data.limit, context, item) ?? data.limit,
      returnAll: data.returnAll,
    };
    return executeCommentsOperation({
      operation,
      cred,
      credentialId,
      workspaceId: context?.workspaceId,
      instagramUserId,
      data: resolved,
    });
  }

  throw igError(
    "Unsupported Instagram resource/operation for this node version.",
    "INSTAGRAM_OPERATION_UNSUPPORTED",
    400
  );
};

module.exports = {
  API_VERSION,
  DEFAULT_LIMIT,
  PAGE_SIZE,
  MAX_ROWS,
  MAX_PAGES,
  MAX_LIMIT,
  sanitizeAfterCursor,
  buildPagingMeta,
  isExplicitReturnAll,
  normalizeListMediaExecutionParams,
  PROFILE_FIELDS,
  PROFILE_FIELDS_REQUIRED,
  PROFILE_FIELDS_OPTIONAL,
  MEDIA_FIELDS,
  MEDIA_FIELDS_CORE,
  withInstagramNodeTestHooks,
  sanitizeInstagramNodeData,
  sanitizeInvalidFieldError,
  normalizeProfile,
  normalizeMedia,
  normalizeInsightRows,
  readInsightValue,
  validateMediaId,
  rowLimits,
  executeInstagramNode,
  getProfile,
  listMedia,
  getMedia,
  runAccountInsights,
  runMediaInsights,
  resolveCredentialContext,
  assertInsightsPermission,
  insightsCatalog,
};
