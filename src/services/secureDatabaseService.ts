/**
 * Secure Database Service
 * Uses new database architecture commands from Rust backend
 */

import { invoke } from '@tauri-apps/api/core';
import { type DatabaseConnection, type ConnectionStatus, type QueryResult, type TableInfo, type ViewInfo, type FunctionInfo, type ColumnMeta } from '@/types/database';
import { useSecureConnectionStore } from '@/stores/secureConnectionStore';

// Backend types that match Rust definitions
interface ConnectResponse {
  connection_id: string;
  server_version?: string;
}

interface TableMeta {
  schema: string;
  name: string;
  kind: 'Table' | 'View' | 'MaterializedView';
  row_estimate: number | null;
  size_bytes: number | null;
}


interface QueryBeginResponse {
  cursor_id: string;
  columns: ColumnMeta[];
  total_approx?: number;
}

interface QueryFetchResponse {
  rows: any[][];
  page: number;
  is_complete: boolean;
}


class SecureDatabaseService {
  /**
   * Get the actual connection ID (isolated) for backend operations
   * This resolves the frontend connection ID to the backend isolated ID
   */
  private getActualConnectionId(connectionId: string): string {
    // We can't use the hook directly in a service, so we need to access the store
    const store = useSecureConnectionStore.getState();
    const actualId = store.getActualConnectionId(connectionId);
    
    // Return the actual connection ID as-is, including any workspace prefix
    // The backend creates these prefixed IDs for workspace isolation
    return actualId;
  }
  /**
   * Create a new database connection using connection ID and workspace ID only
   * Backend will fetch connection details from secure storage
   */
  async createConnectionById(connectionId: string, workspaceId?: string): Promise<string> {
    try {
      console.log(`[SecureDatabaseService] Creating connection by ID: ${connectionId}, workspace: ${workspaceId}`);
      
      const response = await invoke<ConnectResponse>('db_connect_by_id', {
        connectionId,
        workspaceId: workspaceId || null
      });
      
      console.log(`[SecureDatabaseService] Connection created successfully: ${response.connection_id}`);
      return response.connection_id;
    } catch (error) {
      console.error('[SecureDatabaseService] Failed to create connection by ID:', error);
      // Re-throw with more context
      throw new Error(`Failed to create connection: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Legacy method - Create a new database connection using full config
   * @deprecated Use createConnectionById instead
   */
  async createConnection(connectionId: string, config: DatabaseConnection): Promise<string> {
    const connectionConfig = {
      id: connectionId,
      name: config.name,
      db_type: config.type === 'postgresql' ? 'Postgres' : 
               config.type === 'mysql' ? 'Mysql' : 'Sqlite',
      host: config.host || 'localhost',
      port: config.port || this.getDefaultPort(config.type),
      database: config.database || '',
      username: config.username || '',
      password: config.password,
      ssl_mode: config.sslMode || config.ssl_mode || 'prefer',
      max_connections: 10,
      min_connections: 1,
      connection_timeout: 30000,
      idle_timeout: 600000,
      max_lifetime: 3600000,
    };

    const response = await invoke<ConnectResponse>('db_connect', {
      config: connectionConfig
    });
    
    return response.connection_id;
  }

  /**
   * Test database connection through new ping command
   */
  async testConnection(connectionId: string): Promise<boolean> {
    try {
      const actualConnectionId = this.getActualConnectionId(connectionId);
      console.log(`[SecureDatabaseService] Testing connection with actualConnectionId: ${actualConnectionId}`);
      
      const pingMs = await invoke<number>('db_ping', { connectionId: actualConnectionId });
      console.log(`[SecureDatabaseService] Ping successful: ${pingMs}ms`);
      return pingMs >= 0;
    } catch (error) {
      const actualConnectionId = this.getActualConnectionId(connectionId);
      console.error('[SecureDatabaseService] Test connection failed for:', actualConnectionId, error);
      // Re-throw the error with more context instead of just returning false
      throw new Error(`Connection test failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Execute query through new query architecture
   */
  async executeQuery(connectionId: string, query: string): Promise<QueryResult> {
    try {
      const actualConnectionId = this.getActualConnectionId(connectionId);
      
      // Begin query execution
      const beginResponse = await invoke<QueryBeginResponse>('db_query_begin', { 
        connectionId: actualConnectionId, 
        sql: query,
        params: null,
        opts: null
      });

      // Fetch first page of results
      const fetchResponse = await invoke<QueryFetchResponse>('db_query_fetch', {
        connectionId: actualConnectionId,
        cursorId: beginResponse.cursor_id,
        page: 0,
        pageSize: 1000
      });

      return {
        columns: beginResponse.columns.map(col => col.name),
        columnMeta: beginResponse.columns,
        rows: fetchResponse.rows,
        rowCount: fetchResponse.rows.length,
        executionTime: 0,
      };
    } catch (error) {
      console.error('[SecureDatabaseService] Query execution failed:', error);
      throw error;
    }
  }

  /**
   * Execute statement (non-query) through new architecture
   */
  async executeStatement(connectionId: string, sql: string): Promise<number> {
    try {
      const actualConnectionId = this.getActualConnectionId(connectionId);
      const result = await invoke<{ rows_affected: number }>('db_execute', { 
        connectionId: actualConnectionId, 
        sql,
        params: null
      });
      return result.rows_affected;
    } catch (error) {
      console.error('[SecureDatabaseService] Statement execution failed:', error);
      throw error;
    }
  }

  /**
   * Close database connection
   */
  async closeConnection(connectionId: string): Promise<void> {
    try {
      const actualConnectionId = this.getActualConnectionId(connectionId);
      await invoke('db_disconnect', { connectionId: actualConnectionId });
    } catch (error) {
      console.error('[SecureDatabaseService] Failed to close connection:', error);
      throw error;
    }
  }

  /**
   * Get connection status via ping
   */
  async getConnectionStatus(connectionId: string): Promise<ConnectionStatus> {
    try {
      const actualConnectionId = this.getActualConnectionId(connectionId);
      const pingMs = await invoke<number>('db_ping', { connectionId: actualConnectionId });
      return {
        isConnected: pingMs >= 0,
        latency: pingMs
      };
    } catch (error) {
      return {
        isConnected: false,
        latency: -1
      };
    }
  }

  /**
   * Get default port for database type
   */
  private getDefaultPort(type: string): number {
    switch (type) {
      case 'postgresql':
      case 'postgres':
        return 5432;
      case 'mysql':
        return 3306;
      case 'sqlite':
        return 0; // SQLite doesn't use ports
      default:
        return 5432;
    }
  }

  /**
   * Execute multiple queries in a transaction
   */
  async executeTransaction(connectionId: string, queries: string[]): Promise<QueryResult[]> {
    const results: QueryResult[] = [];
    
    try {
      // Begin transaction
      await this.executeStatement(connectionId, 'BEGIN');
      
      // Execute all queries
      for (const query of queries) {
        const result = await this.executeQuery(connectionId, query);
        results.push(result);
      }
      
      // Commit transaction
      await this.executeStatement(connectionId, 'COMMIT');
      
      return results;
    } catch (error) {
      // Rollback on error
      try {
        await this.executeStatement(connectionId, 'ROLLBACK');
      } catch (rollbackError) {
        console.error('[SecureDatabaseService] Failed to rollback transaction:', rollbackError);
      }
      throw error;
    }
  }

  /**
   * Get database list using new architecture
   */
  async getDatabases(connectionId: string): Promise<string[]> {
    try {
      const actualConnectionId = this.getActualConnectionId(connectionId);
      return await invoke<string[]>('db_list_databases', { connectionId: actualConnectionId });
    } catch (error) {
      console.error('[SecureDatabaseService] Failed to fetch databases:', error);
      return [];
    }
  }

  /**
   * Get available schemas for a database
   */
  async getSchemas(connectionId: string, database?: string): Promise<string[]> {
    try {
      const actualConnectionId = this.getActualConnectionId(connectionId);
      const schemas = await invoke<string[]>('db_list_schemas', { 
        connectionId: actualConnectionId,
        database: database || ''
      });
      return schemas;
    } catch (error) {
      console.error('[SecureDatabaseService] Failed to fetch schemas:', error);
      return ['public']; // Default fallback
    }
  }

  /**
   * Get tables using backend db_list_tables command
   */
  async getTables(connectionId: string, database?: string, schema?: string): Promise<TableInfo[]> {
    try {
      const actualConnectionId = this.getActualConnectionId(connectionId);
      console.log('[SecureDatabaseService] getTables called with:', { connectionId: actualConnectionId, database, schema });
      
      // Don't default schema to 'public' - let the backend handle it based on database type
      console.log('[SecureDatabaseService] Invoking db_list_tables with params:', {
        connectionId: actualConnectionId,
        database: database || '',
        schema: schema || ''
      });
      
      const tables = await invoke<TableMeta[]>('db_list_tables', { 
        connectionId: actualConnectionId,
        database: database || '',
        schema: schema || ''
      });
      
      console.log('[SecureDatabaseService] Backend returned tables:', tables);
      
      // Transform TableMeta to TableInfo format
      return tables
        .filter(t => t.kind === 'Table')
        .map(t => ({
          name: t.name,
          schema: t.schema,
          type: 'table' as const,
          rowCount: t.row_estimate || 0
        }));
    } catch (error) {
      console.error('[SecureDatabaseService] Failed to fetch tables - Full error:', error);
      console.error('[SecureDatabaseService] Error type:', typeof error);
      console.error('[SecureDatabaseService] Error details:', JSON.stringify(error, null, 2));
      // Don't swallow the error - let it propagate
      throw error;
    }
  }

  /**
   * Get views using backend db_list_tables command
   */
  async getViews(connectionId: string, database?: string, schema?: string): Promise<ViewInfo[]> {
    try {
      const actualConnectionId = this.getActualConnectionId(connectionId);
      console.log('[SecureDatabaseService] getViews called with:', { connectionId: actualConnectionId, database, schema });
      
      // Don't default schema to 'public' - let the backend handle it based on database type
      const tables = await invoke<TableMeta[]>('db_list_tables', { 
        connectionId: actualConnectionId,
        database: database || '',
        schema: schema || ''
      });
      
      console.log('[SecureDatabaseService] Backend returned views:', tables.filter(t => t.kind === 'View' || t.kind === 'MaterializedView'));
      
      // Filter for views only and transform to ViewInfo format
      return tables
        .filter(t => t.kind === 'View' || t.kind === 'MaterializedView')
        .map(v => ({
          name: v.name,
          schema: v.schema,
          type: v.kind === 'MaterializedView' ? 'materialized_view' as const : 'view' as const,
          definition: ''
        }));
    } catch (error) {
      console.error('[SecureDatabaseService] Failed to fetch views - Full error:', error);
      console.error('[SecureDatabaseService] Error details:', JSON.stringify(error, null, 2));
      throw error;
    }
  }

  /**
   * Get functions using backend db_list_functions command
   */
  async getFunctions(connectionId: string, database?: string, schema?: string): Promise<FunctionInfo[]> {
    try {
      const actualConnectionId = this.getActualConnectionId(connectionId);
      console.log('[SecureDatabaseService] getFunctions called with:', { connectionId: actualConnectionId, database, schema });
      
      // Define FunctionMeta interface matching backend
      interface FunctionMeta {
        schema: string;
        name: string;
        return_type: string;
        arguments: string[];
      }
      
      // Don't default schema to 'public' - let the backend handle it based on database type
      const functions = await invoke<FunctionMeta[]>('db_list_functions', { 
        connectionId: actualConnectionId,
        database: database || '',
        schema: schema || ''
      });
      
      console.log('[SecureDatabaseService] Backend returned functions:', functions);
      
      // Transform to FunctionInfo format
      return functions.map(f => ({
        name: f.name,
        schema: f.schema,
        returnType: f.return_type,
        arguments: f.arguments
      }));
    } catch (error) {
      console.error('[SecureDatabaseService] Failed to fetch functions - Full error:', error);
      console.error('[SecureDatabaseService] Error details:', JSON.stringify(error, null, 2));
      throw error;
    }
  }

  /**
   * Get table columns using backend db_table_columns command
   */
  async getTableColumns(connectionId: string, database: string, schema: string, table: string): Promise<ColumnMeta[]> {
    try {
      const actualConnectionId = this.getActualConnectionId(connectionId);
      return await invoke<ColumnMeta[]>('db_table_columns', {
        connectionId: actualConnectionId,
        database,
        schema,
        table
      });
    } catch (error) {
      console.error('[SecureDatabaseService] Failed to fetch table columns:', error);
      return [];
    }
  }

  /**
   * Get table indexes using backend db_table_indexes command
   */
  async getTableIndexes(connectionId: string, database: string, schema: string, table: string): Promise<any[]> {
    try {
      const actualConnectionId = this.getActualConnectionId(connectionId);
      return await invoke<any[]>('db_table_indexes', {
        connectionId: actualConnectionId,
        database,
        schema,
        table
      });
    } catch (error) {
      console.error('[SecureDatabaseService] Failed to fetch table indexes:', error);
      return [];
    }
  }

  /**
   * Cancel a running query
   */
  async cancelQuery(connectionId: string, queryId: string): Promise<void> {
    try {
      const actualConnectionId = this.getActualConnectionId(connectionId);
      await invoke('db_query_cancel', {
        connectionId: actualConnectionId,
        queryId
      });
    } catch (error) {
      console.error('[SecureDatabaseService] Failed to cancel query:', error);
      throw error;
    }
  }

  /**
   * Update a cell value in a table
   */
  async updateCell(connectionId: string, update: {
    schema: string;
    table: string;
    column: string;
    pk: Record<string, any>;
    newValue: any;
  }): Promise<number> {
    try {
      const actualConnectionId = this.getActualConnectionId(connectionId);
      const result = await invoke<{ rows_affected: number }>('db_update_cell', {
        connectionId: actualConnectionId,
        update: {
          schema: update.schema,
          table: update.table,
          column: update.column,
          pk: update.pk,
          new_value: update.newValue
        }
      });
      return result.rows_affected;
    } catch (error) {
      console.error('[SecureDatabaseService] Failed to update cell:', error);
      throw error;
    }
  }

  /**
   * Test database connection with configuration
   * This creates a temporary connection to test connectivity without persisting it
   */
  async testConnectionConfig(config: {
    type: string;
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    ssl_mode?: string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const connectionConfig = {
        id: 'test',
        name: 'Test Connection',
        db_type: config.type === 'postgresql' ? 'Postgres' : 
                 config.type === 'mysql' ? 'Mysql' : 'Sqlite',
        host: config.host,
        port: config.port,
        database: config.database,
        username: config.username,
        password: config.password,
        ssl_mode: config.ssl_mode || 'prefer',
        max_connections: 1,
        min_connections: 1,
        connection_timeout: 5000,
        idle_timeout: 10000,
        max_lifetime: 60000,
      };

      const result = await invoke<{ success: boolean; error_message?: string }>('db_test_connection', {
        config: connectionConfig
      });

      return {
        success: result.success,
        error: result.error_message
      };
    } catch (error) {
      console.error('[SecureDatabaseService] Test connection failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }
}

export const secureDatabaseService = new SecureDatabaseService();