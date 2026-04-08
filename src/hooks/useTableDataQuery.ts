import { logger } from "@/lib/logger";
import { databaseService } from "@/services/databaseService";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
  type QueryObserverResult,
} from "@tanstack/react-query";
import type { ColumnMeta } from "@/types/database";
import type { TableDataRow } from "@/services/tableDataTypes";
import type { FilterConfig, SortConfig } from "@/types/filter";
import type { EmbeddedFKConfig } from "@/adapters/types";
import { tableDataQueryKey, tableStructureQueryKey } from "./queryKeys";
import {
  fetchTableStructure,
  type TableStructureQueryParams,
} from "./useTableFullStructure";
import {
  streamEntityPage,
  type StreamEntityPageResult,
  type StreamProgress,
} from "@/services/tableStreamingService";
import type { TableStructure } from "@/types/tableStructure";

export interface TableDataPage extends StreamEntityPageResult {
  offset: number;
}

export interface UseTableDataQueryParams {
  connectionId: string;
  database: string;
  schema?: string;
  entityName: string;
  entityType: "table" | "view" | "materialized_view";
  tabId?: string;
  select?: string[];
  filters?: FilterConfig;
  sorts?: SortConfig[];
  limit?: number;
  pageSize?: number;
  rowLimit?: number;
  enabled?: boolean;
  reuseStructure?: boolean;
  embeddedFKs?: EmbeddedFKConfig[];
}

export interface UseTableDataQueryResult {
  data: InfiniteData<TableDataPage> | undefined;
  rows: TableDataRow[];
  columns: ColumnMeta[];
  estimatedTotal?: number;
  isEstimatedCount?: boolean; // True if count is estimated, false if exact
  status: "idle" | "loading" | "success" | "error";
  error: unknown;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => Promise<void>;
  refetch: () => Promise<
    QueryObserverResult<InfiniteData<TableDataPage>, unknown>
  >;
  cancelStream: () => void;
  progress: StreamProgress | null;
}

export function useTableDataQuery(
  params: UseTableDataQueryParams,
): UseTableDataQueryResult {
  const {
    connectionId,
    database,
    schema,
    entityName,
    entityType,
    tabId,
    select,
    filters,
    sorts,
    limit,
    pageSize,
    rowLimit,
    enabled = true,
    reuseStructure = true,
    embeddedFKs,
  } = params;

  const queryClient = useQueryClient();
  const abortControllerRef = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<StreamProgress | null>(null);
  const isStreamingRef = useRef(false); // Track if currently streaming a page

  const queryKey = tableDataQueryKey({
    connectionId,
    database,
    schema,
    entityType,
    entityName,
    filters,
    sorts,
    limit,
    pageSize,
    embeddedFKs,
  });

  const structureKey = tableStructureQueryKey({
    connectionId,
    database,
    schema: schema ?? "",
    table: entityName,
    options: undefined,
  });

  const loadStructure = useCallback(async () => {
    if (!reuseStructure) {
      return undefined;
    }

    try {
      const cached = queryClient.getQueryData<TableStructure>(structureKey);
      if (cached) {
        return cached;
      }

      const structureParams: TableStructureQueryParams = {
        connectionId,
        database,
        schema: schema ?? "",
        table: entityName,
      };

      return await queryClient.ensureQueryData({
        queryKey: structureKey,
        queryFn: () => fetchTableStructure(structureParams),
      });
    } catch (error) {
      logger.warn(
        "table-data-query",
        "Failed to load table structure for columns hint",
        error,
      );
      return undefined;
    }
  }, [
    connectionId,
    database,
    schema,
    entityName,
    queryClient,
    reuseStructure,
    structureKey,
  ]);

  const queryFn = useCallback(
    async ({
      pageParam,
      signal,
    }: {
      pageParam?: { offset: number };
      signal?: AbortSignal;
    }): Promise<TableDataPage> => {
      const currentOffset = pageParam?.offset ?? 0;
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Store abort handler ref for cleanup
      let abortHandler: (() => void) | undefined;

      if (signal) {
        if (signal.aborted) {
          controller.abort();
          throw new Error("Query aborted");
        }
        abortHandler = () => {
          controller.abort();
        };
        signal.addEventListener("abort", abortHandler, { once: true });
      }

      setProgress({ rowsFetched: 0, started: true });

      let columnsHint: ColumnMeta[] | undefined;
      let structureRowCount: number | undefined;
      let estimatedTotalHint: number | undefined;
      let isEstimatedCountHint: boolean | undefined;

      // Start structure load in parallel with the stream — it's only needed as a hint.
      // If cached, this resolves immediately; otherwise it runs concurrently with the query.
      const structurePromise =
        currentOffset === 0 ? loadStructure() : Promise.resolve(undefined);

      // Check cache synchronously first so we can pass columnsHint to the stream right away
      if (currentOffset === 0 && reuseStructure) {
        const cached = queryClient.getQueryData<TableStructure>(structureKey);
        if (cached) {
          columnsHint = cached.columns;
          const rowCount = cached.rowCount;
          if (rowCount != null && rowCount > 0) {
            structureRowCount = rowCount;
            estimatedTotalHint = rowCount;
            isEstimatedCountHint = true;
          }
        }
      }

      const existing =
        queryClient.getQueryData<InfiniteData<TableDataPage>>(queryKey);
      if (!columnsHint) {
        columnsHint = existing?.pages.find(
          (page) => page.columns.length > 0,
        )?.columns;
      }
      if (estimatedTotalHint == null) {
        estimatedTotalHint = existing?.pages.find(
          (page) => page.estimatedTotal != null,
        )?.estimatedTotal;
      }
      if (isEstimatedCountHint == null) {
        isEstimatedCountHint = existing?.pages.find(
          (page) => page.isEstimatedCount != null,
        )?.isEstimatedCount;
      }

      // Declare outside try block so finally can access it
      let rafId: number | undefined;

      try {
        // Mark as streaming to prevent overlapping page fetches
        isStreamingRef.current = true;

        // Progressive loading: update cache as batches arrive
        const accumulatedRows: TableDataRow[] = [];
        let updateScheduled = false;
        const MIN_PROGRESSIVE_INTERVAL_MS = 300; // Increased from 120ms to reduce UI flicker during streaming
        const MAX_PROGRESSIVE_ROWS = 5000;
        let lastProgressiveUpdate = 0;

        if (currentOffset === 0 && reuseStructure && !columnsHint) {
          const structure = await structurePromise;
          if (structure) {
            columnsHint = structure.columns;
            const rowCount = structure.rowCount;
            if (rowCount != null && rowCount > 0) {
              structureRowCount = rowCount;
              estimatedTotalHint ??= rowCount;
              isEstimatedCountHint ??= true;
            }
          }
        }

        const scheduleUpdate = (currentEstimatedTotal?: number) => {
          // Skip progressive updates when we've already pushed a lot of rows
          // to avoid thrashing the grid during large streams.
          if (!enableProgressiveUpdates) return;
          if (accumulatedRows.length > MAX_PROGRESSIVE_ROWS) return;

          const now = performance.now();
          if (now - lastProgressiveUpdate < MIN_PROGRESSIVE_INTERVAL_MS) {
            return;
          }

          if (updateScheduled) return;
          updateScheduled = true;

          rafId = requestAnimationFrame(() => {
            updateScheduled = false;
            lastProgressiveUpdate = performance.now();

            // Update the cache with partial page data for progressive rendering
            queryClient.setQueryData<InfiniteData<TableDataPage>>(
              queryKey,
              (old) => {
                // Use the most recent estimated total (from progress or hint)
                const bestEstimate =
                  currentEstimatedTotal ?? estimatedTotalHint;

                // CRITICAL: Initialize data structure on first batch if needed
                if (!old) {
                  return {
                    pages: [
                      {
                        columns: columnsHint ?? [],
                        rows: [...accumulatedRows],
                        hasMore: true, // Keep true during streaming - final result will set correct value
                        estimatedTotal: bestEstimate,
                        executionTimeMs: undefined,
                        offset: currentOffset,
                      } as TableDataPage,
                    ],
                    pageParams: [{ offset: currentOffset }],
                  };
                }

                // Find the current page being loaded
                const pageIndex = old.pages.findIndex(
                  (p) => p.offset === currentOffset,
                );

                if (pageIndex === -1) {
                  // Page doesn't exist yet, add it
                  return {
                    pages: [
                      ...old.pages,
                      {
                        columns: columnsHint ?? [],
                        rows: [...accumulatedRows], // Shallow copy for immutability
                        hasMore: true, // Keep true during streaming - final result will set correct value
                        estimatedTotal: bestEstimate,
                        executionTimeMs: undefined,
                        offset: currentOffset,
                      } as TableDataPage,
                    ],
                    pageParams: [...old.pageParams, { offset: currentOffset }],
                  };
                } else {
                  // Update existing page - minimize allocations
                  const newPages = [...old.pages];
                  const existingPage = newPages[pageIndex];
                  newPages[pageIndex] = {
                    ...existingPage,
                    rows: [...accumulatedRows], // Shallow copy for immutability
                    hasMore: existingPage?.hasMore ?? true, // Preserve existing value during streaming
                    estimatedTotal:
                      bestEstimate ?? existingPage?.estimatedTotal,
                  } as TableDataPage;
                  return {
                    ...old,
                    pages: newPages,
                  };
                }
              },
            );
          });
        };

        // Only do progressive updates for first page (initial load)
        // For pagination, skip progressive updates to avoid lag
        const enableProgressiveUpdates = currentOffset === 0;

        if (!databaseService.isConnectionActive(connectionId)) {
          await databaseService.connectById(connectionId);
        }

        const pageResult = await streamEntityPage({
          connectionId,
          database,
          schema,
          entityType,
          entityName,
          tabId,
          select,
          filters,
          sorts,
          limit,
          offset: currentOffset,
          pageSize,
          rowLimit,
          columnsHint,
          estimatedTotalHint,
          embeddedFKs,
          signal: controller.signal,
          onProgress: (progress) => {
            setProgress(progress);
            // Update estimated total if we received it in progress
            if (progress.totalRows != null) {
              estimatedTotalHint = progress.totalRows;
              if (progress.isEstimatedCount != null) {
                isEstimatedCountHint = progress.isEstimatedCount;
              }

              queryClient.setQueryData<InfiniteData<TableDataPage>>(
                queryKey,
                (old) => {
                  if (!old) {
                    return old;
                  }

                  const pageIndex = old.pages.findIndex(
                    (page) => page.offset === currentOffset,
                  );
                  if (pageIndex === -1) {
                    return old;
                  }

                  const newPages = [...old.pages];
                  const existingPage = newPages[pageIndex];
                  if (!existingPage) {
                    return old;
                  }
                  const totalRows = progress.totalRows;
                  if (totalRows == null) {
                    return old;
                  }
                  const rowsLoaded = existingPage.rows.length;
                  const hasMore = totalRows > rowsLoaded + currentOffset;

                  newPages[pageIndex] = {
                    ...existingPage,
                    estimatedTotal: totalRows,
                    isEstimatedCount:
                      progress.isEstimatedCount ??
                      existingPage.isEstimatedCount,
                    hasMore,
                  };

                  return {
                    ...old,
                    pages: newPages,
                  };
                },
              );
            }
          },
          onBatch: (batchRows, _rowOffset) => {
            // Accumulate rows - use push for O(1) instead of spread O(n)
            accumulatedRows.push(...batchRows);

            // Only schedule progressive updates for first page.
            // Pagination pages load without intermediate updates to avoid lag.
            if (enableProgressiveUpdates) {
              scheduleUpdate(estimatedTotalHint);
            }
          },
        });

        // Cancel any pending RAF update (also done in finally for error cases)
        if (rafId !== undefined) {
          cancelAnimationFrame(rafId);
          rafId = undefined;
        }

        // Collect structure result — by now it's almost certainly already resolved
        // since the stream takes longer than a cache/network fetch.
        if (currentOffset === 0 && structureRowCount == null) {
          const structure = await structurePromise;
          const rowCount = structure?.rowCount;
          if (rowCount != null && rowCount > 0) {
            structureRowCount = rowCount;
          }
        }

        return {
          ...pageResult,
          estimatedTotal:
            pageResult.estimatedTotal ??
            structureRowCount ??
            estimatedTotalHint ??
            undefined,
          isEstimatedCount:
            pageResult.isEstimatedCount ?? isEstimatedCountHint,
          offset: currentOffset,
        };
      } finally {
        // Cancel any pending RAF update on error/abort
        if (rafId !== undefined) {
          cancelAnimationFrame(rafId);
        }
        // Clean up abort handler to prevent memory leak
        if (signal && abortHandler) {
          signal.removeEventListener("abort", abortHandler);
        }
        // Mark streaming as complete
        isStreamingRef.current = false;
        abortControllerRef.current = null;
      }
    },
    [
      abortControllerRef,
      connectionId,
      database,
      schema,
      entityType,
      entityName,
      tabId,
      select,
      filters,
      sorts,
      limit,
      pageSize,
      rowLimit,
      embeddedFKs,
      loadStructure,
      queryClient,
      queryKey,
      reuseStructure,
      structureKey,
    ],
  );

  const infiniteQuery = useInfiniteQuery({
    queryKey,
    queryFn,
    enabled:
      enabled && Boolean(connectionId && database && entityName && entityType),
    initialPageParam: { offset: 0 },
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore) {
        return undefined;
      }
      const nextOffset = lastPage.offset + lastPage.rows.length;
      return { offset: nextOffset };
    },
    // Keep previous data visible while refetching (e.g., during sort change)
    placeholderData: (previousData) => previousData,
    // Cap retained pages to prevent unbounded memory growth (M1 fix)
    maxPages: 10000,
  });

  const cancelStream = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  const rows = useMemo(() => {
    if (!infiniteQuery.data) {
      return [];
    }

    // Deduplicate pages by offset (safety check for React StrictMode double-renders)
    const seenOffsets = new Set<number>();
    const uniquePages = infiniteQuery.data.pages.filter((page) => {
      if (seenOffsets.has(page.offset)) {
      logger.warn(
        "table-data-query",
        `Duplicate page detected at offset ${page.offset}, skipping`,
      );
        return false;
      }
      seenOffsets.add(page.offset);
      return true;
    });

    return uniquePages.flatMap((page) => page.rows);
  }, [infiniteQuery.data]);

  const columns = useMemo(() => {
    if (!infiniteQuery.data) {
      return [] as ColumnMeta[];
    }
    for (const page of infiniteQuery.data.pages) {
      if (page.columns.length) {
        return page.columns;
      }
    }
    return [] as ColumnMeta[];
  }, [infiniteQuery.data]);

  // Get the most recent estimatedTotal and isEstimatedCount from pages
  // Prefer the last page (most recent), fall back to first page
  const estimatedTotal = useMemo(() => {
    if (!infiniteQuery.data?.pages) return undefined;
    return (
      infiniteQuery.data.pages.at(-1)?.estimatedTotal ??
      infiniteQuery.data.pages[0]?.estimatedTotal
    );
  }, [infiniteQuery.data]);

  const isEstimatedCount = useMemo(() => {
    if (!infiniteQuery.data?.pages) return undefined;
    // If the last page says it's exact (false), use that
    // Otherwise check first page, default to true (estimated)
    const lastPage = infiniteQuery.data.pages.at(-1);
    if (lastPage?.isEstimatedCount === false) return false;
    return infiniteQuery.data.pages[0]?.isEstimatedCount ?? true;
  }, [infiniteQuery.data]);

  const fetchNextPageStable = useCallback(async () => {
    logger.debug("table-data-query", "fetchNextPage called", {
      isFetchingNextPage: infiniteQuery.isFetchingNextPage,
      isStreaming: isStreamingRef.current,
      hasNextPage: infiniteQuery.hasNextPage,
    });
    // Prevent overlapping fetches while streaming
    if (infiniteQuery.isFetchingNextPage || isStreamingRef.current) {
      logger.debug(
        "table-data-query",
        "Blocked fetchNextPage - currently streaming or fetching",
      );
      return;
    }
    try {
      logger.debug(
        "table-data-query",
        "Calling infiniteQuery.fetchNextPage()",
      );
      const result = await infiniteQuery.fetchNextPage();
      logger.debug("table-data-query", "fetchNextPage completed", {
        status: result.status,
        pagesCount: result.data?.pages.length,
        isFetchingNextPage: infiniteQuery.isFetchingNextPage,
      });
    } catch (error) {
      logger.error("table-data-query", "fetchNextPage error", error);
    }
  }, [infiniteQuery]);

  return {
    data: infiniteQuery.data,
    rows,
    columns,
    estimatedTotal,
    isEstimatedCount,
    status:
      infiniteQuery.status === "pending" ? "loading" : infiniteQuery.status,
    error: infiniteQuery.error,
    isFetching: infiniteQuery.isFetching,
    isFetchingNextPage: infiniteQuery.isFetchingNextPage,
    hasNextPage: infiniteQuery.hasNextPage,
    fetchNextPage: fetchNextPageStable,
    refetch: async () => infiniteQuery.refetch(),
    cancelStream,
    progress,
  };
}
