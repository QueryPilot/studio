/**
 * ACP Protocol Types
 *
 * Types for Agent Client Protocol (ACP) communication with AI coding agents.
 * Aligned with agent-client-protocol 0.9.x specification.
 */

// ============ Agent Information ============

export interface AgentInfo {
  id: string;
  name: string;
  path: string | null; // null if not installed
  version: string | null;
  acpArgs: string[];
  installed: boolean;
  installUrl: string | null;
  packages: PackageInfo[];
  models: ModelInfo[];
}

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
}

export interface PackageInfo {
  name: string;
  description: string;
  /** Package manager type: "npm" for npm/pnpm/yarn/bun, "brew" for homebrew */
  managerType: "npm" | "brew";
  /** Whether this package is already installed */
  installed: boolean;
  /** Currently installed version (e.g. "0.13.2") */
  installedVersion: string | null;
  /** Latest available version from registry */
  latestVersion: string | null;
  /** True when an update is available */
  updateAvailable: boolean;
}

/** Available package managers for npm-type packages */
export type NpmPackageManager = "npm" | "pnpm" | "yarn" | "bun";

// ============ Session Types ============

export interface AcpSession {
  id: string;
  agentId: string;
  instanceId: string;
  connectionId?: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

// ============ Message Types ============

export interface AcpMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  thinking?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed";
  input: Record<string, unknown>;
  output?: unknown;
}

// ============ Session Update Events ============

/**
 * Wrapper for session update events from the backend
 */
export interface SessionUpdateEvent {
  sessionId: string;
  update: SessionUpdate;
}

/**
 * SessionUpdate variants - matches actual ACP protocol enum (PascalCase)
 */
export type SessionUpdate =
  | { type: "AgentMessageChunk"; content: ContentChunk }
  | { type: "AgentThoughtChunk"; content: ContentChunk }
  | { type: "ToolCall"; toolCall: AcpToolCall }
  | { type: "ToolCallUpdate"; update: ToolCallUpdateData }
  | { type: "Plan"; plan: PlanData }
  | { type: "CurrentModeUpdate"; mode: ModeData }
  | { type: "AvailableCommandsUpdate"; commands: AvailableCommandsData }
  | { type: "UserMessageChunk"; content: ContentChunk }
  | { type: "Complete" } // Custom: emitted when stream ends
  | { type: "Error"; message: string } // Custom: emitted on error
  | { type: "Unknown" };

// ============ Content Types ============

/**
 * Content chunk for streaming text
 * Note: content can be a single block or array depending on the agent
 */
export interface ContentChunk {
  content: ContentBlock | ContentBlock[];
}

/**
 * ACP ContentBlock variants
 */
export type ContentBlock =
  | { type: "text"; text: string; annotations?: unknown }
  | { type: "image"; mimeType: string; data: string }
  | { type: "audio"; mimeType: string; data: string }
  | { type: "resourceLink"; uri: string; title?: string }
  | { type: "resource"; uri: string; content: unknown };

// ============ Tool Call Types ============

/**
 * Tool call from agent
 * Note: Different agents may use different field names
 * - id or tool_call_id or toolCallId
 * - name or tool_name or title
 * - input or arguments
 */
export interface AcpToolCall {
  // Standard ACP fields
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  // Alternate field names used by some agents
  tool_call_id?: string;
  tool_name?: string;
  arguments?: Record<string, unknown>;
  // Claude Code specific fields
  toolCallId?: string;
  title?: string;
  kind?: string;
  _meta?: {
    claudeCode?: {
      toolName?: string;
    };
  };
}

/**
 * Tool call status update
 * Note: Different agents may use different field names
 */
export interface ToolCallUpdateData {
  // Standard field
  toolCallId?: string;
  // Alternate field names
  tool_call_id?: string;
  id?: string;
  status?: "running" | "completed" | "failed";
  // Alternate status field
  state?: string;
  output?: unknown;
  error?: string;
}

// ============ Plan Types ============

/**
 * Agent's execution plan
 */
export interface PlanData {
  steps: PlanStep[];
}

export interface PlanStep {
  id: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed";
}

// ============ Mode Types ============

/**
 * Session mode (e.g., "plan", "act")
 */
export interface ModeData {
  mode: string;
}

// ============ Commands Types ============

/**
 * Available commands update
 */
export interface AvailableCommandsData {
  commands: string[];
}
