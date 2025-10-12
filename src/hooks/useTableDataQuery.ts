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
  select?: string[];
  filters?: FilterConfig;
  sorts?: SortConfig[];
  limit?: number;
  pageSize?: number;
  rowLimit?: number;
  enabled?: boolean;
  reuseStructure?: boolean;
}

export interface UseTableDataQueryResult {
  data: InfiniteData<TableDataPage> | undefined;
  rows: TableDataRow[];
  columns: ColumnMeta[];
  status: "idle" | "loading" | "success" | "error";
  error: unknown;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => Promise<void>;
  refetch: () => Promise<QueryObserverResult<InfiniteData<TableDataPage>, unknown>>;
  cancelStream: () => void;
  progress: StreamProgress | null;
}

export function useTableDataQuery(
  params: UseTableDataQueryParams,
): UseTableDataQueryResult {
  const {
    connectionId,
    database,
    schema = "public",
    entityName,
    entityType,
    select,
    filters,
    sorts,
    limit,
    pageSize,
    rowLimit,
    enabled = true,
    reuseStructure = true,
  } = params;

  const queryClient = useQueryClient();
  const abortControllerRef = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<StreamProgress | null>(null);

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
  });

  const structureKey = tableStructureQueryKey({
    connectionId,
    database,
    schema,
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
        schema,
        table: entityName,
      };

      return await queryClient.ensureQueryData({
        queryKey: structureKey,
        queryFn: () => fetchTableStructure(structureParams),
      });
    } catch (error) {
      console.warn("Failed to load table structure for columns hint", error);
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

      if (signal) {
        if (signal.aborted) {
          controller.abort();
        } else {
          signal.addEventListener(
            "abort",
            () => {
              controller.abort();
            },
            { once: true },
          );
        }
      }

      setProgress({ rowsFetched: 0, started: true });

      let columnsHint: ColumnMeta[] | undefined;
      let structureRowCount: number | undefined;
      let estimatedTotalHint: number | undefined;
      if (currentOffset === 0) {
        const structure = await loadStructure();
        columnsHint = structure?.columns;
        structureRowCount = structure?.rowCount;
        estimatedTotalHint = structure?.rowCount ?? undefined;
      }

      const existing = queryClient.getQueryData<InfiniteData<TableDataPage>>(queryKey);
      if (!columnsHint) {
        columnsHint = existing?.pages.find((page) => page.columns.length > 0)?.columns;
      }
      if (estimatedTotalHint == null) {
        estimatedTotalHint = existing?.pages.find(
          (page) => page.estimatedTotal != null,
        )?.estimatedTotal;
      }

      try {
        const pageResult = await streamEntityPage({
          connectionId,
          database,
          schema,
          entityType,
          entityName,
          select,
          filters,
          sorts,
          limit,
          offset: currentOffset,
          pageSize,
          rowLimit,
          columnsHint,
          estimatedTotalHint,
          signal: controller.signal,
          onProgress: setProgress,
        });

        return {
          ...pageResult,
          estimatedTotal:
            pageResult.estimatedTotal ?? structureRowCount ?? estimatedTotalHint ?? undefined,
          offset: currentOffset,
        };
      } finally {
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
      select,
      filters,
      sorts,
      limit,
      pageSize,
      rowLimit,
      loadStructure,
      queryClient,
      queryKey,
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
  });

  const cancelStream = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  const rows = useMemo(() => {
    if (!infiniteQuery.data) {
      return [];
    }
    return infiniteQuery.data.pages.flatMap((page) => page.rows);
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

  return {
    data: infiniteQuery.data,
    rows,
    columns,
    status: infiniteQuery.status,
    error: infiniteQuery.error,
    isFetching: infiniteQuery.isFetching,
    isFetchingNextPage: infiniteQuery.isFetchingNextPage,
    hasNextPage: !!infiniteQuery.hasNextPage,
    fetchNextPage: async () => {
      await infiniteQuery.fetchNextPage();
    },
    refetch: async () => infiniteQuery.refetch(),
    cancelStream,
    progress,
  };
}
