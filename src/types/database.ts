/**
 * Database Types - Frontend Display Only
 * All database operations are handled by Rust backend with connection pooling
 */

export type DatabaseType = 'postgresql' | 'mysql' | 'sqlite';

/**
 * Connection configuration for display purposes only
 * Actual connections and passwords are managed securely by Rust backend
 */
export interface DatabaseConnection {
  id: string;
  name: string;
  type: DatabaseType;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string; // Only used when creating/updating, never stored in frontend
  filepath?: string; // For SQLite
  ssl_mode?: string; // SSL mode for PostgreSQL/MySQL connections
  sslMode?: string; // Alternative property name for SSL mode
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

export interface ConnectionProfile {
  id: string;
  name: string;
  color?: string;
  connections: DatabaseConnection[];
}

export interface QueryResult {
  columns: string[];
  rows: any[][];
  rowCount: number;
  executionTime: number;
}

export interface TableInfo {
  name: string;
  schema?: string;
  type: 'table' | 'view' | 'materialized_view';
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

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  isUnique: boolean;
}