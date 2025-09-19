import { isTauri, safeInvoke, safeEmit } from "@/utils/tauri";
import { queryManager, type QueryResult } from "./queryManager";
import {
  BackendAPI,
  ConstraintType,
  type ConnectionProfile,
  type DbType,
} from "./backend";
import { streamingTableService } from "./streamingTableService";
import type {
  TableStructure,
  TableStructureOptions,
  ForeignKeyInfo,
  TableStatistics,
} from "@/types/tableStructure";

// Types from API spec
export interface ConnectionConfig {
  id: string;
  name: string;
  db_type: "PostgreSQL" | "MySQL" | "SQLite" | "SQLServer";
  host: string;
  port: number;
  database: string;
  username: string;
  password?: string;
  options?: Record<string, string>;
}

export interface ConnectResponse {
  connection_id: string;
  server_version: string | null;
}

export interface TableMeta {
  schema: string;
  name: string;
  kind: "Table" | "View" | "MaterializedView";
  row_estimate?: number;
  size_bytes?: number;
}

export interface FunctionMeta {
  schema: string;
  name: string;
  return_type: string;
  arguments: string[];
}

export interface TriggerMeta {
  name: string;
  event: string; // INSERT, UPDATE, DELETE, TRUNCATE
  timing: string; // BEFORE, AFTER, INSTEAD OF
  level: string; // ROW, STATEMENT
  enabled: boolean;
  function: string;
  condition?: string;
  created?: string;
}

export interface TableIndex {
  name: string;
  unique: boolean;
  primary: boolean;
  columns: string[];
  index_type: string;
  condition?: string;
  size?: string;
  foreign_key?: boolean;
}

export interface ColumnMeta {
  name: string;
  db_type: string;
  nullable: boolean;
  default?: string;
  is_pk: boolean;
  is_fk: boolean;
  ordinal: number;
  precision?: number;
  scale?: number;
}

export interface ConnectionHealth {
  connectionId: string;
  status: "ready" | "degraded" | "error";
  healthy: boolean;
  rttMs?: number;
  error?: string;
}

class DatabaseService {
  private static instance: DatabaseService;
  private activeConnections: Map<string, ConnectResponse> = new Map();
  private connectionIdMap: Map<string, string> = new Map(); // Maps local ID to backend connection ID
  private healthMonitors: Map<string, NodeJS.Timeout> = new Map();
  private healthListeners: Map<string, ((health: ConnectionHealth) => void)[]> =
    new Map();

  private constructor() {}

  static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  /**
   * Connect to a database using stored credentials
   */
  async connectById(
    connectionId: string,
    workspaceId?: string,
  ): Promise<ConnectResponse> {
    if (!isTauri()) {
      console.warn(
        "Database operations require Tauri runtime - using mock connection",
      );
      // Return a mock connection for browser development
      const mockResponse: ConnectResponse = {
        connection_id: connectionId,
        server_version: "Mock Database (Browser Mode)",
      };
      this.activeConnections.set(connectionId, mockResponse);
      return mockResponse;
    }

    try {
      // Backend returns ConnectionInfo with 'id' field, not 'connection_id'
      const backendResponse = await safeInvoke<{
        id: string;
        db_type: string;
        database: string;
        version?: string;
      }>("db_connect_by_id", {
        connectionId: connectionId,
        workspaceId: workspaceId,
      });

      if (!backendResponse) {
        throw new Error("Failed to connect to database");
      }

      // Convert backend response to frontend format
      const response: ConnectResponse = {
        connection_id: backendResponse.id,
        server_version: backendResponse.version || null,
      };

      this.activeConnections.set(connectionId, response);
      // Map the local connection ID to the backend connection ID
      this.connectionIdMap.set(connectionId, backendResponse.id);
      this.startHealthMonitoring(connectionId);

      // Emit successful connection health
      const health: ConnectionHealth = {
        connectionId,
        status: "ready",
        healthy: true,
      };
      this.notifyHealthListeners(connectionId, health);

      return response;
    } catch (error) {
      console.error("Failed to connect to database:", error);

      // Emit error health status
      const health: ConnectionHealth = {
        connectionId,
        status: "error",
        healthy: false,
        error: error instanceof Error ? error.message : String(error),
      };
      this.notifyHealthListeners(connectionId, health);

      throw error;
    }
  }

  /**
   * Connect to a database using configuration
   */
  async connect(config: ConnectionConfig): Promise<ConnectResponse> {
    if (!isTauri()) {
      console.warn(
        "Database operations require Tauri runtime - using mock connection",
      );
      // Return a mock connection for browser development
      const mockResponse: ConnectResponse = {
        connection_id: config.id,
        server_version: "Mock Database (Browser Mode)",
      };
      this.activeConnections.set(config.id, mockResponse);
      return mockResponse;
    }

    try {
      // Convert to new backend types
      const profile: ConnectionProfile = {
        id: config.id,
        name: config.name,
        db_type: config.db_type as unknown as DbType,
        host: config.host,
        port: config.port,
        database: config.database,
        username: config.username,
        password: config.password,
        ssl_mode: undefined,
        options: config.options || {},
      };

      const connectionInfo = await BackendAPI.connect(profile);

      const response: ConnectResponse = {
        connection_id: connectionInfo.id,
        server_version: connectionInfo.version || null,
      };

      this.activeConnections.set(config.id, response);
      // Map the local connection ID to the backend connection ID
      this.connectionIdMap.set(config.id, connectionInfo.id);

      // Start health monitoring
      this.startHealthMonitoring(config.id);

      return response;
    } catch (error) {
      console.error("Failed to connect to database:", error);
      throw error;
    }
  }

  /**
   * Disconnect from a database
   */
  async disconnect(connectionId: string): Promise<void> {
    try {
      // Stop health monitoring
      this.stopHealthMonitoring(connectionId);

      if (isTauri()) {
        const backendConnId = this.getBackendConnectionId(connectionId);
        await BackendAPI.disconnect(backendConnId);
      }

      this.activeConnections.delete(connectionId);
      this.connectionIdMap.delete(connectionId);
    } catch (error) {
      console.error("Failed to disconnect from database:", error);
      throw error;
    }
  }

  /**
   * Test connection health
   */
  async testConnection(connectionId: string): Promise<boolean> {
    try {
      const backendConnId = this.getBackendConnectionId(connectionId);
      const result = await BackendAPI.testConnection(backendConnId);
      return result.success;
    } catch (error) {
      console.error("Failed to test connection:", error);
      return false;
    }
  }

  /**
   * Get connection health details
   */
  async getConnectionHealth(connectionId: string): Promise<ConnectionHealth> {
    try {
      const backendConnId = this.getBackendConnectionId(connectionId);
      const health = await BackendAPI.getConnectionHealth(backendConnId);
      return {
        connectionId: health.connection_id,
        status: health.status as "ready" | "degraded" | "error",
        healthy: health.healthy,
        rttMs: health.rtt_ms,
        error: health.error,
      };
    } catch (error) {
      return {
        connectionId,
        status: "error",
        healthy: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Ping connection to measure latency
   */
  async ping(connectionId: string): Promise<number> {
    try {
      const backendConnId = this.getBackendConnectionId(connectionId);
      return await BackendAPI.ping(backendConnId);
    } catch (error) {
      console.error("Failed to ping connection:", error);
      throw error;
    }
  }

  /**
   * Get available foreign key targets (tables with primary keys or unique constraints)
   */
  async getForeignKeyTargets(connectionId: string): Promise<any[]> {
    try {
      const backendConnId = this.getBackendConnectionId(connectionId);

      // Get all tables in the public schema
      const tables = await this.listTables(connectionId, 'public', 'public');

      const targets: any[] = [];
      const addedTargets = new Set<string>(); // Track added column combinations

      // For each table, get its structure to find referenceable columns
      for (const table of tables) {
        try {
          const structure = await this.getTableStructure(
            connectionId,
            'public',
            'public',
            table.name,
            {
              includeIndexes: true,
              includeConstraints: true
            }
          );

          // Add primary key columns
          if (structure.primaryKeys && structure.primaryKeys.length > 0) {
            for (const pkColumn of structure.primaryKeys) {
              const column = structure.columns.find(c => c.name === pkColumn);
              if (column) {
                const key = `${table.name}.${column.name}`;
                if (!addedTargets.has(key)) {
                  targets.push({
                    table: table.name,
                    column: column.name,
                    type: column.db_type
                  });
                  addedTargets.add(key);
                }
              }
            }
          }

          // Add columns with unique constraints
          if (structure.constraints) {
            for (const constraint of structure.constraints) {
              if (constraint.constraint_type === 'UNIQUE' || constraint.constraint_type === 'u') {
                // Parse the constraint definition to extract column names
                const match = constraint.definition.match(/\((.*?)\)/);
                if (match) {
                  const columns = match[1].split(',').map(col => col.trim().replace(/"/g, ''));
                  for (const colName of columns) {
                    const column = structure.columns.find(c => c.name === colName);
                    if (column) {
                      const key = `${table.name}.${column.name}`;
                      if (!addedTargets.has(key)) {
                        targets.push({
                          table: table.name,
                          column: column.name,
                          type: column.db_type
                        });
                        addedTargets.add(key);
                      }
                    }
                  }
                }
              }
            }
          }

          // Add columns with unique indexes
          if (structure.indexes) {
            for (const index of structure.indexes) {
              if (index.is_unique) {
                for (const colName of index.columns) {
                  const column = structure.columns.find(c => c.name === colName);
                  if (column) {
                    const key = `${table.name}.${column.name}`;
                    if (!addedTargets.has(key)) {
                      targets.push({
                        table: table.name,
                        column: column.name,
                        type: column.db_type
                      });
                      addedTargets.add(key);
                    }
                  }
                }
              }
            }
          }
        } catch (err) {
          console.error(`Failed to get structure for table ${table.name}:`, err);
        }
      }

      return targets;
    } catch (error) {
      console.error("Failed to fetch foreign key targets:", error);
      return [];
    }
  }

  /**
   * Get backend connection ID from local connection ID
   */
  getBackendConnectionId(localConnectionId: string): string {
    // First check if we have a mapped backend connection ID
    const backendId = this.connectionIdMap.get(localConnectionId);
    if (backendId) {
      return backendId;
    }
    // Fallback to using the local ID (for backward compatibility)
    return localConnectionId;
  }

  /**
   * List available databases
   */
  async listDatabases(connectionId: string): Promise<string[]> {
    try {
      const backendConnId = this.getBackendConnectionId(connectionId);
      const databases = await BackendAPI.getDatabases(backendConnId);
      return databases.map((db) => db.name);
    } catch (error) {
      console.error("Failed to list databases:", error);
      throw error;
    }
  }

  /**
   * List schemas in a database
   */
  async listSchemas(
    connectionId: string,
    _database: string,
  ): Promise<string[]> {
    try {
      const backendConnId = this.getBackendConnectionId(connectionId);
      const schemas = await BackendAPI.getSchemas(backendConnId, _database);
      return schemas.map((s) => s.name);
    } catch (error) {
      console.error("Failed to list schemas:", error);
      throw error;
    }
  }

  /**
   * List tables and views in a schema
   */
  async listTables(
    connectionId: string,
    _database: string,
    schema: string,
  ): Promise<TableMeta[]> {
    try {
      const backendConnId = this.getBackendConnectionId(connectionId);
      const [tables, views] = await Promise.all([
        BackendAPI.getTables(backendConnId, schema),
        BackendAPI.getViews(backendConnId, schema),
      ]);

      const tableMetas: TableMeta[] = [
        ...tables.map((t) => ({
          schema: t.schema,
          name: t.name,
          kind: "Table" as const,
          row_estimate: t.row_count,
          size_bytes: undefined,
        })),
        ...views.map((v) => ({
          schema: v.schema,
          name: v.name,
          kind: v.is_materialized
            ? ("MaterializedView" as const)
            : ("View" as const),
          row_estimate: undefined,
          size_bytes: undefined,
        })),
      ];

      return tableMetas;
    } catch (error) {
      console.error("Failed to list tables:", error);
      throw error;
    }
  }

  /**
   * List functions in a schema
   */
  async listFunctions(
    connectionId: string,
    _database: string,
    schema: string,
  ): Promise<FunctionMeta[]> {
    try {
      const backendConnId = this.getBackendConnectionId(connectionId);
      const functions = await BackendAPI.getFunctions(backendConnId, schema);
      return functions.map((f) => ({
        schema: f.schema,
        name: f.name,
        return_type: f.return_type,
        arguments: f.arguments.split(",").map((a) => a.trim()),
      }));
    } catch (error) {
      console.error("Failed to list functions:", error);
      throw error;
    }
  }

  /**
   * Get table triggers metadata
   */
  async listTriggers(
    connectionId: string,
    _database: string,
    schema: string,
    table: string,
  ): Promise<TriggerMeta[]> {
    try {
      const backendConnId = this.getBackendConnectionId(connectionId);
      const triggers = await BackendAPI.getTriggers(
        backendConnId,
        schema,
        table,
      );
      return triggers.map((t) => ({
        name: t.name,
        event: t.event,
        timing: t.timing,
        level: t.level,
        enabled: t.enabled,
        function: t.function,
        condition: t.condition,
        created: undefined,
      }));
    } catch (error) {
      console.error("Failed to list triggers:", error);
      throw error;
    }
  }

  /**
   * Get table columns metadata
   */
  async getTableColumns(
    connectionId: string,
    _database: string,
    schema: string,
    table: string,
  ): Promise<ColumnMeta[]> {
    try {
      const backendConnId = this.getBackendConnectionId(connectionId);
      const columns = await BackendAPI.getColumns(backendConnId, schema, table);
      return columns.map(
        (c, index) =>
          ({
            name: c.name,
            db_type: c.db_type,
            nullable: c.nullable,
            default: c.default_value || null,
            is_pk: c.primary_key,
            is_fk: false,
            ordinal: index,
            precision: undefined,
            scale: undefined,
            comment: c.comment || null,
          } as ColumnMeta & { comment?: string | null }),
      );
    } catch (error) {
      console.error("Failed to get table columns:", error);
      throw error;
    }
  }

  /**
   * Get table indexes
   */
  async tableIndexes(
    connectionId: string,
    _database: string,
    _schema: string,
    table: string,
  ): Promise<TableIndex[]> {
    try {
      const backendConnId = this.getBackendConnectionId(connectionId);
      const indexes = await BackendAPI.getIndexes(backendConnId, table);
      console.log('Raw indexes from backend:', indexes);
      const mapped = indexes.map((idx) => ({
        name: idx.name,
        unique: idx.is_unique,
        primary: idx.is_primary,
        columns: idx.columns,
        index_type: idx.is_partial ? "PARTIAL" : "BTREE",
        condition: idx.is_partial ? idx.definition : undefined,
        foreign_key: idx.is_foreign_key,
      }));
      console.log('Mapped indexes:', mapped);
      return mapped;
    } catch (error) {
      console.error("Failed to get table indexes:", error);
      throw error;
    }
  }

  /**
   * Get index usage statistics
   */
  async getIndexUsageStats(
    connectionId: string,
    table: string,
  ): Promise<import("./backend").IndexUsageStats[]> {
    try {
      const backendConnId = this.getBackendConnectionId(connectionId);
      return await BackendAPI.getIndexUsageStats(backendConnId, table);
    } catch (error) {
      console.error("Failed to get index usage stats:", error);
      throw error;
    }
  }

  private indexTypeCache = new Map<
    string,
    { types: string[]; timestamp: number }
  >();
  private INDEX_TYPE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  async getSupportedIndexTypes(connectionId: string): Promise<string[]> {
    try {
      const backendConnId = this.getBackendConnectionId(connectionId);

      // Check cache first
      const cached = this.indexTypeCache.get(backendConnId);
      if (cached && Date.now() - cached.timestamp < this.INDEX_TYPE_CACHE_TTL) {
        return cached.types;
      }

      // Fetch from backend - database is source of truth
      const types = await safeInvoke<string[]>("get_supported_index_types", {
        connId: backendConnId,
      });

      // Cache the result
      this.indexTypeCache.set(backendConnId, {
        types,
        timestamp: Date.now(),
      });

      return types;
    } catch (error) {
      console.error("Failed to get supported index types:", error);
      // Throw error instead of masking it with fallback
      throw error;
    }
  }

  clearIndexTypeCache(connectionId?: string) {
    if (connectionId) {
      const backendConnId = this.getBackendConnectionId(connectionId);
      this.indexTypeCache.delete(backendConnId);
    } else {
      this.indexTypeCache.clear();
    }
  }

  private columnTypeCache = new Map<
    string,
    { types: string[]; timestamp: number }
  >();
  private COLUMN_TYPE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  async getSupportedColumnTypes(connectionId: string): Promise<string[]> {
    try {
      const backendConnId = this.getBackendConnectionId(connectionId);

      // Check cache first
      const cached = this.columnTypeCache.get(backendConnId);
      if (cached && Date.now() - cached.timestamp < this.COLUMN_TYPE_CACHE_TTL) {
        return cached.types;
      }

      // Fetch from backend - database is source of truth
      const types = await safeInvoke<string[]>("get_supported_column_types", {
        connId: backendConnId,
      });

      // Cache the result
      this.columnTypeCache.set(backendConnId, {
        types,
        timestamp: Date.now(),
      });

      return types;
    } catch (error) {
      console.error("Failed to get supported column types:", error);
      // Throw error instead of masking it with fallback
      throw error;
    }
  }

  clearColumnTypeCache(connectionId?: string) {
    if (connectionId) {
      const backendConnId = this.getBackendConnectionId(connectionId);
      this.columnTypeCache.delete(backendConnId);
    } else {
      this.columnTypeCache.clear();
    }
  }

  /**
   * Get comprehensive table structure with all metadata
   * This includes columns, indexes, constraints, triggers, and statistics
   */
  async getTableStructure(
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    options: TableStructureOptions = {},
  ): Promise<TableStructure> {
    const {
      includeIndexes = true,
      includeConstraints = true,
      includeTriggers = true,
      includeStatistics = true,
      includeForeignKeys = true,
    } = options;

    try {
      const backendConnId = this.getBackendConnectionId(connectionId);

      // Fetch all table metadata in parallel for performance
      const [columns, constraints, indexes, triggers, tables] =
        await Promise.all([
          // Always fetch columns
          BackendAPI.getColumns(backendConnId, schema, table),

          // Conditionally fetch other metadata
          includeConstraints
            ? BackendAPI.getConstraints(backendConnId, table)
            : Promise.resolve([]),
          includeIndexes
            ? BackendAPI.getIndexes(backendConnId, table)
            : Promise.resolve([]),
          includeTriggers
            ? BackendAPI.getTriggers(backendConnId, schema, table)
            : Promise.resolve([]),
          includeStatistics
            ? BackendAPI.getTables(backendConnId, schema)
            : Promise.resolve([]),
        ]);

      // Find this specific table in the list for metadata
      const tableInfo = tables.find((t) => t.name === table);

      // Extract primary keys from constraints
      const primaryKeys = constraints
        .filter((c) => c.constraint_type === ConstraintType.PrimaryKey)
        .flatMap((c) => {
          // Parse constraint definition to extract column names
          const match = c.definition.match(/\((.*?)\)/);
          return match ? match[1].split(",").map((col) => col.trim()) : [];
        });

      // Extract foreign keys with full information
      const foreignKeys: ForeignKeyInfo[] = includeForeignKeys
        ? constraints
            .filter((c) => c.constraint_type === ConstraintType.ForeignKey)
            .map((c) => {
              // Parse foreign key constraint definition
              // Example: "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
              const fkMatch = c.definition.match(
                /FOREIGN KEY\s*\((.*?)\)\s*REFERENCES\s*([\w.]+)\s*\((.*?)\)/i,
              );
              const onDeleteMatch = c.definition.match(/ON DELETE\s+(\w+)/i);
              const onUpdateMatch = c.definition.match(/ON UPDATE\s+(\w+)/i);

              if (!fkMatch) {
                return null;
              }

              const [, localCols, foreignTable, foreignCols] = fkMatch;
              const [foreignSchema, foreignTableName] = foreignTable.includes(
                ".",
              )
                ? foreignTable.split(".")
                : [schema, foreignTable];

              return {
                name: c.name,
                columns: localCols.split(",").map((col) => col.trim()),
                foreignTable: foreignTableName,
                foreignSchema,
                foreignColumns: foreignCols.split(",").map((col) => col.trim()),
                onDelete: onDeleteMatch?.[1],
                onUpdate: onUpdateMatch?.[1],
              };
            })
            .filter((fk): fk is ForeignKeyInfo => fk !== null)
        : [];

      // Build table statistics if available
      const stats: TableStatistics | undefined =
        includeStatistics && tableInfo
          ? {
              totalRows: tableInfo.row_count || 0,
              tableSize: tableInfo.size || "Unknown",
              indexSize: "Unknown", // Would need additional query for this
              totalSize: tableInfo.size || "Unknown",
            }
          : undefined;

      // Return comprehensive table structure
      const structure: TableStructure = {
        name: table,
        schema,
        database,
        owner: tableInfo?.owner,
        comment: tableInfo?.comment,
        rowCount: tableInfo?.row_count,
        size: tableInfo?.size,
        columns,
        primaryKeys,
        foreignKeys,
        indexes: includeIndexes ? indexes : [],
        constraints: includeConstraints ? constraints : [],
        triggers: includeTriggers ? triggers : [],
        stats,
      };

      return structure;
    } catch (error) {
      console.error("Failed to get table structure:", error);
      throw new Error(
        `Failed to get structure for table ${schema}.${table}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  /**
   * Get SQL definition for a database object (table, view, materialized view)
   */
  async getObjectDefinition(
    connectionId: string,
    database: string,
    schema: string,
    objectName: string,
    objectType:
      | "table"
      | "view"
      | "materialized_view"
      | "function"
      | "procedure",
  ): Promise<string> {
    try {
      const backendConnId = this.getBackendConnectionId(connectionId);

      // Map frontend object type to backend format
      const backendObjectType = objectType.replace("_", "");

      const definition = await BackendAPI.getObjectDefinition(
        backendConnId,
        database,
        schema,
        objectName,
        backendObjectType,
      );

      return definition;
    } catch (error) {
      console.error("Failed to get object definition:", error);
      throw new Error(
        `Failed to get definition for ${objectType} ${schema}.${objectName}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  /**
   * Start health monitoring for a connection
   */
  private startHealthMonitoring(connectionId: string): void {
    // Clear existing monitor if any
    this.stopHealthMonitoring(connectionId);

    // Monitor health every 5 seconds
    const monitor = setInterval(async () => {
      const health = await this.getConnectionHealth(connectionId);
      this.notifyHealthListeners(connectionId, health);
    }, 5000);

    this.healthMonitors.set(connectionId, monitor);

    // Do immediate health check
    void this.getConnectionHealth(connectionId).then((health) => {
      this.notifyHealthListeners(connectionId, health);
    });
  }

  /**
   * Notify all health listeners for a connection
   */
  private notifyHealthListeners(
    connectionId: string,
    health: ConnectionHealth,
  ): void {
    const listeners = this.healthListeners.get(connectionId) || [];
    listeners.forEach((listener) => {
      listener(health);
    });
    void safeEmit(`connection-health-${connectionId}`, health);
  }

  /**
   * Stop health monitoring for a connection
   */
  private stopHealthMonitoring(connectionId: string): void {
    const monitor = this.healthMonitors.get(connectionId);
    if (monitor) {
      clearInterval(monitor);
      this.healthMonitors.delete(connectionId);
    }
  }

  /**
   * Subscribe to connection health updates
   */
  onHealthChange(
    connectionId: string,
    listener: (health: ConnectionHealth) => void,
  ): () => void {
    const listeners = this.healthListeners.get(connectionId) || [];
    listeners.push(listener);
    this.healthListeners.set(connectionId, listeners);

    // Return unsubscribe function
    return () => {
      const currentListeners = this.healthListeners.get(connectionId) || [];
      const index = currentListeners.indexOf(listener);
      if (index > -1) {
        currentListeners.splice(index, 1);
      }
    };
  }

  /**
   * Get active connection
   */
  getActiveConnection(connectionId: string): ConnectResponse | undefined {
    return this.activeConnections.get(connectionId);
  }

  /**
   * Check if connection is active
   */
  isConnectionActive(connectionId: string): boolean {
    return this.activeConnections.has(connectionId);
  }

  /**
   * Execute a SQL query with streaming support
   */
  async executeQuery(
    connectionId: string,
    sql: string,
    options?: {
      pageSize?: number;
      maxRows?: number;
      timeoutMs?: number;
      onProgress?: (event: any) => void;
      onError?: (error: any) => void;
    },
  ): Promise<QueryResult> {
    // Use streaming service for query execution
    const result = await streamingTableService.streamQuery(
      connectionId,
      sql,
      options?.pageSize,
      (progress) => {
        if (options?.onProgress) {
          options.onProgress({
            type: "progress",
            rows_fetched: progress.rowsFetched,
            percentage: progress.percentage,
          });
        }
      },
      (error) => {
        if (options?.onError) {
          options.onError(error);
        }
      },
    );

    // Convert to QueryResult format
    return {
      query_id: crypto.randomUUID(),
      columns: result.columns.map((c) => ({
        name: c.name,
        db_type: c.db_type,
        nullable: c.nullable,
      })),
      rows: result.rows as any,
      row_count: result.totalRows || result.rows.length,
      affected_rows: 0,
      query_time_ms: result.executionTimeMs || 0,
      has_more: false,
      error: null,
    };
  }

  /**
   * Execute multiple SQL queries in sequence
   */
  async executeMultipleQueries(
    connectionId: string,
    queries: string[],
    callbacks?: {
      onQueryComplete?: (index: number, result: QueryResult) => void;
      onError?: (
        index: number,
        error: { code: string; message: string },
      ) => void;
    },
  ): Promise<QueryResult[]> {
    return queryManager.executeMultipleQueries(
      connectionId,
      queries,
      callbacks,
    );
  }

  /**
   * Cancel an active query
   */
  async cancelQuery(queryId: string): Promise<void> {
    return queryManager.cancelQuery(queryId);
  }

  /**
   * Create a new index
   */
  async createIndex(
    connectionId: string,
    schema: string,
    table: string,
    index: {
      name: string;
      columns: string[];
      unique: boolean;
      indexType: string;
      condition?: string;
    }
  ): Promise<void> {
    try {
      const backendConnId = this.getBackendConnectionId(connectionId);
      await safeInvoke("create_index", {
        connId: backendConnId,
        schema,
        table,
        index: {
          name: index.name,
          columns: index.columns,
          unique: index.unique,
          index_type: index.indexType,
          condition: index.condition,
        },
      });
    } catch (error) {
      console.error("Failed to create index:", error);
      throw error;
    }
  }

  /**
   * Drop an index
   */
  async dropIndex(
    connectionId: string,
    schema: string,
    indexName: string
  ): Promise<void> {
    try {
      const backendConnId = this.getBackendConnectionId(connectionId);
      await safeInvoke("drop_index", {
        connId: backendConnId,
        schema,
        indexName,
      });
    } catch (error) {
      console.error("Failed to drop index:", error);
      throw error;
    }
  }

  /**
   * Rename an index
   */
  async renameIndex(
    connectionId: string,
    schema: string,
    oldName: string,
    newName: string
  ): Promise<void> {
    try {
      const backendConnId = this.getBackendConnectionId(connectionId);
      await safeInvoke("rename_index", {
        connId: backendConnId,
        schema,
        oldName,
        newName,
      });
    } catch (error) {
      console.error("Failed to rename index:", error);
      throw error;
    }
  }

  /**
   * Add a column to a table
   */
  async addColumn(
    connectionId: string,
    schema: string,
    table: string,
    column: {
      name: string;
      dataType: string;
      nullable: boolean;
      defaultValue?: string;
      checkConstraint?: string;
      comment?: string;
    }
  ): Promise<void> {
    try {
      const backendConnId = this.getBackendConnectionId(connectionId);
      await safeInvoke("alter_table_add_column", {
        connId: backendConnId,
        schema,
        table,
        column: {
          name: column.name,
          data_type: column.dataType,
          nullable: column.nullable,
          default_value: column.defaultValue,
          check_constraint: column.checkConstraint,
          comment: column.comment,
        },
      });
    } catch (error) {
      console.error("Failed to add column:", error);
      throw error;
    }
  }

  /**
   * Drop a column from a table
   */
  async dropColumn(
    connectionId: string,
    schema: string,
    table: string,
    columnName: string
  ): Promise<void> {
    try {
      const backendConnId = this.getBackendConnectionId(connectionId);
      await safeInvoke("alter_table_drop_column", {
        connId: backendConnId,
        schema,
        table,
        columnName,
      });
    } catch (error) {
      console.error("Failed to drop column:", error);
      throw error;
    }
  }

  /**
   * Modify a table column
   */
  async modifyColumn(
    connectionId: string,
    schema: string,
    table: string,
    column: {
      name: string;
      newName?: string;
      newType?: string;
      nullable?: boolean;
      defaultValue?: string;
      dropDefault?: boolean;
      comment?: string;
    }
  ): Promise<void> {
    try {
      const backendConnId = this.getBackendConnectionId(connectionId);
      await safeInvoke("alter_table_modify_column", {
        connId: backendConnId,
        schema,
        table,
        column: {
          name: column.name,
          new_name: column.newName,
          new_type: column.newType,
          nullable: column.nullable,
          default_value: column.defaultValue,
          drop_default: column.dropDefault || false,
          comment: column.comment,
        },
      });
    } catch (error) {
      console.error("Failed to modify column:", error);
      throw error;
    }
  }

  /**
   * Rename a column
   */
  async renameColumn(
    connectionId: string,
    schema: string,
    table: string,
    oldName: string,
    newName: string
  ): Promise<void> {
    try {
      const backendConnId = this.getBackendConnectionId(connectionId);
      await safeInvoke("alter_table_rename_column", {
        connId: backendConnId,
        schema,
        table,
        oldName,
        newName,
      });
    } catch (error) {
      console.error("Failed to rename column:", error);
      throw error;
    }
  }

  /**
   * Add a foreign key constraint
   */
  async addForeignKey(
    connectionId: string,
    schema: string,
    table: string,
    foreignKey: {
      constraintName?: string;
      columnName: string;
      referencedTable: string;
      referencedColumn: string;
      onUpdate: string;
      onDelete: string;
    }
  ): Promise<void> {
    try {
      const backendConnId = this.getBackendConnectionId(connectionId);
      await safeInvoke("alter_table_add_foreign_key", {
        connId: backendConnId,
        schema,
        table,
        fk: {
          constraint_name: foreignKey.constraintName,
          column_name: foreignKey.columnName,
          referenced_table: foreignKey.referencedTable,
          referenced_column: foreignKey.referencedColumn,
          on_update: foreignKey.onUpdate,
          on_delete: foreignKey.onDelete,
        },
      });
    } catch (error) {
      console.error("Failed to add foreign key:", error);
      throw error;
    }
  }

  /**
   * Drop a foreign key constraint
   */
  async dropForeignKey(
    connectionId: string,
    schema: string,
    table: string,
    constraintName: string
  ): Promise<void> {
    try {
      const backendConnId = this.getBackendConnectionId(connectionId);
      await safeInvoke("alter_table_drop_foreign_key", {
        connId: backendConnId,
        schema,
        table,
        constraintName,
      });
    } catch (error) {
      console.error("Failed to drop foreign key:", error);
      throw error;
    }
  }

  /**
   * Cleanup all connections
   */
  async cleanup(): Promise<void> {
    // Stop all health monitors
    this.healthMonitors.forEach((monitor) => {
      clearInterval(monitor);
    });
    this.healthMonitors.clear();
    this.healthListeners.clear();

    // Clean up query manager
    await queryManager.cleanupAll();

    // Disconnect all active connections
    const promises = Array.from(this.activeConnections.keys()).map((id) =>
      this.disconnect(id).catch(console.error),
    );
    await Promise.all(promises);

    this.activeConnections.clear();
  }
}

export const databaseService = DatabaseService.getInstance();
