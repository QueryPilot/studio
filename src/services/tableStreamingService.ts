import { logger } from "@/lib/logger";
import { queryStreamClient } from "./queryStreamClient";
import { isTauri } from "@/utils/tauri";
import type { TableDataRow } from "./tableDataTypes";
import type { ColumnMeta } from "@/types/database";
import type { FilterConfig, SortConfig } from "@/types/filter";
import { mapBackendColumnsToColumnMeta } from "./tableDataTransform";
import { type CellValue } from "./backend";
import { getStreamDecodeWorker } from "./streamDecodeWorkerClient";
import { getAdapterForConnection } from "@/adapters";
import { filterConfigToWhereClause, sortConfigToOrderBy } from "@/adapters/formatting";
import { IntrospectionService } from "./introspectionService";

export interface StreamProgress {
  rowsFetched: number;
  totalRows?: number;
  percentage?: number;
  executionTimeMs?: number;
  started?: boolean;
  completed?: boolean;
}

export interface StreamEntityPageParams {
  connectionId: string;
  database: string;
  schema?: string;
  entityType: "table" | "view" | "materialized_view";
  entityName: string;
  select?: string[];
  filters?: FilterConfig;
  sorts?: SortConfig[];
  limit?: number;
  offset?: number;
  pageSize?: number;
  rowLimit?: number;
  signal?: AbortSignal;
  columnsHint?: ColumnMeta[];
  estimatedTotalHint?: number;
  onProgress?: (progress: StreamProgress) => void;
  onBatch?: (batch: TableDataRow[], rowOffset: number) => void;
  tabId?: string; // Optional: for query tabs. If not provided, uses table-specific ID
}

export interface StreamEntityPageResult {
  columns: ColumnMeta[];
  rows: TableDataRow[];
  hasMore: boolean;
  estimatedTotal?: number;
  executionTimeMs?: number;
}

const DEFAULT_PAGE_SIZE = 1000;

export async function streamEntityPage(
  params: StreamEntityPageParams,
): Promise<StreamEntityPageResult> {
  const {
    connectionId,
    schema = "public",
    entityName,
    limit,
    offset = 0,
    pageSize = DEFAULT_PAGE_SIZE,
    rowLimit,
    signal,
    onProgress,
    onBatch,
    columnsHint,
    estimatedTotalHint,
    tabId,
  } = params;

  // Use provided tabId or generate table-specific ID for data browsing
  const effectiveTabId = tabId ?? `table-view:${schema}.${entityName}`;
  const decodeWorker = getStreamDecodeWorker();
  // Keep a simple promise chain to preserve batch order when mapping on the worker
  let mappingQueue = Promise.resolve<void>(undefined);

  const basePageSize = limit ?? pageSize;
  const effectivePageSize = Math.max(1, basePageSize);
  const fetchLimit =
    rowLimit != null
      ? Math.max(1, Math.min(effectivePageSize, rowLimit))
      : effectivePageSize;
  const limitReachedByRowCap =
    rowLimit != null && offset >= rowLimit ? true : undefined;

  if (!isTauri()) {
    throw new Error(
      "Table streaming requires the Tauri runtime. Run the desktop shell to stream table data.",
    );
  }

  if (signal?.aborted) {
    throw new DOMException("Streaming aborted", "AbortError");
  }

  // Use dialect-aware SQL generation for proper quoting per database type
  const adapter = await getAdapterForConnection(connectionId);
  const rawWhere = filterConfigToWhereClause(params.filters, adapter.dbType);
  const orderBy = sortConfigToOrderBy(params.sorts);

  const sql = adapter.select(
    { schema, table: entityName },
    { columns: params.select, rawWhere, orderBy, limit: fetchLimit, offset }
  ) as string;

  // CRITICAL FIX: Wrap in promise to ensure we only resolve after ALL callbacks complete
  return new Promise<StreamEntityPageResult>((resolve, reject) => {
    let resolvedColumns: ColumnMeta[] | null = columnsHint ?? null;
    const rows: TableDataRow[] = [];
    let executionTimeMs: number | undefined;
    // Normalize invalid estimates (reltuples can be -1 for unanalyzed tables)
    let estimatedTotal: number | undefined =
      estimatedTotalHint != null && estimatedTotalHint > 0 ? estimatedTotalHint : undefined;

    const abortHandler = () => {
      reject(new DOMException("Streaming aborted", "AbortError"));
    };

    if (signal) {
      signal.addEventListener("abort", abortHandler, { once: true });
    }

    // Fetch estimated total count early for progress reporting (on first page only)
    // This uses SELECT COUNT(*) which always returns >= 0
    const fetchEstimatedTotal = async () => {
      if (offset === 0 && !estimatedTotal) {
        try {
          const count = await IntrospectionService.getTableCount(
            connectionId,
            schema,
            entityName,
          );
          if (count > 0) {
            estimatedTotal = count;
            if (onProgress) {
              onProgress({
                rowsFetched: 0,
                totalRows: estimatedTotal,
                started: true,
              });
            }
          }
        } catch (error) {
          logger.warn(
            "stream-service",
            "Failed to fetch estimated total",
            error,
          );
        }
      }
    };

    // Start fetching estimated total in parallel (don't wait for it)
    void fetchEstimatedTotal();

    // Wait for stream to complete
    void queryStreamClient.streamWithCallbacks(
      {
        connId: connectionId,
        tabId: effectiveTabId,
        sql,
        batchSize: fetchLimit,
      },
      {
        onStarted: (columns, estimatedRows) => {
          if (!resolvedColumns) {
            const mapped = mapBackendColumnsToColumnMeta(columns);
            if (columnsHint?.length) {
              const hintByName = new Map(
                columnsHint.map((col) => [col.name, col]),
              );
              resolvedColumns = mapped.map((col, index) => {
                const fromHint = hintByName.get(col.name);
                return fromHint
                  ? { ...fromHint, ordinal: index }
                  : { ...col, ordinal: index };
              });
            } else {
              resolvedColumns = mapped.map((col, index) => ({
                ...col,
                ordinal: index,
              }));
            }
          }

          if (onProgress) {
            onProgress({
              rowsFetched: 0,
              totalRows: estimatedRows,
              started: true,
            });
          }
        },
        onBatch: (batch, _totalSoFar) => {
          if (!resolvedColumns) {
            return;
          }

          if (signal?.aborted) {
            return;
          }

          let rawRows = batch.rows;
          if (rowLimit !== undefined) {
            const remaining = rowLimit - rows.length;
            if (remaining <= 0) {
              return;
            }
            rawRows = rawRows.slice(0, remaining);
          }

          if (rawRows.length === 0) {
            return;
          }

          // Offload normalization to the worker and preserve ordering via the queue
          mappingQueue = mappingQueue
            .then(async () => {
              const mappedRows = await decodeWorker.mapRowsNormalized(
                rawRows,
                resolvedColumns!,
              );

              rows.push(...mappedRows);
              if (onBatch) {
                onBatch(mappedRows, rows.length - mappedRows.length);
              }

              if (onProgress) {
                onProgress({
                  rowsFetched: rows.length,
                  totalRows: estimatedTotal,
                });
              }
            })
            .catch((error) => {
              logger.error(
                "stream-service",
                "Failed to map rows in worker",
                error,
              );
            });
        },
        onSuccess: (result) => {
          mappingQueue
            .catch(() => {
              // ignore mapping errors here, they'll have been logged
            })
            .then(() => {
              executionTimeMs = result.executionTimeMs;
              if (onProgress) {
                onProgress({
                  rowsFetched: result.totalRows,
                  totalRows: estimatedTotal ?? result.totalRows,
                  executionTimeMs: result.executionTimeMs,
                  completed: true,
                });
              }

              // CRITICAL FIX: Poll until all batches are accumulated
              // The backend sends success before all batch messages are processed
              const expectedRows = result.totalRows;
              const pollInterval = setInterval(() => {
                if (rows.length >= expectedRows) {
                  clearInterval(pollInterval);

                  try {
                    if (signal) {
                      signal.removeEventListener("abort", abortHandler);
                    }

                    if (!resolvedColumns) {
                      resolvedColumns = columnsHint ?? [];
                    }

                    const limitReached =
                      (rowLimit != null && offset + rows.length >= rowLimit) ||
                      limitReachedByRowCap === true;
                    // If we got fewer rows than requested, we've definitely reached the end
                    // This is critical when filters are applied since estimatedTotal is unfiltered count
                    const fetchedFullPage = rows.length === fetchLimit;
                    // Handle invalid estimatedTotal (-1 or negative means unknown)
                    const hasMoreFromEstimate =
                      estimatedTotal != null && estimatedTotal > 0
                        ? offset + rows.length < estimatedTotal
                        : true; // If no valid estimate, assume more data if we got a full page
                    const hasMore = !limitReached && fetchedFullPage && hasMoreFromEstimate;

                    logger.debug("stream-service", "hasMore calculation", {
                      rowsLength: rows.length,
                      fetchLimit,
                      offset,
                      estimatedTotal,
                      limitReached,
                      fetchedFullPage,
                      hasMoreFromEstimate,
                      hasMore,
                    });

                    resolve({
                      columns: resolvedColumns,
                      rows,
                      hasMore,
                      estimatedTotal,
                      executionTimeMs,
                    });
                  } catch (error) {
                    reject(
                      error instanceof Error ? error : new Error(String(error)),
                    );
                  }
                }
              }, 10);

              // Safety timeout: resolve after 5 seconds even if count doesn't match
              setTimeout(() => {
                clearInterval(pollInterval);
                logger.warn(
                  "stream-service",
                  `Timeout waiting for batches: expected ${expectedRows}, got ${rows.length}`,
                );
                resolve({
                  columns: resolvedColumns ?? columnsHint ?? [],
                  rows,
                  hasMore: false,
                  estimatedTotal: undefined,
                  executionTimeMs,
                });
              }, 5000);
            });
        },
        onError: (error) => {
          if (signal) {
            signal.removeEventListener("abort", abortHandler);
          }
          if (!signal?.aborted) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        },
      },
    );
  });
}

// Query streaming (unified API for QueryPanel)

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

class TableStreamingService {
  private unlistener?: () => void;
  private accumulatedRows: CellValue[][] = [];
  private columns?: ColumnMeta[];
  private isStreaming = false;

  isStreamingActive(): boolean {
    return this.isStreaming;
  }

  async streamQuery(
    connectionId: string,
    tabId: string,
    sql: string,
    pageSize?: number,
    onProgress?: (progress: StreamingProgress) => void,
    onError?: (error: StreamingError) => void,
  ): Promise<StreamingTableResult> {
    this.cancel();
    return new Promise((resolve, reject) => {
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

        void queryStreamClient.streamWithCallbacks(
          {
            connId: connectionId,
            tabId,
            sql,
            batchSize: pageSize,
          },
          {
            onStarted: (columns, estimatedRows) => {
              clearTimeout(timeoutId);
              this.columns = mapBackendColumnsToColumnMeta(columns);
              if (onProgress) {
                onProgress({
                  rowsFetched: 0,
                  totalRows: estimatedRows,
                  percentage: 0,
                  columns: this.columns,
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

              // CRITICAL FIX: Poll until all batches are accumulated
              // The backend sends success before all batch messages are processed
              // This is the same proven pattern used in streamEntityPage
              const expectedRows = streamResult.totalRows;
              const pollInterval = setInterval(() => {
                if (this.accumulatedRows.length >= expectedRows) {
                  clearInterval(pollInterval);

                  const finalResult: StreamingTableResult = {
                    columns: mapBackendColumnsToColumnMeta(streamResult.columns),
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
                }
              }, 10);

              // Safety timeout: resolve after 5 seconds even if count doesn't match
              setTimeout(() => {
                clearInterval(pollInterval);
                logger.warn(
                  `⚠️ streamQuery timeout waiting for batches: expected ${expectedRows}, got ${this.accumulatedRows.length}`,
                );
                const finalResult: StreamingTableResult = {
                  columns: mapBackendColumnsToColumnMeta(streamResult.columns),
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
                resolve(finalResult);
              }, 5000);
            },
            onError: (err) => {
              clearTimeout(timeoutId);
              this.isStreaming = false;
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

  cancel(): void {
    if (this.unlistener) {
      this.unlistener();
      this.unlistener = undefined;
    }
    this.isStreaming = false;
    this.accumulatedRows = [];
    this.columns = undefined;
  }
}

export const tableStreamingService = new TableStreamingService();
