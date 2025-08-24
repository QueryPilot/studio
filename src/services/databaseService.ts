import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

// Types from API spec
export interface ConnectionConfig {
  id: string;
  name: string;
  db_type: "Postgres" | "Mysql" | "Sqlite" | "Mssql" | "Mariadb";
  host: string;
  port: number;
  database: string;
  username: string;
  password?: string;
  max_connections?: number;
  min_connections?: number;
  connection_timeout?: number;
  idle_timeout?: number;
  max_lifetime?: number;
  // MSSQL specific
  instance_name?: string;
  auth_type?: "windows" | "sql";
  encrypt?: boolean;
  trust_server_certificate?: boolean;
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
  private healthMonitors: Map<string, NodeJS.Timeout> = new Map();
  private healthListeners: Map<string, ((health: ConnectionHealth) => void)[]> = new Map();

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
  async connectById(connectionId: string, workspaceId?: string): Promise<ConnectResponse> {
    try {
      const response = await invoke<ConnectResponse>("db_connect_by_id", {
        connectionId: connectionId,
        workspaceId: workspaceId,
      });

      this.activeConnections.set(connectionId, response);
      
      // Start health monitoring
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
    try {
      const response = await invoke<ConnectResponse>("db_connect", {
        config,
      });

      this.activeConnections.set(config.id, response);
      
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
      
      await invoke("db_disconnect", {
        connectionId: connectionId,
      });

      this.activeConnections.delete(connectionId);
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
      return await invoke<boolean>("test_connection", {
        connectionId: connectionId,
      });
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
      const health = await invoke<any>("get_connection_health", {
        connectionId: connectionId,
      });

      return {
        connectionId: health.connectionId || connectionId,
        status: health.status || "error",
        healthy: health.healthy || false,
        rttMs: health.rttMs,
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
      return await invoke<number>("db_ping", {
        connectionId: connectionId,
      });
    } catch (error) {
      console.error("Failed to ping connection:", error);
      throw error;
    }
  }

  /**
   * List available databases
   */
  async listDatabases(connectionId: string): Promise<string[]> {
    try {
      return await invoke<string[]>("db_list_databases", {
        connectionId: connectionId,
      });
    } catch (error) {
      console.error("Failed to list databases:", error);
      throw error;
    }
  }

  /**
   * List schemas in a database
   */
  async listSchemas(connectionId: string, database: string): Promise<string[]> {
    try {
      return await invoke<string[]>("db_list_schemas", {
        connectionId: connectionId,
        database,
      });
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
    database: string,
    schema: string
  ): Promise<TableMeta[]> {
    try {
      return await invoke<TableMeta[]>("db_list_tables", {
        connectionId: connectionId,
        database,
        schema,
      });
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
    database: string,
    schema: string
  ): Promise<FunctionMeta[]> {
    try {
      return await invoke<FunctionMeta[]>("db_list_functions", {
        connectionId: connectionId,
        database,
        schema,
      });
    } catch (error) {
      console.error("Failed to list functions:", error);
      throw error;
    }
  }

  /**
   * Get table columns metadata
   */
  async getTableColumns(
    connectionId: string,
    database: string,
    schema: string,
    table: string
  ): Promise<ColumnMeta[]> {
    try {
      return await invoke<ColumnMeta[]>("db_table_columns", {
        connectionId: connectionId,
        database,
        schema,
        table,
      });
    } catch (error) {
      console.error("Failed to get table columns:", error);
      throw error;
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
      listeners.forEach(listener => listener(health));
      
      // Emit global event
      await emit(`connection-health-${connectionId}`, health);
    }, 5000);

    this.healthMonitors.set(connectionId, monitor);
    
    // Do immediate health check
    void this.getConnectionHealth(connectionId).then(health => {
      const listeners = this.healthListeners.get(connectionId) || [];
      listeners.forEach(listener => listener(health));
      void emit(`connection-health-${connectionId}`, health);
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
    listener: (health: ConnectionHealth) => void
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
   * Cleanup all connections
   */
  async cleanup(): Promise<void> {
    // Stop all health monitors
    this.healthMonitors.forEach((monitor) => clearInterval(monitor));
    this.healthMonitors.clear();
    this.healthListeners.clear();

    // Disconnect all active connections
    const promises = Array.from(this.activeConnections.keys()).map((id) =>
      this.disconnect(id).catch(console.error)
    );
    await Promise.all(promises);
    
    this.activeConnections.clear();
  }
}

export const databaseService = DatabaseService.getInstance();