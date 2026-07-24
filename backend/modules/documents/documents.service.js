const { v4: uuidv4 } = require("uuid");
const { pool } = require("../../config/database");
const config = require("../../config");
const AppError = require("../../utils/AppError");
const { formatDocument } = require("../../utils/formatters");
const {
  assertWorkspaceAccess,
  assertWorkspaceManageAccess,
} = require("../../services/authorization.service");
const {
  buildOriginalStorageKey,
  persistBuffer,
  removeIfExists,
} = require("../../services/documentStorage.service");
const {
  queueDocumentConversion,
  convertDocumentById,
  rebuildWorkspaceStaticMemory,
} = require("../../services/documentProcessing.service");

const getByIdRaw = async (documentId) => {
  const [rows] = await pool.execute(
    "SELECT * FROM workspace_documents WHERE id = ?",
    [documentId]
  );
  if (rows.length === 0) {
    throw new AppError("Document not found", 404, "NOT_FOUND");
  }
  return rows[0];
};

const listByWorkspace = async (workspaceId, authUser) => {
  await assertWorkspaceAccess(authUser, workspaceId);

  const [rows] = await pool.execute(
    `
    SELECT *
    FROM workspace_documents
    WHERE workspace_id = ?
    ORDER BY created_at DESC
    `,
    [workspaceId]
  );

  return rows.map(formatDocument);
};

const getById = async (documentId, authUser) => {
  const document = await getByIdRaw(documentId);
  await assertWorkspaceAccess(authUser, document.workspace_id);
  return formatDocument(document);
};

const getWorkspaceUsageBytes = async (workspaceId) => {
  const [rows] = await pool.execute(
    `
    SELECT COALESCE(SUM(size_bytes), 0) AS total_bytes
    FROM workspace_documents
    WHERE workspace_id = ?
    `,
    [workspaceId]
  );
  return Number(rows[0].total_bytes || 0);
};

const createFromUpload = async (workspaceId, authUser, file, uploadMeta) => {
  await assertWorkspaceManageAccess(authUser, workspaceId);

  const usageBytes = await getWorkspaceUsageBytes(workspaceId);
  if (usageBytes + uploadMeta.sizeBytes > config.storage.maxWorkspaceBytes) {
    throw new AppError(
      "Workspace static-memory quota exceeded",
      400,
      "QUOTA_EXCEEDED"
    );
  }

  const [duplicates] = await pool.execute(
    `
    SELECT id
    FROM workspace_documents
    WHERE workspace_id = ? AND sha256 = ?
    LIMIT 1
    `,
    [workspaceId, uploadMeta.sha256]
  );
  if (duplicates.length > 0) {
    throw new AppError(
      "This file was already uploaded to the workspace",
      409,
      "DUPLICATE_DOCUMENT"
    );
  }

  const documentId = uuidv4();
  const storageKey = buildOriginalStorageKey(
    workspaceId,
    documentId,
    uploadMeta.originalName,
    uploadMeta.extension
  );

  await persistBuffer(storageKey, file.buffer);

  try {
    await pool.execute(
      `
      INSERT INTO workspace_documents (
        id,
        workspace_id,
        uploaded_by,
        original_name,
        storage_key,
        mime_type,
        file_extension,
        size_bytes,
        sha256,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploaded')
      `,
      [
        documentId,
        workspaceId,
        authUser.userId,
        uploadMeta.originalName,
        storageKey,
        uploadMeta.mimeType,
        uploadMeta.extension,
        uploadMeta.sizeBytes,
        uploadMeta.sha256,
      ]
    );
  } catch (error) {
    await removeIfExists(storageKey);
    throw error;
  }

  queueDocumentConversion(documentId);
  return getById(documentId, authUser);
};

const reconvert = async (documentId, authUser) => {
  const document = await getByIdRaw(documentId);
  await assertWorkspaceManageAccess(authUser, document.workspace_id);

  if (!document.storage_key) {
    throw new AppError(
      "Original file was removed after conversion. Re-upload the document to convert again.",
      400,
      "ORIGINAL_REMOVED"
    );
  }

  const result = await convertDocumentById(documentId);
  return {
    ...result,
    document: await getById(documentId, authUser),
  };
};

const remove = async (documentId, authUser) => {
  const document = await getByIdRaw(documentId);
  await assertWorkspaceManageAccess(authUser, document.workspace_id);

  await pool.execute("DELETE FROM workspace_documents WHERE id = ?", [
    documentId,
  ]);
  await removeIfExists(document.storage_key);
  await removeIfExists(document.markdown_storage_key);
  await rebuildWorkspaceStaticMemory(document.workspace_id, authUser.userId);
  // Summary refresh is manual via "Regenerate from files" in Workspace Edit.

  return { message: "Document deleted successfully" };
};

module.exports = {
  listByWorkspace,
  getById,
  createFromUpload,
  reconvert,
  remove,
};
