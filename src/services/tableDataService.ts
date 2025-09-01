/**
 * TableDataService - Service for loading table data using new streaming backend
 * Provides type-safe streaming interface for table data operations
 */
import { isTauri, safeInvoke } from '@/utils/tauri';
import type {
  TableDataParams,
  TableDataCallbacks,
  TableDataRow,
} from './tableDataTypes';
import { BackendAPI } from './backend';

export class TableDataService {

  /**
   * Load table data with the provided parameters
   * Calls callbacks directly with results
   */
  async loadTableData(
    params: TableDataParams,
    callbacks: TableDataCallbacks
  ): Promise<void> {
    console.log('[TableDataService] Loading data with params:', params);
    
    try {
      // Validate parameters
      this.validateParams(params);
      console.log('[TableDataService] Parameters validated');

      if (!isTauri()) {
        console.warn('[TableDataService] Not in Tauri context, simulating completion');
        // Simulate immediate completion for browser mode
        setTimeout(() => {
          callbacks.onDone();
        }, 100);
        return;
      }
      
      // Use proper offset-based pagination API
      console.log('[TableDataService] Starting table data fetch');
      console.log('  - Table:', params.table);
      console.log('  - Schema:', params.schema || 'public');
      console.log('  - Limit:', params.limit || 1000);
      console.log('  - Offset:', params.offset || 0);
      
      // Get backend connection ID  
      const { databaseService } = await import('./databaseService');
      const backendConnectionId = databaseService.getBackendConnectionId?.(params.connectionId) || params.connectionId;
      
      // Use proper getTableData API with offset-based pagination
      const result = await BackendAPI.getTableData(
        backendConnectionId,
        params.schema || 'public',
        params.table,
        params.limit || 1000,
        params.offset || 0
      );
      
      // Get total count if it's the first page
      let estimatedTotal: number | undefined;
      if (!params.offset || params.offset === 0) {
        try {
          estimatedTotal = await BackendAPI.getTableCount(
            backendConnectionId,
            params.schema || 'public',
            params.table
          );
          console.log('[TableDataService] Table total count:', estimatedTotal);
        } catch (err) {
          console.warn('[TableDataService] Failed to get table count:', err);
        }
      }

      // Send meta information first
      callbacks.onMeta({
        type: 'meta',
        table: params.table,
        schema: params.schema,
        columns: result.columns,
        selected: result.columns.map(col => col.name),
        page_size: params.limit || 1000,
        cursor_key_columns: []
      });

      // Transform data to expected format
      const transformedRows: TableDataRow[] = result.rows.map(row => {
        const rowObj: TableDataRow = {};
        result.columns.forEach((col, index) => {
          const cellValue = row[index];
          rowObj[col.name] = {
            value: cellValue?.display_value || null,
            db_type: col.db_type || 'text',
            value_type: cellValue?.value_type || 'Text',
            is_truncated: false,
          };
        });
        return rowObj;
      });

      // Send rows with proper next page indication from backend
      callbacks.onRows({
        type: 'rows',
        rows: transformedRows,
        next_cursor: result.has_more ? 'has_more' : undefined,
        estimated_total: estimatedTotal,
      });

      // Mark as completed
      callbacks.onDone();

    } catch (error) {
      console.error('[TableDataService] Error fetching table data:', error);
      callbacks.onError({
        type: 'error',
        code: 'FETCH_ERROR',
        message: error instanceof Error ? error.message : 'Failed to fetch table data',
      });
    }
  }


  /**
   * Execute a SQL query and return results
   */
  async executeQuery(
    connectionId: string,
    database: string,
    query: string,
    options: { limit?: number; signal?: AbortSignal } = {}
  ): Promise<{ columns: string[]; rows: any[][]; error?: string }> {
    try {
      const result = await safeInvoke<{
        columns: string[];
        rows: any[][];
        error?: string;
      }>('execute_query', {
        connectionId,
        database,
        query,
        limit: options.limit || 1000,
      });

      return result;
    } catch (error) {
      console.error('[TableDataService] Query execution error:', error);
      throw error;
    }
  }

  /**
   * Validate table data parameters
   */
  private validateParams(params: TableDataParams): void {
    if (!params.connectionId || typeof params.connectionId !== 'string') {
      throw new Error('Connection ID is required and must be a string');
    }

    if (!params.database || typeof params.database !== 'string') {
      throw new Error('Database name is required and must be a string');
    }

    if (!params.table || typeof params.table !== 'string') {
      throw new Error('Table name is required and must be a string');
    }

    if (params.limit !== undefined && (params.limit < 1 || params.limit > 1000)) {
      throw new Error('Limit must be between 1 and 1000');
    }

    if (params.offset !== undefined && params.offset < 0) {
      throw new Error('Offset must be non-negative');
    }

    // Validate sort specifications
    if (params.sorts) {
      for (const sort of params.sorts) {
        if (!sort.column || typeof sort.column !== 'string') {
          throw new Error('Sort column name is required and must be a string');
        }
        if (!['asc', 'desc'].includes(sort.direction)) {
          throw new Error('Sort direction must be "asc" or "desc"');
        }
      }
    }

    // Validate filter specifications
    if (params.filters) {
      for (const filter of params.filters) {
        if (!filter.column || typeof filter.column !== 'string') {
          throw new Error('Filter column name is required and must be a string');
        }
        
        // Additional validation based on filter type would be done here
        // The discriminated union ensures type safety at compile time
      }
    }

    // Validate column selection
    if (params.select) {
      if (!Array.isArray(params.select) || params.select.length === 0) {
        throw new Error('Select must be a non-empty array of column names');
      }
      for (const column of params.select) {
        if (!column || typeof column !== 'string') {
          throw new Error('Selected column names must be non-empty strings');
        }
      }
    }
  }
}

// Export singleton instance
export const tableDataService = new TableDataService();