import { type UnlistenFn } from "@tauri-apps/api/event";
import {
  BackendAPI,
  type StreamEvent,
  type CellValue,
  type ColumnMeta,
  type TableDataResult,
} from "./backend";

export interface StreamingTableOptions {
  connectionId: string;
  schema: string;
  table: string;
  pageSize?: number;
  onProgress?: (progress: StreamingProgress) => void;
  onError?: (error: StreamingError) => void;
}

export interface StreamingProgress {
  rowsFetched: number;
  totalRows?: number;
  percentage?: number;
  executionTimeMs?: number;
  // New incremental streaming details
  newRows?: CellValue[][];
  rowOffset?: number;
  columns?: ColumnMeta[];
  started?: boolean;
  completed?: boolean;
}

export interface StreamingError {
  message: string;
  code?: string;
}

export interface StreamingTableResult {
  columns: ColumnMeta[];
  rows: CellValue[][];
  isComplete: boolean;
  totalRows?: number;
  executionTimeMs?: number;
}

export class StreamingTableService {
  private currentStreamId?: string;
  private unlistener?: UnlistenFn;
  private accumulatedRows: CellValue[][] = [];
  private columns?: ColumnMeta[];
  private isStreaming = false;

  /**
   * Stream table data with progress updates
   */
  async streamTable(
    options: StreamingTableOptions,
  ): Promise<StreamingTableResult> {
    // Cancel any existing stream
    this.cancel();

    const {
      connectionId,
      schema,
      table,
      pageSize = 1000,
      onProgress,
      onError,
    } = options;

    // Build SQL query
    const sql = `SELECT * FROM ${schema}.${table}`;

    return new Promise(async (resolve, reject) => {
      // Set a timeout to prevent hanging
      const timeoutId = setTimeout(() => {
        this.isStreaming = false;
        const error: StreamingError = {
          message: `Stream timeout: No response from backend after 30 seconds`,
          code: "STREAM_TIMEOUT",
        };
        if (onError) {
          onError(error);
        }
        reject(new Error(error.message));
      }, 30000);

      try {
        this.isStreaming = true;
        this.accumulatedRows = [];
        this.columns = undefined;

        // Start streaming
        this.currentStreamId = await BackendAPI.streamQuery(
          connectionId,
          sql,
          pageSize,
          (event: StreamEvent) => {
            // Clear timeout on first event
            clearTimeout(timeoutId);

            switch (event.type) {
              case "Started":
                this.columns = event.columns;
                if (onProgress) {
                  onProgress({
                    rowsFetched: 0,
                    totalRows: event.estimated_rows,
                    percentage: 0,
                  });
                }
                break;

              case "Data":
                this.accumulatedRows.push(...event.rows);
                if (onProgress) {
                  onProgress({
                    rowsFetched: this.accumulatedRows.length,
                    percentage: undefined, // Will be updated by Progress event
                  });
                }
                break;

              case "Progress":
                if (onProgress) {
                  onProgress({
                    rowsFetched: event.rows_fetched,
                    percentage: event.percentage,
                  });
                }
                break;

              case "Completed":
                clearTimeout(timeoutId);
                this.isStreaming = false;
                resolve({
                  columns: this.columns || [],
                  rows: this.accumulatedRows,
                  isComplete: true,
                  totalRows: event.total_rows,
                  executionTimeMs: event.execution_time_ms,
                });
                break;

              case "Error":
                clearTimeout(timeoutId);
                this.isStreaming = false;
                const error: StreamingError = {
                  message: event.message,
                  code: event.code,
                };
                if (onError) {
                  onError(error);
                }
                reject(new Error(error.message));
                break;
            }
          },
        );
      } catch (error) {
        clearTimeout(timeoutId);
        this.isStreaming = false;
        reject(error);
      }
    });
  }

  /**
   * Load table data with pagination (non-streaming)
   */
  async loadTablePage(
    connectionId: string,
    schema: string,
    table: string,
    limit: number,
    offset: number,
  ): Promise<TableDataResult> {
    return BackendAPI.getTableData(connectionId, schema, table, limit, offset);
  }

  /**
   * Get total row count for a table
   */
  async getTableCount(
    connectionId: string,
    schema: string,
    table: string,
  ): Promise<number> {
    return BackendAPI.getTableCount(connectionId, schema, table);
  }

  /**
   * Stream query results with progress updates
   */
  async streamQuery(
    connectionId: string,
    sql: string,
    pageSize?: number,
    onProgress?: (progress: StreamingProgress) => void,
    onError?: (error: StreamingError) => void,
  ): Promise<StreamingTableResult> {
    // Cancel any existing stream
    this.cancel();

    return new Promise(async (resolve, reject) => {
      // Set a timeout to prevent hanging
      const timeoutId = setTimeout(() => {
        this.isStreaming = false;
        const error: StreamingError = {
          message: `Stream timeout: No response from backend after 30 seconds`,
          code: "STREAM_TIMEOUT",
        };
        if (onError) {
          onError(error);
        }
        reject(new Error(error.message));
      }, 30000);

      try {
        this.isStreaming = true;
        this.accumulatedRows = [];
        this.columns = undefined;

        // Start streaming
        this.currentStreamId = await BackendAPI.streamQuery(
          connectionId,
          sql,
          pageSize,
          (event: StreamEvent) => {
            // Clear timeout on first event
            clearTimeout(timeoutId);

            switch (event.type) {
              case "Started":
                this.columns = event.columns;
                if (onProgress) {
                  onProgress({
                    rowsFetched: 0,
                    totalRows: event.estimated_rows,
                    percentage: 0,
                    columns: event.columns,
                    started: true,
                  });
                }
                break;

              case "Data":
                this.accumulatedRows.push(...event.rows);
                if (onProgress) {
                  onProgress({
                    rowsFetched: this.accumulatedRows.length,
                    newRows: event.rows,
                    rowOffset: event.row_offset,
                  });
                }
                break;

              case "Progress":
                if (onProgress) {
                  onProgress({
                    rowsFetched: event.rows_fetched,
                    percentage: event.percentage,
                  });
                }
                break;

              case "Completed":
                clearTimeout(timeoutId);
                this.isStreaming = false;
                const result = {
                  columns: this.columns || [],
                  rows: this.accumulatedRows,
                  isComplete: true,
                  totalRows: event.total_rows,
                  executionTimeMs: event.execution_time_ms,
                } as StreamingTableResult;
                if (onProgress) {
                  onProgress({
                    rowsFetched: this.accumulatedRows.length,
                    totalRows: event.total_rows,
                    executionTimeMs: event.execution_time_ms,
                    completed: true,
                  });
                }
                resolve(result);
                break;

              case "Error":
                clearTimeout(timeoutId);
                this.isStreaming = false;
                const error: StreamingError = {
                  message: event.message,
                  code: event.code,
                };
                if (onError) {
                  onError(error);
                }
                reject(new Error(error.message));
                break;
            }
          },
        );
      } catch (error) {
        clearTimeout(timeoutId);
        this.isStreaming = false;
        reject(error);
      }
    });
  }

  /**
   * Cancel current streaming operation
   */
  cancel(): void {
    if (this.unlistener) {
      this.unlistener();
      this.unlistener = undefined;
    }
    this.currentStreamId = undefined;
    this.isStreaming = false;
    this.accumulatedRows = [];
    this.columns = undefined;
  }

  /**
   * Check if currently streaming
   */
  isStreamingActive(): boolean {
    return this.isStreaming;
  }

  /**
   * Get current accumulated rows (partial result)
   */
  getCurrentRows(): CellValue[][] {
    return this.accumulatedRows;
  }

  /**
   * Get columns from current stream
   */
  getCurrentColumns(): ColumnMeta[] | undefined {
    return this.columns;
  }
}

// Singleton instance
export const streamingTableService = new StreamingTableService();
