/**
 * Stable OpsAi GSC MCP plugin contracts (Phase 1 → Phase 2).
 * Runtime is CommonJS JS; this file documents the long-term API.
 */

export type McpTransportKind = "stdio" | "native" | "mock";

export type ToolCategory = "data" | "intelligence" | "action";

export type ToolSource = "external" | "opsai" | "native";

export interface OpsAiMcpTool {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  category: ToolCategory;
  source: ToolSource;
  write?: boolean;
  externalName?: string;
}

export interface AuthContext {
  workspaceId?: string;
  credentialId?: string;
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  grantedScopes?: string[];
  accountEmail?: string;
}

export interface NormalizedMcpResult {
  toolId: string;
  ok: boolean;
  data: unknown;
  warnings: string[];
  error?: { code: string; message: string };
  raw?: unknown;
}

export interface McpSession {
  listTools(): Promise<OpsAiMcpTool[]>;
  callTool(
    name: string,
    args?: Record<string, unknown>
  ): Promise<NormalizedMcpResult>;
  close(): Promise<void>;
}

export interface McpTransport {
  connect(auth: AuthContext): Promise<McpSession>;
}

export type PluginErrorCode =
  | "MCP_UNAVAILABLE"
  | "MCP_TOOL_FAILED"
  | "MCP_AUTH_REQUIRED"
  | "MCP_TOOL_BLOCKED"
  | "MCP_SCOPE_INSUFFICIENT"
  | "MCP_VALIDATION";
