import { isTauri, safeInvoke, safeListen } from "@/utils/tauri";

// Types matching the Rust backend
export type CellValue = 
  | { type: "Null" }
  | { type: "Bool"; value: boolean }
  | { type: "I8"; value: number }
  | { type: "I16"; value: number }
  | { type: "I32"; value: number }
  | { type: "I64"; value: string }
  | { type: "F32"; value: number }
  | { type: "F64"; value: number }
  | { type: "String"; value: string }
  | { type: "Binary"; value: number[] }
  | { type: "Date"; value: string }
  | { type: "Time"; value: string }
  | { type: "DateTime"; value: string }
  | { type: "Decimal"; value: string }
  | { type: "Json"; value: any }
  | { type: "Uuid"; value: string }
  | { type: "Array"; value: CellValue[] }
  | { type: "Composite"; fields: Record<string, CellValue> };

export interface QueryColumn {
  name: string;
  db_type: string;
  nullable: boolean;
}

export interface QueryRow {
  values: CellValue[];
}

export interface QueryMetadata {
  columns: QueryColumn[];
  total_rows?: number;
  execution_time_ms: number;
}

export interface ExecuteQueryRequest {
  connection_id: string;
  sql: string;
  page_size?: number;
  max_rows?: number;
  timeout_ms?: number;
}

export interface QueryStreamEvent {
  query_id: string;
  event: 
    | { type: "Started"; metadata: QueryMetadata }
    | { type: "RowBatch"; rows: QueryRow[]; batch_number: number }
    | { type: "Completed"; total_rows: number; execution_time_ms: number }
    | { type: "Error"; code: string; message: string; details?: string };
}

export interface QueryResult {
  query_id: string;
  columns: QueryColumn[];
  rows: QueryRow[];
  total_rows: number;
  execution_time_ms: number;
  is_streaming: boolean;
}

export type QueryProgressCallback = (event: QueryStreamEvent) => void;
export type QueryErrorCallback = (error: { code: string; message: string }) => void;

class QueryManager {
  private static instance: QueryManager;
  private activeQueries: Map<string, {
    result: Partial<QueryResult>;
    listeners: Array<(() => void) | null>;
    callbacks: {
      progress?: QueryProgressCallback;
      error?: QueryErrorCallback;
    };
  }> = new Map();

  private constructor() {}

  static getInstance(): QueryManager {
    if (!QueryManager.instance) {
      QueryManager.instance = new QueryManager();
    }
    return QueryManager.instance;
  }

  /**
   * Execute a query with streaming support
   */
  async executeQuery(
    request: ExecuteQueryRequest,
    callbacks?: {
      onProgress?: QueryProgressCallback;
      onError?: QueryErrorCallback;
    }
  ): Promise<QueryResult> {
    if (!isTauri()) {
      throw new Error("Query execution requires Tauri runtime");
    }
    
    const queryId = crypto.randomUUID();
    
    // Initialize query tracking
    const queryState = {
      result: {
        query_id: queryId,
        columns: [],
        rows: [],
        total_rows: 0,
        execution_time_ms: 0,
        is_streaming: true,
      } as Partial<QueryResult>,
      listeners: [] as Array<(() => void) | null>,
      callbacks: {
        progress: callbacks?.onProgress,
        error: callbacks?.onError,
      },
    };
    
    this.activeQueries.set(queryId, queryState);

    try {
      // Set up event listeners for streaming
      const streamListener = await safeListen<QueryStreamEvent>(
        `query-stream-${queryId}`,
        (event) => {
          this.handleStreamEvent(queryId, event.payload);
        }
      );
      
      if (streamListener) {
        queryState.listeners.push(streamListener);
      }

      // Execute the query using streaming
      await safeInvoke("stream_query", {
        connId: request.connection_id,
        sql: request.sql,
        pageSize: request.page_size || 1000,
      });

      // Wait for completion or error
      return await this.waitForCompletion(queryId);
    } catch (error) {
      this.cleanup(queryId);
      throw error;
    }
  }

  /**
   * Execute multiple queries in sequence
   */
  async executeMultipleQueries(
    connectionId: string,
    queries: string[],
    callbacks?: {
      onQueryComplete?: (index: number, result: QueryResult) => void;
      onError?: (index: number, error: { code: string; message: string }) => void;
    }
  ): Promise<QueryResult[]> {
    const results: QueryResult[] = [];
    
    for (let i = 0; i < queries.length; i++) {
      const sql = queries[i];
      if (!sql) continue;
      
      try {
        const result = await this.executeQuery({
          connection_id: connectionId,
          sql,
        });
        results.push(result);
        callbacks?.onQueryComplete?.(i, result);
      } catch (error) {
        const errorObj = {
          code: "E_QUERY_FAILED",
          message: error instanceof Error ? error.message : String(error),
        };
        callbacks?.onError?.(i, errorObj);
        throw error;
      }
    }
    
    return results;
  }

  /**
   * Cancel an active query
   */
  async cancelQuery(queryId: string): Promise<void> {
    try {
      await safeInvoke("cancel_query", { queryId });
    } finally {
      this.cleanup(queryId);
    }
  }

  /**
   * Get active query status
   */
  getActiveQuery(queryId: string): Partial<QueryResult> | undefined {
    return this.activeQueries.get(queryId)?.result;
  }

  /**
   * Check if a query is still running
   */
  isQueryActive(queryId: string): boolean {
    return this.activeQueries.has(queryId);
  }

  /**
   * Handle streaming events from the backend
   */
  private handleStreamEvent(queryId: string, event: QueryStreamEvent): void {
    const queryState = this.activeQueries.get(queryId);
    if (!queryState) return;

    const { result, callbacks } = queryState;

    // Notify progress callback
    callbacks.progress?.(event);

    switch (event.event.type) {
      case "Started":
        result.columns = event.event.metadata.columns;
        result.execution_time_ms = event.event.metadata.execution_time_ms;
        if (event.event.metadata.total_rows !== undefined) {
          result.total_rows = event.event.metadata.total_rows;
        }
        break;

      case "RowBatch":
        if (!result.rows) result.rows = [];
        result.rows.push(...event.event.rows);
        break;

      case "Completed":
        result.total_rows = event.event.total_rows;
        result.execution_time_ms = event.event.execution_time_ms;
        result.is_streaming = false;
        break;

      case "Error":
        callbacks.error?.({
          code: event.event.code,
          message: event.event.message,
        });
        break;
    }
  }

  /**
   * Wait for query completion
   */
  private waitForCompletion(queryId: string): Promise<QueryResult> {
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        const queryState = this.activeQueries.get(queryId);
        if (!queryState) {
          clearInterval(checkInterval);
          reject(new Error("Query state lost"));
          return;
        }

        const { result } = queryState;

        // Check if query completed successfully
        if (result.is_streaming === false && result.columns && result.rows) {
          clearInterval(checkInterval);
          this.cleanup(queryId);
          resolve(result as QueryResult);
        }
      }, 100);

      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(checkInterval);
        this.cleanup(queryId);
        reject(new Error("Query timeout"));
      }, 300000);
    });
  }

  /**
   * Clean up query resources
   */
  private cleanup(queryId: string): void {
    const queryState = this.activeQueries.get(queryId);
    if (queryState) {
      // Unlisten all event listeners
      queryState.listeners.forEach(unlisten => {
        if (unlisten) unlisten();
      });
      this.activeQueries.delete(queryId);
    }
  }

  /**
   * Clean up all active queries
   */
  async cleanupAll(): Promise<void> {
    const queryIds = Array.from(this.activeQueries.keys());
    await Promise.all(queryIds.map(id => this.cancelQuery(id)));
    this.activeQueries.clear();
  }
}

export const queryManager = QueryManager.getInstance();

/**
 * Utility function to format CellValue for display
 */
export function formatCellValue(value: CellValue): string {
  switch (value.type) {
    case "Null":
      return "NULL";
    case "Bool":
      return value.value ? "true" : "false";
    case "I8":
    case "I16":
    case "I32":
    case "F32":
    case "F64":
      return String(value.value);
    case "I64":
    case "String":
    case "Decimal":
    case "Uuid":
      return value.value;
    case "Binary":
      return `<Binary ${value.value.length} bytes>`;
    case "Date":
    case "Time":
    case "DateTime":
      return value.value;
    case "Json":
      return JSON.stringify(value.value);
    case "Array":
      return `[${value.value.map(formatCellValue).join(", ")}]`;
    case "Composite":
      return JSON.stringify(value.fields);
    default:
      return "<Unknown>";
  }
}

/**
 * Utility function to get JavaScript value from CellValue
 */
export function getCellValue(value: CellValue): any {
  switch (value.type) {
    case "Null":
      return null;
    case "Bool":
      return value.value;
    case "I8":
    case "I16":
    case "I32":
    case "F32":
    case "F64":
      return value.value;
    case "I64":
      return BigInt(value.value);
    case "String":
    case "Decimal":
    case "Uuid":
    case "Date":
    case "Time":
    case "DateTime":
      return value.value;
    case "Binary":
      return new Uint8Array(value.value);
    case "Json":
      return value.value;
    case "Array":
      return value.value.map(getCellValue);
    case "Composite":
      const result: Record<string, any> = {};
      for (const [key, val] of Object.entries(value.fields)) {
        result[key] = getCellValue(val);
      }
      return result;
    default:
      return undefined;
  }
}