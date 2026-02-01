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

export interface AiCommandMeta {
  name: AiCommandName;
  paradigm: "sql" | "document" | "keyvalue" | "universal";
  approvalLevel: CommandApprovalLevel;
  description: string;
}

export const COMMAND_META: Record<AiCommandName, AiCommandMeta> = {
  // SQL
  "sql.execute": {
    name: "sql.execute",
    paradigm: "sql",
    approvalLevel: "approve",
    description: "Execute SELECT query",
  },
  "sql.explain": {
    name: "sql.explain",
    paradigm: "sql",
    approvalLevel: "auto",
    description: "Explain query plan",
  },
  // MongoDB
  "mongodb.find": {
    name: "mongodb.find",
    paradigm: "document",
    approvalLevel: "approve",
    description: "Find documents",
  },
  "mongodb.aggregate": {
    name: "mongodb.aggregate",
    paradigm: "document",
    approvalLevel: "approve",
    description: "Run aggregation",
  },
  "mongodb.count": {
    name: "mongodb.count",
    paradigm: "document",
    approvalLevel: "auto",
    description: "Count documents",
  },
  // Redis
  "redis.get": {
    name: "redis.get",
    paradigm: "keyvalue",
    approvalLevel: "auto",
    description: "Get key value",
  },
  "redis.keys": {
    name: "redis.keys",
    paradigm: "keyvalue",
    approvalLevel: "auto",
    description: "List keys",
  },
  "redis.scan": {
    name: "redis.scan",
    paradigm: "keyvalue",
    approvalLevel: "approve",
    description: "Scan keys",
  },
  // Universal
  "crud.stage": {
    name: "crud.stage",
    paradigm: "universal",
    approvalLevel: "approve",
    description: "Stage database change",
  },
  "tab.update": {
    name: "tab.update",
    paradigm: "universal",
    approvalLevel: "auto",
    description: "Update tab content",
  },
  "tab.create": {
    name: "tab.create",
    paradigm: "universal",
    approvalLevel: "auto",
    description: "Create new tab",
  },
  "editor.insert": {
    name: "editor.insert",
    paradigm: "universal",
    approvalLevel: "auto",
    description: "Insert at cursor",
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
