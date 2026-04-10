import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ConnectionProfile } from "@/types/connection";
import { logger } from "@/lib/logger";

// Database Types
export enum DbType {
  PostgreSQL = "PostgreSQL",
  MySQL = "MySQL",
  MariaDB = "MariaDB",
  SQLite = "SQLite",
  DuckDB = "DuckDB",
  MotherDuck = "MotherDuck",
  SQLServer = "SQLServer",
  Oracle = "Oracle",
  // New paradigms
  MongoDB = "MongoDB",
  Redis = "Redis",
  // Analytics engines
  Trino = "Trino",
}

export enum SslMode {
  Disable = "Disable",
  Allow = "Allow",
  Prefer = "Prefer",
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
  pooler_mode?: boolean | null;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  version?: string;
  warnings: string[];
  /** Detected database type (e.g., MariaDB detected from MySQL connection) */
  detected_db_type?: DbType;
  pooler_mode?: boolean | null;
}

export interface ConnectionHealth {
  connection_id: string;
  status: string;
  healthy: boolean;
  rtt_ms?: number;
  error?: string;
}

export interface DuckDbColumnDefinition {
  name: string;
  duckdbType: string;
}

export interface DuckDbAddFileRequest {
  filePath: string;
  targetSchema?: string | null;
  targetName: string;
  sourceId?: string | null;
}

export interface DuckDbReplaceManagedObjectRequest {
  targetSchema: string;
  targetName: string;
  objectKind: string;
  sourceId: string;
  sourceKind: string;
  sourceConnectionId?: string | null;
  sourceSpec: Record<string, unknown>;
  columns: DuckDbColumnDefinition[];
  rows: RawCellValue[][];
}

export interface DuckDbManagedObjectSummary {
  targetSchema: string;
  targetName: string;
  objectKind: string;
  sourceId: string;
  sourceKind: string;
  sourceConnectionId?: string | null;
  lastRefreshAt?: string | null;
  lastRefreshStatus?: string | null;
  lastRowCount?: number | null;
  lastError?: string | null;
}

export interface DuckDbExtensionInfo {
  extensionName: string;
  loaded: boolean;
  installed: boolean;
  description: string | null;
  installPath: string | null;
}

export interface DuckDbAttachDatabaseRequest {
  path: string;
  alias: string;
  dbType?: string | null;
  readOnly: boolean;
}

export interface DuckDbAttachedDatabase {
  databaseName: string;
  path: string;
  dbType: string;
  readOnly: boolean;
}

export interface DuckDbSecretInfo {
  name: string;
  secretType: string;
  provider: string;
  scope: string[];
  persistent: boolean;
}

export interface DuckDbCreateSecretRequest {
  name: string;
  secretType: string;
  provider: string;
  scope?: string | null;
  persistent: boolean;
  params: Record<string, string>;
}

export type DuckDbExportSource =
  | { query: string }
  | { table: { schema: string; name: string } };

export interface DuckDbExportRequest {
  source: DuckDbExportSource;
  destination: string;
  format: string;
  options: Record<string, string>;
}

export interface DuckDbExportResult {
  rowsExported: number;
  destination: string;
  format: string;
}

export interface DuckDbAutocompleteSuggestion {
  suggestion: string;
  suggestionStart: number;
  suggestionType: string | null;
}

export interface DuckDbQueryPlan {
  planText: string;
  planJson: Record<string, unknown> | null;
  totalTimeMs: number | null;
}

export interface DuckDbManagedObjectLineage {
  targetSchema: string;
  targetName: string;
  objectKind: string;
  sourceId: string;
  sourceKind: string;
  sourceConnectionId?: string | null;
  sourceSpec: Record<string, unknown>;
  lastRefreshStatus?: string | null;
  lastRefreshAt?: string | null;
  lastRowCount?: number | null;
  lastError?: string | null;
}

// =============================================================================
// Query Result Types (from Rust backend)
// These types match the Rust serialization format exactly.
// For grid display types, see @/types/cellValue.ts (GridCellValue)
// For schema introspection types, see @/types/schema.ts (QueryColumnMeta)
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
  set_values?: string[];
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
  routine_type?: "FUNCTION" | "PROCEDURE";
  language: string;
  is_aggregate: boolean;
  is_window: boolean;
  is_trigger: boolean;
  source?: string;
  is_extension?: boolean;
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

/**
 * MySQL/MariaDB Event Scheduler event
 */
export interface Event {
  schema: string;
  name: string;
  definer?: string;
  time_zone?: string;
  event_type: "ONE TIME" | "RECURRING";
  execute_at?: string;
  interval_value?: number;
  interval_field?: string;
  starts?: string;
  ends?: string;
  status: "ENABLED" | "DISABLED" | "SLAVESIDE_DISABLED";
  on_completion: "PRESERVE" | "NOT PRESERVE";
  created?: string;
  last_altered?: string;
  last_executed?: string;
  comment?: string;
}

/**
 * MySQL/MariaDB table partition information
 */
export interface Partition {
  schema: string;
  table_name: string;
  partition_name: string;
  subpartition_name?: string;
  partition_ordinal_position: number;
  subpartition_ordinal_position?: number;
  partition_method?: string;
  subpartition_method?: string;
  partition_expression?: string;
  subpartition_expression?: string;
  partition_description?: string;
  table_rows?: number;
  avg_row_length?: number;
  data_length?: number;
  index_length?: number;
  partition_comment?: string;
  partition_function_name?: string;
}

export interface TableDataResult {
  columns: QueryColumnMeta[];
  rows: RawCellValue[][];
  has_more: boolean;
  total_count?: number;
  execution_time_ms?: number;
}

// Streaming types
export type StreamEvent =
  | { type: "Started"; columns: QueryColumnMeta[]; estimated_rows?: number }
  | { type: "Data"; rows: RawCellValue[][]; row_offset: number }
  | { type: "Progress"; rows_fetched: number; percentage?: number }
  | { type: "Completed"; total_rows: number; execution_time_ms: number }
  | { type: "Error"; message: string; code?: string };

// NEW: Channel-based streaming (matches Rust StreamMessage enum)
// NOTE: Batch data sent via separate data channel as ArrayBuffer (not in metadata messages)
export type StreamMessage =
  | { type: "limitApplied"; original_sql: string; applied_limit: number }
  | { type: "started"; columns: QueryColumnMeta[]; estimated_rows?: number }
  | {
      type: "success";
      total_rows: number;
      execution_time_ms: number;
      cursor_setup_ms?: number;
      total_streaming_ms?: number;
      fetch_count?: number;
      network_ms?: number;
      conversion_ms?: number;
      ipc_send_ms?: number;
    }
  | { type: "error"; code: string; message: string }
  | { type: "interrupted"; resumable: boolean; message: string };

export type DocumentStreamMessage =
  | { type: "started"; collection: string; estimated_count?: number }
  | { type: "success"; total_documents: number; execution_time_ms: number }
  | { type: "error"; code: string; message: string };

export type KeyValueStreamMessage =
  | { type: "started"; pattern: string; estimated_keys?: number }
  | { type: "progress"; cursor: number; keys_so_far: number }
  | { type: "success"; total_keys: number; execution_time_ms: number }
  | { type: "error"; code: string; message: string };

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

  static async switchDatabase(
    connId: string,
    newDatabase: string,
  ): Promise<void> {
    return invoke("switch_database", { connId, newDatabase });
  }

  static async disconnectAll(): Promise<void> {
    return invoke("disconnect_all");
  }

  static async testConnection(connId: string): Promise<ConnectionTestResult> {
    return invoke("test_connection", { connId });
  }

  static async updateActiveSchema(connId: string, schema: string): Promise<void> {
    return invoke("update_active_schema", { connId, schema });
  }

  static async getConnectionHealth(connId: string): Promise<ConnectionHealth> {
    return invoke("get_connection_health", { connId });
  }

  static async ping(connId: string): Promise<number> {
    return invoke("ping", { connId });
  }

  static async duckdbAddFile(
    connId: string,
    request: DuckDbAddFileRequest,
  ): Promise<DuckDbManagedObjectSummary> {
    return invoke("duckdb_add_file", { connId, request });
  }

  static async duckdbReplaceManagedObject(
    connId: string,
    request: DuckDbReplaceManagedObjectRequest,
  ): Promise<DuckDbManagedObjectSummary> {
    return invoke("duckdb_replace_managed_object", { connId, request });
  }

  static async duckdbListManagedObjects(
    connId: string,
  ): Promise<DuckDbManagedObjectSummary[]> {
    return invoke("duckdb_list_managed_objects", { connId });
  }

  static async duckdbGetObjectLineage(
    connId: string,
    targetSchema: string,
    targetName: string,
  ): Promise<DuckDbManagedObjectLineage | null> {
    return invoke("duckdb_get_object_lineage", {
      connId,
      targetSchema,
      targetName,
    });
  }

  static async duckdbListExtensions(
    connectionId: string,
  ): Promise<DuckDbExtensionInfo[]> {
    return invoke<DuckDbExtensionInfo[]>("duckdb_list_extensions", {
      connId: connectionId,
    });
  }

  static async duckdbInstallExtension(
    connectionId: string,
    extensionName: string,
  ): Promise<void> {
    await invoke("duckdb_install_extension", {
      connId: connectionId,
      extensionName,
    });
  }

  static async duckdbAttachDatabase(
    connId: string,
    request: DuckDbAttachDatabaseRequest,
  ): Promise<string> {
    return invoke("duckdb_attach_database", { connId, request });
  }

  static async duckdbDetachDatabase(
    connId: string,
    alias: string,
  ): Promise<void> {
    await invoke("duckdb_detach_database", { connId, alias });
  }

  static async duckdbListAttachedDatabases(
    connId: string,
  ): Promise<DuckDbAttachedDatabase[]> {
    return invoke("duckdb_list_attached_databases", { connId });
  }

  static async duckdbCreateSecret(
    connId: string,
    request: DuckDbCreateSecretRequest,
  ): Promise<void> {
    await invoke("duckdb_create_secret", { connId, request });
  }

  static async duckdbListSecrets(
    connId: string,
  ): Promise<DuckDbSecretInfo[]> {
    return invoke("duckdb_list_secrets", { connId });
  }

  static async duckdbDropSecret(
    connId: string,
    name: string,
    persistent: boolean,
  ): Promise<void> {
    await invoke("duckdb_drop_secret", { connId, name, persistent });
  }

  static async duckdbExportData(
    connId: string,
    request: DuckDbExportRequest,
  ): Promise<DuckDbExportResult> {
    return invoke("duckdb_export_data", { connId, request });
  }

  static async duckdbAutocomplete(
    connId: string,
    partialSql: string,
  ): Promise<DuckDbAutocompleteSuggestion[]> {
    return invoke("duckdb_autocomplete", { connId, partialSql });
  }

  static async duckdbExplainQuery(
    connId: string,
    sql: string,
  ): Promise<DuckDbQueryPlan> {
    return invoke("duckdb_explain_query", { connId, sql });
  }

  // Streaming query
  // @deprecated This method is not actively used. Use QueryStreamClient instead.
  static async streamQuery(
    connId: string,
    sql: string,
    pageSize?: number,
    onEvent?: (event: StreamEvent) => void,
  ): Promise<string> {
    const streamId = await invoke<string>("execute_query", {
      connId,
      tabId: "legacy-backend-api", // Default tabId for backward compatibility
      sql,
      pageSize,
    });

    if (onEvent) {
      const unlisten = await listen<StreamEvent>(
        `query-stream-${streamId}`,
        (event) => {
          onEvent(event.payload);

          // Auto cleanup on completion or error
          if (
            event.payload.type === "Completed" ||
            event.payload.type === "Error"
          ) {
            unlisten();
          }
        },
      );
    }

    return streamId;
  }

  // Database introspection - Use IntrospectionService instead (dialect-aware)
  // See: src/services/introspectionService.ts

  // ============================================================================
  // Generic SQL Execution (Frontend-Driven Adapter Support)
  // ============================================================================
  // These methods allow the frontend to execute SQL directly.
  // SQL generation is handled by frontend adapters (src/adapters/).

  /**
   * Execute a SQL query and return results directly (Path 1: Direct Query).
   *
   * This method uses the `query` Tauri command with SimpleConverter for JSON encoding.
   * Optimized for small result sets (< 1000 rows) with low latency (~5-10ms overhead).
   *
   * ## Use Cases
   * - Schema metadata queries (tables, columns, constraints)
   * - System catalog queries (information_schema, pg_catalog)
   * - AI HTTP server endpoints
   * - Any query with known small result size
   *
   * ## When NOT to Use
   * For large result sets or user-facing data display, use `queryStreamClient.stream()`
   * instead, which provides 3-5x better performance with MessagePack encoding.
   *
   * ## Architecture
   * Frontend → BackendAPI.query() → Tauri `query` command → SimpleConverter → JSON
   *
   * See: `docs/query-execution-architecture.md` for detailed architecture documentation.
   *
   * @param connectionId - Database connection ID
   * @param sql - SQL query to execute
   * @returns Query result with columns and rows as JSON
   *
   * @example
   * ```typescript
   * import { getAdapterForConnection } from '@/adapters';
   *
   * // Get table metadata
   * const adapter = await getAdapterForConnection(connectionId);
   * const sql = adapter.getColumnsQuery(schema, table);
   * const result = await BackendAPI.query(connectionId, sql);
   * // result.columns: QueryColumnMeta[], result.rows: RawCellValue[][]
   * ```
   */
  static async query(
    connectionId: string,
    sql: string,
    timeoutSecs?: number,
  ): Promise<RawQueryResult> {
    logger.info(
      `[BackendAPI] query called for ${connectionId}, sql length: ${sql.length}`,
    );
    const result = await invoke<RawQueryResult>("query", {
      connId: connectionId,
      sql,
      timeoutSecs,
    });
    logger.info(
      `[BackendAPI] query returned ${result.rows.length} rows for ${connectionId}`,
    );
    return result;
  }
}

/**
 * Raw query result from Rust backend
 * Used for introspection queries executed via BackendAPI.query()
 */
export interface RawQueryResult {
  columns: QueryColumnMeta[];
  rows: RawCellValue[][];
}

// Alias for convenience (matches naming convention in other parts of codebase)
export const Backend = BackendAPI;
