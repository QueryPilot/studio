import { logger } from "@/lib/logger";
import { useState, useCallback, useRef, useEffect, startTransition } from "react";
import { toast } from "sonner";
import { tableStreamingService } from "@/services/tableStreamingService";
import { queryHistoryService } from "@/services/queryHistoryService";
import { useTabStateStore, type QueryResult, type MultiQueryResult } from "@/stores/tabStateStore";
import type { ColumnMeta } from "@/types/database";
import {
  handleMutationCache,
  isMutationQuery,
  isSelectQuery,
} from "@/lib/cacheManager";
import { useDataInvalidationStore } from "@/stores/dataInvalidationStore";
import { parseMutationTables } from "@/utils/sqlParser";

/**
 * Options for useQueryExecution hook
 */
export interface UseQueryExecutionOptions {
  connectionId: string;
  database: string;
  tabId: string;
  smartQueryLimit?: number;
  onMutationDetected?: (sql: string, rowCount: number, executionTime: number) => void;
  onTransactionCommand?: (sql: string) => { message?: string };
}

/**
 * Return value from useQueryExecution hook
 */
export interface UseQueryExecutionReturn {
  isExecuting: boolean;
  isStreaming: boolean;
  result: QueryResult | null;
  appliedLimit: { originalSql: string; limit: number } | null;
  execute: (sql: string) => Promise<void>;
  executeMulti: (statements: string[]) => Promise<void>;
  cancel: () => void;
  setResult: React.Dispatch<React.SetStateAction<QueryResult | null>>;
}

/**
 * Hook for managing query execution state and logic
 *
 * Handles:
 * - Single query execution with streaming
 * - Multi-statement query execution
 * - Cancellation via AbortController
 * - Mutation detection and cache invalidation
 * - Transaction state management
 * - Query history persistence
 *
 * @example
 * ```tsx
 * const { execute, cancel, isExecuting, result } = useQueryExecution({
 *   connectionId: 'conn-123',
 *   database: 'mydb',
 *   tabId: 'tab-456',
 *   smartQueryLimit: 1000,
 * });
 *
 * // Execute a query
 * await execute('SELECT * FROM users');
 *
 * // Cancel running query
 * cancel();
 * ```
 */
export function useQueryExecution(options: UseQueryExecutionOptions): UseQueryExecutionReturn {
  const {
    connectionId,
    database,
    tabId,
    smartQueryLimit,
  } = options;

  // State
  const [isExecuting, setIsExecuting] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [result, setResultState] = useState<QueryResult | null>(null);
  const [appliedLimit, setAppliedLimit] = useState<{ originalSql: string; limit: number } | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // Refs for stable access in callbacks
  const isExecutingRef = useRef<boolean>(false);
  const resultRef = useRef<QueryResult | null>(null);
  const pendingRefreshRef = useRef<number | null>(null);

  // Global state
  const setQueryState = useTabStateStore((state) => state.setQueryState);
  const globalState = useTabStateStore((state) => state.queryStates.get(tabId));

  // Sync isExecutingRef with isExecuting state
  useEffect(() => {
    isExecutingRef.current = isExecuting;
  }, [isExecuting]);

  // Keep resultRef in sync with result state
  useEffect(() => {
    resultRef.current = result;
  }, [result]);

  // Cleanup pending auto-refresh on unmount
  useEffect(() => {
    return () => {
      if (pendingRefreshRef.current) {
        clearTimeout(pendingRefreshRef.current);
        pendingRefreshRef.current = null;
      }
    };
  }, []);

  /**
   * Wrapper for setResult that supports functional updates
   * Uses ref to avoid stale closure issues
   */
  const setResult = useCallback(
    (value: QueryResult | null | ((prev: QueryResult | null) => QueryResult | null)) => {
      if (typeof value === "function") {
        setResultState(value(resultRef.current));
      } else {
        setResultState(value);
      }
    },
    [],
  );

  /**
   * Execute multiple SQL statements sequentially.
   * Shows progress and accumulates results in a tabbed interface.
   */
  const executeMulti = useCallback(
    async (statements: string[], signal?: AbortSignal) => {
      if (statements.length === 0) return;

      logger.info(
        `[useQueryExecution.executeMulti] Executing ${statements.length} statements`,
      );

      setIsExecuting(true);
      setIsStreaming(false);
      setResult(null);

      const multiResults: MultiQueryResult[] = [];
      let hasError = false;

      // Clear any previous multi-results
      setQueryState(tabId, { multiResults: [], activeResultIndex: 0 });

      for (let i = 0; i < statements.length; i++) {
        if (hasError || signal?.aborted) break;

        const stmt = statements[i];
        if (!stmt || !stmt.trim()) continue;

        const startTime = Date.now();
        logger.info(
          `[useQueryExecution.executeMulti] Executing statement ${i + 1}/${statements.length}`,
        );

        toast.info(`Executing statement ${i + 1} of ${statements.length}...`, {
          id: `multi-query-progress`,
          duration: Infinity,
        });

        try {
          const pageSize = 2500;
          let currentColumns: string[] = [];
          let currentColumnMeta: ColumnMeta[] = [];
          const accumulatedRows: unknown[][] = [];

          const streamPromise = tableStreamingService.streamQuery(
            connectionId,
            `${tabId}-stmt${i}`,
            stmt.trim(),
            pageSize,
            (progress) => {
              if (progress.started && progress.columns) {
                currentColumns = progress.columns.map((c) => c.name);
                currentColumnMeta = progress.columns as unknown as ColumnMeta[];
              }
              if (progress.newRows && progress.newRows.length > 0) {
                accumulatedRows.push(...progress.newRows);
              }
            },
            (err: unknown) => {
              logger.error(
                `[useQueryExecution.executeMulti] Stream error for statement ${i + 1}:`,
                err,
              );
            },
            smartQueryLimit ?? undefined,
            () => {
              /* Skip limit callback for multi-query */
            },
            signal,
          );

          const final = await streamPromise;
          const endTime = Date.now();
          const executionTime = final.executionTimeMs ?? endTime - startTime;

          // Determine statement type and build appropriate result
          const sqlUpper = stmt.trim().toUpperCase();
          const hasReturning = sqlUpper.includes(" RETURNING ");
          const wasMutation = isMutationQuery(stmt);
          const isDDL =
            sqlUpper.startsWith("CREATE ") ||
            sqlUpper.startsWith("ALTER ") ||
            sqlUpper.startsWith("DROP ");
          const isTransaction =
            sqlUpper === "BEGIN" ||
            sqlUpper === "COMMIT" ||
            sqlUpper === "ROLLBACK";

          let affectedRows: number | undefined;
          let message: string | undefined;

          if (wasMutation && hasReturning && accumulatedRows.length > 0) {
            affectedRows = final.totalRows ?? accumulatedRows.length;
            message = `${affectedRows} row(s) affected`;
          } else if (wasMutation && !hasReturning) {
            affectedRows = final.totalRows ?? 0;
          } else if (isDDL && accumulatedRows.length === 0) {
            message = "Query executed successfully";
          } else if (isTransaction) {
            message =
              sqlUpper === "BEGIN"
                ? "Transaction started"
                : sqlUpper === "COMMIT"
                ? "Transaction committed"
                : "Transaction rolled back";
          }

          multiResults.push({
            statementIndex: i,
            statement: stmt.trim(),
            result: {
              columns: currentColumns,
              columnMeta: currentColumnMeta,
              rows: [...accumulatedRows],
              rowCount: final.totalRows ?? accumulatedRows.length,
              affectedRows,
              message,
              executionTime,
              cursorSetupMs: final.cursorSetupMs,
              totalStreamingMs: final.totalStreamingMs,
              fetchCount: final.fetchCount,
              networkMs: final.networkMs,
              conversionMs: final.conversionMs,
              ipcSendMs: final.ipcSendMs,
            },
            startTime,
            endTime,
          });

          // Handle mutation cache invalidation
          if (wasMutation && connectionId) {
            handleMutationCache(stmt, connectionId);
            logger.info(
              `[useQueryExecution.executeMulti] Mutation detected in statement ${i + 1} - cache invalidated`,
            );

            const affectedTables = parseMutationTables(stmt);
            if (affectedTables.length > 0) {
              const { invalidateTable } = useDataInvalidationStore.getState();
              affectedTables.forEach(({ schema, table }) => {
                logger.info(
                  `[useQueryExecution.executeMulti] Invalidating table: ${schema ?? "public"}.${table}`,
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
                `[useQueryExecution.executeMulti] Mutation detected but no tables parsed from SQL:`,
                stmt,
              );
            }
          }
        } catch (error) {
          hasError = true;
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          multiResults.push({
            statementIndex: i,
            statement: stmt.trim(),
            result: {
              columns: [],
              rows: [],
              rowCount: 0,
              error: errorMessage,
              executionTime: Date.now() - startTime,
            },
            startTime,
            endTime: Date.now(),
          });

          toast.error(`Error in statement ${i + 1}: ${errorMessage}`, {
            id: `multi-query-progress`,
            duration: 5000,
          });

          logger.error(
            `[useQueryExecution.executeMulti] Error in statement ${i + 1}:`,
            error,
          );
        }
      }

      toast.dismiss(`multi-query-progress`);

      // Update state with all results
      setQueryState(tabId, {
        multiResults,
        activeResultIndex: 0,
        hasUnsavedChanges: false,
        lastExecutedQuery: statements.join(";\n"),
      });

      setIsExecuting(false);

      // Show completion toast
      const successCount = multiResults.filter((r) => !r.result.error).length;
      const errorCount = multiResults.length - successCount;

      if (errorCount === 0) {
        toast.success(`✓ Executed ${successCount} statement(s) successfully`);
      } else {
        toast.warning(
          `Executed ${successCount} statement(s), ${errorCount} failed`,
        );
      }

      logger.info(
        `[useQueryExecution.executeMulti] Completed: ${successCount} succeeded, ${errorCount} failed`,
      );
    },
    [connectionId, database, tabId, smartQueryLimit, setQueryState, setResult],
  );

  /**
   * Execute a single SQL query with streaming support
   */
  const execute = useCallback(
    async (sql: string) => {
      // Cancel any pending auto-refresh
      if (pendingRefreshRef.current) {
        clearTimeout(pendingRefreshRef.current);
        pendingRefreshRef.current = null;
      }

      logger.info("[useQueryExecution.execute] Called with SQL:", { sql, sqlLength: sql.length });

      if (!sql || !sql.trim()) {
        logger.info("[useQueryExecution.execute] Empty query");
        toast.error("Please enter a query to execute");
        return;
      }

      // Clean up trailing semicolons
      sql = sql.trim().replace(/;\s*$/, "");

      if (!sql) {
        logger.info("[useQueryExecution.execute] Empty query after cleanup");
        toast.error("Please enter a query to execute");
        return;
      }

      // Clear multi-results for single query execution
      setQueryState(tabId, {
        multiResults: undefined,
        activeResultIndex: undefined,
      });

      setIsExecuting(true);
      setIsStreaming(true);
      setResult(null);

      // Create abort controller for cancellation
      const controller = new AbortController();
      setAbortController(controller);

      let executionTime = 0;
      let queryResult: QueryResult | null = null;
      let errorMessage: string | undefined;

      try {
        const pageSize = 2500;
        let started = false;
        let currentColumns: string[] = [];
        let currentColumnMeta: ColumnMeta[] = [];
        let rowCount = 0;
        const accumulatedRows: unknown[][] = [];
        let rafPending = false;

        // Single RAF with frame budget for smooth streaming
        const renderedCountRef = { current: 0 };
        const hasRenderedOnce = { current: false };

        const flushUpdate = () => {
          if (accumulatedRows.length === 0) {
            return;
          }

          // First render is synchronous, subsequent use startTransition
          if (!hasRenderedOnce.current) {
            hasRenderedOnce.current = true;
            renderedCountRef.current = accumulatedRows.length;
            setResult({
              columns: currentColumns,
              columnMeta: currentColumnMeta,
              rows: accumulatedRows.slice(0),
              rowCount: accumulatedRows.length,
              executionTime: 0,
            });
            return;
          }

          startTransition(() => {
            setResult((prev) => {
              if (!prev) {
                return null;
              }
              const already = renderedCountRef.current;
              const total = accumulatedRows.length;
              if (total <= already) {
                return prev;
              }
              const newRows = accumulatedRows.slice(already);
              renderedCountRef.current = total;
              return {
                ...prev,
                rows: [...prev.rows, ...newRows],
                rowCount: total,
              };
            });
          });
        };

        const scheduleUpdate = () => {
          if (rafPending) return;
          rafPending = true;
          requestAnimationFrame(() => {
            rafPending = false;
            if (accumulatedRows.length > renderedCountRef.current) {
              flushUpdate();
            }
          });
        };

        if (!connectionId) {
          throw new Error("No active connection selected");
        }

        const streamPromise = tableStreamingService.streamQuery(
          connectionId,
          tabId,
          sql,
          pageSize,
          (progress) => {
            if (progress.started && progress.columns && !started) {
              started = true;
              currentColumns = progress.columns.map((c) => c.name);
              currentColumnMeta = progress.columns as unknown as ColumnMeta[];
            }
            if (progress.newRows && progress.newRows.length > 0) {
              accumulatedRows.push(...progress.newRows);
              rowCount = accumulatedRows.length;
              scheduleUpdate();
            }
          },
          (err: unknown) => {
            let msg: string;
            if (err instanceof Error) msg = err.message;
            else if (typeof err === "string") msg = err;
            else if (err && typeof err === "object") msg = JSON.stringify(err);
            else msg = "Stream error";
            toast.error(msg);
          },
          smartQueryLimit ?? undefined,
          (originalSql, appliedLimit) => {
            setAppliedLimit({ originalSql, limit: appliedLimit });
          },
          controller.signal,
        );

        const final = await streamPromise;

        executionTime = final.executionTimeMs ?? 0;

        // Detect query type for proper result display
        const sqlUpper = sql.trim().toUpperCase();
        const hasReturning = sqlUpper.includes(" RETURNING ");
        const wasMutation = isMutationQuery(sql);
        const isTransaction =
          sqlUpper === "BEGIN" ||
          sqlUpper === "COMMIT" ||
          sqlUpper === "ROLLBACK" ||
          sqlUpper.startsWith("ROLLBACK TO ") ||
          sqlUpper.startsWith("SAVEPOINT ") ||
          sqlUpper.startsWith("RELEASE SAVEPOINT ") ||
          sqlUpper === "START TRANSACTION";
        const isConfig =
          sqlUpper.startsWith("SET ") || sqlUpper.startsWith("RESET ");
        const isDDL =
          sqlUpper.startsWith("CREATE ") ||
          sqlUpper.startsWith("ALTER ") ||
          sqlUpper.startsWith("DROP ");
        const isMaintenance =
          sqlUpper.startsWith("VACUUM") ||
          sqlUpper.startsWith("ANALYZE") ||
          sqlUpper.startsWith("REINDEX");

        let affectedRows: number | undefined;
        let message: string | undefined;

        // For mutation queries with RETURNING, show both data and affected rows
        if (wasMutation && hasReturning && accumulatedRows.length > 0) {
          affectedRows = final.totalRows ?? accumulatedRows.length;
          message = `${affectedRows} row(s) affected`;
        } else if (wasMutation && !hasReturning) {
          affectedRows = final.totalRows ?? 0;
        } else if (isDDL && accumulatedRows.length === 0) {
          message = "Query executed successfully";
        } else if (isTransaction) {
          if (
            sqlUpper.startsWith("BEGIN") ||
            sqlUpper.startsWith("START TRANSACTION")
          ) {
            message = "Transaction started";
            setQueryState(tabId, { inTransaction: true });
            toast.success("Transaction started", {
              description:
                "This tab now has an active transaction. All queries in this tab will be part of this transaction until you COMMIT or ROLLBACK.",
              duration: 5000,
            });
          } else if (sqlUpper.startsWith("COMMIT")) {
            message = "Transaction committed successfully";
            setQueryState(tabId, { inTransaction: false });
          } else if (sqlUpper.startsWith("ROLLBACK")) {
            message = "Transaction rolled back successfully";
            setQueryState(tabId, { inTransaction: false });
          } else if (sqlUpper.startsWith("SAVEPOINT")) {
            message = "Savepoint created";
          } else if (sqlUpper.startsWith("RELEASE SAVEPOINT")) {
            message = "Savepoint released";
          }
        } else if (isConfig && accumulatedRows.length === 0) {
          message = sqlUpper.startsWith("SET ")
            ? "Configuration parameter set"
            : "Configuration parameter reset";
        } else if (isMaintenance && accumulatedRows.length === 0) {
          message = "Maintenance command completed successfully";
        }

        // Build final result object
        const finalResult: QueryResult = {
          columns: currentColumns,
          columnMeta: currentColumnMeta,
          rows: [...accumulatedRows],
          rowCount: final.totalRows ?? accumulatedRows.length,
          affectedRows,
          message,
          executionTime,
          cursorSetupMs: final.cursorSetupMs,
          totalStreamingMs: final.totalStreamingMs,
          fetchCount: final.fetchCount,
          networkMs: final.networkMs,
          conversionMs: final.conversionMs,
          ipcSendMs: final.ipcSendMs,
        };

        // Direct state update to ensure ALL rows are immediately visible
        setResult(finalResult);

        setIsStreaming(false);

        // Handle mutations and auto-refresh
        if (connectionId) {
          if (wasMutation) {
            handleMutationCache(sql, connectionId);
            logger.info("[useQueryExecution.execute] Mutation detected - cache invalidated");

            const affectedTables = parseMutationTables(sql);
            if (affectedTables.length > 0) {
              const { invalidateTable } = useDataInvalidationStore.getState();
              affectedTables.forEach(({ schema, table }) => {
                logger.info(
                  `[useQueryExecution.execute] Invalidating table: ${schema ?? "public"}.${table}`,
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
                "[useQueryExecution.execute] Mutation detected but no tables parsed from SQL:",
                sql,
              );
            }

            // Auto-refresh: Re-run last SELECT query
            const lastSelectQuery = globalState?.lastSelectQuery;
            if (lastSelectQuery) {
              if (pendingRefreshRef.current) {
                clearTimeout(pendingRefreshRef.current);
              }

              if (!isExecuting) {
                toast.info("Data modified - Refreshing results...");
                pendingRefreshRef.current = window.setTimeout(() => {
                  pendingRefreshRef.current = null;
                  if (!isExecutingRef.current) {
                    void execute(lastSelectQuery);
                  }
                }, 100);
              }
            }
          }
        }

        // Store SELECT queries for auto-refresh
        const isSelect = isSelectQuery(sql);

        setQueryState(tabId, {
          result: finalResult, // Sync result to store for background execution access
          hasUnsavedChanges: false,
          lastExecutedQuery: sql,
          ...(isSelect ? { lastSelectQuery: sql } : {}),
        });

        queryResult = {
          columns: final.columns.map((c) => c.name),
          columnMeta: final.columns as unknown as ColumnMeta[],
          rows: [],
          rowCount: final.totalRows ?? rowCount,
          affectedRows,
          executionTime,
        };
      } catch (error) {
        const isCancellation =
          (error instanceof Error && error.name === "AbortError") ||
          (error instanceof Error && error.message.includes("cancelled")) ||
          (error instanceof Error && error.message.includes("interrupted"));

        if (isCancellation) {
          logger.info("Query cancelled by user");
          return;
        } else {
          if (error instanceof Error) {
            errorMessage = error.message;
          } else if (typeof error === "string") {
            errorMessage = error;
          } else if (error && typeof error === "object" && "message" in error) {
            errorMessage = String(error.message);
          } else {
            errorMessage = "An unknown error occurred while executing the query";
          }

          const errorResult: QueryResult = {
            columns: [],
            rows: [],
            rowCount: 0,
            error: errorMessage,
          };
          setResult(errorResult);

          // Sync error result to store for background execution access
          setQueryState(tabId, { result: errorResult });

          toast.error(errorMessage, {
            duration: 5000,
            description: "Check the console for more details",
          });

          logger.error("Query execution failed:", error);
        }
      } finally {
        setIsExecuting(false);
        setIsStreaming(false);
        setAbortController(null);

        // Save to history (skip if cancelled)
        const wasCancelled = controller.signal.aborted;
        if (sql.trim() && !wasCancelled) {
          await queryHistoryService.addEntry({
            connectionId,
            database,
            query: sql,
            executedAt: new Date(),
            executionTime,
            rowCount: queryResult?.rowCount,
            error: errorMessage,
          });
        }
      }
    },
    [
      connectionId,
      database,
      tabId,
      smartQueryLimit,
      globalState?.lastSelectQuery,
      setQueryState,
      setResult,
    ],
  );

  /**
   * Cancel currently executing query
   */
  const cancel = useCallback(() => {
    if (abortController) {
      abortController.abort();
      setIsExecuting(false);
      setIsStreaming(false);
      setAbortController(null);
      toast.info("Query cancelled");
    }
  }, [abortController]);

  return {
    isExecuting,
    isStreaming,
    result,
    appliedLimit,
    execute,
    executeMulti,
    cancel,
    setResult,
  };
}
