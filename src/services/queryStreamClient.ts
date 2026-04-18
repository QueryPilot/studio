/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { logger } from "@/lib/logger";
import {
  invoke,
  SERIALIZE_TO_IPC_FN,
  transformCallback,
} from "@tauri-apps/api/core";
import type {
  QueryColumnMeta,
  RawCellValue,
  StreamMessage,
} from "./backend";
import { isTauri } from "../utils/tauri";
import { getStreamDecodeWorker, prewarmStreamDecodeWorker } from "./streamDecodeWorkerClient";

export interface QueryStreamParams {
  connId: string;
  tabId: string;
  sql: string;
  batchSize?: number;
  /** Query timeout in seconds. Default: 300 (5 minutes) */
  timeoutSecs?: number;
  /** Force a tab-scoped backend session, even when the connection is in pooler mode. */
  pinSession?: boolean;
  /** Abort the stream and tear down the IPC callbacks. */
  signal?: AbortSignal;
  /** Ordered schemas for search_path / completion scope. Phase 1. */
  effectiveSchemas?: string[];
  /** Active catalog/database for multi-catalog dialects. Phase 1. */
  effectiveDatabase?: string;
}

export interface StreamBatch {
  rows: RawCellValue[][];
  rowOffset: number;
}

export interface StreamResult {
  columns: QueryColumnMeta[];
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

type IpcChannelHandle = ChannelLike & {
  id: number;
  close: () => void;
};

type OrderedIpcPayload = {
  index?: number;
  id?: number;
  message?: unknown;
  end?: boolean;
};

function isOrderedIpcPayload(payload: unknown): payload is OrderedIpcPayload {
  return typeof payload === "object" && payload !== null;
}

function getOrderedPayloadIndex(payload: OrderedIpcPayload): number | undefined {
  if (typeof payload.index === "number") {
    return payload.index;
  }
  if (typeof payload.id === "number") {
    return payload.id;
  }
  return undefined;
}

function unregisterIpcCallback(id: number): void {
  (
    window as Window & {
      __TAURI_INTERNALS__?: { unregisterCallback?: (callbackId: number) => void };
    }
  ).__TAURI_INTERNALS__?.unregisterCallback?.(id);
}

function makeAbortError(): Error {
  try {
    return new DOMException("Query cancelled", "AbortError");
  } catch {
    const error = new Error("Query cancelled");
    error.name = "AbortError";
    return error;
  }
}

function createIpcChannel(handler: (message: unknown) => void): IpcChannelHandle {
  let nextMessageId = 0;
  const pending = new Map<number, unknown>();
  let messageEndIndex: number | undefined;
  let closed = false;
  const callbackId = transformCallback(
    (payload: unknown) => {
      if (closed) {
        return;
      }
      if (!isOrderedIpcPayload(payload)) {
        handler(payload);
        return;
      }

      const messageIndex = getOrderedPayloadIndex(payload);
      if (payload.end === true) {
        if (
          typeof messageIndex === "number" &&
          messageIndex > nextMessageId
        ) {
          messageEndIndex = messageIndex;
        }
        return;
      }

      const message =
        "message" in payload ? payload.message : payload;

      if (typeof messageIndex !== "number") {
        handler(message);
        return;
      }

      if (messageIndex === nextMessageId) {
        nextMessageId++;
        handler(message);

        while (pending.has(nextMessageId)) {
          const next = pending.get(nextMessageId)!;
          pending.delete(nextMessageId);
          nextMessageId++;
          handler(next);
        }

        if (
          messageEndIndex !== undefined &&
          nextMessageId >= messageEndIndex
        ) {
          pending.clear();
        }
      } else if (messageIndex > nextMessageId) {
        pending.set(messageIndex, message);
      } else {
        // Late arrival; deliver but do not disturb ordering state
        handler(message);
      }
    },
  );

  const serializedId = `__CHANNEL__:${String(callbackId)}`;
  return {
    id: callbackId,
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      pending.clear();
      unregisterIpcCallback(callbackId);
    },
    [SERIALIZE_TO_IPC_FN]: () => serializedId,
    toJSON: () => serializedId,
  };
}

export class QueryStreamClient {
  private columns?: QueryColumnMeta[];
  private estimatedRows?: number;

  /**
   * Stream query results using async generator for easy consumption
   * NOTE: Currently unused - streamWithCallbacks() is the primary API
   *
   * @example
   * const client = new QueryStreamClient();
   * for await (const batch of client.stream({ connId, sql })) {
   *   logger.info(`Received ${batch.rows.length} rows at offset ${batch.rowOffset}`);
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
          await invoke("execute_query", {
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
      onStarted?: (
        columns: QueryColumnMeta[],
        estimatedRows?: number,
      ) => void;
      onBatch?: (batch: StreamBatch, totalSoFar: number) => void;
      onSuccess?: (result: StreamResult) => void;
      onError?: (error: Error) => void;
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

    const {
      connId,
      tabId,
      sql,
      batchSize = 1000,
      timeoutSecs,
      pinSession,
      signal,
      effectiveSchemas,
      effectiveDatabase,
    } = params;

    const decodeWorker = getStreamDecodeWorker();

    return new Promise((resolve, reject) => {
      this.columns = undefined;
      this.estimatedRows = undefined;
      let totalRows = 0;
      let settled = false;
      let pendingDecode = Promise.resolve();
      let invokeCompleted = false;
      let successResult: StreamResult | null = null;
      let finalizingSuccess = false;
      let decodeFailure: Error | null = null;

      const normalizeError = (err: unknown): Error =>
        err instanceof Error ? err : new Error(String(err));

      const sleep = (ms: number) =>
        new Promise<void>((resolveSleep) => {
          setTimeout(resolveSleep, ms);
        });

      const drainPendingDecode = async (
        expectedRows: number,
        expectedBatches?: number,
        options?: {
          skipRowExpectation?: boolean;
        },
      ) => {
        const deadline = Date.now() + 2000;

        for (;;) {
          const snapshot = pendingDecode;
          await snapshot.catch((error: unknown) => {
            logger.error(
              "query-stream",
              "Pending decode error while draining stream",
              error,
            );
          });

          if (decodeFailure) {
            return;
          }

          const decodeQueueStable = snapshot === pendingDecode;
          const haveExpectedRows =
            options?.skipRowExpectation === true || totalRows >= expectedRows;
          const haveExpectedBatches =
            expectedBatches === undefined || batchCount >= expectedBatches;

          if (decodeQueueStable && haveExpectedRows && haveExpectedBatches) {
            return;
          }

          if (Date.now() >= deadline) {
            logger.warn(
              "query-stream",
              "Timed out waiting for trailing stream batches",
              {
                expectedRows,
                decodedRows: totalRows,
                expectedBatches,
                decodedBatches: batchCount,
              },
            );
            return;
          }

          await sleep(5);
        }
      };

      const maybeFinalizeSuccess = () => {
        if (settled || finalizingSuccess) return;
        if (!invokeCompleted || !successResult) return;

        finalizingSuccess = true;
        const result = successResult;
        const isMetadataOnlyMutation =
          result.columns.length === 0 &&
          batchCount === 0 &&
          result.totalRows > 0;

        void drainPendingDecode(result.totalRows, result.fetchCount, {
          skipRowExpectation: isMetadataOnlyMutation,
        })
          .catch((error: unknown) => {
            logger.error(
              "query-stream",
              "Failed while waiting for trailing batches",
              error,
            );
          })
          .finally(() => {
            if (decodeFailure) {
              callbacks.onError?.(decodeFailure);
              settleReject(decodeFailure);
              return;
            }

            if (!isMetadataOnlyMutation && totalRows !== result.totalRows) {
              const mismatchError = new Error(
                `Stream completed with ${totalRows} decoded rows, expected ${result.totalRows}`,
              );
              callbacks.onError?.(mismatchError);
              settleReject(mismatchError);
              return;
            }

            callbacks.onSuccess?.(result);
            settleResolve(result);
          });
      };

      const settleResolve = (result: StreamResult) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", handleAbort);
        closeChannels();
        resolve(result);
      };

      const settleReject = (error: Error) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", handleAbort);
        closeChannels();
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
        if (settled) {
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

            if (decoded.length === 0) {
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
          .catch((err: unknown) => {
            decodeFailure = normalizeError(err);
            logger.error("query-stream", "Failed to decode batch", decodeFailure);
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
        if (settled) {
          return;
        }

        switch (typedMessage.type) {
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

            // Success metadata can arrive before trailing data batches from the
            // separate data channel. Defer completion until invoke() returns and
            // decode queue is fully drained to avoid truncating rows.
            successResult = result;
            maybeFinalizeSuccess();
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
              .finally(() => { settleReject(error); });
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

      let channelsClosed = false;
      const closeChannels = () => {
        if (channelsClosed) {
          return;
        }
        channelsClosed = true;
        dataChannel.close();
        metadataChannel.close();
      };

      const handleAbort = () => {
        if (settled) {
          return;
        }
        const abortError = makeAbortError();
        callbacks.onError?.(abortError);
        settleReject(abortError);
      };

      if (signal?.aborted) {
        handleAbort();
        return;
      }

      signal?.addEventListener("abort", handleAbort, { once: true });

      try {
        invoke("execute_query", {
          connId,
          tabId,
          sql,
          batchSize,
          timeoutSecs,
          pinSession,
          effectiveSchemas,
          effectiveDatabase,
          metadataChannel,
          dataChannel,
        })
          .then(() => {
            invokeCompleted = true;
            maybeFinalizeSuccess();
          })
          .catch((error: unknown) => {
            const normalized = normalizeError(error);
            invokeCompleted = true;

            // If success metadata already arrived, treat invoke rejection as a
            // late channel-close artifact and finish with success after drain.
            if (successResult) {
              logger.warn(
                "query-stream",
                "invoke() rejected after success metadata; draining trailing batches",
                normalized,
              );
              maybeFinalizeSuccess();
              return;
            }
            if (settled) {
              return;
            }

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
  getColumns(): QueryColumnMeta[] | undefined {
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

// Pre-warm the decode worker so the first query doesn't pay ~500ms init cost
if (typeof Worker !== "undefined") {
  prewarmStreamDecodeWorker();
}
