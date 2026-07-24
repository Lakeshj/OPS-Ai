const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const config = require("../config");

const mediaRoot = path.resolve(
  path.dirname(config.storage.root),
  "generated-media"
);

const ensureMediaRoot = async () => {
  await fs.mkdir(mediaRoot, { recursive: true });
};

const saveGeneratedMedia = async ({
  buffer,
  extension = "mp4",
  mimeType = "video/mp4",
}) => {
  await ensureMediaRoot();
  const id = randomUUID();
  const filename = `${id}.${String(extension).replace(/^\./, "")}`;
  const fullPath = path.join(mediaRoot, filename);
  await fs.writeFile(fullPath, buffer);
  return {
    id,
    filename,
    mimeType,
    sizeBytes: buffer.length,
    absolutePath: fullPath,
    publicPath: `/api/generated-media/${filename}`,
  };
};

const resolveMediaFile = async (filename) => {
  const safe = path.basename(String(filename || ""));
  if (!safe || safe !== filename) return null;
  const fullPath = path.join(mediaRoot, safe);
  try {
    await fs.access(fullPath);
    return fullPath;
  } catch {
    return null;
  }
};

const publicMediaUrl = (publicPath) => {
  const origin =
    process.env.PUBLIC_API_ORIGIN ||
    `http://localhost:${config.port}`;
  return `${origin.replace(/\/$/, "")}${publicPath}`;
};

const mimeFromExt = (ext) => {
  const e = String(ext || "").toLowerCase().replace(/^\./, "");
  if (e === "mp4") return "video/mp4";
  if (e === "webm") return "video/webm";
  if (e === "png") return "image/png";
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (e === "webp") return "image/webp";
  if (e === "gif") return "image/gif";
  return "application/octet-stream";
};

const kindFromExt = (ext) => {
  const e = String(ext || "").toLowerCase().replace(/^\./, "");
  if (["mp4", "webm", "ogg", "mov"].includes(e)) return "video";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(e)) return "image";
  return "other";
};

const listGeneratedMedia = async () => {
  await ensureMediaRoot();
  const names = await fs.readdir(mediaRoot);
  const items = await Promise.all(
    names.map(async (filename) => {
      const fullPath = path.join(mediaRoot, filename);
      try {
        const stat = await fs.stat(fullPath);
        if (!stat.isFile()) return null;
        const ext = path.extname(filename);
        const publicPath = `/api/generated-media/${filename}`;
        return {
          filename,
          kind: kindFromExt(ext),
          mimeType: mimeFromExt(ext),
          sizeBytes: stat.size,
          createdAt: stat.birthtime?.toISOString?.() || stat.mtime.toISOString(),
          updatedAt: stat.mtime.toISOString(),
          publicPath,
          url: publicMediaUrl(publicPath),
        };
      } catch {
        return null;
      }
    })
  );

  return items
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
};

const deleteGeneratedMedia = async (filename) => {
  const fullPath = await resolveMediaFile(filename);
  if (!fullPath) return false;
  await fs.unlink(fullPath);
  return true;
};

const getGeneratedMediaStats = async () => {
  const items = await listGeneratedMedia();
  const totalBytes = items.reduce((sum, row) => sum + Number(row.sizeBytes || 0), 0);
  return {
    count: items.length,
    totalBytes,
    imageCount: items.filter((row) => row.kind === "image").length,
    videoCount: items.filter((row) => row.kind === "video").length,
  };
};

module.exports = {
  mediaRoot,
  ensureMediaRoot,
  saveGeneratedMedia,
  resolveMediaFile,
  publicMediaUrl,
  listGeneratedMedia,
  deleteGeneratedMedia,
  getGeneratedMediaStats,
};
