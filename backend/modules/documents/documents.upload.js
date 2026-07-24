const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const config = require("../../config");
const AppError = require("../../utils/AppError");

const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "txt",
  "md",
]);

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/markdown",
  "application/octet-stream",
]);

const sanitizeOriginalName = (originalName) => {
  const base = path.basename(originalName || "upload");
  return base.replace(/[^\w.\-()+\s]/g, "_").slice(0, 255);
};

const getExtension = (originalName) => {
  const ext = path.extname(originalName || "").replace(".", "").toLowerCase();
  return ext;
};

const startsWithBytes = (buffer, bytes) =>
  bytes.every((byte, index) => buffer[index] === byte);

const looksLikeUtf8Text = (buffer) => {
  if (!buffer.length) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 2048));
  // Reject obvious binary control characters except common whitespace.
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 7 || (byte > 13 && byte < 32)) return false;
  }
  return true;
};

const detectKindFromMagic = (buffer, extension) => {
  if (startsWithBytes(buffer, [0x25, 0x50, 0x44, 0x46])) {
    return extension === "pdf" ? "pdf" : null;
  }

  // ZIP-based Office Open XML
  if (startsWithBytes(buffer, [0x50, 0x4b, 0x03, 0x04])) {
    if (["docx", "xlsx", "pptx"].includes(extension)) return extension;
    return null;
  }

  // Legacy OLE compound document is no longer accepted for upload.
  if (startsWithBytes(buffer, [0xd0, 0xcf, 0x11, 0xe0])) {
    return null;
  }

  if (["txt", "md"].includes(extension) && looksLikeUtf8Text(buffer)) {
    return extension;
  }

  return null;
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.storage.maxFileSizeBytes,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const extension = getExtension(file.originalname);
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return cb(
        new AppError(
          "Unsupported file type. Allowed: PDF, DOCX, XLSX, PPTX, TXT, MD",
          400,
          "INVALID_FILE_TYPE"
        )
      );
    }

    if (file.mimetype && !ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(
        new AppError("Unsupported MIME type for upload", 400, "INVALID_MIME")
      );
    }

    return cb(null, true);
  },
});

const validateUploadedFile = (req, res, next) => {
  try {
    if (!req.file) {
      throw new AppError("File is required", 400, "VALIDATION_ERROR");
    }

    const extension = getExtension(req.file.originalname);
    const kind = detectKindFromMagic(req.file.buffer, extension);
    if (!kind) {
      throw new AppError(
        "File content does not match the declared file type",
        400,
        "INVALID_FILE_CONTENT"
      );
    }

    req.uploadMeta = {
      originalName: sanitizeOriginalName(req.file.originalname),
      extension,
      mimeType: req.file.mimetype || "application/octet-stream",
      sizeBytes: req.file.size,
      sha256: crypto.createHash("sha256").update(req.file.buffer).digest("hex"),
    };

    return next();
  } catch (error) {
    return next(error);
  }
};

const singleUpload = [
  upload.single("file"),
  (err, req, res, next) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return next(
          new AppError(
            `File exceeds the ${Math.floor(
              config.storage.maxFileSizeBytes / (1024 * 1024)
            )}MB limit`,
            400,
            "FILE_TOO_LARGE"
          )
        );
      }
      return next(new AppError(err.message, 400, "UPLOAD_ERROR"));
    }
    return next(err);
  },
  validateUploadedFile,
];

module.exports = {
  singleUpload,
  ALLOWED_EXTENSIONS,
};
