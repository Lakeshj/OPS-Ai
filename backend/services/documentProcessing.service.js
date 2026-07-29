const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const { pool } = require("../config/database");
const AppError = require("../utils/AppError");
const {
  buildMarkdownStorageKey,
  persistText,
  removeIfExists,
} = require("./documentStorage.service");
const {
  convertStoredDocumentToMarkdown,
} = require("./documentConversion.service");
const {
  chunkMarkdown,
  estimateTokenCount,
} = require("./documentChunking.service");

// Keep a stable ~3k-token core prefix so prompt caching is eligible (>1,024
// tokens), while the retrieval layer supplies question-specific detail.
const CORE_MEMORY_MAX_CHARS = 12000;

const setDocumentStatus = async (
  documentId,
  {
    status,
    errorMessage = null,
    markdownStorageKey = null,
    tokenCount = null,
    clearOriginal = false,
    sizeBytes = null,
  }
) => {
  await pool.execute(
    `
    UPDATE workspace_documents
    SET
      status = ?,
      error_message = ?,
      markdown_storage_key = COALESCE(?, markdown_storage_key),
      token_count = COALESCE(?, token_count),
      size_bytes = COALESCE(?, size_bytes),
      storage_key = IF(?, NULL, storage_key),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    [
      status,
      errorMessage,
      markdownStorageKey,
      tokenCount,
      sizeBytes,
      clearOriginal ? 1 : 0,
      documentId,
    ]
  );
};

const replaceChunks = async (documentId, chunks) => {
  await pool.execute("DELETE FROM document_chunks WHERE document_id = ?", [
    documentId,
  ]);

  for (const [index, chunk] of chunks.entries()) {
    await pool.execute(
      `
      INSERT INTO document_chunks (
        id,
        document_id,
        chunk_index,
        heading,
        content,
        content_hash,
        token_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        uuidv4(),
        documentId,
        index,
        chunk.heading,
        chunk.content,
        chunk.contentHash,
        chunk.tokenCount,
      ]
    );
  }
};

const rebuildWorkspaceStaticMemory = async (workspaceId, updatedBy = null) => {
  const [docs] = await pool.execute(
    `
    SELECT id, original_name, markdown_storage_key, token_count
    FROM workspace_documents
    WHERE workspace_id = ? AND status = 'ready' AND markdown_storage_key IS NOT NULL
    ORDER BY created_at ASC
    `,
    [workspaceId]
  );

  const sections = [];
  let remainingChars = CORE_MEMORY_MAX_CHARS;

  for (const doc of docs) {
    if (remainingChars <= 0) break;

    const [chunks] = await pool.execute(
      `
      SELECT content
      FROM document_chunks
      WHERE document_id = ?
      ORDER BY chunk_index ASC
      LIMIT 50
      `,
      [doc.id]
    );

    const heading = `## ${doc.original_name}\n\n`;
    const availableForDocument = Math.max(
      0,
      remainingChars - heading.length
    );
    const fullPreview = chunks.map((chunk) => chunk.content).join("\n\n");
    const preview =
      fullPreview.length > availableForDocument
        ? `${fullPreview.slice(0, availableForDocument)}\n\n_[Additional content available through retrieval.]_`
        : fullPreview;
    const section = `${heading}${preview || "_No preview available._"}`;
    sections.push(section);
    remainingChars -= section.length;
  }

  const coreMarkdown =
    sections.length > 0
      ? `# Workspace Static Memory\n\n${sections.join("\n\n---\n\n")}`
      : "# Workspace Static Memory\n\n_No ready documents yet._";

  const contentHash = crypto
    .createHash("sha256")
    .update(coreMarkdown)
    .digest("hex");

  const [existing] = await pool.execute(
    "SELECT workspace_id, content_hash, version FROM workspace_static_memory WHERE workspace_id = ?",
    [workspaceId]
  );

  if (existing.length === 0) {
    await pool.execute(
      `
      INSERT INTO workspace_static_memory (
        workspace_id,
        version,
        core_markdown,
        content_hash,
        updated_by
      ) VALUES (?, 1, ?, ?, ?)
      `,
      [workspaceId, coreMarkdown, contentHash, updatedBy]
    );
    return;
  }

  if (existing[0].content_hash === contentHash) return;

  await pool.execute(
    `
    UPDATE workspace_static_memory
    SET
      version = version + 1,
      core_markdown = ?,
      content_hash = ?,
      updated_by = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE workspace_id = ?
    `,
    [coreMarkdown, contentHash, updatedBy, workspaceId]
  );
};

const convertDocumentById = async (documentId) => {
  const [rows] = await pool.execute(
    "SELECT * FROM workspace_documents WHERE id = ?",
    [documentId]
  );
  if (rows.length === 0) {
    throw new AppError("Document not found", 404, "NOT_FOUND");
  }

  const document = rows[0];
  await setDocumentStatus(documentId, {
    status: "converting",
    errorMessage: null,
  });

  let markdownStorageKey = null;

  try {
    if (!document.storage_key) {
      throw new AppError(
        "Original file was removed after conversion. Re-upload the document to convert again.",
        400,
        "ORIGINAL_REMOVED"
      );
    }

    const markdown = await convertStoredDocumentToMarkdown(document);
    markdownStorageKey = buildMarkdownStorageKey(
      document.workspace_id,
      document.id,
      document.original_name
    );

    // Replace any previous markdown file for this document.
    if (
      document.markdown_storage_key &&
      document.markdown_storage_key !== markdownStorageKey
    ) {
      await removeIfExists(document.markdown_storage_key);
    }

    const markdownBytes = await persistText(markdownStorageKey, markdown);

    const chunks = chunkMarkdown(markdown);
    await replaceChunks(document.id, chunks);

    const tokenCount = estimateTokenCount(markdown);
    await setDocumentStatus(documentId, {
      status: "ready",
      errorMessage: null,
      markdownStorageKey,
      tokenCount,
      sizeBytes: markdownBytes,
      clearOriginal: true,
    });

    // Keep only readable Markdown permanently.
    await removeIfExists(document.storage_key);

    await rebuildWorkspaceStaticMemory(
      document.workspace_id,
      document.uploaded_by
    );

    // Refresh scored workspace summary so new/corrected files affect AI readiness.
    const {
      queueSummaryRegeneration,
    } = require("./workspaceSummary.service");
    queueSummaryRegeneration(document.workspace_id, document.uploaded_by);

    return {
      id: documentId,
      status: "ready",
      tokenCount,
      chunkCount: chunks.length,
      markdownBytes,
    };
  } catch (error) {
    if (markdownStorageKey) {
      await removeIfExists(markdownStorageKey);
    }

    await setDocumentStatus(documentId, {
      status: "failed",
      errorMessage: String(error.message || "Conversion failed").slice(0, 1000),
    });

    throw error;
  }
};

const queueDocumentConversion = (documentId) => {
  setImmediate(() => {
    convertDocumentById(documentId).catch((error) => {
      console.error(
        `[document-conversion] Failed for ${documentId}:`,
        error.message
      );
    });
  });
};

const resumePendingDocumentConversions = async () => {
  // Free disk for documents already converted successfully.
  const [readyWithOriginals] = await pool.execute(
    `
    SELECT id, storage_key
    FROM workspace_documents
    WHERE status = 'ready' AND storage_key IS NOT NULL
    `
  );

  for (const row of readyWithOriginals) {
    await removeIfExists(row.storage_key);
    await pool.execute(
      `
      UPDATE workspace_documents
      SET storage_key = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [row.id]
    );
  }

  if (readyWithOriginals.length > 0) {
    console.info(
      `[document-conversion] Removed ${readyWithOriginals.length} original(s) after successful conversion`
    );
  }

  const [rows] = await pool.execute(
    `
    SELECT id
    FROM workspace_documents
    WHERE status IN ('uploaded', 'converting')
    ORDER BY created_at ASC
    `
  );

  if (rows.length > 0) {
    console.info(
      `[document-conversion] Resuming ${rows.length} pending document(s)`
    );
  }

  for (const row of rows) {
    queueDocumentConversion(row.id);
  }
};

module.exports = {
  convertDocumentById,
  queueDocumentConversion,
  resumePendingDocumentConversions,
  rebuildWorkspaceStaticMemory,
};
