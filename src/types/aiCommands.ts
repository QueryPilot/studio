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
  | "crud.unstage"
  // Query execution
  | "query.run"
  // UI/Editor commands
  | "tab.update"
  | "tab.create"
  | "tab.focus"
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
      { name: "mode", type: "string", required: false, description: "How to apply content: replace, append, or prepend (default: replace)" },
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
  "tab.focus": {
    name: "tab.focus",
    paradigm: "universal",
    approvalLevel: "auto",
    description: "Focus/switch to a specific tab",
    params: [
      { name: "tabId", type: "string", required: true, description: "Tab ID to focus" },
    ],
  },
  "crud.unstage": {
    name: "crud.unstage",
    paradigm: "universal",
    approvalLevel: "auto",
    description: "Remove staged CRUD changes",
    params: [
      { name: "scope", type: "string", required: true, description: "Scope of unstaging: id, table, or all" },
      { name: "commandId", type: "string", required: false, description: "Command ID to unstage (when scope = id)" },
      { name: "table", type: "string", required: false, description: "Table name to unstage all commands for (when scope = table)" },
      { name: "connectionId", type: "string", required: false, description: "Filter by connection ID" },
    ],
  },
  "query.run": {
    name: "query.run",
    paradigm: "universal",
    approvalLevel: "approve",
    description: "Execute a query and display results",
    params: [
      { name: "connectionId", type: "string", required: true, description: "Database connection ID" },
      { name: "query", type: "string", required: true, description: "Query to execute" },
      { name: "title", type: "string", required: false, description: "Result panel title" },
      { name: "database", type: "string", required: false, description: "Database name" },
      { name: "schema", type: "string", required: false, description: "Schema name" },
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
  mode?: "replace" | "append" | "prepend"; // How to apply content update (default: replace)
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

export interface TabFocusParams {
  tabId: string;
}

export interface CrudUnstageParams {
  scope: "id" | "table" | "all";
  commandId?: string; // When scope = "id"
  table?: string; // When scope = "table"
  connectionId?: string; // Filter by connection
}

export interface QueryRunParams {
  connectionId: string;
  query: string;
  title?: string;
  database?: string;
  schema?: string;
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

export interface TabFocusResult {
  success: boolean;
  tabId: string;
  panelId: string;
}

export interface CrudUnstageResult {
  unstaged: boolean;
  count: number; // Number of commands unstaged
}

export interface QueryRunResult {
  success: boolean;
  tabId: string;
  rowCount?: number;
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
  /** Parser confidence. "low" means parsed from non-canonical command syntax. */
  confidence?: "high" | "low";
  error?: string;
}

export type AnyParsedCommand =
  | ParsedCommand<CrudStageParams>
  | ParsedCommand<CrudUnstageParams>
  | ParsedCommand<QueryRunParams>
  | ParsedCommand<TabUpdateParams>
  | ParsedCommand<TabCreateParams>
  | ParsedCommand<TabFocusParams>
  | ParsedCommand<EditorInsertParams>;
