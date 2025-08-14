import Database from '@tauri-apps/plugin-sql';
import { DatabaseConnection } from '@/types/database';
// Decryption now handled by Rust backend

export interface QueryResult {
  columns: string[];
  rows: any[];
  rowCount: number;
  queryTime: number;
}

export interface QueryError {
  message: string;
  code?: string;
  details?: string;
}

class QueryService {
  private connections: Map<string, Database> = new Map();

  async executeQuery(
    connection: DatabaseConnection,
    query: string
  ): Promise<QueryResult> {
    const startTime = performance.now();
    
    try {
      // Get or create database connection
      let db = this.connections.get(connection.id);
      
      if (!db) {
        const connectionString = await this.buildConnectionString(connection);
        db = await Database.load(connectionString);
        this.connections.set(connection.id, db);
      }

      // Execute query
      const result = await db.select(query) as any[];
      const queryTime = Math.round(performance.now() - startTime);

      // Extract columns from first row
      const columns = result.length > 0 ? Object.keys(result[0]) : [];

      return {
        columns,
        rows: result,
        rowCount: result.length,
        queryTime
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
      let db = this.connections.get(connection.id);
      
      if (!db) {
        const connectionString = await this.buildConnectionString(connection);
        db = await Database.load(connectionString);
        this.connections.set(connection.id, db);
      }

      const result = await db.execute(query);
      const queryTime = Math.round(performance.now() - startTime);

      return {
        affectedRows: result.rowsAffected || 0,
        queryTime
      };
    } catch (error) {
      throw this.formatError(error);
    }
  }

  async testConnection(connection: DatabaseConnection): Promise<boolean> {
    try {
      const connectionString = await this.buildConnectionString(connection);
      const db = await Database.load(connectionString);
      
      // Test with a simple query
      const testQuery = this.getTestQuery(connection.type);
      await db.select(testQuery);
      
      // Store the connection for reuse
      this.connections.set(connection.id, db);
      
      return true;
    } catch (error) {
      // Don't log the error to console as it might contain credentials
      // Just return false to indicate failure
      return false;
    }
  }

  async closeConnection(connectionId: string): Promise<void> {
    const db = this.connections.get(connectionId);
    if (db) {
      await db.close();
      this.connections.delete(connectionId);
    }
  }

  async closeAllConnections(): Promise<void> {
    for (const [, db] of this.connections) {
      await db.close();
    }
    this.connections.clear();
  }

  private async buildConnectionString(connection: DatabaseConnection): Promise<string> {
    const { type, host, port, database, username, password } = connection;
    
    // Password is already decrypted from secure storage in backend
    const decryptedPassword = password || '';
    
    switch (type) {
      case 'postgresql':
        return `postgresql://${username}:${decryptedPassword}@${host}:${port}/${database}`;
      
      case 'mysql':
        return `mysql://${username}:${decryptedPassword}@${host}:${port}/${database}`;
      
      case 'sqlite':
        return `sqlite:${database}`; // database is the file path for SQLite
      
      default:
        throw new Error(`Unsupported database type: ${type}`);
    }
  }

  private getTestQuery(type: DatabaseConnection['type']): string {
    switch (type) {
      case 'postgresql':
        return 'SELECT 1';
      case 'mysql':
        return 'SELECT 1';
      case 'sqlite':
        return 'SELECT 1';
      default:
        return 'SELECT 1';
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
      
      // Sanitize stack trace as well
      let sanitizedStack = error.stack || '';
      sanitizedStack = sanitizedStack.replace(
        /postgresql:\/\/[^:]+:([^@]+)@/g, 
        'postgresql://[username]:[REDACTED]@'
      );
      sanitizedStack = sanitizedStack.replace(
        /mysql:\/\/[^:]+:([^@]+)@/g,
        'mysql://[username]:[REDACTED]@'
      );
      
      return {
        message: sanitizedMessage,
        details: sanitizedStack
      };
    }
    
    // Sanitize string error as well
    let sanitizedError = String(error);
    sanitizedError = sanitizedError.replace(
      /postgresql:\/\/[^:]+:([^@]+)@/g, 
      'postgresql://[username]:[REDACTED]@'
    );
    sanitizedError = sanitizedError.replace(
      /mysql:\/\/[^:]+:([^@]+)@/g,
      'mysql://[username]:[REDACTED]@'
    );
    
    return {
      message: sanitizedError,
      details: sanitizedError
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
}

export const queryService = new QueryService();