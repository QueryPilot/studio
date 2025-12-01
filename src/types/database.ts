/**
 * Database Types - Frontend Display Only
 * All database operations are handled by Rust backend with connection pooling
 */

// Re-export canonical schema types from schema.ts
export type {
  ColumnMeta,
  ForeignKeyRef,
  EnhancedColumnMeta,
} from "./schema";

// Import for local use in interfaces below
import type { ColumnMeta } from "./schema";

export type DatabaseType =
  | "postgresql"
  | "mysql"
  | "sqlite"
  | "mssql"
  | "mariadb"
  | "mongodb";

/**
 * Connection configuration for display purposes only
 * Actual connections and passwords are managed securely by Rust backend
 */
export interface Tag {
  name: string;
  color: string;
}

export interface DatabaseConnection {
  id: string;
  name: string;
  type: DatabaseType;
  workspace: string; // Now workspace is just a string identifier
  tags: Tag[]; // Support for multiple tags with name and color
  order?: number; // Order for drag-and-drop sorting
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string; // Only used when creating/updating, never stored in frontend
  filepath?: string; // For SQLite
  ssl_mode?: string; // SSL mode for PostgreSQL/MySQL connections
  sslMode?: string; // Alternative property name for SSL mode
  // MSSQL specific
  instanceName?: string;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
  authType?: "windows" | "sql";
  namedPipe?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Connection status from backend
 */
export interface ConnectionStatus {
  isConnected: boolean;
  latency?: number;
}

export interface QueryResult {
  columns: string[];
  columnMeta?: ColumnMeta[];
  rows: any[][];
  rowCount: number;
  executionTime: number;
  affectedRows?: number; // For UPDATE, DELETE, INSERT queries
  message?: string; // For informational messages (e.g., "Query OK", DDL results)
  error?: string; // Error message if query failed
}

export interface TableInfo {
  name: string;
  schema?: string;
  type: "table" | "view" | "materialized_view";
  rowCount?: number;
}

export interface ViewInfo {
  name: string;
  schema: string;
  definition?: string;
}

export interface FunctionInfo {
  name: string;
  schema: string;
  returnType: string;
  arguments: string[];
}

export interface TriggerInfo {
  name: string;
  schema: string;
  table_name: string;
  event: string; // INSERT, UPDATE, DELETE
  timing: string; // BEFORE, AFTER, INSTEAD OF
  level: string; // ROW, STATEMENT
  enabled: boolean;
  function_name?: string;
  definition?: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  isUnique: boolean;
}
