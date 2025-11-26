/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  invoke,
  SERIALIZE_TO_IPC_FN,
  transformCallback,
} from "@tauri-apps/api/core";
import type { ColumnMeta, CellValue, StreamMessage } from "./backend";
import { isTauri } from "../utils/tauri";
import { getStreamDecodeWorker } from "./streamDecodeWorkerClient";
import { logger } from "@/lib/logger";

export interface QueryStreamParams {
  connId: string;
  tabId: string;
  sql: string;
  batchSize?: number;
  userLimitPreference?: number;
}

export interface StreamBatch {
  rows: CellValue[][];
  rowOffset: number;
}

export interface StreamResult {
  columns: ColumnMeta[];
  totalRows: number;
  executionTimeMs: number;
  cursorSetupMs?: number;
  totalStreamingMs?: number;
  fetchCount?: number;
  networkMs?: number;
  conversionMs?: number;
  ipcSendMs?: number;
}

/**
 * QueryStreamClient - FAST PATH streaming client using Tauri IPC channels
 * Eliminates 300-350ms window.emit overhead by using direct channel communication
 */
type ChannelLike = {
  [SERIALIZE_TO_IPC_FN]: () => string;
  toJSON: () => string;
};

function createIpcChannel(handler: (message: unknown) => void): ChannelLike {
  let nextMessageId = 0;
  const pending = new Map<number, unknown>();
  const callbackId = transformCallback(
    ({ message, id }: { message: unknown; id?: number }) => {
      // Suppress ID warnings - messages are delivered sequentially anyway
      if (typeof id !== "number") {
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
    },
  );

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
      onLimitApplied?: (originalSql: string, appliedLimit: number) => void;
    },
  ): Promise<StreamResult> {
    // Check if running in Tauri context
    if (!isTauri()) {
      const error = new Error(
        "Query streaming requires Tauri context. Please run the app with 'pnpm tauri:dev' instead of 'pnpm dev'",
      );
      callbacks.onError?.(error);
      return Promise.reject(error);
    }

    const { connId, tabId, sql, batchSize = 1000, userLimitPreference } = params;

    const decodeWorker = getStreamDecodeWorker();

    return new Promise((resolve, reject) => {
      this.columns = undefined;
      this.estimatedRows = undefined;
      let totalRows = 0;
      let settled = false;
      let pendingDecode = Promise.resolve<void>(undefined);

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

      // DUAL CHANNEL: metadata (JSON) + data (raw ArrayBuffer)
      let batchCount = 0;
      // Data channel: receives raw MessagePack ArrayBuffers (Response type)
      const dataChannel = createIpcChannel((message: unknown) => {
        // Type guard: ensure message is an ArrayBuffer
        if (!(message instanceof ArrayBuffer)) {
        logger.warn(
          "query-stream",
          "Expected ArrayBuffer batch but received",
          typeof message,
        );
        return;
      }
        const buffer = message;
        // Decode off the main thread to keep UI responsive
        pendingDecode = pendingDecode
          .then(async () => {
            // Skip empty buffers (used for cancellation checks)
            if (buffer.byteLength === 0) {
              return;
            }

            const decoded = await decodeWorker.decode(buffer);

            if (!decoded || decoded.length === 0) {
              return;
            }

            totalRows += decoded.length;
            const batch: StreamBatch = {
              rows: decoded,
              rowOffset: Math.max(totalRows - decoded.length, 0),
            };
            batchCount++;
            callbacks.onBatch?.(batch, totalRows);
          })
          .catch((err) => {
            logger.error("query-stream", "Failed to decode batch", err);
          });
      });

      // Metadata channel: receives JSON StreamMessages
      const metadataChannel = createIpcChannel((message) => {
        if (!message || typeof message !== "object") {
            logger.warn(
              "query-stream",
              "Skipping malformed metadata message",
              message,
            );
            return;
          }

        const typedMessage = message as StreamMessage;

        if (typeof (typedMessage as { type?: unknown }).type !== "string") {
          logger.warn(
            "query-stream",
            "Metadata message missing type",
            typedMessage,
          );
          return;
        }

        switch (typedMessage.type) {
          case "limitApplied":
            callbacks.onLimitApplied?.(
              typedMessage.original_sql,
              typedMessage.applied_limit,
            );
            break;

          case "started":
            this.columns = typedMessage.columns;
            this.estimatedRows = typedMessage.estimated_rows;
            callbacks.onStarted?.(
              typedMessage.columns,
              typedMessage.estimated_rows,
            );
            break;

          case "success": {
            const result: StreamResult = {
              columns: this.columns || [],
              totalRows: typedMessage.total_rows,
              executionTimeMs: typedMessage.execution_time_ms,
              cursorSetupMs: typedMessage.cursor_setup_ms,
              totalStreamingMs: typedMessage.total_streaming_ms,
              fetchCount: typedMessage.fetch_count,
              networkMs: typedMessage.network_ms,
              conversionMs: typedMessage.conversion_ms,
              ipcSendMs: typedMessage.ipc_send_ms,
            };

            callbacks.onSuccess?.(result);

            // Ensure all pending decode tasks are flushed before resolving
            pendingDecode
              .catch((error) => {
                console.error(
                  "[QueryStreamClient] Pending decode error on success",
                  error,
                );
              })
              .finally(() => {
                settleResolve(result);
              });
            break;
          }

          case "error": {
            const error = new Error(
              `[${typedMessage.code}] ${typedMessage.message}`,
            );
            callbacks.onError?.(error);
            pendingDecode
              .catch(() => {
                // swallow
              })
              .finally(() => settleReject(error));
            break;
          }

          case "interrupted":
            {
              const interruptError = new Error(
                `Stream interrupted (resumable: ${typedMessage.resumable}): ${typedMessage.message}`,
              );
              callbacks.onError?.(interruptError);
              settleReject(interruptError);
            }
            break;

          default:
            logger.warn(
              "query-stream",
              "Received unknown metadata message type",
              typedMessage,
            );
            break;
        }
      });

      try {
        invoke("stream_query", {
          connId,
          tabId,
          sql,
          batchSize,
          userLimitPreference,
          metadataChannel,
          dataChannel,
        }).catch((error: unknown) => {
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
