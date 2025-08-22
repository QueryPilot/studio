/**
 * Query Service
 * Delegates all database operations to the secure database service
 * which uses the new architecture commands
 */

import { type DatabaseConnection } from '@/types/database';
import { secureDatabaseService } from './secureDatabaseService';

export interface QueryResult {
  columns: string[];
  rows: any[];
  rowCount: number;
  queryTime: number;
  error?: string | null;
}

export interface QueryError {
  message: string;
  code?: string;
  details?: string;
}

class QueryService {
  // Track active query cursors for cancellation
  private activeQueries: Map<string, string> = new Map();

  async executeQuery(
    connection: DatabaseConnection,
    query: string
  ): Promise<QueryResult> {
    const startTime = performance.now();
    
    try {
      const result = await secureDatabaseService.executeQuery(connection.id, query);
      const queryTime = Math.round(performance.now() - startTime);

      return {
        columns: result.columns || [],
        rows: result.rows || [],
        rowCount: result.rowCount || 0,
        queryTime,
        error: undefined
      };
    } catch (error) {
      throw this.formatError(error);
    }
  }

  async executeUpdate(
    connection: DatabaseConnection,
    query: string
  ): Promise<{ affectedRows: number; queryTime: number }> {
    const startTime = performance.now();
    
    try {
      const affectedRows = await secureDatabaseService.executeStatement(connection.id, query);
      const queryTime = Math.round(performance.now() - startTime);

      return {
        affectedRows,
        queryTime
      };
    } catch (error) {
      throw this.formatError(error);
    }
  }

  async testConnection(connection: DatabaseConnection): Promise<boolean> {
    try {
      return await secureDatabaseService.testConnection(connection.id);
    } catch (error) {
      console.error('[QueryService] Connection test failed:', error);
      return false;
    }
  }

  async closeConnection(connectionId: string): Promise<void> {
    try {
      await secureDatabaseService.closeConnection(connectionId);
      // Clean up any active queries for this connection
      this.activeQueries.delete(connectionId);
    } catch (error) {
      console.error('[QueryService] Failed to close connection:', error);
    }
  }

  async closeAllConnections(): Promise<void> {
    // This would need to be tracked at a higher level
    // For now, clear active queries
    this.activeQueries.clear();
  }

  async cancelQuery(connectionId: string): Promise<void> {
    const queryId = this.activeQueries.get(connectionId);
    if (queryId) {
      try {
        await secureDatabaseService.cancelQuery(connectionId, queryId);
        this.activeQueries.delete(connectionId);
      } catch (error) {
        console.error('[QueryService] Failed to cancel query:', error);
      }
    }
  }

  // Execute multiple queries in sequence
  async executeMultipleQueries(
    connection: DatabaseConnection,
    queries: string[]
  ): Promise<QueryResult[]> {
    const results: QueryResult[] = [];
    
    for (const query of queries) {
      try {
        const result = await this.executeQuery(connection, query);
        results.push(result);
      } catch (error) {
        // Add error result but continue with other queries
        results.push({
          columns: [],
          rows: [],
          rowCount: 0,
          queryTime: 0,
          error: this.formatError(error).message
        });
      }
    }
    
    return results;
  }

  // Execute queries in a transaction
  async executeTransaction(
    connection: DatabaseConnection,
    queries: string[]
  ): Promise<QueryResult[]> {
    try {
      const results = await secureDatabaseService.executeTransaction(
        connection.id,
        queries
      );
      
      return results.map(result => ({
        columns: result.columns || [],
        rows: result.rows || [],
        rowCount: result.rowCount || 0,
        queryTime: 0,
        error: undefined
      }));
    } catch (error) {
      throw this.formatError(error);
    }
  }

  private formatError(error: any): QueryError {
    if (error instanceof Error) {
      // Sanitize error message to remove credentials
      let sanitizedMessage = error.message;
      
      // Remove password from PostgreSQL connection strings
      sanitizedMessage = sanitizedMessage.replace(
        /postgresql:\/\/[^:]+:([^@]+)@/g, 
        'postgresql://[username]:[REDACTED]@'
      );
      
      // Remove password from MySQL connection strings
      sanitizedMessage = sanitizedMessage.replace(
        /mysql:\/\/[^:]+:([^@]+)@/g,
        'mysql://[username]:[REDACTED]@'
      );
      
      // Remove any other potential credential patterns
      sanitizedMessage = sanitizedMessage.replace(
        /password['":\s]+=?\s*['"]?([^'"\s,;}]+)['"]?/gi,
        'password=[REDACTED]'
      );
      
      return {
        message: sanitizedMessage,
        details: error.stack
      };
    }
    
    return {
      message: String(error),
      details: String(error)
    };
  }

  // Parse query to determine type (SELECT, INSERT, UPDATE, DELETE, etc.)
  getQueryType(query: string): 'select' | 'update' | 'other' {
    const trimmed = query.trim().toUpperCase();
    if (trimmed.startsWith('SELECT') || trimmed.startsWith('WITH')) {
      return 'select';
    }
    if (
      trimmed.startsWith('INSERT') ||
      trimmed.startsWith('UPDATE') ||
      trimmed.startsWith('DELETE')
    ) {
      return 'update';
    }
    return 'other';
  }

  // Split multiple queries
  splitQueries(sql: string): string[] {
    // Simple split by semicolon (can be improved for complex cases)
    return sql
      .split(';')
      .map(q => q.trim())
      .filter(q => q.length > 0);
  }

  // Get databases for a connection
  async getDatabases(connectionId: string): Promise<string[]> {
    return await secureDatabaseService.getDatabases(connectionId);
  }

  // Get schemas for a database
  async getSchemas(connectionId: string, database: string): Promise<string[]> {
    return await secureDatabaseService.getSchemas(connectionId, database);
  }

  // Get tables for a schema
  async getTables(connectionId: string, database?: string, schema?: string) {
    return await secureDatabaseService.getTables(connectionId, database, schema);
  }

  // Get views for a schema
  async getViews(connectionId: string, database?: string, schema?: string) {
    return await secureDatabaseService.getViews(connectionId, database, schema);
  }

  // Get functions for a schema
  async getFunctions(connectionId: string, database?: string, schema?: string) {
    return await secureDatabaseService.getFunctions(connectionId, database, schema);
  }

  // Get table columns
  async getTableColumns(connectionId: string, database: string, schema: string, table: string) {
    return await secureDatabaseService.getTableColumns(connectionId, database, schema, table);
  }
}

export const queryService = new QueryService();