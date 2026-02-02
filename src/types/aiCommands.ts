/**
 * AI Command Types
 *
 * Defines all structured output commands the AI agent can emit.
 * Supports SQL, MongoDB, and Redis databases.
 */

// ============================================================================
// Base Types
// ============================================================================

export type AiCommandName =
  // SQL commands
  | "sql.execute"
  | "sql.explain"
  // MongoDB commands
  | "mongodb.find"
  | "mongodb.aggregate"
  | "mongodb.count"
  // Redis commands
  | "redis.get"
  | "redis.keys"
  | "redis.scan"
  // Universal commands
  | "crud.stage"
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

export const COMMAND_META: Record<AiCommandName, AiCommandMeta> = {
  // SQL
  "sql.execute": {
    name: "sql.execute",
    paradigm: "sql",
    approvalLevel: "auto",
    description: "Execute SELECT query",
    params: [
      { name: "connectionId", type: "string", required: true, description: "Database connection ID" },
      { name: "sql", type: "string", required: true, description: "SQL query to execute" },
      { name: "limit", type: "number", required: false, description: "Max rows to return (default: 100, max: 1000)" },
    ],
  },
  "sql.explain": {
    name: "sql.explain",
    paradigm: "sql",
    approvalLevel: "auto",
    description: "Explain query plan",
    params: [
      { name: "connectionId", type: "string", required: true, description: "Database connection ID" },
      { name: "sql", type: "string", required: true, description: "SQL query to explain" },
    ],
  },
  // MongoDB
  "mongodb.find": {
    name: "mongodb.find",
    paradigm: "document",
    approvalLevel: "approve",
    description: "Find documents",
    params: [
      { name: "connectionId", type: "string", required: true, description: "Database connection ID" },
      { name: "collection", type: "string", required: true, description: "Collection name" },
      { name: "filter", type: "object", required: false, description: "Query filter" },
      { name: "projection", type: "object", required: false, description: "Fields to include/exclude" },
      { name: "sort", type: "object", required: false, description: "Sort order" },
      { name: "limit", type: "number", required: false, description: "Max documents (default: 20, max: 100)" },
    ],
  },
  "mongodb.aggregate": {
    name: "mongodb.aggregate",
    paradigm: "document",
    approvalLevel: "approve",
    description: "Run aggregation",
    params: [
      { name: "connectionId", type: "string", required: true, description: "Database connection ID" },
      { name: "collection", type: "string", required: true, description: "Collection name" },
      { name: "pipeline", type: "array", required: true, description: "Aggregation pipeline stages" },
    ],
  },
  "mongodb.count": {
    name: "mongodb.count",
    paradigm: "document",
    approvalLevel: "auto",
    description: "Count documents",
    params: [
      { name: "connectionId", type: "string", required: true, description: "Database connection ID" },
      { name: "collection", type: "string", required: true, description: "Collection name" },
      { name: "filter", type: "object", required: false, description: "Query filter" },
    ],
  },
  // Redis
  "redis.get": {
    name: "redis.get",
    paradigm: "keyvalue",
    approvalLevel: "auto",
    description: "Get key value",
    params: [
      { name: "connectionId", type: "string", required: true, description: "Database connection ID" },
      { name: "key", type: "string", required: true, description: "Redis key to get" },
    ],
  },
  "redis.keys": {
    name: "redis.keys",
    paradigm: "keyvalue",
    approvalLevel: "auto",
    description: "List keys",
    params: [
      { name: "connectionId", type: "string", required: true, description: "Database connection ID" },
      { name: "pattern", type: "string", required: false, description: "Key pattern (default: *)" },
      { name: "limit", type: "number", required: false, description: "Max keys (default: 100)" },
    ],
  },
  "redis.scan": {
    name: "redis.scan",
    paradigm: "keyvalue",
    approvalLevel: "approve",
    description: "Scan keys",
    params: [
      { name: "connectionId", type: "string", required: true, description: "Database connection ID" },
      { name: "pattern", type: "string", required: false, description: "Key pattern" },
      { name: "count", type: "number", required: false, description: "Count hint per iteration" },
      { name: "cursor", type: "string", required: false, description: "Scan cursor" },
    ],
  },
  // Universal
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

// SQL Commands
export interface SqlExecuteParams {
  connectionId: string;
  sql: string;
  limit?: number; // Default 100, max 1000
}

export interface SqlExplainParams {
  connectionId: string;
  sql: string;
}

// MongoDB Commands
export interface MongodbFindParams {
  connectionId: string;
  collection: string;
  filter?: Record<string, unknown>;
  projection?: Record<string, 0 | 1>;
  sort?: Record<string, 1 | -1>;
  limit?: number; // Default 20, max 100
}

export interface MongodbAggregateParams {
  connectionId: string;
  collection: string;
  pipeline: Record<string, unknown>[];
}

export interface MongodbCountParams {
  connectionId: string;
  collection: string;
  filter?: Record<string, unknown>;
}

// Redis Commands
export interface RedisGetParams {
  connectionId: string;
  key: string;
}

export interface RedisKeysParams {
  connectionId: string;
  pattern?: string; // Default "*"
  limit?: number; // Default 100
}

export interface RedisScanParams {
  connectionId: string;
  pattern?: string;
  count?: number;
  cursor?: string;
}

// Universal Commands
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

export interface SqlExecuteResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  executionTimeMs: number;
  truncated: boolean;
}

export interface SqlExplainResult {
  plan: string;
  executionTimeMs: number;
}

export interface MongodbFindResult {
  documents: Record<string, unknown>[];
  count: number;
  executionTimeMs: number;
  truncated: boolean;
}

export interface MongodbAggregateResult {
  results: Record<string, unknown>[];
  executionTimeMs: number;
}

export interface MongodbCountResult {
  count: number;
  executionTimeMs: number;
}

export interface RedisGetResult {
  key: string;
  type: "string" | "hash" | "list" | "set" | "zset" | "stream" | "none";
  value: unknown;
  ttl: number | null; // -1 = no expiry, -2 = key doesn't exist
}

export interface RedisKeysResult {
  keys: string[];
  count: number;
  truncated: boolean;
}

export interface RedisScanResult {
  keys: string[];
  cursor: string;
  done: boolean;
}

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
  | ParsedCommand<SqlExecuteParams>
  | ParsedCommand<SqlExplainParams>
  | ParsedCommand<MongodbFindParams>
  | ParsedCommand<MongodbAggregateParams>
  | ParsedCommand<MongodbCountParams>
  | ParsedCommand<RedisGetParams>
  | ParsedCommand<RedisKeysParams>
  | ParsedCommand<RedisScanParams>
  | ParsedCommand<CrudStageParams>
  | ParsedCommand<TabUpdateParams>
  | ParsedCommand<TabCreateParams>
  | ParsedCommand<EditorInsertParams>;
