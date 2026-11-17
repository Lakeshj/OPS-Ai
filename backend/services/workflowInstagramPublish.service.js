/**
 * Instagram Login content publishing (M5).
 * Uses Instagram-only GET/POST Graph helpers — never Meta Ads client.
 */

const { v4: uuidv4 } = require("uuid");
const net = require("node:net");
const { URL } = require("node:url");
const AppError = require("../utils/AppError");
const { pool } = require("../config/database");
const {
  SCOPE_BASIC,
  SCOPE_PUBLISH,
  API_VERSION,
} = require("../config/instagramGraph");
const {
  withInstagramAuthTestHooks,
  instagramGraphGet,
  instagramGraphPost,
  missingPermissions,
  stripSecrets,
} = require("./workflowInstagramAuth.service");
const {
  isLoopbackIp,
  isLinkLocalIp,
  isPrivateIp,
  isBlockedHostname,
} = require("./workflowHttpSecurity.service");

const CAPTION_MAX = 2200;
const CAROUSEL_MIN = 2;
const CAROUSEL_MAX = 10;
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 24;
const PUBLISH_STATUSES = Object.freeze([
  "container_created",
  "processing",
  "publish_attempted",
  "published",
  "failed",
]);

const hooks = {
  now: () => Date.now(),
  sleep: async (ms) =>
    new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0))),
  loadPublishRecord: null,
  savePublishRecord: null,
};

const withInstagramPublishTestHooks = async (overrides, fn) => {
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

const grantedPermissionsOf = (cred) => {
  if (Array.isArray(cred?.secret?.grantedPermissions)) {
    return cred.secret.grantedPermissions;
  }
  if (Array.isArray(cred?.config?.grantedPermissions)) {
    return cred.config.grantedPermissions;
  }
  return null;
};

const assertPublishPermission = (cred) => {
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
  const missingPublish = missingPermissions(granted, [SCOPE_PUBLISH]);
  if (missingPublish.length) {
    throw igError(
      "Instagram publishing permission is missing. Reconnect and grant content publishing access.",
      "INSTAGRAM_PERMISSION_DENIED",
      403
    );
  }
};

/**
 * Validate media URL for Instagram container creation.
 * HTTPS-only; no localhost/private/file/data; no credential-bearing URLs.
 * Does not fetch the URL (Meta retrieves it).
 */
const assertInstagramPublicMediaUrl = (raw, label = "Media URL") => {
  const text = String(raw || "").trim();
  if (!text) {
    throw igError(`${label} is required.`, "INSTAGRAM_MEDIA_URL_INVALID");
  }
  if (/^data:/i.test(text) || /^file:/i.test(text) || /^blob:/i.test(text)) {
    throw igError(
      `${label} must be a public HTTPS URL (not a local or data URL).`,
      "INSTAGRAM_MEDIA_URL_INVALID"
    );
  }
  let u;
  try {
    u = new URL(text);
  } catch {
    throw igError(`${label} is not a valid URL.`, "INSTAGRAM_MEDIA_URL_INVALID");
  }
  if (u.protocol !== "https:") {
    throw igError(`${label} must use HTTPS.`, "INSTAGRAM_MEDIA_URL_INVALID");
  }
  if (u.username || u.password) {
    throw igError(
      `${label} must not include credentials.`,
      "INSTAGRAM_MEDIA_URL_INVALID"
    );
  }
  const host = String(u.hostname || "").toLowerCase().replace(/\.$/, "");
  if (!host || isBlockedHostname(host)) {
    throw igError(
      `${label} host is not allowed.`,
      "INSTAGRAM_MEDIA_URL_INVALID"
    );
  }
  if (net.isIP(host)) {
    if (isLoopbackIp(host) || isLinkLocalIp(host) || isPrivateIp(host)) {
      throw igError(
        `${label} must not target a private or local network address.`,
        "INSTAGRAM_MEDIA_URL_INVALID"
      );
    }
  }
  return u.href;
};

const normalizeCaption = (raw) => {
  if (raw == null || raw === "") return undefined;
  const text = String(raw);
  if (text.length > CAPTION_MAX) {
    throw igError(
      `Caption must be at most ${CAPTION_MAX} characters.`,
      "INSTAGRAM_CAPTION_INVALID"
    );
  }
  return text;
};

const buildPublishMeta = ({ operation, instagramUserId }) => ({
  provider: "instagram",
  resource: "publish",
  operation: String(operation || ""),
  instagramUserId: String(instagramUserId || ""),
  apiVersion: API_VERSION,
});

const loadPublishRecordDb = async ({
  workspaceId,
  workflowId,
  nodeId,
  publishKey,
}) => {
  if (hooks.loadPublishRecord) {
    return hooks.loadPublishRecord({
      workspaceId,
      workflowId,
      nodeId,
      publishKey,
    });
  }
  const [rows] = await pool.execute(
    `SELECT * FROM workflow_instagram_publish_keys
     WHERE workspace_id = ? AND workflow_id = ? AND node_id = ? AND publish_key = ?
     LIMIT 1`,
    [workspaceId, workflowId, nodeId, publishKey]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workflowId: row.workflow_id,
    nodeId: row.node_id,
    runId: row.run_id,
    publishKey: row.publish_key,
    credentialId: row.credential_id,
    operation: row.operation,
    status: row.status,
    containerId: row.container_id,
    mediaId: row.media_id,
    childContainerIds: (() => {
      try {
        return JSON.parse(row.child_container_ids_json || "[]");
      } catch {
        return [];
      }
    })(),
    result: (() => {
      try {
        return row.result_json ? JSON.parse(row.result_json) : null;
      } catch {
        return null;
      }
    })(),
    errorCode: row.error_code,
    errorMessage: row.error_message,
  };
};

const savePublishRecordDb = async (record) => {
  if (hooks.savePublishRecord) {
    return hooks.savePublishRecord(record);
  }
  const id = record.id || uuidv4();
  const children = JSON.stringify(record.childContainerIds || []);
  const resultJson = record.result ? JSON.stringify(record.result) : null;
  await pool.execute(
    `INSERT INTO workflow_instagram_publish_keys (
      id, workspace_id, workflow_id, node_id, run_id, publish_key, credential_id,
      operation, status, container_id, media_id, child_container_ids_json,
      result_json, error_code, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      run_id = VALUES(run_id),
      credential_id = VALUES(credential_id),
      operation = VALUES(operation),
      status = VALUES(status),
      container_id = VALUES(container_id),
      media_id = VALUES(media_id),
      child_container_ids_json = VALUES(child_container_ids_json),
      result_json = VALUES(result_json),
      error_code = VALUES(error_code),
      error_message = VALUES(error_message)`,
    [
      id,
      record.workspaceId,
      record.workflowId,
      record.nodeId,
      record.runId || null,
      record.publishKey,
      record.credentialId,
      record.operation,
      record.status,
      record.containerId || null,
      record.mediaId || null,
      children,
      resultJson,
      record.errorCode || null,
      record.errorMessage ? stripSecrets(record.errorMessage).slice(0, 1000) : null,
    ]
  );
  return { ...record, id };
};

const getContentPublishingLimit = async ({
  credentialId,
  workspaceId,
  instagramUserId,
}) => {
  try {
    const body = await instagramGraphGet({
      credentialId,
      workspaceId,
      path: `${instagramUserId}/content_publishing_limit`,
      query: { fields: "config,quota_usage" },
    });
    const row = Array.isArray(body?.data) ? body.data[0] : body;
    if (!row || typeof row !== "object") return null;
    const quotaUsage =
      row.quota_usage == null ? null : Number(row.quota_usage);
    const quotaTotal =
      row.config?.quota_total == null ? null : Number(row.config.quota_total);
    return {
      quotaUsage: Number.isFinite(quotaUsage) ? quotaUsage : null,
      quotaTotal: Number.isFinite(quotaTotal) ? quotaTotal : null,
      rawConfig: row.config || undefined,
    };
  } catch (err) {
    // Endpoint may be unavailable for some apps/accounts — do not hard-fail publish.
    if (err?.code === "INSTAGRAM_PERMISSION_DENIED") throw err;
    return null;
  }
};

const assertPublishingQuota = async (ctx) => {
  const limit = await getContentPublishingLimit(ctx);
  if (
    limit &&
    limit.quotaTotal != null &&
    limit.quotaUsage != null &&
    limit.quotaUsage >= limit.quotaTotal
  ) {
    throw igError(
      `Instagram publishing quota exhausted (${limit.quotaUsage}/${limit.quotaTotal}).`,
      "INSTAGRAM_PUBLISH_QUOTA_EXCEEDED",
      429
    );
  }
  return limit;
};

const createMediaContainer = async ({
  credentialId,
  workspaceId,
  instagramUserId,
  fields,
}) => {
  const body = await instagramGraphPost({
    credentialId,
    workspaceId,
    path: `${instagramUserId}/media`,
    body: fields,
  });
  const containerId = String(body?.id || "").trim();
  if (!containerId) {
    throw igError(
      "Instagram did not return a media container id.",
      "INSTAGRAM_CONTAINER_INVALID"
    );
  }
  return containerId;
};

const getContainerStatus = async ({
  credentialId,
  workspaceId,
  containerId,
}) => {
  const body = await instagramGraphGet({
    credentialId,
    workspaceId,
    path: containerId,
    query: { fields: "status_code,status,id" },
  });
  return {
    id: String(body?.id || containerId),
    statusCode: String(body?.status_code || "").toUpperCase(),
    status: body?.status == null ? undefined : String(body.status),
  };
};

const waitForContainerReady = async ({
  credentialId,
  workspaceId,
  containerId,
  pollIntervalMs = POLL_INTERVAL_MS,
  maxAttempts = MAX_POLL_ATTEMPTS,
}) => {
  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    last = await getContainerStatus({
      credentialId,
      workspaceId,
      containerId,
    });
    const code = last.statusCode;
    if (code === "FINISHED" || code === "PUBLISHED") return last;
    if (code === "ERROR") {
      throw igError(
        last.status || "Instagram media container failed processing.",
        "INSTAGRAM_CONTAINER_ERROR"
      );
    }
    if (code === "EXPIRED") {
      throw igError(
        "Instagram media container expired. Create a new container.",
        "INSTAGRAM_CONTAINER_EXPIRED"
      );
    }
    // IN_PROGRESS or unknown — wait then retry
    if (attempt < maxAttempts) {
      await hooks.sleep(pollIntervalMs);
    }
  }
  throw igError(
    `Instagram media container is still processing after ${maxAttempts} checks.`,
    "INSTAGRAM_CONTAINER_TIMEOUT"
  );
};

const publishContainer = async ({
  credentialId,
  workspaceId,
  instagramUserId,
  containerId,
}) => {
  const body = await instagramGraphPost({
    credentialId,
    workspaceId,
    path: `${instagramUserId}/media_publish`,
    body: { creation_id: containerId },
  });
  const mediaId = String(body?.id || "").trim();
  if (!mediaId) {
    throw igError(
      "Instagram did not return a published media id.",
      "INSTAGRAM_PUBLISH_FAILED"
    );
  }
  return mediaId;
};

const fetchPublishedMedia = async ({
  credentialId,
  workspaceId,
  mediaId,
}) => {
  try {
    const body = await instagramGraphGet({
      credentialId,
      workspaceId,
      path: mediaId,
      query: { fields: "id,permalink,timestamp,media_type,media_product_type" },
    });
    return {
      permalink: body?.permalink ? String(body.permalink) : undefined,
      timestamp: body?.timestamp ? String(body.timestamp) : undefined,
      mediaType: body?.media_type ? String(body.media_type) : undefined,
    };
  } catch {
    return {};
  }
};

const finalizePublishedItem = async ({
  credentialId,
  workspaceId,
  instagramUserId,
  operation,
  mediaId,
  containerId,
  mediaType,
  childContainerIds,
  quota,
}) => {
  const extra = await fetchPublishedMedia({
    credentialId,
    workspaceId,
    mediaId,
  });
  const json = {
    mediaId,
    containerId,
    mediaType: mediaType || extra.mediaType || undefined,
    status: "published",
    permalink: extra.permalink,
    timestamp: extra.timestamp,
    _meta: buildPublishMeta({ operation, instagramUserId }),
  };
  if (Array.isArray(childContainerIds) && childContainerIds.length) {
    json.childContainerIds = childContainerIds;
  }
  if (quota && (quota.quotaUsage != null || quota.quotaTotal != null)) {
    json._meta.publishingQuota = {
      usage: quota.quotaUsage,
      total: quota.quotaTotal,
    };
  }
  return json;
};

const parseCarouselItems = (raw) => {
  let items = raw;
  if (typeof raw === "string") {
    try {
      items = JSON.parse(raw);
    } catch {
      throw igError(
        "Carousel items must be a JSON array.",
        "INSTAGRAM_CAROUSEL_INVALID"
      );
    }
  }
  if (!Array.isArray(items)) {
    throw igError(
      "Carousel items must be an array.",
      "INSTAGRAM_CAROUSEL_INVALID"
    );
  }
  if (items.length < CAROUSEL_MIN || items.length > CAROUSEL_MAX) {
    throw igError(
      `Carousel requires ${CAROUSEL_MIN}–${CAROUSEL_MAX} items.`,
      "INSTAGRAM_CAROUSEL_INVALID"
    );
  }
  return items.map((item, index) => {
    const type = String(item?.type || item?.mediaType || "IMAGE")
      .trim()
      .toUpperCase();
    if (type !== "IMAGE" && type !== "VIDEO") {
      throw igError(
        `Carousel item ${index + 1} type must be IMAGE or VIDEO.`,
        "INSTAGRAM_CAROUSEL_INVALID"
      );
    }
    const url = assertInstagramPublicMediaUrl(
      item?.mediaUrl || item?.imageUrl || item?.videoUrl || item?.url,
      `Carousel item ${index + 1} media URL`
    );
    return { type, mediaUrl: url };
  });
};

const beginIdempotentPublish = async ({
  workspaceId,
  workflowId,
  nodeId,
  runId,
  publishKey,
  credentialId,
  operation,
}) => {
  const key = String(publishKey || "").trim();
  if (!key) return { record: null, resume: null };
  if (!workspaceId || !workflowId || !nodeId) {
    throw igError(
      "publishKey requires workflow and node context.",
      "INSTAGRAM_PUBLISH_KEY_INVALID"
    );
  }
  const existing = await loadPublishRecordDb({
    workspaceId,
    workflowId,
    nodeId,
    publishKey: key,
  });
  if (existing?.status === "published" && existing.result) {
    return { record: existing, resume: "return_existing" };
  }
  if (
    existing &&
    (existing.status === "container_created" ||
      existing.status === "processing" ||
      existing.status === "publish_attempted") &&
    existing.containerId
  ) {
    return { record: existing, resume: "verify_or_publish" };
  }
  // Prior failed attempt with same key: allow a new attempt (new container).
  const record = {
    id: existing?.id || uuidv4(),
    workspaceId,
    workflowId,
    nodeId,
    runId: runId || null,
    publishKey: key,
    credentialId,
    operation,
    status: "container_created",
    containerId: null,
    mediaId: null,
    childContainerIds: [],
    result: null,
    errorCode: null,
    errorMessage: null,
  };
  await savePublishRecordDb(record);
  return { record, resume: "fresh" };
};

const markPublishState = async (record, patch) => {
  if (!record) return null;
  const next = { ...record, ...patch };
  await savePublishRecordDb(next);
  return next;
};

const publishImage = async (ctx) => {
  const imageUrl = assertInstagramPublicMediaUrl(ctx.imageUrl, "Image URL");
  const caption = normalizeCaption(ctx.caption);
  const fields = { image_url: imageUrl };
  if (caption != null) fields.caption = caption;
  if (ctx.altText != null && String(ctx.altText).trim()) {
    fields.alt_text = String(ctx.altText).trim().slice(0, 1000);
  }
  const containerId = await createMediaContainer({
    credentialId: ctx.credentialId,
    workspaceId: ctx.workspaceId,
    instagramUserId: ctx.instagramUserId,
    fields,
  });
  await markPublishState(ctx.record, {
    status: "processing",
    containerId,
  });
  const status = await waitForContainerReady({
    credentialId: ctx.credentialId,
    workspaceId: ctx.workspaceId,
    containerId,
    pollIntervalMs: ctx.pollIntervalMs,
    maxAttempts: ctx.maxPollAttempts,
  });
  if (status.statusCode === "PUBLISHED") {
    const mediaId = ctx.record?.mediaId || containerId;
    const json = await finalizePublishedItem({
      ...ctx,
      mediaId,
      containerId,
      mediaType: "IMAGE",
      operation: "publish_image",
    });
    await markPublishState(ctx.record, {
      status: "published",
      containerId,
      mediaId,
      result: json,
    });
    return json;
  }
  await markPublishState(ctx.record, {
    status: "publish_attempted",
    containerId,
  });
  const mediaId = await publishContainer({
    credentialId: ctx.credentialId,
    workspaceId: ctx.workspaceId,
    instagramUserId: ctx.instagramUserId,
    containerId,
  });
  const json = await finalizePublishedItem({
    ...ctx,
    mediaId,
    containerId,
    mediaType: "IMAGE",
    operation: "publish_image",
  });
  await markPublishState(ctx.record, {
    status: "published",
    containerId,
    mediaId,
    result: json,
  });
  return json;
};

const publishReel = async (ctx) => {
  const videoUrl = assertInstagramPublicMediaUrl(ctx.videoUrl, "Video URL");
  const caption = normalizeCaption(ctx.caption);
  const fields = {
    media_type: "REELS",
    video_url: videoUrl,
  };
  if (caption != null) fields.caption = caption;
  if (ctx.coverUrl) {
    fields.cover_url = assertInstagramPublicMediaUrl(ctx.coverUrl, "Cover URL");
  }
  if (ctx.shareToFeed === true || ctx.shareToFeed === "true") {
    fields.share_to_feed = "true";
  } else if (ctx.shareToFeed === false || ctx.shareToFeed === "false") {
    fields.share_to_feed = "false";
  }
  const containerId = await createMediaContainer({
    credentialId: ctx.credentialId,
    workspaceId: ctx.workspaceId,
    instagramUserId: ctx.instagramUserId,
    fields,
  });
  await markPublishState(ctx.record, { status: "processing", containerId });
  const status = await waitForContainerReady({
    credentialId: ctx.credentialId,
    workspaceId: ctx.workspaceId,
    containerId,
    pollIntervalMs: ctx.pollIntervalMs,
    maxAttempts: ctx.maxPollAttempts,
  });
  if (status.statusCode === "PUBLISHED") {
    const mediaId = ctx.record?.mediaId || containerId;
    const json = await finalizePublishedItem({
      ...ctx,
      mediaId,
      containerId,
      mediaType: "REELS",
      operation: "publish_reel",
    });
    await markPublishState(ctx.record, {
      status: "published",
      containerId,
      mediaId,
      result: json,
    });
    return json;
  }
  await markPublishState(ctx.record, {
    status: "publish_attempted",
    containerId,
  });
  const mediaId = await publishContainer({
    credentialId: ctx.credentialId,
    workspaceId: ctx.workspaceId,
    instagramUserId: ctx.instagramUserId,
    containerId,
  });
  const json = await finalizePublishedItem({
    ...ctx,
    mediaId,
    containerId,
    mediaType: "REELS",
    operation: "publish_reel",
  });
  await markPublishState(ctx.record, {
    status: "published",
    containerId,
    mediaId,
    result: json,
  });
  return json;
};

const publishStory = async (ctx) => {
  const mediaKind = String(ctx.storyMediaType || ctx.mediaType || "IMAGE")
    .trim()
    .toUpperCase();
  const fields = { media_type: "STORIES" };
  if (mediaKind === "VIDEO") {
    fields.video_url = assertInstagramPublicMediaUrl(
      ctx.videoUrl || ctx.mediaUrl,
      "Story video URL"
    );
  } else if (mediaKind === "IMAGE") {
    fields.image_url = assertInstagramPublicMediaUrl(
      ctx.imageUrl || ctx.mediaUrl,
      "Story image URL"
    );
  } else {
    throw igError(
      "Story media type must be IMAGE or VIDEO.",
      "INSTAGRAM_STORY_INVALID"
    );
  }
  const containerId = await createMediaContainer({
    credentialId: ctx.credentialId,
    workspaceId: ctx.workspaceId,
    instagramUserId: ctx.instagramUserId,
    fields,
  });
  await markPublishState(ctx.record, { status: "processing", containerId });
  const status = await waitForContainerReady({
    credentialId: ctx.credentialId,
    workspaceId: ctx.workspaceId,
    containerId,
    pollIntervalMs: ctx.pollIntervalMs,
    maxAttempts: ctx.maxPollAttempts,
  });
  if (status.statusCode === "PUBLISHED") {
    const mediaId = ctx.record?.mediaId || containerId;
    const json = await finalizePublishedItem({
      ...ctx,
      mediaId,
      containerId,
      mediaType: "STORIES",
      operation: "publish_story",
    });
    await markPublishState(ctx.record, {
      status: "published",
      containerId,
      mediaId,
      result: json,
    });
    return json;
  }
  await markPublishState(ctx.record, {
    status: "publish_attempted",
    containerId,
  });
  const mediaId = await publishContainer({
    credentialId: ctx.credentialId,
    workspaceId: ctx.workspaceId,
    instagramUserId: ctx.instagramUserId,
    containerId,
  });
  const json = await finalizePublishedItem({
    ...ctx,
    mediaId,
    containerId,
    mediaType: "STORIES",
    operation: "publish_story",
  });
  await markPublishState(ctx.record, {
    status: "published",
    containerId,
    mediaId,
    result: json,
  });
  return json;
};

const publishCarousel = async (ctx) => {
  const items = parseCarouselItems(ctx.carouselItems || ctx.items);
  const caption = normalizeCaption(ctx.caption);
  const childIds = [];
  try {
    for (const item of items) {
      const fields = { is_carousel_item: "true" };
      if (item.type === "VIDEO") {
        fields.media_type = "VIDEO";
        fields.video_url = item.mediaUrl;
      } else {
        fields.image_url = item.mediaUrl;
      }
      const childId = await createMediaContainer({
        credentialId: ctx.credentialId,
        workspaceId: ctx.workspaceId,
        instagramUserId: ctx.instagramUserId,
        fields,
      });
      await waitForContainerReady({
        credentialId: ctx.credentialId,
        workspaceId: ctx.workspaceId,
        containerId: childId,
        pollIntervalMs: ctx.pollIntervalMs,
        maxAttempts: ctx.maxPollAttempts,
      });
      childIds.push(childId);
    }
  } catch (err) {
    throw igError(
      stripSecrets(err?.message) ||
        "Carousel child container failed. Parent was not published.",
      err?.code || "INSTAGRAM_CAROUSEL_CHILD_FAILED",
      err?.status || 400
    );
  }

  const parentFields = {
    media_type: "CAROUSEL",
    children: childIds.join(","),
  };
  if (caption != null) parentFields.caption = caption;

  await markPublishState(ctx.record, {
    status: "processing",
    childContainerIds: childIds,
  });

  const containerId = await createMediaContainer({
    credentialId: ctx.credentialId,
    workspaceId: ctx.workspaceId,
    instagramUserId: ctx.instagramUserId,
    fields: parentFields,
  });
  await markPublishState(ctx.record, {
    status: "processing",
    containerId,
    childContainerIds: childIds,
  });
  await waitForContainerReady({
    credentialId: ctx.credentialId,
    workspaceId: ctx.workspaceId,
    containerId,
    pollIntervalMs: ctx.pollIntervalMs,
    maxAttempts: ctx.maxPollAttempts,
  });
  await markPublishState(ctx.record, {
    status: "publish_attempted",
    containerId,
    childContainerIds: childIds,
  });
  const mediaId = await publishContainer({
    credentialId: ctx.credentialId,
    workspaceId: ctx.workspaceId,
    instagramUserId: ctx.instagramUserId,
    containerId,
  });
  const json = await finalizePublishedItem({
    ...ctx,
    mediaId,
    containerId,
    mediaType: "CAROUSEL_ALBUM",
    childContainerIds: childIds,
    operation: "publish_carousel",
  });
  await markPublishState(ctx.record, {
    status: "published",
    containerId,
    mediaId,
    childContainerIds: childIds,
    result: json,
  });
  return json;
};

const resumeFromRecord = async (ctx, record) => {
  const containerId = record.containerId;
  if (!containerId) return null;
  const status = await waitForContainerReady({
    credentialId: ctx.credentialId,
    workspaceId: ctx.workspaceId,
    containerId,
    pollIntervalMs: ctx.pollIntervalMs,
    maxAttempts: ctx.maxPollAttempts,
  });
  if (status.statusCode === "PUBLISHED") {
    const mediaId = record.mediaId || containerId;
    const json = await finalizePublishedItem({
      ...ctx,
      mediaId,
      containerId,
      mediaType: record.result?.mediaType,
      childContainerIds: record.childContainerIds,
      operation: record.operation,
    });
    await markPublishState(record, {
      status: "published",
      mediaId,
      result: json,
    });
    return json;
  }
  await markPublishState(record, {
    status: "publish_attempted",
    containerId,
  });
  const mediaId = await publishContainer({
    credentialId: ctx.credentialId,
    workspaceId: ctx.workspaceId,
    instagramUserId: ctx.instagramUserId,
    containerId,
  });
  const json = await finalizePublishedItem({
    ...ctx,
    mediaId,
    containerId,
    mediaType: record.result?.mediaType,
    childContainerIds: record.childContainerIds,
    operation: record.operation,
  });
  await markPublishState(record, {
    status: "published",
    mediaId,
    result: json,
  });
  return json;
};

const executePublishOperation = async ({
  operation,
  cred,
  credentialId,
  workspaceId,
  instagramUserId,
  data,
  context,
  item,
}) => {
  assertPublishPermission(cred);
  const quota = await assertPublishingQuota({
    credentialId,
    workspaceId,
    instagramUserId,
  });

  const workflowId = String(context?.workflowId || data.workflowId || "").trim();
  const nodeId = String(context?.nodeId || data.nodeId || "").trim();
  const runId = String(context?.runId || data.runId || "").trim() || null;
  const publishKey = String(data.publishKey || "").trim();

  const { record, resume } = await beginIdempotentPublish({
    workspaceId,
    workflowId,
    nodeId,
    runId,
    publishKey,
    credentialId,
    operation,
  });

  if (resume === "return_existing" && record?.result) {
    return {
      json: { ...record.result, status: "published", idempotentReplay: true },
      replayed: true,
    };
  }

  const ctx = {
    credentialId,
    workspaceId,
    instagramUserId,
    record,
    quota,
    pollIntervalMs:
      data.pollIntervalMs != null ? Number(data.pollIntervalMs) : POLL_INTERVAL_MS,
    maxPollAttempts:
      data.maxPollAttempts != null
        ? Number(data.maxPollAttempts)
        : MAX_POLL_ATTEMPTS,
    imageUrl: data.imageUrl ?? item?.json?.imageUrl,
    videoUrl: data.videoUrl ?? item?.json?.videoUrl,
    mediaUrl: data.mediaUrl ?? item?.json?.mediaUrl,
    coverUrl: data.coverUrl ?? item?.json?.coverUrl,
    caption: data.caption ?? item?.json?.caption,
    altText: data.altText ?? item?.json?.altText,
    shareToFeed: data.shareToFeed,
    storyMediaType: data.storyMediaType ?? data.mediaType ?? item?.json?.mediaType,
    carouselItems: data.carouselItems ?? data.items ?? item?.json?.carouselItems,
  };

  try {
    if (resume === "verify_or_publish" && record) {
      const resumed = await resumeFromRecord(ctx, record);
      if (resumed) return { json: resumed, replayed: false };
    }

    let json;
    if (operation === "publish_image") json = await publishImage(ctx);
    else if (operation === "publish_reel") json = await publishReel(ctx);
    else if (operation === "publish_story") json = await publishStory(ctx);
    else if (operation === "publish_carousel") json = await publishCarousel(ctx);
    else {
      throw igError(
        `Unsupported Instagram publish operation: ${operation}`,
        "INSTAGRAM_OPERATION_UNSUPPORTED"
      );
    }
    return { json, replayed: false };
  } catch (err) {
    if (record) {
      await markPublishState(record, {
        status: "failed",
        errorCode: err?.code || "INSTAGRAM_PUBLISH_FAILED",
        errorMessage: err?.message || "Publish failed",
        // Do not keep a successful result on failure — prevents stale success output.
        result: null,
      });
    }
    throw err;
  }
};

module.exports = {
  CAPTION_MAX,
  CAROUSEL_MIN,
  CAROUSEL_MAX,
  POLL_INTERVAL_MS,
  MAX_POLL_ATTEMPTS,
  PUBLISH_STATUSES,
  withInstagramPublishTestHooks,
  assertInstagramPublicMediaUrl,
  assertPublishPermission,
  getContentPublishingLimit,
  getContainerStatus,
  waitForContainerReady,
  createMediaContainer,
  publishContainer,
  executePublishOperation,
  parseCarouselItems,
};
