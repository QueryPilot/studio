/**
 * AI Command Types
 *
 * Defines all structured output commands the AI agent can emit.
 * Supports SQL, MongoDB, and Redis databases.
 */

// ============================================================================
// Base Types
// ============================================================================

/**
 * AI Command Names
 *
 * Note: Read commands (sql.execute, sql.explain, mongodb.find, etc.) have been
 * removed. The AI agent now accesses database data through MCP tools instead
 * of structured commands. Only mutation and UI commands remain.
 */
export type AiCommandName =
  // Universal mutation commands
  | "crud.stage"
  // UI/Editor commands
  | "tab.update"
  | "tab.create"
  | "editor.insert";

export type CommandApprovalLevel = "auto" | "approve" | "dangerous";

export interface ParamSchema {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  required: boolean;
  description: string;
}

export interface AiCommandMeta {
  name: AiCommandName;
  paradigm: "sql" | "document" | "keyvalue" | "universal";
  approvalLevel: CommandApprovalLevel;
  description: string;
  params?: ParamSchema[];
}

/**
 * Command metadata for mutation and UI commands only.
 *
 * Read commands have been removed - AI agent now uses MCP tools for database access.
 */
export const COMMAND_META: Record<AiCommandName, AiCommandMeta> = {
  // Universal mutation command
  "crud.stage": {
    name: "crud.stage",
    paradigm: "universal",
    approvalLevel: "approve",
    description: "Stage database change",
    params: [
      { name: "connectionId", type: "string", required: true, description: "Database connection ID" },
      { name: "operation", type: "string", required: true, description: "Operation type: insert, update, or delete" },
      { name: "database", type: "string", required: false, description: "Database name" },
      { name: "schema", type: "string", required: false, description: "Schema name (SQL)" },
      { name: "table", type: "string", required: false, description: "Table name (SQL)" },
      { name: "collection", type: "string", required: false, description: "Collection name (MongoDB)" },
      { name: "document", type: "object", required: false, description: "Document to insert" },
      { name: "filter", type: "object", required: false, description: "Filter for update/delete" },
      { name: "update", type: "object", required: false, description: "Update data" },
      { name: "primaryKeys", type: "object", required: false, description: "Primary key values for delete" },
      { name: "description", type: "string", required: false, description: "Human-readable description" },
    ],
  },
  "tab.update": {
    name: "tab.update",
    paradigm: "universal",
    approvalLevel: "auto",
    description: "Update tab content",
    params: [
      { name: "tabId", type: "string", required: false, description: "Tab ID (defaults to active tab)" },
      { name: "content", type: "string", required: false, description: "New content" },
      { name: "title", type: "string", required: false, description: "New title" },
    ],
  },
  "tab.create": {
    name: "tab.create",
    paradigm: "universal",
    approvalLevel: "auto",
    description: "Create new tab",
    params: [
      { name: "connectionId", type: "string", required: true, description: "Database connection ID" },
      { name: "type", type: "string", required: true, description: "Tab type (query)" },
      { name: "title", type: "string", required: false, description: "Tab title" },
      { name: "content", type: "string", required: false, description: "Initial content" },
    ],
  },
  "editor.insert": {
    name: "editor.insert",
    paradigm: "universal",
    approvalLevel: "auto",
    description: "Insert at cursor",
    params: [
      { name: "text", type: "string", required: true, description: "Text to insert" },
      { name: "position", type: "string", required: false, description: "Position: cursor, end, or replace" },
    ],
  },
};

// ============================================================================
// Command Parameter Types
// ============================================================================

// Note: Read command parameter types (SqlExecuteParams, MongodbFindParams, etc.)
// have been removed. AI agent now uses MCP tools for database reads.

// Mutation Commands
export interface CrudStageParams {
  connectionId: string;
  database?: string;
  schema?: string;
  table?: string; // For SQL
  collection?: string; // For MongoDB
  operation: "insert" | "update" | "delete";
  // For insert
  document?: Record<string, unknown>;
  // For update
  filter?: Record<string, unknown>;
  update?: Record<string, unknown>;
  // For delete
  primaryKeys?: Record<string, unknown>;
  description?: string;
}

export interface TabUpdateParams {
  tabId?: string; // Optional, defaults to active tab
  content?: string; // New content (SQL, MongoDB query, etc.)
  title?: string;
}

export interface TabCreateParams {
  connectionId: string;
  type: "query";
  title?: string;
  content?: string;
}

export interface EditorInsertParams {
  text: string;
  position?: "cursor" | "end" | "replace";
}

// ============================================================================
// Command Result Types
// ============================================================================

// Note: Read command result types have been removed.
// AI agent now uses MCP tools for database reads.

export interface CrudStageResult {
  staged: boolean;
  commandId: string;
  tableKey: string;
}

export interface TabUpdateResult {
  success: boolean;
  tabId: string;
}

export interface TabCreateResult {
  success: boolean;
  tabId: string;
}

export interface EditorInsertResult {
  success: boolean;
}

// ============================================================================
// Parsed Command Type
// ============================================================================

export interface ParsedCommand<T = unknown> {
  id: string;
  name: AiCommandName;
  params: T;
  raw: string;
  startIndex: number;
  endIndex: number;
  error?: string;
}

export type AnyParsedCommand =
  | ParsedCommand<CrudStageParams>
  | ParsedCommand<TabUpdateParams>
  | ParsedCommand<TabCreateParams>
  | ParsedCommand<EditorInsertParams>;
