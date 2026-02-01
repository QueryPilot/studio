/**
 * AI Context Types
 *
 * Types for AI panel context and @ mentions.
 * Supports lightweight connection context + detailed on-demand mentions.
 */

import type { TabMetadata } from "./workbench";
import type { DatabaseParadigm } from "./connection";

// =============================================================================
// Connection Context (lightweight - names only)
// =============================================================================

export interface AISchemaContext {
  name: string;
  tables: string[];
  views: string[];
  functions: string[];
}

/**
 * MongoDB collection info for AI context
 */
export interface AIMongoCollection {
  name: string;
  documentCount?: number;
  indexes: string[];
  sampleFields: string[]; // Field names from sample document
}

/**
 * Redis key pattern info for AI context
 */
export interface AIRedisKeyPattern {
  pattern: string;
  count: number;
  types: Array<"string" | "hash" | "list" | "set" | "zset" | "stream">;
  sampleKeys?: string[]; // A few example keys
}

export interface AIConnectionContext {
  id: string;
  name: string;
  dbType: string;
  database: string;
  paradigm: DatabaseParadigm;
  /** SQL schemas with tables/views/functions (for sql paradigm) */
  schemas: AISchemaContext[];
  /** MongoDB collections (for document paradigm) */
  collections?: AIMongoCollection[];
  /** Redis key patterns (for keyvalue paradigm) */
  keyPatterns?: AIRedisKeyPattern[];
}

export interface AIContext {
  /** All connections in the workspace */
  connections: AIConnectionContext[];
  /** Currently focused connection ID */
  focusedConnectionId: string | null;
  /** Detailed info for @-mentioned objects */
  mentions: AIMention[];
}

// =============================================================================
// @ Mention Types (detailed - on demand)
// =============================================================================

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue?: string;
  isPrimaryKey: boolean;
  isUnique: boolean;
  comment?: string;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
  type?: string; // btree, hash, gin, etc.
}

export interface TriggerInfo {
  name: string;
  event: string; // INSERT, UPDATE, DELETE
  timing: string; // BEFORE, AFTER, INSTEAD OF
  definition?: string;
}

export interface ForeignKeyInfo {
  name: string;
  columns: string[];
  referencedTable: string;
  referencedSchema?: string;
  referencedColumns: string[];
  onUpdate?: string;
  onDelete?: string;
}

export interface ConstraintInfo {
  name: string;
  type: "PRIMARY KEY" | "UNIQUE" | "CHECK" | "FOREIGN KEY" | "EXCLUDE";
  columns: string[];
  definition?: string;
}

export interface ParameterInfo {
  name: string;
  dataType: string;
  mode: "IN" | "OUT" | "INOUT";
  defaultValue?: string;
}

// -----------------------------------------------------------------------------
// Table Mention
// -----------------------------------------------------------------------------

export interface TableMention {
  type: "table";
  name: string;
  schema: string;
  connectionId: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  triggers: TriggerInfo[];
  foreignKeys: ForeignKeyInfo[];
  constraints: ConstraintInfo[];
  comment?: string;
  rowCount?: number;
}

// -----------------------------------------------------------------------------
// View Mention
// -----------------------------------------------------------------------------

export interface ViewMention {
  type: "view";
  name: string;
  schema: string;
  connectionId: string;
  columns: ColumnInfo[];
  definition?: string; // View SQL definition
  isMaterialized: boolean;
}

// -----------------------------------------------------------------------------
// Function/Procedure Mention
// -----------------------------------------------------------------------------

export interface FunctionMention {
  type: "function";
  name: string;
  schema: string;
  connectionId: string;
  signature: string;
  parameters: ParameterInfo[];
  returnType: string;
  language?: string;
  definition?: string; // Function body if available
  isAggregate: boolean;
  isProcedure: boolean;
}

// -----------------------------------------------------------------------------
// Tab Mention
// -----------------------------------------------------------------------------

export interface TabMention {
  type: "tab";
  id: string; // tabId for later interaction
  panelId: string; // Panel containing this tab
  name: string; // Display name
  tabType: string; // "table" | "query" | "function" | etc.
  connectionId?: string;
  database?: string;
  schema?: string;
  table?: string; // For table/view tabs
  sql?: string; // For query tabs - current SQL content
  metadata: TabMetadata; // Full metadata for flexibility
}

// -----------------------------------------------------------------------------
// Union Type
// -----------------------------------------------------------------------------

export type AIMention =
  | TableMention
  | ViewMention
  | FunctionMention
  | TabMention;

// =============================================================================
// Mention Reference (parsed from input)
// =============================================================================

export interface MentionReference {
  type: "table" | "view" | "function" | "tab";
  name: string;
  schema?: string;
  connectionId?: string;
  /** Original text in input (e.g., "@users" or "@public.users") */
  raw: string;
  /** Start position in input string */
  start: number;
  /** End position in input string */
  end: number;
}
