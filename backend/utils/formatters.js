const formatUser = (user) => {
  const { password: _password, created_at, updated_at, ...safeUser } = user;
  return {
    ...safeUser,
    createdAt: created_at,
    updatedAt: updated_at,
  };
};

const formatWorkspace = (workspace) => ({
  ...workspace,
  createdBy: workspace.created_by,
  createdAt: workspace.created_at,
  updatedAt: workspace.updated_at,
  assignedUsers: workspace.assignedUsers || [],
});

const formatFolder = (row) => ({
  ...row,
  workspaceId: row.workspace_id,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const formatThread = (row) => ({
  ...row,
  workspaceId: row.workspace_id,
  folderId: row.folder_id,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const formatMessage = (row) => ({
  ...row,
  threadId: row.thread_id,
  isUserMessage: Boolean(row.is_user_message),
  createdAt: row.created_at,
});

const formatAssistant = (row) => ({
  ...row,
  taskType: row.task_type,
  capabilityType: row.capability_type,
  provider: row.provider || "openai",
  model: row.model,
  promptTemplate: row.prompt_template,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const formatDocument = (row) => ({
  id: row.id,
  workspaceId: row.workspace_id,
  uploadedBy: row.uploaded_by,
  originalName: row.original_name,
  storageKey: row.storage_key,
  markdownStorageKey: row.markdown_storage_key,
  mimeType: row.mime_type,
  fileExtension: row.file_extension,
  sizeBytes: Number(row.size_bytes),
  sha256: row.sha256,
  status: row.status,
  errorMessage: row.error_message,
  tokenCount: row.token_count == null ? null : Number(row.token_count),
  includedInSummary: Boolean(row.included_in_summary),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

module.exports = {
  formatUser,
  formatWorkspace,
  formatFolder,
  formatThread,
  formatMessage,
  formatAssistant,
  formatDocument,
};
