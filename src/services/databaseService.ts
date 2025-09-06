import { isTauri, safeInvoke, safeEmit } from "@/utils/tauri";
import {
  queryManager,
  type QueryResult,
} from "./queryManager";
import {
  BackendAPI,
  ConstraintType,
  type ConnectionProfile,
  type DbType,
  type Constraint,
} from "./backend";
import { streamingTableService } from "./streamingTableService";
import type { 
  TableStructure, 
  TableStructureOptions, 
  ForeignKeyInfo, 
  TableStatistics 
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
      const backendResponse = await safeInvoke<{ id: string; db_type: string; database: string; version?: string }>("db_connect_by_id", {
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
      return response;
    } catch (error) {
      console.error("Failed to connect to database:", error);
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
  async listSchemas(connectionId: string, _database: string): Promise<string[]> {
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
      return columns.map((c, index) => ({
        name: c.name,
        db_type: c.db_type,
        nullable: c.nullable,
        default: undefined,
        is_pk: c.primary_key,
        is_fk: false,
        ordinal: index,
        precision: undefined,
        scale: undefined,
      }));
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
      return indexes.map((idx) => ({
        name: idx.name,
        unique: idx.is_unique,
        primary: idx.is_primary,
        columns: idx.columns,
        index_type: idx.is_partial ? "PARTIAL" : "BTREE",
      }));
    } catch (error) {
      console.error("Failed to get table indexes:", error);
      throw error;
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
    options: TableStructureOptions = {}
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
      const [
        columns,
        constraints,
        indexes,
        triggers,
        tables,
      ] = await Promise.all([
        // Always fetch columns
        BackendAPI.getColumns(backendConnId, schema, table),
        
        // Conditionally fetch other metadata
        includeConstraints ? BackendAPI.getConstraints(backendConnId, table) : Promise.resolve([]),
        includeIndexes ? BackendAPI.getIndexes(backendConnId, table) : Promise.resolve([]),
        includeTriggers ? BackendAPI.getTriggers(backendConnId, schema, table) : Promise.resolve([]),
        includeStatistics ? BackendAPI.getTables(backendConnId, schema) : Promise.resolve([]),
      ]);

      // Find this specific table in the list for metadata
      const tableInfo = tables.find(t => t.name === table);

      // Extract primary keys from constraints
      const primaryKeys = constraints
        .filter(c => c.constraint_type === ConstraintType.PrimaryKey)
        .flatMap(c => {
          // Parse constraint definition to extract column names
          const match = c.definition.match(/\((.*?)\)/);
          return match ? match[1].split(',').map(col => col.trim()) : [];
        });

      // Extract foreign keys with full information
      const foreignKeys: ForeignKeyInfo[] = includeForeignKeys
        ? constraints
            .filter(c => c.constraint_type === ConstraintType.ForeignKey)
            .map(c => {
              // Parse foreign key constraint definition
              // Example: "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
              const fkMatch = c.definition.match(/FOREIGN KEY\s*\((.*?)\)\s*REFERENCES\s*([\w.]+)\s*\((.*?)\)/i);
              const onDeleteMatch = c.definition.match(/ON DELETE\s+(\w+)/i);
              const onUpdateMatch = c.definition.match(/ON UPDATE\s+(\w+)/i);
              
              if (!fkMatch) {
                return null;
              }

              const [, localCols, foreignTable, foreignCols] = fkMatch;
              const [foreignSchema, foreignTableName] = foreignTable.includes('.')
                ? foreignTable.split('.')
                : [schema, foreignTable];

              return {
                name: c.name,
                columns: localCols.split(',').map(col => col.trim()),
                foreignTable: foreignTableName,
                foreignSchema,
                foreignColumns: foreignCols.split(',').map(col => col.trim()),
                onDelete: onDeleteMatch?.[1],
                onUpdate: onUpdateMatch?.[1],
              };
            })
            .filter((fk): fk is ForeignKeyInfo => fk !== null)
        : [];

      // Build table statistics if available
      const stats: TableStatistics | undefined = includeStatistics && tableInfo
        ? {
            totalRows: tableInfo.row_count || 0,
            tableSize: tableInfo.size || 'Unknown',
            indexSize: 'Unknown', // Would need additional query for this
            totalSize: tableInfo.size || 'Unknown',
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
          error instanceof Error ? error.message : 'Unknown error'
        }`
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
    objectType: 'table' | 'view' | 'materialized_view' | 'function' | 'procedure'
  ): Promise<string> {
    try {
      const backendConnId = this.getBackendConnectionId(connectionId);
      
      // Map frontend object type to backend format
      const backendObjectType = objectType.replace('_', '');
      
      const definition = await BackendAPI.getObjectDefinition(
        backendConnId,
        database,
        schema,
        objectName,
        backendObjectType
      );
      
      return definition;
    } catch (error) {
      console.error('Failed to get object definition:', error);
      throw new Error(
        `Failed to get definition for ${objectType} ${schema}.${objectName}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
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

      // Notify listeners
      const listeners = this.healthListeners.get(connectionId) || [];
      listeners.forEach((listener) => {
        listener(health);
      });

      // Emit global event
      await safeEmit(`connection-health-${connectionId}`, health);
    }, 5000);

    this.healthMonitors.set(connectionId, monitor);

    // Do immediate health check
    void this.getConnectionHealth(connectionId).then((health) => {
      const listeners = this.healthListeners.get(connectionId) || [];
      listeners.forEach((listener) => {
        listener(health);
      });
      void safeEmit(`connection-health-${connectionId}`, health);
    });
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
