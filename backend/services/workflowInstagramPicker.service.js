/**
 * Instagram picker + publish staging helpers (M8.12).
 * Credential-scoped media/comment lists for the editor; media staging for Meta fetch URLs.
 * Does not change Graph node execution contracts.
 */

const path = require("path");
const multer = require("multer");
const AppError = require("../utils/AppError");
const {
  saveGeneratedMedia,
  publicMediaUrl,
} = require("./generatedMedia.service");
const {
  resolveCredentialContext,
  listMedia,
  validateMediaId,
} = require("./workflowInstagram.service");
const {
  listComments,
} = require("./workflowInstagramComments.service");

const MAX_STAGE_BYTES = 50 * 1024 * 1024;
const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
const VIDEO_EXT = new Set(["mp4", "mov", "webm"]);

const igPickerError = (message, code, status = 400) =>
  new AppError(message, status, code);

const extensionOf = (filename, mimeType) => {
  const fromName = path.extname(String(filename || "")).replace(/^\./, "").toLowerCase();
  if (fromName) return fromName;
  const mime = String(mimeType || "").toLowerCase();
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "video/mp4") return "mp4";
  if (mime === "video/quicktime") return "mov";
  if (mime === "video/webm") return "webm";
  return "";
};

const assertHttpsUrl = (raw) => {
  const url = String(raw || "").trim();
  if (!url) {
    throw igPickerError("Enter a media URL.", "INSTAGRAM_MEDIA_URL_REQUIRED");
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw igPickerError("Media URL is not valid.", "INSTAGRAM_MEDIA_URL_INVALID");
  }
  if (parsed.protocol !== "https:") {
    throw igPickerError(
      "Media URL must use HTTPS so Instagram can fetch it.",
      "INSTAGRAM_MEDIA_URL_HTTPS_REQUIRED"
    );
  }
  return url;
};

const captionSnippet = (caption, max = 72) => {
  const text = String(caption || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
};

const formatMediaOption = (row) => {
  const id = String(row?.id || row?.mediaId || "").trim();
  if (!id) return null;
  const caption = captionSnippet(row.caption);
  const mediaType = String(row.mediaType || row.media_type || "").trim();
  const timestamp = String(row.timestamp || "").trim();
  const thumb =
    String(row.thumbnailUrl || row.thumbnail_url || row.mediaUrl || row.media_url || "").trim();
  const labelParts = [];
  if (mediaType) labelParts.push(mediaType);
  if (caption) labelParts.push(`“${caption}”`);
  else labelParts.push(id);
  if (timestamp) {
    try {
      labelParts.push(
        new Date(timestamp).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      );
    } catch {
      // keep raw
    }
  }
  return {
    id,
    mediaId: id,
    label: labelParts.join(" — "),
    caption: row.caption ? String(row.caption) : undefined,
    captionSnippet: caption || undefined,
    mediaType: mediaType || undefined,
    timestamp: timestamp || undefined,
    thumbnailUrl: thumb || undefined,
  };
};

const formatCommentOption = (row) => {
  const id = String(row?.commentId || row?.id || "").trim();
  if (!id) return null;
  const username = String(row.username || "").trim();
  const text = captionSnippet(row.text || row.message, 64);
  const timestamp = String(row.timestamp || "").trim();
  let when = "";
  if (timestamp) {
    try {
      when = new Date(timestamp).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      when = "";
    }
  }
  const author = username ? `@${username}` : "Comment";
  const quote = text ? `“${text}”` : id;
  const label = when ? `${author} — ${quote} — ${when}` : `${author} — ${quote}`;
  return {
    id,
    commentId: id,
    label,
    username: username || undefined,
    text: row.text != null ? String(row.text) : undefined,
    timestamp: timestamp || undefined,
    repliesCount:
      row.repliesCount != null && Number.isFinite(Number(row.repliesCount))
        ? Number(row.repliesCount)
        : undefined,
  };
};

const PICKER_MEDIA_LIMIT = 25;

const listMediaOptions = async ({
  credentialId,
  workspaceId,
  limit = PICKER_MEDIA_LIMIT,
}) => {
  const { cred, instagramUserId } = await resolveCredentialContext({
    credentialId,
    workspaceId,
  });
  const result = await listMedia({
    credentialId,
    workspaceId,
    instagramUserId,
    returnAll: false,
    // Picker must stay bounded — never pull entire account history.
    limit: Math.min(Math.max(Number(limit) || PICKER_MEDIA_LIMIT, 1), 50),
  });
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const options = rows.map((row) => formatMediaOption(row)).filter(Boolean);
  return {
    instagramUserId,
    options,
    truncated: Boolean(result?.truncated),
    paging: result?.paging,
  };
};

const listCommentOptions = async ({
  credentialId,
  workspaceId,
  mediaId,
  limit = 50,
}) => {
  const { cred, instagramUserId } = await resolveCredentialContext({
    credentialId,
    workspaceId,
  });
  const mid = validateMediaId(mediaId);
  const result = await listComments({
    cred,
    credentialId,
    workspaceId,
    instagramUserId,
    mediaId: mid,
    returnAll: false,
    limit: Math.min(Math.max(Number(limit) || 50, 1), 100),
  });
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const options = rows.map((row) => formatCommentOption(row)).filter(Boolean);
  return {
    instagramUserId,
    mediaId: mid,
    options,
  };
};

const stagePublishMedia = async ({ buffer, originalName, mimeType, kind }) => {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw igPickerError("Upload a media file.", "INSTAGRAM_MEDIA_UPLOAD_REQUIRED");
  }
  if (buffer.length > MAX_STAGE_BYTES) {
    throw igPickerError(
      "Media file is too large (max 50MB).",
      "INSTAGRAM_MEDIA_UPLOAD_TOO_LARGE"
    );
  }
  const ext = extensionOf(originalName, mimeType);
  const want = String(kind || "").toLowerCase();
  if (want === "image" && !IMAGE_EXT.has(ext)) {
    throw igPickerError(
      "Upload an image (JPG, PNG, WEBP, or GIF).",
      "INSTAGRAM_MEDIA_UPLOAD_TYPE"
    );
  }
  if (want === "video" && !VIDEO_EXT.has(ext)) {
    throw igPickerError(
      "Upload a video (MP4, MOV, or WEBM).",
      "INSTAGRAM_MEDIA_UPLOAD_TYPE"
    );
  }
  if (!IMAGE_EXT.has(ext) && !VIDEO_EXT.has(ext)) {
    throw igPickerError(
      "Unsupported media type. Use an image or video file.",
      "INSTAGRAM_MEDIA_UPLOAD_TYPE"
    );
  }
  const saved = await saveGeneratedMedia({
    buffer,
    extension: ext,
    mimeType: mimeType || (IMAGE_EXT.has(ext) ? "image/jpeg" : "video/mp4"),
  });
  const url = publicMediaUrl(saved.publicPath);
  if (!String(url).startsWith("https://") && process.env.NODE_ENV === "production") {
    throw igPickerError(
      "Public HTTPS origin is not configured for media staging.",
      "INSTAGRAM_MEDIA_PUBLIC_ORIGIN"
    );
  }
  return {
    url,
    publicPath: saved.publicPath,
    filename: saved.filename,
    mimeType: saved.mimeType,
    sizeBytes: saved.sizeBytes,
    kind: IMAGE_EXT.has(ext) ? "image" : "video",
  };
};

const stageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_STAGE_BYTES, files: 1 },
});

module.exports = {
  assertHttpsUrl,
  formatMediaOption,
  formatCommentOption,
  listMediaOptions,
  listCommentOptions,
  stagePublishMedia,
  stageUpload,
  captionSnippet,
};
