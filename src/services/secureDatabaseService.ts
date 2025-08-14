/**
 * Secure Database Service
 * All database operations go through Rust backend with connection pooling
 * No passwords or connection strings are ever constructed in frontend
 */

import { invoke } from '@tauri-apps/api/core';
import { DatabaseConnection, ConnectionStatus, QueryResult, TableInfo, ViewInfo, FunctionInfo } from '@/types/database';

class SecureDatabaseService {
  /**
   * Create a new database connection in the backend
   * Connection pool is managed by Rust
   */
  async createConnection(connectionId: string, config: DatabaseConnection): Promise<string> {
    return await invoke<string>('create_db_connection', {
      connectionId,
      name: config.name,
      dbType: config.type,
      host: config.host || 'localhost',
      port: config.port || this.getDefaultPort(config.type),
      database: config.database || '',
      username: config.username || '',
      // Password is fetched from secure storage in the backend
    });
  }

  /**
   * Test database connection through backend
   * Uses connection pool for testing
   */
  async testConnection(connectionId: string): Promise<boolean> {
    try {
      return await invoke<boolean>('test_db_connection', { connectionId });
    } catch (error) {
      console.error('[SecureDatabaseService] Test connection failed:', error);
      throw error;
    }
  }

  /**
   * Execute query through backend connection pool
   */
  async executeQuery(connectionId: string, query: string): Promise<QueryResult> {
    try {
      return await invoke<QueryResult>('execute_db_query', { 
        connectionId, 
        query 
      });
    } catch (error) {
      console.error('[SecureDatabaseService] Query execution failed:', error);
      throw error;
    }
  }

  /**
   * Close database connection and release pool resources
   */
  async closeConnection(connectionId: string): Promise<void> {
    try {
      await invoke('close_db_connection', { connectionId });
    } catch (error) {
      console.error('[SecureDatabaseService] Failed to close connection:', error);
      throw error;
    }
  }

  /**
   * Get connection pool status
   */
  async getConnectionStatus(connectionId: string): Promise<ConnectionStatus> {
    try {
      return await invoke<ConnectionStatus>('get_db_connection_status', { 
        connectionId 
      });
    } catch (error) {
      console.error('[SecureDatabaseService] Failed to get connection status:', error);
      throw error;
    }
  }

  /**
   * Get default port for database type
   */
  private getDefaultPort(type: string): number {
    switch (type) {
      case 'postgresql':
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
      await this.executeQuery(connectionId, 'BEGIN');
      
      // Execute all queries
      for (const query of queries) {
        const result = await this.executeQuery(connectionId, query);
        results.push(result);
      }
      
      // Commit transaction
      await this.executeQuery(connectionId, 'COMMIT');
      
      return results;
    } catch (error) {
      // Rollback on error
      try {
        await this.executeQuery(connectionId, 'ROLLBACK');
      } catch (rollbackError) {
        console.error('[SecureDatabaseService] Failed to rollback transaction:', rollbackError);
      }
      throw error;
    }
  }

  /**
   * Get database metadata through secure backend commands
   */
  async getDatabases(connectionId: string): Promise<string[]> {
    const result = await this.executeQuery(connectionId, `
      SELECT datname FROM pg_database 
      WHERE datistemplate = false
    `);
    return result.rows.map(row => row[0] as string);
  }

  async getTables(connectionId: string): Promise<TableInfo[]> {
    try {
      return await invoke<TableInfo[]>('get_db_tables', { connectionId });
    } catch (error) {
      console.error('[SecureDatabaseService] Failed to fetch tables:', error);
      return [];
    }
  }

  async getViews(connectionId: string): Promise<ViewInfo[]> {
    try {
      return await invoke<ViewInfo[]>('get_db_views', { connectionId });
    } catch (error) {
      console.error('[SecureDatabaseService] Failed to fetch views:', error);
      return [];
    }
  }

  async getFunctions(connectionId: string): Promise<FunctionInfo[]> {
    try {
      return await invoke<FunctionInfo[]>('get_db_functions', { connectionId });
    } catch (error) {
      console.error('[SecureDatabaseService] Failed to fetch functions:', error);
      return [];
    }
  }
}

export const secureDatabaseService = new SecureDatabaseService();