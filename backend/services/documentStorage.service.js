const fs = require("fs/promises");
const path = require("path");
const zlib = require("zlib");
const { promisify } = require("util");
const config = require("../config");

const gunzip = promisify(zlib.gunzip);

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const getWorkspaceRoot = (workspaceId) =>
  path.join(config.storage.root, workspaceId);

const getOriginalsDir = (workspaceId) =>
  path.join(getWorkspaceRoot(workspaceId), "originals");

const getMarkdownDir = (workspaceId) =>
  path.join(getWorkspaceRoot(workspaceId), "markdown");

const toAbsolutePath = (storageKey) =>
  path.join(config.storage.root, storageKey);

const sanitizeFileBaseName = (originalName) => {
  const parsed = path.parse(String(originalName || "document"));
  const base = (parsed.name || "document")
    .normalize("NFKD")
    .replace(/[^\w.\-()+ ]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 80);

  return base || "document";
};

const shortId = (documentId) =>
  String(documentId || "")
    .replace(/-/g, "")
    .slice(0, 8);

const buildOriginalStorageKey = (
  workspaceId,
  documentId,
  originalName,
  extension
) => {
  const base = sanitizeFileBaseName(originalName);
  const id = shortId(documentId);
  const ext = String(extension || "bin").toLowerCase();
  return path
    .join(workspaceId, "originals", `${base}-${id}.${ext}`)
    .replace(/\\/g, "/");
};

const buildMarkdownStorageKey = (workspaceId, documentId, originalName) => {
  const base = sanitizeFileBaseName(originalName);
  const id = shortId(documentId);
  return path
    .join(workspaceId, "markdown", `${base}-${id}.md`)
    .replace(/\\/g, "/");
};

const persistBuffer = async (storageKey, buffer) => {
  const absolutePath = toAbsolutePath(storageKey);
  await ensureDir(path.dirname(absolutePath));
  await fs.writeFile(absolutePath, buffer);
  return absolutePath;
};

const persistText = async (storageKey, text) => {
  const buffer = Buffer.from(String(text), "utf8");
  await persistBuffer(storageKey, buffer);
  return buffer.length;
};

const readTextFile = async (storageKey) => {
  const absolutePath = toAbsolutePath(storageKey);
  const buffer = await fs.readFile(absolutePath);
  if (String(storageKey).endsWith(".gz")) {
    return (await gunzip(buffer)).toString("utf8");
  }
  return buffer.toString("utf8");
};

const removeIfExists = async (storageKey) => {
  if (!storageKey) return;
  const absolutePath = toAbsolutePath(storageKey);
  try {
    await fs.unlink(absolutePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
};

module.exports = {
  ensureDir,
  getWorkspaceRoot,
  getOriginalsDir,
  getMarkdownDir,
  toAbsolutePath,
  sanitizeFileBaseName,
  buildOriginalStorageKey,
  buildMarkdownStorageKey,
  persistBuffer,
  persistText,
  readTextFile,
  removeIfExists,
};
