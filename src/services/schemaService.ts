/**
 * Schema Service
 * Manages database schema information for intellisense and autocomplete
 */

import { secureDatabaseService } from './secureDatabaseService';
import { TableInfo, ViewInfo, FunctionInfo } from '@/types/database';

export interface SchemaInfo {
  tables: TableInfo[];
  views: ViewInfo[];
  functions: FunctionInfo[];
  columns: Map<string, ColumnInfo[]>;
  lastUpdated: number;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  defaultValue?: string;
  precision?: number;
  scale?: number;
}

class SchemaService {
  private schemaCache: Map<string, SchemaInfo> = new Map();
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes

  /**
   * Get complete schema information for a connection
   */
  async getSchema(connectionId: string, forceRefresh = false): Promise<SchemaInfo> {
    const cached = this.schemaCache.get(connectionId);
    
    // Return cached if still valid
    if (cached && !forceRefresh) {
      const age = Date.now() - cached.lastUpdated;
      if (age < this.cacheTimeout) {
        return cached;
      }
    }

    // Fetch fresh schema
    try {
      const [tables, views, functions] = await Promise.all([
        secureDatabaseService.getTables(connectionId),
        secureDatabaseService.getViews(connectionId),
        secureDatabaseService.getFunctions(connectionId)
      ]);

      // Fetch columns for each table
      const columns = new Map<string, ColumnInfo[]>();
      
      for (const table of tables) {
        try {
          const tableColumns = await secureDatabaseService.getTableColumns(
            connectionId,
            '', // database - will be determined by connection
            table.schema || 'public',
            table.name
          );
          
          columns.set(
            `${table.schema || 'public'}.${table.name}`,
            tableColumns.map(col => ({
              name: col.name,
              dataType: col.db_type,
              nullable: col.nullable,
              isPrimaryKey: col.is_pk,
              isForeignKey: col.is_fk,
              defaultValue: col.default || undefined,
              precision: col.precision || undefined,
              scale: col.scale || undefined
            }))
          );
        } catch (error) {
          console.warn(`Failed to fetch columns for table ${table.name}:`, error);
        }
      }

      const schema: SchemaInfo = {
        tables,
        views,
        functions,
        columns,
        lastUpdated: Date.now()
      };

      this.schemaCache.set(connectionId, schema);
      return schema;
    } catch (error) {
      console.error('[SchemaService] Failed to fetch schema:', error);
      
      // Return empty schema on error
      return {
        tables: [],
        views: [],
        functions: [],
        columns: new Map(),
        lastUpdated: Date.now()
      };
    }
  }

  /**
   * Clear schema cache for a connection
   */
  clearCache(connectionId?: string) {
    if (connectionId) {
      this.schemaCache.delete(connectionId);
    } else {
      this.schemaCache.clear();
    }
  }

  /**
   * Get table names for autocomplete
   */
  async getTableNames(connectionId: string): Promise<string[]> {
    const schema = await this.getSchema(connectionId);
    return [
      ...schema.tables.map(t => t.name),
      ...schema.views.map(v => v.name)
    ];
  }

  /**
   * Get column names for a specific table
   */
  async getTableColumnNames(connectionId: string, tableName: string): Promise<string[]> {
    const schema = await this.getSchema(connectionId);
    
    // Try with and without schema prefix
    const columns = schema.columns.get(tableName) || 
                   schema.columns.get(`public.${tableName}`) ||
                   Array.from(schema.columns.entries())
                     .find(([key]) => key.endsWith(`.${tableName}`))?.[1];
    
    return columns?.map(c => c.name) || [];
  }

  /**
   * Get function signatures for autocomplete
   */
  async getFunctionSignatures(connectionId: string): Promise<string[]> {
    const schema = await this.getSchema(connectionId);
    return schema.functions.map(f => {
      const args = f.arguments?.join(', ') || '';
      return `${f.name}(${args})`;
    });
  }

  /**
   * Search for matching database objects
   */
  async searchObjects(connectionId: string, prefix: string): Promise<{
    tables: string[];
    columns: string[];
    functions: string[];
  }> {
    const schema = await this.getSchema(connectionId);
    const lowerPrefix = prefix.toLowerCase();

    const tables = [
      ...schema.tables.filter(t => t.name.toLowerCase().startsWith(lowerPrefix)).map(t => t.name),
      ...schema.views.filter(v => v.name.toLowerCase().startsWith(lowerPrefix)).map(v => v.name)
    ];

    const columns: string[] = [];
    schema.columns.forEach((cols, tableName) => {
      cols.forEach(col => {
        if (col.name.toLowerCase().startsWith(lowerPrefix)) {
          columns.push(col.name);
        }
      });
    });

    const functions = schema.functions
      .filter(f => f.name.toLowerCase().startsWith(lowerPrefix))
      .map(f => f.name);

    return {
      tables: [...new Set(tables)],
      columns: [...new Set(columns)],
      functions: [...new Set(functions)]
    };
  }

  /**
   * Get detailed information about a table
   */
  async getTableInfo(connectionId: string, tableName: string): Promise<{
    table?: TableInfo | ViewInfo;
    columns?: ColumnInfo[];
  }> {
    const schema = await this.getSchema(connectionId);
    
    const table = schema.tables.find(t => t.name === tableName) ||
                 schema.views.find(v => v.name === tableName);
    
    const columns = schema.columns.get(tableName) ||
                   schema.columns.get(`public.${tableName}`) ||
                   Array.from(schema.columns.entries())
                     .find(([key]) => key.endsWith(`.${tableName}`))?.[1];
    
    return { table, columns };
  }
}

export const schemaService = new SchemaService();