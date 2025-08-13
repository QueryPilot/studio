import { invoke } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';

export interface DatabaseInfo {
  name: string;
  size?: string;
  encoding?: string;
}

export interface TableInfo {
  name: string;
  schema: string;
  table_type: string;
  row_count?: number;
  size?: string;
}

export interface ColumnInfo {
  name: string;
  data_type: string;
  is_nullable: boolean;
  is_primary_key: boolean;
  default_value?: string;
  foreign_key?: {
    table: string;
    column: string;
  };
}

export interface IndexInfo {
  name: string;
  columns: string[];
  is_unique: boolean;
  is_primary: boolean;
}

export interface ViewInfo {
  name: string;
  schema: string;
  definition?: string;
}

export interface FunctionInfo {
  name: string;
  schema: string;
  return_type: string;
  arguments: string[];
}

export interface QueryResult {
  columns: string[];
  rows: any[][];
  rowCount: number;
  executionTime: number;
}

class DatabaseService {
  private connections: Map<string, Database> = new Map();

  // Create a connection string from connection config
  private createConnectionString(config: any): string {
    const { type, host, port, database, username, password, filePath } = config;
    
    if (type === 'sqlite') {
      return `sqlite:${filePath}`;
    }
    
    if (type === 'postgresql') {
      return `postgresql://${username}:${password}@${host}:${port}/${database}`;
    }
    
    if (type === 'mysql') {
      return `mysql://${username}:${password}@${host}:${port}/${database}`;
    }
    
    throw new Error(`Unsupported database type: ${type}`);
  }

  // Test database connection
  async testConnection(config: any): Promise<boolean> {
    const connectionString = this.createConnectionString(config);
    return await invoke<boolean>('test_connection', {
      connectionString,
      dbType: config.type,
    });
  }

  // Connect to database using Tauri SQL plugin
  async connect(config: any): Promise<void> {
    const connectionString = this.createConnectionString(config);
    const db = await Database.load(connectionString);
    this.connections.set(config.id, db);
  }

  // Disconnect from database
  async disconnect(connectionId: string): Promise<void> {
    const db = this.connections.get(connectionId);
    if (db) {
      await db.close();
      this.connections.delete(connectionId);
    }
  }

  // Get list of databases
  async getDatabases(config: any): Promise<DatabaseInfo[]> {
    const connectionString = this.createConnectionString(config);
    return await invoke<DatabaseInfo[]>('get_databases', {
      connectionString,
      dbType: config.type,
    });
  }

  // Get tables for a database
  async getTables(config: any, database: string): Promise<TableInfo[]> {
    const connectionString = this.createConnectionString(config);
    return await invoke<TableInfo[]>('get_tables', {
      connectionString,
      dbType: config.type,
      database,
    });
  }

  // Get columns for a table
  async getColumns(config: any, database: string, table: string): Promise<ColumnInfo[]> {
    const connectionString = this.createConnectionString(config);
    return await invoke<ColumnInfo[]>('get_columns', {
      connectionString,
      dbType: config.type,
      database,
      table,
    });
  }

  // Get indexes for a table
  async getIndexes(config: any, database: string, table: string): Promise<IndexInfo[]> {
    const connectionString = this.createConnectionString(config);
    return await invoke<IndexInfo[]>('get_indexes', {
      connectionString,
      dbType: config.type,
      database,
      table,
    });
  }

  // Get views for a database
  async getViews(config: any, database: string): Promise<ViewInfo[]> {
    const connectionString = this.createConnectionString(config);
    return await invoke<ViewInfo[]>('get_views', {
      connectionString,
      dbType: config.type,
      database,
    });
  }

  // Get functions for a database
  async getFunctions(config: any, database: string): Promise<FunctionInfo[]> {
    const connectionString = this.createConnectionString(config);
    return await invoke<FunctionInfo[]>('get_functions', {
      connectionString,
      dbType: config.type,
      database,
    });
  }

  // Execute SQL query
  async executeQuery(config: any, database: string, query: string): Promise<QueryResult> {
    const connectionString = this.createConnectionString(config);
    return await invoke<QueryResult>('execute_query', {
      connectionString,
      dbType: config.type,
      database,
      query,
    });
  }

  // Execute query using SQL plugin directly (for simple queries)
  async executeDirectQuery(connectionId: string, query: string): Promise<any> {
    const db = this.connections.get(connectionId);
    if (!db) {
      throw new Error('Connection not found');
    }
    
    const queryLower = query.trim().toLowerCase();
    
    if (queryLower.startsWith('select')) {
      return await db.select(query);
    } else {
      return await db.execute(query);
    }
  }
}

export const databaseService = new DatabaseService();