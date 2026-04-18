import { logger } from "@/lib/logger";
import { queryStreamClient } from "./queryStreamClient";
import { isTauri } from "@/utils/tauri";
import { appendOverrideHint } from "./effectiveSchemas";
import type { TableDataRow } from "./tableDataTypes";
import type { ColumnMeta } from "@/types/database";
import { DbType } from "@/types";
import type { FilterConfig, SortConfig } from "@/types/filter";
import type { DatabaseAdapter, EmbeddedFKConfig } from "@/adapters/types";
import { mapBackendColumnsToColumnMeta } from "./tableDataTransform";
import { type RawCellValue } from "./backend";
import { getStreamDecodeWorker } from "./streamDecodeWorkerClient";
import { getAdapterForConnection } from "@/adapters";
import {
  formatTableName,
  filterConfigToWhereClause,
  sortConfigToOrderBy,
} from "@/adapters/formatting";
import { IntrospectionService } from "./introspectionService";

export interface StreamProgress {
  rowsFetched: number;
  totalRows?: number;
  isEstimatedCount?: boolean;
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
  embeddedFKs?: EmbeddedFKConfig[];
  onProgress?: (progress: StreamProgress) => void;
  onBatch?: (batch: TableDataRow[], rowOffset: number) => void;
  tabId?: string; // Optional: for query tabs. If not provided, uses table-specific ID
  effectiveSchemas?: string[];
  effectiveDatabase?: string;
}

export interface StreamEntityPageResult {
  columns: ColumnMeta[];
  rows: TableDataRow[];
  hasMore: boolean;
  estimatedTotal?: number;
  isEstimatedCount?: boolean; // True if count is from pg_class.reltuples (approximate), false if exact
  executionTimeMs?: number;
}

const DEFAULT_PAGE_SIZE = 100;
const POSTGRES_BROWSE_PREVIEW_BYTES = 8192;

function normalizePostgresDbType(dbType: string | undefined): string {
  return (dbType ?? "").trim().toLowerCase();
}

function isPostgresPreviewTextType(dbType: string | undefined): boolean {
  const normalized = normalizePostgresDbType(dbType);
  return (
    normalized === "text" ||
    normalized === "json" ||
    normalized === "jsonb" ||
    normalized === "xml" ||
    normalized === "citext"
  );
}

function isPostgresPreviewBinaryType(dbType: string | undefined): boolean {
  return normalizePostgresDbType(dbType) === "bytea";
}

function buildPostgresBrowseSql(
  adapter: DatabaseAdapter,
  tableName: string,
  columns: ColumnMeta[],
  rawWhere: string | undefined,
  orderBy: Array<{ column: string; direction: "ASC" | "DESC" }>,
  limit: number,
  offset: number,
): string {
  const selectList = columns
    .map((column) => {
      const alias = adapter.quoteIdentifier(column.name);
      const qualified = `${tableName}.${adapter.quoteIdentifier(column.name)}`;

      if (isPostgresPreviewTextType(column.db_type)) {
        const textValue = `${qualified}::text`;
        return `CASE WHEN ${qualified} IS NULL THEN NULL WHEN octet_length(${textValue}) > ${POSTGRES_BROWSE_PREVIEW_BYTES} THEN left(${textValue}, ${POSTGRES_BROWSE_PREVIEW_BYTES}) || '...' ELSE ${textValue} END AS ${alias}`;
      }

      if (isPostgresPreviewBinaryType(column.db_type)) {
        return `CASE WHEN ${qualified} IS NULL THEN NULL WHEN octet_length(${qualified}) > ${POSTGRES_BROWSE_PREVIEW_BYTES} THEN substring(${qualified} FROM 1 FOR ${POSTGRES_BROWSE_PREVIEW_BYTES}) ELSE ${qualified} END AS ${alias}`;
      }

      return `${qualified} AS ${alias}`;
    })
    .join(", ");

  let sql = `SELECT ${selectList} FROM ${tableName}`;

  if (rawWhere) {
    sql += ` WHERE ${rawWhere}`;
  }

  if (orderBy.length > 0) {
    const orderClause = orderBy
      .map(
        (sort) =>
          `${adapter.quoteIdentifier(sort.column)} ${sort.direction}`,
      )
      .join(", ");
    sql += ` ORDER BY ${orderClause}`;
  }

  sql += ` LIMIT ${limit}`;
  if (offset > 0) {
    sql += ` OFFSET ${offset}`;
  }

  return sql;
}

export async function streamEntityPage(
  params: StreamEntityPageParams,
): Promise<StreamEntityPageResult> {
  const {
    connectionId,
    database,
    entityType,
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
    embeddedFKs,
    tabId,
  } = params;

  // Use provided tabId or generate table-specific ID for data browsing
  const effectiveTabId = tabId ?? `table-view:${schema}.${entityName}`;
  const decodeWorker = getStreamDecodeWorker();
  // Keep a simple promise chain to preserve batch order when mapping on the worker
  let mappingQueue: Promise<void> = Promise.resolve();

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
  const adapter = (await getAdapterForConnection(connectionId)) as DatabaseAdapter;
  const columnPrefix = embeddedFKs?.length
    ? formatTableName(schema, entityName, adapter.dbType)
    : undefined;
  const columnNames =
    embeddedFKs?.length && params.columnsHint?.length
      ? params.columnsHint.map((col) => col.name)
      : undefined;
  const rawWhere = filterConfigToWhereClause(
    params.filters,
    adapter.dbType,
    columnPrefix,
    columnNames,
  );
  const orderBy = sortConfigToOrderBy(params.sorts) ?? [];

  const selectOptions = {
    columns: params.select,
    rawWhere,
    orderBy,
    limit: fetchLimit,
    offset,
    embeddedFKs,
  };

  const tableRef = { catalog: database, schema, table: entityName };
  const sql =
    adapter.dbType === DbType.PostgreSQL &&
    !embeddedFKs?.length &&
    !params.select?.length &&
    columnsHint?.length
      ? buildPostgresBrowseSql(
          adapter,
          formatTableName(schema, entityName, adapter.dbType),
          columnsHint,
          rawWhere,
          orderBy,
          fetchLimit,
          offset,
        )
      : ((embeddedFKs?.length
          ? adapter.selectWithEmbeddedFK(tableRef, selectOptions)
          : adapter.select(tableRef, selectOptions)) as string);

  // CRITICAL FIX: Wrap in promise to ensure we only resolve after ALL callbacks complete
  return new Promise<StreamEntityPageResult>((resolve, reject) => {
    // Don't use columnsHint directly when embeddedFKs are present
    // because the actual query has additional columns (__qp_fk__*) not in the hint
    let resolvedColumns: ColumnMeta[] | null = embeddedFKs?.length
      ? null
      : columnsHint ?? null;
    const rows: TableDataRow[] = [];
    let executionTimeMs: number | undefined;
    // Event-driven batch completion: onSuccess sets the target, onBatch checks after each mapping
    let expectedRowCount: number | null = null;
    let onAllBatchesMapped: (() => void) | null = null;
    // Normalize invalid estimates (reltuples can be -1 for unanalyzed tables)
    let estimatedTotal: number | undefined =
      estimatedTotalHint != null && estimatedTotalHint > 0
        ? estimatedTotalHint
        : undefined;
    let isEstimatedCount = true; // Start as estimated (from pg_class.reltuples or similar)

    const abortHandler = () => {
      reject(new DOMException("Streaming aborted", "AbortError"));
    };

    if (signal) {
      signal.addEventListener("abort", abortHandler, { once: true });
    }

    // Fetch estimated total count early for progress reporting (on first page only)
    // This uses SELECT COUNT(*) which always returns >= 0
    const useExactCount = entityType !== "table";

    const fetchEstimatedTotal = async () => {
      if (offset === 0 && !estimatedTotal) {
        try {
          const countInfo = await IntrospectionService.getTableCount(
            connectionId,
            schema,
            entityName,
            { exact: useExactCount, catalog: database },
          );
          if (countInfo.count >= 0) {
            estimatedTotal = countInfo.count;
            isEstimatedCount = countInfo.isEstimated;
            if (onProgress) {
              onProgress({
                rowsFetched: 0,
                totalRows: estimatedTotal,
                isEstimatedCount,
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
    const countPromise = fetchEstimatedTotal();

    // Wait for stream to complete
    void queryStreamClient.streamWithCallbacks(
      {
        connId: connectionId,
        tabId: effectiveTabId,
        sql,
        batchSize: fetchLimit,
        signal,
        effectiveSchemas: params.effectiveSchemas,
        effectiveDatabase: params.effectiveDatabase,
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
            logger.warn(
              "stream-service",
              `Batch with ${batch.rows.length} rows arrived before columns resolved — dropped`,
            );
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
          const columns = resolvedColumns;
          mappingQueue = mappingQueue
            .then(async () => {
              const mappedRows = await decodeWorker.mapRowsNormalized(
                rawRows,
                columns,
              );

              rows.push(...mappedRows);
              if (onBatch) {
                onBatch(mappedRows, rows.length - mappedRows.length);
              }

              if (onProgress) {
                onProgress({
                  rowsFetched: rows.length,
                  totalRows: estimatedTotal,
                  isEstimatedCount,
                });
              }

              // Event-driven: check if this was the last batch needed
              if (
                expectedRowCount !== null &&
                rows.length >= expectedRowCount &&
                onAllBatchesMapped
              ) {
                onAllBatchesMapped();
                onAllBatchesMapped = null;
              }
            })
            .catch((error: unknown) => {
              logger.error(
                "stream-service",
                "Failed to map rows in worker",
                error,
              );
            });
        },
        onSuccess: (result) => {
          void mappingQueue
            .catch(() => {
              // ignore mapping errors here, they'll have been logged
            })
            .then(async () => {
              await countPromise;
              executionTimeMs = result.executionTimeMs;
              if (onProgress) {
                onProgress({
                  rowsFetched: result.totalRows,
                  totalRows: estimatedTotal ?? result.totalRows,
                  isEstimatedCount,
                  executionTimeMs: result.executionTimeMs,
                  completed: true,
                });
              }

              // Wait until all batches are mapped (event-driven, no polling)
              // The backend sends success before all batch messages are processed,
              // so onBatch callbacks may still be in the mapping queue.
              const finalize = () => {
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
                  const fetchedFullPage = rows.length === fetchLimit;
                  let hasMore = !limitReached && fetchedFullPage;
                  if (!isEstimatedCount && estimatedTotal != null) {
                    hasMore =
                      !limitReached &&
                      offset + rows.length < estimatedTotal;
                  }

                  if (!hasMore) {
                    const actualTotal = offset + rows.length;
                    estimatedTotal = actualTotal;
                    isEstimatedCount = false;
                  }

                  resolve({
                    columns: resolvedColumns,
                    rows,
                    hasMore,
                    estimatedTotal,
                    isEstimatedCount,
                    executionTimeMs,
                  });
                } catch (error) {
                  reject(
                    error instanceof Error ? error : new Error(String(error)),
                  );
                }
              };

              const expectedRows = result.totalRows;
              if (rows.length >= expectedRows) {
                // All batches already mapped
                finalize();
              } else {
                // Tell onBatch to notify us when rows reach expected count
                expectedRowCount = expectedRows;
                const batchTimeout = setTimeout(() => {
                  onAllBatchesMapped = null;
                  logger.warn(
                    "stream-service",
                    `Timeout waiting for batches: expected ${expectedRows}, got ${rows.length}`,
                  );
                  finalize();
                }, 5000);

                onAllBatchesMapped = () => {
                  clearTimeout(batchTimeout);
                  finalize();
                };
              }
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
  newRows?: RawCellValue[][];
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
  rows: RawCellValue[][];
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
  private abortController: AbortController | null = null;
  private generation = 0;
  private accumulatedRows: RawCellValue[][] = [];
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
    _onError?: (error: StreamingError) => void,
    timeoutSecs?: number,
    options?: {
      collectRows?: boolean;
      pinSession?: boolean;
      effectiveSchemas?: string[];
      effectiveDatabase?: string;
    },
  ): Promise<StreamingTableResult> {
    this.cancel(); // Abort any previous query
    const collectRows = options?.collectRows ?? true;

    const controller = new AbortController();
    this.abortController = controller;
    const gen = this.generation;

    return new Promise((resolve, reject) => {
      try {
        this.isStreaming = true;
        this.accumulatedRows = [];
        this.columns = undefined;

        // Reject the promise when cancelled via abort
        const onAbort = () => {
          reject(new DOMException("Query cancelled", "AbortError"));
        };
        controller.signal.addEventListener("abort", onAbort, { once: true });

        void queryStreamClient.streamWithCallbacks(
          {
            connId: connectionId,
            tabId,
            sql,
            batchSize: pageSize,
            timeoutSecs,
            pinSession: options?.pinSession,
            signal: controller.signal,
            effectiveSchemas: options?.effectiveSchemas,
            effectiveDatabase: options?.effectiveDatabase,
          },
          {
            onStarted: (columns, estimatedRows) => {
              if (gen !== this.generation) return; // stale — ignore
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
              if (gen !== this.generation) return; // stale — ignore
              // BigInt→string normalization now happens in the Web Worker (streamDecode.worker.ts)
              if (collectRows) {
                this.accumulatedRows.push(...batch.rows);
              }
              if (onProgress) {
                onProgress({
                  rowsFetched: totalSoFar,
                  newRows: batch.rows,
                  rowOffset: batch.rowOffset,
                });
              }
            },
            onSuccess: (streamResult) => {
              if (gen !== this.generation) return; // stale — ignore
              // queryStreamClient guarantees all onBatch callbacks have completed
              // before calling onSuccess (via pendingDecode chain). Resolve immediately.
              controller.signal.removeEventListener("abort", onAbort);
              this.isStreaming = false;

              const finalResult: StreamingTableResult = {
                columns: mapBackendColumnsToColumnMeta(
                  streamResult.columns,
                ),
                rows: collectRows ? this.accumulatedRows : [],
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
              if (gen !== this.generation) return; // stale — ignore
              controller.signal.removeEventListener("abort", onAbort);
              this.isStreaming = false;
              // appendOverrideHint always throws — catches the enriched error
              try {
                appendOverrideHint(err, tabId);
              } catch (enriched) {
                reject(enriched);
              }
            },
          },
        );
      } catch (error) {
        this.isStreaming = false;
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  cancel(): void {
    this.generation++;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isStreaming = false;
    this.accumulatedRows = [];
    this.columns = undefined;
  }
}

export const tableStreamingService = new TableStreamingService();
