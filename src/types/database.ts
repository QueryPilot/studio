/**
 * Database Types - Frontend Display Only
 * All database operations are handled by Rust backend with connection pooling
 */

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

// Legacy ConnectionProfile interface - deprecated in favor of workspace string in DatabaseConnection
export interface ConnectionProfile {
  id: string;
  name: string;
  color?: string;
  connections: DatabaseConnection[];
}

export interface ColumnMeta {
  name: string;
  db_type: string;
  nullable: boolean;
  default: string | null;
  is_pk: boolean;
  is_fk: boolean;
  ordinal: number;
  precision?: number | null;
  scale?: number | null;
  comment?: string | null;
  // MSSQL specific
  is_identity?: boolean;
  is_computed?: boolean;
  is_hierarchyid?: boolean;
  is_spatial?: boolean;
  // MySQL/MariaDB specific
  is_json?: boolean;
  enum_values?: string[];
  set_values?: string[];
  is_virtual?: boolean;
  // PostgreSQL custom types
  type_category?: string; // 'enum', 'domain', 'composite', 'base', 'range', 'multirange'
}

export interface ForeignKeyRef {
  constraint_name: string;
  referenced_schema: string;
  referenced_table: string;
  referenced_column: string;
  on_delete: string;
  on_update: string;
}

export interface EnhancedColumnMeta extends ColumnMeta {
  fk_reference?: ForeignKeyRef | null;
  check_constraint?: string | null;
  character_maximum_length?: number | null;
  is_unique: boolean;
  is_indexed: boolean;
  comment?: string | null;
}

export interface QueryResult {
  columns: string[];
  columnMeta?: ColumnMeta[];
  rows: any[][];
  rowCount: number;
  executionTime: number;
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
