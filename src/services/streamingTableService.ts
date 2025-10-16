import { type UnlistenFn } from "@tauri-apps/api/event";
import { BackendAPI, type CellValue, type ColumnMeta } from "./backend";
import { queryStreamClient } from "./queryStreamClient";

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
  cursorSetupMs?: number;
  totalStreamingMs?: number;
  fetchCount?: number;
  networkMs?: number;
  conversionMs?: number;
  ipcSendMs?: number;
}

export class StreamingTableService {
  private unlistener?: UnlistenFn;
  private accumulatedRows: CellValue[][] = [];
  private columns?: ColumnMeta[];
  private isStreaming = false;

  /**
   * Stream table data with progress updates (NEW FAST PATH using channels)
   */
  async streamTable(
    options: StreamingTableOptions,
  ): Promise<StreamingTableResult> {
    const {
      connectionId,
      schema,
      table,
      pageSize = 2500, // Increased from 1000 for better performance
      onProgress,
      onError,
    } = options;

    // Build SQL query
    const sql = `SELECT * FROM ${schema}.${table}`;

    // Use the new fast streamQuery method
    return this.streamQuery(connectionId, sql, pageSize, onProgress, onError);
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
   * Stream query results with progress updates (NEW FAST PATH using channels)
   */
  async streamQuery(
    connectionId: string,
    sql: string,
    pageSize?: number,
    onProgress?: (progress: StreamingProgress) => void,
    onError?: (error: StreamingError) => void,
    userLimitPreference?: number,
    onLimitApplied?: (originalSql: string, appliedLimit: number) => void,
  ): Promise<StreamingTableResult> {
    // Cancel any existing stream
    this.cancel();

    return new Promise((resolve, reject) => {
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

        // NEW: Use fast channel-based streaming client
        queryStreamClient.streamWithCallbacks(
          {
            connId: connectionId,
            sql,
            batchSize: pageSize,
            userLimitPreference,
          },
          {
            onLimitApplied: (originalSql, appliedLimit) => {
              clearTimeout(timeoutId);
              if (onLimitApplied) {
                onLimitApplied(originalSql, appliedLimit);
              }
            },
            onStarted: (columns, estimatedRows) => {
              clearTimeout(timeoutId);
              this.columns = columns;
              if (onProgress) {
                onProgress({
                  rowsFetched: 0,
                  totalRows: estimatedRows,
                  percentage: 0,
                  columns,
                  started: true,
                });
              }
            },
            onBatch: (batch, totalSoFar) => {
              clearTimeout(timeoutId);
              this.accumulatedRows.push(...batch.rows);
              if (onProgress) {
                onProgress({
                  rowsFetched: totalSoFar,
                  newRows: batch.rows,
                  rowOffset: batch.rowOffset,
                });
              }
            },
            onSuccess: (streamResult) => {
              clearTimeout(timeoutId);
              this.isStreaming = false;
              const finalResult: StreamingTableResult = {
                columns: streamResult.columns,
                rows: this.accumulatedRows,
                isComplete: true,
                totalRows: streamResult.totalRows,
                executionTimeMs: streamResult.executionTimeMs,
                cursorSetupMs: streamResult.cursorSetupMs,
                totalStreamingMs: streamResult.totalStreamingMs,
                fetchCount: streamResult.fetchCount,
                networkMs: streamResult.networkMs,
                conversionMs: streamResult.conversionMs,
                ipcSendMs: streamResult.ipcSendMs,
              };
              if (onProgress) {
                onProgress({
                  rowsFetched: streamResult.totalRows,
                  totalRows: streamResult.totalRows,
                  executionTimeMs: streamResult.executionTimeMs,
                  completed: true,
                });
              }
              resolve(finalResult);
            },
            onError: (err) => {
              clearTimeout(timeoutId);
              this.isStreaming = false;
              // Don't call onError callback - let the component handle via catch
              // This prevents double error display (toast + banner)
              reject(err);
            },
          },
        );
      } catch (error) {
        clearTimeout(timeoutId);
        this.isStreaming = false;
        reject(error instanceof Error ? error : new Error(String(error)));
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
