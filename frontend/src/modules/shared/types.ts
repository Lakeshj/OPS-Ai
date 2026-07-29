export type UserRole = 'Admin' | 'Project Manager' | 'Employee';

export interface UserCapabilities {
  /** Present only for platform owner emails from server env */
  manageSystemPromptLifecycle?: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  password?: string; // Not returned from API
  role: UserRole;
  capabilities?: UserCapabilities;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  createdBy: string; // User ID
  createdAt: string;
  updatedAt: string;
  assignedUsers: string[]; // Array of user IDs
}

export type WorkspaceDocumentStatus =
  | "uploaded"
  | "converting"
  | "ready"
  | "failed";

export interface WorkspaceDocument {
  id: string;
  workspaceId: string;
  uploadedBy: string | null;
  originalName: string;
  storageKey: string;
  markdownStorageKey: string | null;
  mimeType: string;
  fileExtension: string;
  sizeBytes: number;
  sha256: string;
  status: WorkspaceDocumentStatus;
  errorMessage: string | null;
  tokenCount: number | null;
  includedInSummary: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Folder {
  id: string;
  name: string;
  workspaceId: string;
  createdBy: string; // User ID
  createdAt: string;
  updatedAt: string;
  isExpanded?: boolean;
}

// Keep legacy alias for backward compatibility
export type ThreadFolder = Folder;

export interface ChatThread {
  id: string;
  name: string;
  workspaceId: string;
  folderId?: string; // Optional folder assignment
  createdBy: string; // User ID
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  content: string;
  isUserMessage: boolean;
  createdAt: string;
}

export interface KeywordAssistant {
  id: string;
  name: string;
  taskType: string;
  capabilityType: string;
  provider?: string;
  model: string;
  promptTemplate: string;
  description: string;
  qualityScore?: number | null;
  qualityFeedback?: string | null;
  qualityDetails?: Record<string, unknown> | null;
  qualityModel?: string | null;
  qualityEvaluatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SystemPromptSpecialty =
  | "chat"
  | "image_prompt"
  | "video_prompt"
  | "keywords"
  | "image"
  | "video"
  | "audio"
  | "custom";

export interface SystemPrompt {
  id: string;
  useCaseKey: string;
  name: string;
  description: string;
  promptContent: string;
  config: Record<string, unknown>;
  isActive: boolean;
  /** Built-in product use cases cannot be deleted */
  builtIn?: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSummaryCategoryScore {
  score: number;
  feedback: string;
  label?: string;
}

export interface WorkspaceSummaryEvaluation {
  score: number;
  feedback: string;
  categories?: Record<string, WorkspaceSummaryCategoryScore | number>;
  categoryOrder?: string[];
  strengths?: string[];
  gaps?: string[];
  recommendations?: string[];
  confidence?: string | null;
  confidenceReason?: string | null;
}

export interface WorkspaceSummary {
  workspaceId: string;
  version: number;
  content: string;
  source: "auto" | "manual" | "restored";
  documentSnapshot: string[];
  evaluationScore: number | null;
  evaluationFeedback: string | null;
  evaluationDetails: WorkspaceSummaryEvaluation | null;
  summaryModel: string | null;
  evaluationModel: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSummaryVersion
  extends Omit<WorkspaceSummary, "updatedBy" | "updatedAt"> {
  id: string;
  createdBy: string | null;
}

export interface WorkspaceSummaryResponse {
  summary: WorkspaceSummary | null;
  versions: WorkspaceSummaryVersion[];
  activeScoringCategories?: string[];
}

export interface AdminAiSettings {
  summaryModel: string;
  evaluationModel: string;
  evaluationPrompt: string;
  updatedBy: string | null;
  updatedAt: string;
}

// Legacy type alias for backward compatibility
export type Project = Workspace;
