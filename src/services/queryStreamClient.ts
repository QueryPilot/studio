import {
  invoke,
  SERIALIZE_TO_IPC_FN,
  transformCallback,
} from "@tauri-apps/api/core";
import type { ColumnMeta, CellValue, StreamMessage } from "./backend";
import { isTauri } from "../utils/tauri";

export interface QueryStreamParams {
  connId: string;
  sql: string;
  batchSize?: number;
}

export interface StreamBatch {
  rows: CellValue[][];
  rowOffset: number;
}

export interface StreamResult {
  columns: ColumnMeta[];
  totalRows: number;
  executionTimeMs: number;
}

/**
 * QueryStreamClient - FAST PATH streaming client using Tauri IPC channels
 * Eliminates 300-350ms window.emit overhead by using direct channel communication
 */
type ChannelLike<T> = {
  [SERIALIZE_TO_IPC_FN]: () => string;
  toJSON: () => string;
};

function createIpcChannel<T>(handler: (message: T) => void): ChannelLike<T> {
  let nextMessageId = 0;
  const pending = new Map<number, T>();
  const callbackId = transformCallback(({ message, id }: { message: T; id?: number }) => {
    if (typeof id !== "number") {
      console.warn(
        "[QueryStreamClient] Received channel message missing id; delivering immediately",
        message,
      );
      handler(message);
      return;
    }

    if (id === nextMessageId) {
      nextMessageId++;
      handler(message);

      while (pending.has(nextMessageId)) {
        const next = pending.get(nextMessageId)!;
        pending.delete(nextMessageId);
        nextMessageId++;
        handler(next);
      }
    } else if (id > nextMessageId) {
      pending.set(id, message);
    } else {
      // Late arrival; deliver but do not disturb ordering state
      handler(message);
    }
  });

  const serializedId = `__CHANNEL__:${String(callbackId)}`;
  return {
    [SERIALIZE_TO_IPC_FN]: () => serializedId,
    toJSON: () => serializedId,
  };
}

export class QueryStreamClient {
  private columns?: ColumnMeta[];
  private estimatedRows?: number;

  /**
   * Stream query results using async generator for easy consumption
   * NOTE: Currently unused - streamWithCallbacks() is the primary API
   *
   * @example
   * const client = new QueryStreamClient();
   * for await (const batch of client.stream({ connId, sql })) {
   *   console.log(`Received ${batch.rows.length} rows at offset ${batch.rowOffset}`);
   * }
   */
  /*
  async *stream(params: QueryStreamParams): AsyncGenerator<StreamBatch, StreamResult, void> {
    const { connId, sql, batchSize = 1000 } = params;

    return yield* new Promise<AsyncGenerator<StreamBatch, StreamResult, void>>(
      async (resolve, reject) => {
        const batches: StreamBatch[] = [];

        const channel = createIpcChannel<StreamMessage>((message) => {
          switch (message.type) {
            case "started":
              this.columns = message.columns;
              this.estimatedRows = message.estimated_rows;
              break;

            case "batch":
              batches.push({
                rows: message.rows,
                rowOffset: message.row_offset,
              });
              break;

            case "success":
              const result: StreamResult = {
                columns: this.columns || [],
                totalRows: message.total_rows,
                executionTimeMs: message.execution_time_ms,
              };

              resolve(
                (async function* () {
                  for (const batch of batches) {
                    yield batch;
                  }
                  return result;
                })()
              );
              break;

            case "error":
              reject(new Error(`[${message.code}] ${message.message}`));
              break;

            case "interrupted":
              reject(
                new Error(
                  `Stream interrupted (resumable: ${message.resumable}): ${message.message}`
                )
              );
              break;
          }
        });

        try {
          await invoke("stream_query", {
            connId,
            sql,
            batchSize,
            channel,
          });
        } catch (error) {
          reject(error);
        }
      }
    );
  }
  */

  /**
   * Stream query with callback-based progress updates (alternative API)
   */
  async streamWithCallbacks(
    params: QueryStreamParams,
    callbacks: {
      onStarted?: (columns: ColumnMeta[], estimatedRows?: number) => void;
      onBatch?: (batch: StreamBatch, totalSoFar: number) => void;
      onSuccess?: (result: StreamResult) => void;
      onError?: (error: Error) => void;
    }
  ): Promise<StreamResult> {
    // Check if running in Tauri context
    if (!isTauri()) {
      const error = new Error(
        "Query streaming requires Tauri context. Please run the app with 'pnpm tauri:dev' instead of 'pnpm dev'"
      );
      callbacks.onError?.(error);
      return Promise.reject(error);
    }

    const { connId, sql, batchSize = 1000 } = params;

    return new Promise((resolve, reject) => {
      this.columns = undefined;
      this.estimatedRows = undefined;
      let totalRows = 0;
      let settled = false;

      const normalizeError = (err: unknown): Error =>
        err instanceof Error ? err : new Error(String(err));

      const settleResolve = (result: StreamResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const settleReject = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      const channel = createIpcChannel<StreamMessage>((message) => {
        switch (message.type) {
          case "started":
            this.columns = message.columns;
            this.estimatedRows = message.estimated_rows;
            callbacks.onStarted?.(message.columns, message.estimated_rows);
            break;

          case "batch":
            totalRows += message.rows.length;
            const batch: StreamBatch = {
              rows: message.rows,
              rowOffset: message.row_offset,
            };
            callbacks.onBatch?.(batch, totalRows);
            break;

          case "success":
            const result: StreamResult = {
              columns: this.columns || [],
              totalRows: message.total_rows,
              executionTimeMs: message.execution_time_ms,
            };
            callbacks.onSuccess?.(result);
            settleResolve(result);
            break;

          case "error":
            {
              const error = new Error(`[${message.code}] ${message.message}`);
              callbacks.onError?.(error);
              settleReject(error);
            }
            break;

          case "interrupted":
            {
              const interruptError = new Error(
                `Stream interrupted (resumable: ${message.resumable}): ${message.message}`
              );
              callbacks.onError?.(interruptError);
              settleReject(interruptError);
            }
            break;
        }
      });

      try {
        invoke("stream_query", {
          connId,
          sql,
          batchSize,
          channel,
        }).catch((error) => {
          const normalized = normalizeError(error);
          callbacks.onError?.(normalized);
          settleReject(normalized);
        });
      } catch (error) {
        const normalized = normalizeError(error);
        callbacks.onError?.(normalized);
        settleReject(normalized);
      }
    });
  }

  /**
   * Get cached column metadata from last stream
   */
  getColumns(): ColumnMeta[] | undefined {
    return this.columns;
  }

  /**
   * Get estimated row count from last stream
   */
  getEstimatedRows(): number | undefined {
    return this.estimatedRows;
  }
}

// Singleton instance for convenience
export const queryStreamClient = new QueryStreamClient();
