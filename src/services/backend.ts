import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

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

export interface ConnectionProfile {
  id: string;
  name: string;
  db_type: DbType;
  host: string;
  port: number;
  database: string;
  username: string;
  password?: string;
  ssl_mode?: SslMode;
  options: Record<string, string>;
}

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

export interface QueryHandle {
  id: string;
  columns: ColumnMeta[];
  estimated_rows?: number;
}

export interface ColumnMeta {
  name: string;
  data_type: CellValueType;
  nullable: boolean;
  primary_key: boolean;
  db_type: string;
  type_oid?: number;
  default_value?: string | null;
  comment?: string | null;
  enum_values?: string[];
  type_category?: string;
}

export interface PageChunk {
  rows: CellValue[][];
  has_more: boolean;
  rows_fetched: number;
  timing?: PageTiming;
}

export interface PageTiming {
  fetch_ms: number;
  decode_ms: number;
}

// NEW: CellValue from Rust fast path - lightweight primitives (no display_value)
// Matches Rust CellValue enum serialization (untagged)
export type CellValue =
  | null // Null
  | boolean // Bool
  | number // I16, I32, I64, F32, F64, Timestamp (micros), Date (days)
  | string // Text
  | number[] // Bytes (JSON array of u8)
  | { [key: string]: unknown }; // Json

// DEPRECATED: Old CellValue interface (kept for backward compatibility during migration)
/** @deprecated Use new CellValue type instead - display_value no longer exists */
export interface LegacyCellValue {
  value_type: CellValueType;
  raw_value?: Uint8Array;
  display_value: string;
  db_specific?: DbSpecificValue;
}

export type CellValueType =
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
  | { Array: CellValueType }
  | { Composite: Array<[string, CellValueType]> }
  | { Range: CellValueType }
  | { Multirange: CellValueType }
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

export interface Constraint {
  name: string;
  table_name: string;
  constraint_type: ConstraintType;
  definition: string;
  foreign_table?: string;
}

export enum ConstraintType {
  PrimaryKey = "PrimaryKey",
  ForeignKey = "ForeignKey",
  Unique = "Unique",
  Check = "Check",
  Exclusion = "Exclusion",
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
export type StreamMessage =
  | { type: "limitApplied"; original_sql: string; applied_limit: number }
  | { type: "started"; columns: ColumnMeta[]; estimated_rows?: number }
  | { type: "batch"; rows: CellValue[][]; row_offset: number }
  | { type: "success"; total_rows: number; execution_time_ms: number }
  | { type: "error"; code: string; message: string }
  | { type: "interrupted"; resumable: boolean; message: string };

// Backend API
export class BackendAPI {
  // Connection management
  static async connect(profile: ConnectionProfile): Promise<ConnectionInfo> {
    return invoke("connect", { profile });
  }

  static async disconnect(connId: string): Promise<void> {
    return invoke("disconnect", { connId });
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

  // Streaming query
  static async streamQuery(
    connId: string,
    sql: string,
    pageSize?: number,
    onEvent?: (event: StreamEvent) => void,
  ): Promise<string> {
    const streamId = await invoke<string>("stream_query", {
      connId,
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

  // Database introspection
  static async getDatabases(connId: string): Promise<Database[]> {
    return invoke("get_databases", { connId });
  }

  static async getSchemas(connId: string, database: string): Promise<Schema[]> {
    return invoke("get_schemas", { connId, database });
  }

  static async getTables(connId: string, schema: string): Promise<Table[]> {
    return invoke("get_tables", { connId, schema });
  }

  static async getViews(connId: string, schema: string): Promise<View[]> {
    return invoke("get_views", { connId, schema });
  }

  static async getFunctions(
    connId: string,
    schema: string,
  ): Promise<Function[]> {
    return invoke("get_functions", { connId, schema });
  }

  static async getIndexes(connId: string, table: string): Promise<Index[]> {
    return invoke("get_indexes", { connId, table });
  }

  static async getIndexUsageStats(
    connId: string,
    table: string,
  ): Promise<IndexUsageStats[]> {
    return invoke("get_index_usage_stats", { connId, table });
  }

  static async getConstraints(
    connId: string,
    table: string,
  ): Promise<Constraint[]> {
    return invoke("get_constraints", { connId, table });
  }

  static async getColumns(
    connId: string,
    schema: string,
    table: string,
  ): Promise<ColumnMeta[]> {
    return invoke("get_columns", { connId, schema, table });
  }

  static async getTriggers(
    connId: string,
    schema: string,
    table: string,
  ): Promise<Trigger[]> {
    return invoke("get_triggers", { connId, schema, table });
  }

  static async getObjectDefinition(
    connId: string,
    database: string,
    schema: string,
    objectName: string,
    objectType: string,
  ): Promise<string> {
    return invoke("get_object_definition", {
      connId,
      database,
      schema,
      objectName,
      objectType,
    });
  }

  static async getTableCount(
    connId: string,
    schema: string,
    table: string,
  ): Promise<number> {
    return invoke("get_table_count", { connId, schema, table });
  }

  /**
   * Pre-warm statement cache by preparing a query in background
   * Fire-and-forget operation to eliminate cold start delays
   * Errors are logged but not propagated to caller
   */
  static async prewarmQuery(connectionId: string, sql: string): Promise<void> {
    return invoke("prewarm_query", { connectionId, sql });
  }

  /**
   * Pre-warm schema tables after schema loads (smart table pre-warming)
   * Only pre-warms first 3-5 tables based on schema size
   */
  static async prewarmSchemaTables(
    connectionId: string,
    schema: string,
    tables: string[],
  ): Promise<void> {
    return invoke("prewarm_schema_tables", { connectionId, schema, tables });
  }
}

// Alias for convenience (matches naming convention in other parts of codebase)
export const Backend = BackendAPI;

// REMOVED: Legacy helper functions for old CellValue interface
// The new CellValue is a primitive type union (null | boolean | number | string | array | object)
// Use formatters.ts for display formatting instead
