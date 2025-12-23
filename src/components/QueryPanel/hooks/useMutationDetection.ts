import { useRef, useCallback } from "react";
import { toast } from "sonner";
import { isMutationQuery, handleMutationCache } from "@/lib/cacheManager";
import { parseMutationTables, type TableReference } from "@/utils/sqlParser";
import { useDataInvalidationStore } from "@/stores/dataInvalidationStore";
import { logger } from "@/lib/logger";

export interface UseMutationDetectionOptions {
  connectionId: string;
  database: string;
  tabId: string;
  isExecuting: boolean;
  lastSelectQuery?: string;
  onAutoRefresh?: (sql: string) => Promise<void>;
}

export interface UseMutationDetectionReturn {
  handleMutationDetected: (sql: string, rowCount: number, executionTime: number) => void;
  cancelPendingRefresh: () => void;
}

export function useMutationDetection({
  connectionId,
  database,
  isExecuting,
  lastSelectQuery,
  onAutoRefresh,
}: UseMutationDetectionOptions): UseMutationDetectionReturn {
  const pendingRefreshRef = useRef<number | null>(null);
  const isExecutingRef = useRef<boolean>(false);

  isExecutingRef.current = isExecuting;

  const cancelPendingRefresh = useCallback(() => {
    if (pendingRefreshRef.current) {
      clearTimeout(pendingRefreshRef.current);
      pendingRefreshRef.current = null;
    }
  }, []);

  const handleMutationDetected = useCallback((sql: string, _rowCount: number, _executionTime: number) => {
    if (!isMutationQuery(sql)) {
      return;
    }

    handleMutationCache(sql, connectionId);
    logger.info("[useMutationDetection] Mutation detected - cache invalidated");

    const affectedTables = parseMutationTables(sql);
    if (affectedTables.length > 0) {
      const { invalidateTable } = useDataInvalidationStore.getState();
      affectedTables.forEach(({ schema, table }: TableReference) => {
        logger.info(
          `[useMutationDetection] Invalidating table: ${schema ?? "public"}.${table}`,
        );
        invalidateTable(
          connectionId,
          database,
          schema ?? "public",
          table,
        );
      });
    } else {
      logger.warn(
        "[useMutationDetection] Mutation detected but no tables parsed from SQL:",
        sql,
      );
    }

    if (lastSelectQuery && onAutoRefresh) {
      cancelPendingRefresh();

      if (!isExecuting) {
        toast.info("Data modified - Refreshing results...");
        pendingRefreshRef.current = window.setTimeout(() => {
          pendingRefreshRef.current = null;
          if (!isExecutingRef.current) {
            void onAutoRefresh(lastSelectQuery);
          }
        }, 100);
      }
    }
  }, [connectionId, database, isExecuting, lastSelectQuery, onAutoRefresh, cancelPendingRefresh]);

  return {
    handleMutationDetected,
    cancelPendingRefresh,
  };
}
