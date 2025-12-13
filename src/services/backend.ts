import { logger } from "@/lib/logger";
import { invoke } from "@tauri-apps/api/core";
import type { ConnectionProfile } from "@/types/connection";
import type {
  CrudCommand,
  CrudOperationType,
  CommitResult,
} from "@/types/crud";
import { nanoid } from "nanoid";

// Database Types
export enum DbType {
  PostgreSQL = "PostgreSQL",
  MySQL = "MySQL",
  SQLite = "SQLite",
  SQLServer = "SQLServer",
}

export enum SslMode {
  Disable = "Disable",
  Require = "Require",
  VerifyCa = "VerifyCa",
  VerifyFull = "VerifyFull",
}

// ConnectionProfile type unified in src/types/connection

export interface ConnectionInfo {
  id: string;
  db_type: DbType;
  database: string;
  version?: string;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  version?: string;
  warnings: string[];
}

export interface ConnectionHealth {
  connection_id: string;
  status: string;
  healthy: boolean;
  rtt_ms?: number;
  error?: string;
}

// =============================================================================
// Query Result Types (from Rust backend)
// These types match the Rust serialization format exactly.
// For grid display types, see @/types/cellValue.ts (GridCellValue)
// For schema introspection types, see @/types/schema.ts (ColumnMeta)
// =============================================================================

export interface QueryHandle {
  id: string;
  columns: QueryColumnMeta[];
  estimated_rows?: number;
}

/**
 * Column metadata from query results (Rust backend).
 * Contains rich type information including nested types.
 */
export interface QueryColumnMeta {
  name: string;
  /** Rich type information from Rust (supports nested types) */
  data_type: RawCellValueType;
  nullable: boolean;
  primary_key: boolean;
  /** Original database type string */
  db_type: string;
  /** PostgreSQL type OID */
  type_oid?: number;
  default_value?: string | null;
  comment?: string | null;
  enum_values?: string[];
  /** PostgreSQL type category */
  type_category?: string;
  precision?: number;
  scale?: number;
}

export interface PageChunk {
  rows: RawCellValue[][];
  has_more: boolean;
  rows_fetched: number;
  timing?: PageTiming;
}

export interface PageTiming {
  fetch_ms: number;
  decode_ms: number;
}

/**
 * Raw cell value from Rust backend - lightweight primitives.
 * Matches Rust CellValue enum serialization (untagged).
 * This is the transport format; use GridCellValue for display.
 */
export type RawCellValue =
  | null // Null
  | boolean // Bool
  | number // I16, I32, F32, F64, Timestamp (micros), Date (days)
  | bigint // I64/Uint64 values preserved with full precision
  | string // Text
  | RawCellValue[] // Arrays (including nested)
  | { [key: string]: RawCellValue }; // Json and composite structures

/**
 * Rich type information from Rust backend.
 * Supports nested types (Array, Composite, Range, etc.)
 */
export type RawCellValueType =
  | "Null"
  | "Text"
  | "Integer"
  | "Decimal"
  | "Boolean"
  | "Date"
  | "Time"
  | "DateTime"
  | "Binary"
  | "Json"
  | "Uuid"
  | { Array: RawCellValueType }
  | { Composite: Array<[string, RawCellValueType]> }
  | { Range: RawCellValueType }
  | { Multirange: RawCellValueType }
  | "Geometry"
  | "Geography"
  | "Xml"
  | "Cidr"
  | "Inet"
  | "MacAddr"
  | "Interval"
  | "TsVector"
  | "TsQuery"
  | "Money"
  | "Hstore"
  | "Ltree"
  | "Cube"
  | { CustomType: string };

// =============================================================================
// Legacy type aliases for backward compatibility
// These will be removed in a future version
// =============================================================================

/** @deprecated Use RawCellValue instead */
export type CellValue = RawCellValue;

/** @deprecated Use RawCellValueType instead */
export type CellValueType = RawCellValueType;

/** @deprecated Use QueryColumnMeta instead */
export type ColumnMeta = QueryColumnMeta;

export type DbSpecificValue = {
  PostgreSQL: PostgresValue;
};

export interface PostgresValue {
  oid: number;
  type_name: string;
  type_modifier: number;
}

// Database introspection types
export interface Database {
  name: string;
  owner?: string;
  encoding?: string;
  collation?: string;
  size?: string;
}

export interface Schema {
  name: string;
  owner?: string;
}

export interface Table {
  schema: string;
  name: string;
  kind: TableKind;
  owner?: string;
  size?: string;
  row_count?: number;
  comment?: string;
}

export enum TableKind {
  Regular = "Regular",
  Partitioned = "Partitioned",
  Foreign = "Foreign",
  Temporary = "Temporary",
}

export interface View {
  schema: string;
  name: string;
  owner?: string;
  definition?: string;
  is_materialized: boolean;
  comment?: string;
}

export interface Function {
  schema: string;
  name: string;
  arguments: string;
  return_type: string;
  language: string;
  is_aggregate: boolean;
  is_window: boolean;
  is_trigger: boolean;
  source?: string;
}

export interface Index {
  name: string;
  table_name: string;
  columns: string[];
  is_unique: boolean;
  is_primary: boolean;
  is_partial: boolean;
  definition: string;
  is_foreign_key: boolean;
}

export interface IndexUsageStats {
  index_name: string;
  scan_count?: number;
  rows_read?: number;
  rows_returned?: number;
  last_accessed?: string;
  last_used?: string; // ISO timestamp of last index scan (PG16+)
  cache_hit_ratio?: number;
  size_bytes?: number;
  size_pretty?: string;
  is_unused: boolean;
  efficiency_score?: number; // 0-100
}

export enum ConstraintType {
  PrimaryKey = "PrimaryKey",
  ForeignKey = "ForeignKey",
  Unique = "Unique",
  Check = "Check",
  Exclusion = "Exclusion",
}

export interface Constraint {
  name: string;
  table_name: string;
  constraint_type: ConstraintType;
  definition: string;
  foreign_table?: string;
}

export interface Trigger {
  name: string;
  schema: string;
  table_name: string;
  event: string;
  timing: string;
  level: string;
  enabled: boolean;
  function: string;
  condition?: string;
}

export interface TableDataResult {
  columns: ColumnMeta[];
  rows: CellValue[][];
  has_more: boolean;
  total_count?: number;
  execution_time_ms?: number;
}

// Streaming types
export type StreamEvent =
  | { type: "Started"; columns: ColumnMeta[]; estimated_rows?: number }
  | { type: "Data"; rows: CellValue[][]; row_offset: number }
  | { type: "Progress"; rows_fetched: number; percentage?: number }
  | { type: "Completed"; total_rows: number; execution_time_ms: number }
  | { type: "Error"; message: string; code?: string };

// NEW: Channel-based streaming (matches Rust StreamMessage enum)
// NOTE: Batch data sent via separate data channel as ArrayBuffer (not in metadata messages)
// Rust payloads use camelCase field names (serde renames), reflected here
export type StreamMessage =
  | { type: "limitApplied"; originalSql: string; appliedLimit: number }
  | { type: "started"; columns: ColumnMeta[]; estimatedRows?: number }
  | {
      type: "success";
      totalRows: number;
      executionTimeMs: number;
      cursorSetupMs?: number;
      totalStreamingMs?: number;
      fetchCount?: number;
      networkMs?: number;
      conversionMs?: number;
      ipcSendMs?: number;
    }
  | { type: "error"; code: string; message: string }
  | { type: "interrupted"; resumable: boolean; message: string };

// Backend API
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class BackendAPI {
  // Connection management
  static async connect(profile: ConnectionProfile): Promise<ConnectionInfo> {
    return invoke("connect", { profile });
  }

  static async disconnect(connId: string): Promise<void> {
    return invoke("disconnect", { connId });
  }

  static async switchDatabase(connId: string, newDatabase: string): Promise<void> {
    return invoke("switch_database", { connId, newDatabase });
  }

  static async disconnectAll(): Promise<void> {
    return invoke("disconnect_all");
  }

  static async testConnection(connId: string): Promise<ConnectionTestResult> {
    return invoke("test_connection", { connId });
  }

  static async getConnectionHealth(connId: string): Promise<ConnectionHealth> {
    return invoke("get_connection_health", { connId });
  }

  static async ping(connId: string): Promise<number> {
    return invoke("ping", { connId });
  }

  // NOTE: streamQuery was removed - it was incompatible with the Rust backend
  // (expected channels, returned Result<()> not string). Use QueryStreamClient instead.
  // See: src/services/queryStreamClient.ts

  // Database introspection - Use IntrospectionService instead (dialect-aware)
  // See: src/services/introspectionService.ts

  // ============================================================================
  // CRUD TRANSACTION API
  // ============================================================================

  /**
   * Execute a batch of CRUD commands in a single atomic transaction
   *
   * All commands are executed sequentially within a BEGIN...COMMIT transaction.
   * On error, the entire transaction is rolled back.
   *
   * @param connectionId - Database connection ID
   * @param commands - Array of CRUD commands to execute
   * @returns Transaction result with committed commands, failures, and ID mappings
   *
   * @throws Error if transaction fails or connection not found
   *
   * @example
   * ```ts
   * const result = await BackendAPI.executeCrudTransaction(connId, [
   *   {
   *     id: '1',
   *     type: 'data.update',
   *     target: { connectionId: connId, schema: 'public', table: 'users' },
   *     payload: { column: 'email', primaryKeys: { id: 42 }, newValue: 'new@example.com' },
   *     metadata: { timestamp: new Date().toISOString() },
   *     state: 'staged',
   *   }
   * ]);
   *
   * if (result.success) {
   *   logger.info('Committed:', result.committed.length);
   *   logger.info('ID mappings:', result.idMappings);
   * }
   * ```
   */
  static async executeCrudTransaction(
    connectionId: string,
    commands: CrudCommand[],
  ): Promise<CommitResult> {
    if (commands.length === 0) {
      return {
        transactionId: nanoid(),
        success: true,
        durationMs: 0,
        committed: [],
        failures: [],
      };
    }

    // Build transaction payload
    // Transform commands to snake_case for Rust backend
    const transformedCommands = commands.map((cmd) => ({
      id: cmd.id,
      operation_type: cmd.type,
      target: {
        connection_id: cmd.target.connectionId,
        database: cmd.target.database,
        schema: cmd.target.schema,
        table: cmd.target.table,
        entity_name: cmd.target.entityName,
      },
      payload: cmd.payload,
      metadata: cmd.metadata
        ? {
            timestamp: cmd.metadata.timestamp,
            description: cmd.metadata.description,
            source: cmd.metadata.source,
          }
        : undefined,
    }));

    const transaction = {
      id: nanoid(),
      commands: transformedCommands,
      rollback_on_error: true,
    };

    // Debug logging
    logger.info("Invoking execute_crud_transaction with:", {
      connId: connectionId,
      transaction,
    });

    // Invoke Rust backend
    const result = await invoke<{
      transaction_id: string;
      success: boolean;
      duration_ms: number;
      committed: Array<{
        id: string;
        operation_type: string;
        description?: string;
        affected_rows?: number;
      }>;
      failures: Array<{
        id: string;
        operation_type: string;
        error: {
          code: string;
          message: string;
          severity: string;
          recoverable: boolean;
        };
        rolled_back: boolean;
      }>;
      warnings?: Array<{
        code: string;
        message: string;
        severity: string;
        recoverable: boolean;
      }>;
      id_mappings?: Record<string, string>;
    }>("execute_crud_transaction", {
      connId: connectionId,
      transaction,
    });

    // Map Rust response to frontend CommitResult type
    return {
      transactionId: result.transaction_id,
      success: result.success,
      durationMs: result.duration_ms,
      committed: result.committed.map((c) => ({
        id: c.id,
        type: c.operation_type as CrudOperationType,
        target: commands.find((cmd) => cmd.id === c.id)?.target ?? {
          connectionId,
        },
        description: c.description,
        affectedRows: c.affected_rows,
      })),
      failures: result.failures.map((f) => ({
        id: f.id,
        type: f.operation_type as CrudOperationType,
        target: commands.find((cmd) => cmd.id === f.id)?.target ?? {
          connectionId,
        },
        error: {
          code: f.error.code,
          message: f.error.message,
          severity: f.error.severity as "info" | "warning" | "error",
          recoverable: f.error.recoverable,
        },
        rolledBack: f.rolled_back,
      })),
      warnings: result.warnings?.map((w) => ({
        code: w.code,
        message: w.message,
        severity: w.severity as "info" | "warning" | "error",
        recoverable: w.recoverable,
      })),
    };
  }

  // ============================================================================
  // Generic SQL Execution (Frontend-Driven Dialect Support)
  // ============================================================================
  // These methods allow the frontend to execute SQL directly.
  // SQL generation is handled by frontend dialects (src/dialects/).

  /**
   * Execute a single SQL statement and return the number of affected rows.
   * This is the primary method for DDL operations (CREATE, ALTER, DROP).
   * Use the dialect system to generate the SQL before calling this method.
   *
   * @example
   * ```typescript
   * import { getDialect } from '@/dialects';
   *
   * const dialect = getDialect(DbType.PostgreSQL);
   * const sql = dialect.createIndex({ schema: 'public', table: 'users', ... });
   * const affectedRows = await BackendAPI.executeSql(connectionId, sql);
   * ```
   */
  static async executeSql(connectionId: string, sql: string): Promise<number> {
    return invoke<number>("execute_sql", {
      connId: connectionId,
      sql,
    });
  }

  /**
   * Execute multiple SQL statements in sequence.
   * Returns an array of affected rows for each statement.
   * All statements are executed in the same connection context.
   *
   * Use this for operations that require multiple statements (e.g., column modification).
   *
   * @example
   * ```typescript
   * const dialect = getDialect(DbType.PostgreSQL);
   * const statements = dialect.modifyColumn({ ... }); // Returns string[]
   * const results = await BackendAPI.executeSqlBatch(connectionId, statements);
   * ```
   */
  static async executeSqlBatch(connectionId: string, statements: string[]): Promise<number[]> {
    return invoke<number[]>("execute_sql_batch", {
      connId: connectionId,
      statements,
    });
  }

  /**
   * Execute a SQL query and return results directly.
   * Use for introspection queries and small result sets.
   * For large result sets, use streamQuery instead.
   *
   * @example
   * ```typescript
   * import { DialectService } from './dialectService';
   *
   * const sql = DialectService.getIndexesQuery(connectionId, schema, table);
   * const result = await BackendAPI.query(connectionId, sql);
   * // result.columns: ColumnMeta[], result.rows: CellValue[][]
   * ```
   */
  static async query(connectionId: string, sql: string): Promise<RawQueryResult> {
    return invoke<RawQueryResult>("query", {
      connId: connectionId,
      sql,
    });
  }
}

/**
 * Raw query result from Rust backend
 * Used for introspection queries executed via BackendAPI.query()
 */
export interface RawQueryResult {
  columns: ColumnMeta[];
  rows: CellValue[][];
}

// Alias for convenience (matches naming convention in other parts of codebase)
export const Backend = BackendAPI;

// REMOVED: Legacy helper functions for old CellValue interface
// The new CellValue is a primitive type union (null | boolean | number | string | array | object)
// Use formatters.ts for display formatting instead
