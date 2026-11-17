/**
 * Instagram Login comments — list + reply (M6).
 * Uses Instagram-only Graph GET/POST. Never Meta Ads client.
 */

const AppError = require("../utils/AppError");
const {
  API_VERSION,
  SCOPE_BASIC,
  SCOPE_COMMENTS,
} = require("../config/instagramGraph");
const {
  withInstagramAuthTestHooks,
  instagramGraphGet,
  instagramGraphPost,
  missingPermissions,
  stripSecrets,
} = require("./workflowInstagramAuth.service");

const DEFAULT_LIMIT = 50;
const PAGE_SIZE = 50;
const MAX_ROWS = 500;
const MAX_PAGES = 20;
const MESSAGE_MAX = 2200;

const COMMENT_FIELDS =
  "id,text,timestamp,username,like_count,replies";

const hooks = {
  now: () => Date.now(),
  /** Test hook: count POSTs to prove no auto-duplicate reply. */
  onPost: null,
};

const withInstagramCommentsTestHooks = async (overrides, fn) => {
  const prev = { ...hooks };
  Object.assign(hooks, overrides || {});
  try {
    return await withInstagramAuthTestHooks(overrides || {}, fn);
  } finally {
    Object.assign(hooks, prev);
  }
};

const igError = (message, code, status = 400) =>
  new AppError(stripSecrets(message), status, code);

const PAGING_URL_RE = /access_token=|appsecret_proof=/i;

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

const grantedPermissionsOf = (cred) => {
  if (Array.isArray(cred?.secret?.grantedPermissions)) {
    return cred.secret.grantedPermissions;
  }
  if (Array.isArray(cred?.config?.grantedPermissions)) {
    return cred.config.grantedPermissions;
  }
  return null;
};

const assertCommentsPermission = (cred) => {
  const granted = grantedPermissionsOf(cred);
  if (!granted || !granted.length) return;
  const missingBasic = missingPermissions(granted, [SCOPE_BASIC]);
  if (missingBasic.length) {
    throw igError(
      "Instagram denied this request. A required permission is missing — reconnect and grant access.",
      "INSTAGRAM_PERMISSION_DENIED",
      403
    );
  }
  const missing = missingPermissions(granted, [SCOPE_COMMENTS]);
  if (missing.length) {
    throw igError(
      "Instagram comments permission is missing. Reconnect and grant comments access.",
      "INSTAGRAM_PERMISSION_DENIED",
      403
    );
  }
};

const validateMediaId = (raw) => {
  const mediaId = String(raw == null ? "" : raw).trim();
  if (!mediaId) {
    throw igError("Enter a media id.", "INSTAGRAM_MEDIA_INVALID");
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(mediaId)) {
    throw igError(
      "Media id must be a safe Instagram media identifier.",
      "INSTAGRAM_MEDIA_INVALID"
    );
  }
  return mediaId;
};

const validateCommentId = (raw) => {
  const commentId = String(raw == null ? "" : raw).trim();
  if (!commentId) {
    throw igError("Enter a comment id.", "INSTAGRAM_COMMENT_INVALID");
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(commentId)) {
    throw igError(
      "Comment id must be a safe Instagram comment identifier.",
      "INSTAGRAM_COMMENT_INVALID"
    );
  }
  return commentId;
};

const normalizeMessage = (raw) => {
  const text = String(raw == null ? "" : raw).trim();
  if (!text) {
    throw igError("Reply message cannot be empty.", "INSTAGRAM_COMMENT_MESSAGE_INVALID");
  }
  if (text.length > MESSAGE_MAX) {
    throw igError(
      `Reply message must be at most ${MESSAGE_MAX} characters.`,
      "INSTAGRAM_COMMENT_MESSAGE_INVALID"
    );
  }
  return text;
};

const rowLimits = ({ limit, returnAll }) => {
  const all = returnAll === true || returnAll === "true";
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
        MAX_ROWS
      );
  return { returnAll: all, maxRows, maxPages: MAX_PAGES, pageSize: PAGE_SIZE };
};

const buildCommentMeta = ({
  operation,
  instagramUserId,
  mediaId,
  truncated,
}) => {
  const meta = {
    provider: "instagram",
    resource: "comments",
    operation: String(operation || ""),
    instagramUserId: String(instagramUserId || ""),
    apiVersion: API_VERSION,
  };
  if (mediaId) meta.mediaId = String(mediaId);
  if (truncated === true) meta.truncated = true;
  return meta;
};

const asOptionalNumber = (value) => {
  if (value == null || value === "") return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

/**
 * Normalize one Instagram comment/reply. Never fabricate likes/usernames/timestamps.
 */
const normalizeComment = (row, provenance = {}) => {
  const commentId = String(row?.id || row?.commentId || "").trim();
  if (!commentId) {
    throw igError(
      "Instagram comment is missing an id.",
      "INSTAGRAM_COMMENT_INVALID"
    );
  }
  const json = { commentId };

  const text = row?.text != null ? String(row.text) : undefined;
  if (text != null && text !== "") json.text = text;
  else if (row?.message != null && String(row.message) !== "") {
    json.text = String(row.message);
  }

  if (row?.timestamp != null && String(row.timestamp).trim()) {
    json.timestamp = String(row.timestamp);
  }
  if (row?.username != null && String(row.username).trim()) {
    json.username = String(row.username);
  }

  const likes = asOptionalNumber(row?.like_count ?? row?.likeCount);
  if (likes !== undefined) json.likeCount = likes;

  const repliesCount = asOptionalNumber(
    row?.replies?.summary?.total_count ??
      row?.replies?.count ??
      row?.repliesCount
  );
  if (repliesCount !== undefined) json.repliesCount = repliesCount;

  const parentCommentId = String(
    provenance.parentCommentId || row?.parent_id || row?.parentCommentId || ""
  ).trim();
  if (parentCommentId) json.parentCommentId = parentCommentId;

  const mediaId = String(
    provenance.mediaId || row?.media?.id || row?.mediaId || ""
  ).trim();
  if (mediaId) json.mediaId = mediaId;

  const from = row?.from;
  if (from && typeof from === "object") {
    const author = {};
    if (from.id != null && String(from.id).trim()) author.id = String(from.id);
    if (from.username != null && String(from.username).trim()) {
      author.username = String(from.username);
    }
    if (Object.keys(author).length) json.author = author;
  }

  if (provenance.status) json.status = String(provenance.status);

  json._meta = buildCommentMeta({
    operation: provenance.operation,
    instagramUserId: provenance.instagramUserId,
    mediaId: json.mediaId,
    truncated: provenance.truncated,
  });

  return assertNoSecretLeak(json);
};

const mapCommentsError = (err) => {
  const msg = String(err?.message || "");
  if (/comments? (are )?disabled|cannot comment|commenting is off/i.test(msg)) {
    return igError(
      "Comments are disabled for this Instagram media.",
      "INSTAGRAM_COMMENTS_DISABLED",
      403
    );
  }
  if (
    /does not exist|unsupported get request|object with id|invalid.*comment|invalid.*media/i.test(
      msg
    )
  ) {
    return igError(
      stripSecrets(msg) || "Instagram comment or media was not found.",
      "INSTAGRAM_COMMENT_NOT_FOUND",
      404
    );
  }
  return err;
};

const collectCommentPages = async ({
  credentialId,
  workspaceId,
  path,
  maxRows,
  maxPages,
  pageSize,
  returnAll,
  fields = COMMENT_FIELDS,
}) => {
  const rows = [];
  const seen = new Set();
  let after = "";
  let pages = 0;
  let more = false;

  while (rows.length < maxRows && pages < maxPages) {
    const remaining = maxRows - rows.length;
    const size = Math.min(pageSize, remaining);
    pages += 1;
    const query = { fields, limit: String(size) };
    if (after) query.after = after;
    let body;
    try {
      body = await instagramGraphGet({
        credentialId,
        workspaceId,
        path,
        query,
      });
    } catch (err) {
      throw mapCommentsError(err);
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
    const hasNext = Boolean(
      body?.paging && Object.prototype.hasOwnProperty.call(body.paging, "next")
    );
    if (!after || data.length === 0) {
      more = false;
      break;
    }
    if (!returnAll && data.length < size) {
      more = false;
      break;
    }
    if (returnAll && !hasNext && !after) {
      more = false;
      break;
    }
    more = true;
    if (rows.length >= maxRows) break;
  }

  const truncated = Boolean(more && (rows.length >= maxRows || pages >= maxPages));
  return { rows, truncated };
};

const listComments = async ({
  credentialId,
  workspaceId,
  instagramUserId,
  cred,
  mediaId,
  limit,
  returnAll,
}) => {
  assertCommentsPermission(cred);
  const id = validateMediaId(mediaId);
  const limits = rowLimits({ limit, returnAll });
  const fetched = await collectCommentPages({
    credentialId,
    workspaceId,
    path: `${id}/comments`,
    maxRows: limits.maxRows,
    maxPages: limits.maxPages,
    pageSize: limits.pageSize,
    returnAll: limits.returnAll,
  });
  return {
    rows: fetched.rows.map((row) =>
      normalizeComment(row, {
        operation: "list_comments",
        instagramUserId,
        mediaId: id,
        truncated: fetched.truncated,
      })
    ),
    truncated: fetched.truncated,
    mediaId: id,
  };
};

const listReplies = async ({
  credentialId,
  workspaceId,
  instagramUserId,
  cred,
  commentId,
  mediaId,
  limit,
  returnAll,
}) => {
  assertCommentsPermission(cred);
  const parentId = validateCommentId(commentId);
  const limits = rowLimits({ limit, returnAll });
  const fetched = await collectCommentPages({
    credentialId,
    workspaceId,
    path: `${parentId}/replies`,
    maxRows: limits.maxRows,
    maxPages: limits.maxPages,
    pageSize: limits.pageSize,
    returnAll: limits.returnAll,
  });
  return {
    rows: fetched.rows.map((row) =>
      normalizeComment(row, {
        operation: "list_replies",
        instagramUserId,
        mediaId: mediaId || undefined,
        parentCommentId: parentId,
        truncated: fetched.truncated,
      })
    ),
    truncated: fetched.truncated,
    parentCommentId: parentId,
  };
};

/**
 * Reply once — no automatic re-POST on uncertainty (avoids duplicate replies).
 */
const replyComment = async ({
  credentialId,
  workspaceId,
  instagramUserId,
  cred,
  commentId,
  message,
  mediaId,
}) => {
  assertCommentsPermission(cred);
  const parentId = validateCommentId(commentId);
  const text = normalizeMessage(message);

  if (typeof hooks.onPost === "function") {
    hooks.onPost({ path: `${parentId}/replies`, message: text });
  }

  let body;
  try {
    body = await instagramGraphPost({
      credentialId,
      workspaceId,
      path: `${parentId}/replies`,
      body: { message: text },
    });
  } catch (err) {
    // Do not retry POST here — failed/uncertain replies stay failed.
    throw mapCommentsError(err);
  }

  const createdId = String(body?.id || "").trim();
  if (!createdId) {
    throw igError(
      "Instagram did not return a reply comment id.",
      "INSTAGRAM_COMMENT_REPLY_FAILED"
    );
  }

  // Only use fields actually returned — do not invent username/timestamp.
  return normalizeComment(
    {
      id: createdId,
      text: body.text != null ? body.text : text,
      username: body.username,
      timestamp: body.timestamp,
      like_count: body.like_count,
      from: body.from,
    },
    {
      operation: "reply_comment",
      instagramUserId,
      mediaId: mediaId || undefined,
      parentCommentId: parentId,
      status: "replied",
    }
  );
};

const executeCommentsOperation = async ({
  operation,
  cred,
  credentialId,
  workspaceId,
  instagramUserId,
  data,
}) => {
  if (operation === "list_comments") {
    const fetched = await listComments({
      credentialId,
      workspaceId,
      instagramUserId,
      cred,
      mediaId: data.mediaId,
      limit: data.limit,
      returnAll: data.returnAll,
    });
    return {
      items: fetched.rows.map((json, index) => ({
        json,
        pairedItem: { item: 0, inputItemIndex: index },
      })),
      output: {
        resource: "comments",
        operation,
        instagramUserId,
        mediaId: fetched.mediaId,
        rowCount: fetched.rows.length,
        truncated: fetched.truncated,
      },
    };
  }

  if (operation === "list_replies") {
    const fetched = await listReplies({
      credentialId,
      workspaceId,
      instagramUserId,
      cred,
      commentId: data.commentId,
      mediaId: data.mediaId,
      limit: data.limit,
      returnAll: data.returnAll,
    });
    return {
      items: fetched.rows.map((json, index) => ({
        json,
        pairedItem: { item: 0, inputItemIndex: index },
      })),
      output: {
        resource: "comments",
        operation,
        instagramUserId,
        parentCommentId: fetched.parentCommentId,
        rowCount: fetched.rows.length,
        truncated: fetched.truncated,
      },
    };
  }

  if (operation === "reply_comment") {
    const json = await replyComment({
      credentialId,
      workspaceId,
      instagramUserId,
      cred,
      commentId: data.commentId,
      message: data.message ?? data.replyMessage ?? data.text,
      mediaId: data.mediaId,
    });
    return {
      items: [{ json, pairedItem: { item: 0 } }],
      output: {
        resource: "comments",
        operation,
        instagramUserId,
        commentId: json.commentId,
        parentCommentId: json.parentCommentId,
        status: "replied",
        rowCount: 1,
      },
    };
  }

  throw igError(
    `Unsupported Instagram comments operation: ${operation}`,
    "INSTAGRAM_OPERATION_UNSUPPORTED"
  );
};

module.exports = {
  DEFAULT_LIMIT,
  PAGE_SIZE,
  MAX_ROWS,
  MAX_PAGES,
  MESSAGE_MAX,
  COMMENT_FIELDS,
  withInstagramCommentsTestHooks,
  assertCommentsPermission,
  validateCommentId,
  validateMediaId,
  normalizeMessage,
  normalizeComment,
  listComments,
  listReplies,
  replyComment,
  executeCommentsOperation,
  rowLimits,
};
