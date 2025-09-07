import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

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

export interface CellValue {
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
}

// Streaming types
export type StreamEvent =
  | { type: "Started"; columns: ColumnMeta[]; estimated_rows?: number }
  | { type: "Data"; rows: CellValue[][]; row_offset: number }
  | { type: "Progress"; rows_fetched: number; percentage?: number }
  | { type: "Completed"; total_rows: number; execution_time_ms: number }
  | { type: "Error"; message: string; code?: string };

// Backend API
export class BackendAPI {
  // Connection management
  static async connect(profile: ConnectionProfile): Promise<ConnectionInfo> {
    return invoke("connect", { profile });
  }

  static async disconnect(connId: string): Promise<void> {
    return invoke("disconnect", { connId });
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

  // Query execution
  static async executeQuery(connId: string, sql: string): Promise<QueryHandle> {
    return invoke("execute_query", { connId, sql });
  }

  static async fetchResults(
    connId: string,
    queryHandle: QueryHandle,
    maxRows: number,
  ): Promise<PageChunk> {
    return invoke("fetch_results", { connId, queryHandle, maxRows });
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
      objectType 
    });
  }

  // Table operations
  static async getTableData(
    connId: string,
    schema: string,
    table: string,
    limit: number,
    offset: number,
  ): Promise<TableDataResult> {
    return invoke("get_table_data", { connId, schema, table, limit, offset });
  }

  static async getTableDataFiltered(
    connId: string,
    schema: string,
    table: string,
    limit: number,
    offset: number,
    filters?: any,
    sorts?: any[],
  ): Promise<TableDataResult> {
    return invoke("get_table_data_filtered", { 
      connId, 
      schema, 
      table, 
      limit, 
      offset,
      filters: filters || undefined,
      sorts: sorts || undefined
    });
  }

  static async getTableCount(
    connId: string,
    schema: string,
    table: string,
  ): Promise<number> {
    return invoke("get_table_count", { connId, schema, table });
  }
}

// Helper functions for working with CellValues
export function getCellDisplayValue(cell: CellValue): string {
  return cell.display_value;
}

export function isCellNull(cell: CellValue): boolean {
  return cell.value_type === "Null";
}

export function getCellType(cell: CellValue): string {
  if (typeof cell.value_type === "string") {
    return cell.value_type;
  }

  // Handle complex types
  if ("Array" in cell.value_type) {
    return "Array";
  }
  if ("Composite" in cell.value_type) {
    return "Composite";
  }
  if ("Range" in cell.value_type) {
    return "Range";
  }
  if ("Multirange" in cell.value_type) {
    return "Multirange";
  }
  if ("CustomType" in cell.value_type) {
    return `Custom(${cell.value_type.CustomType})`;
  }

  return "Unknown";
}
