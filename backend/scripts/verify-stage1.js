const fs = require("fs/promises");
const { pool } = require("../config/database");
const {
  assemblePrompt,
} = require("../services/promptAssembler.service");
const {
  toAbsolutePath,
} = require("../services/documentStorage.service");

const pass = (message) => console.log(`PASS  ${message}`);
const info = (message) => console.log(`INFO  ${message}`);

const verify = async () => {
  const [workspaces] = await pool.query(`
    SELECT
      w.id,
      w.name,
      sm.version,
      CHAR_LENGTH(sm.core_markdown) AS memory_chars,
      (
        SELECT COUNT(*)
        FROM workspace_documents d
        WHERE d.workspace_id = w.id AND d.status = 'ready'
      ) AS ready_documents,
      (
        SELECT COUNT(*)
        FROM document_chunks c
        INNER JOIN workspace_documents d ON d.id = c.document_id
        WHERE d.workspace_id = w.id AND d.status = 'ready'
      ) AS chunk_count
    FROM workspaces w
    INNER JOIN workspace_static_memory sm ON sm.workspace_id = w.id
    WHERE EXISTS (
      SELECT 1
      FROM workspace_documents d
      WHERE d.workspace_id = w.id AND d.status = 'ready'
    )
    ORDER BY memory_chars DESC
    LIMIT 1
  `);

  if (workspaces.length === 0) {
    throw new Error("No workspace with ready documents was found");
  }

  const workspace = workspaces[0];
  pass(`Workspace found: ${workspace.name} (${workspace.id})`);
  pass(
    `Static memory v${workspace.version}: ${workspace.memory_chars} characters`
  );
  pass(
    `${workspace.ready_documents} ready document(s), ${workspace.chunk_count} chunk(s)`
  );

  const [[summary]] = await pool.execute(
    `
    SELECT
      version,
      CHAR_LENGTH(content) AS summary_chars,
      evaluation_score,
      JSON_LENGTH(document_snapshot) AS document_count
    FROM workspace_summaries
    WHERE workspace_id = ?
    `,
    [workspace.id]
  );
  if (!summary) {
    throw new Error("Workspace summary has not been generated");
  }
  pass(
    `Workspace summary v${summary.version}: ${summary.summary_chars} characters, score ${summary.evaluation_score ?? "pending"}`
  );

  const [documents] = await pool.execute(
    `
    SELECT original_name, storage_key, markdown_storage_key, status
    FROM workspace_documents
    WHERE workspace_id = ? AND status = 'ready'
    ORDER BY created_at ASC
    `,
    [workspace.id]
  );

  for (const document of documents) {
    if (document.storage_key !== null) {
      throw new Error(
        `Ready document still keeps original: ${document.original_name}`
      );
    }
    if (!document.markdown_storage_key?.endsWith(".md")) {
      throw new Error(
        `Ready document lacks readable .md path: ${document.original_name}`
      );
    }
    await fs.access(toAbsolutePath(document.markdown_storage_key));
    pass(`Readable Markdown exists: ${document.markdown_storage_key}`);
  }

  const [threads] = await pool.execute(
    `
    SELECT id, name
    FROM chat_threads
    WHERE workspace_id = ?
    ORDER BY created_at ASC
    LIMIT 1
    `,
    [workspace.id]
  );

  if (threads.length === 0) {
    info("No chat thread exists in this workspace; prompt dry-run skipped");
  } else {
    const thread = threads[0];
    const assembled = await assemblePrompt({
      workspaceId: workspace.id,
      threadId: thread.id,
      prompt: "What does the workspace documentation describe?",
      assistant: null,
    });

    pass(`Prompt assembled for thread: ${thread.name} (${thread.id})`);
    pass(`Cache key: ${assembled.promptCacheKey}`);
    pass(
      `${assembled.messages.length} prompt message(s), ${assembled.retrievedChunks.length} retrieved chunk(s)`
    );
    pass(
      assembled.messages[0]?.content?.includes("Workspace Summary")
        ? "Stable prefix contains Workspace Summary"
        : "Stable prefix assembled"
    );
  }

  const [[counts]] = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM chat_session_memory) AS session_memories,
      (SELECT COUNT(*) FROM ai_usage_events) AS usage_events
  `);
  info(`${counts.session_memories} session-memory row(s)`);
  info(`${counts.usage_events} AI usage event(s)`);

  pass("Stage 1 dry-run verification completed");
};

verify()
  .catch((error) => {
    console.error(`FAIL  ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
