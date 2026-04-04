import { logger } from "@/lib/logger";
import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";

import { tableStreamingService } from "@/services/tableStreamingService";
import useWorkbenchStore from "@/stores/workbenchStore";
import { usePanelFocusStore } from "@/stores/panelFocusStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { type QueryResult } from "@/stores/tabStateStore";
import type { ColumnMeta } from "@/types/database";
import type { SqlEditorRef } from "@/components/CodeEditor/SqlEditor";
import {
  handleMutationCache,
  isMutationQuery,
  isSelectQuery,
} from "@/lib/cacheManager";
import { useDataInvalidationStore } from "@/stores/dataInvalidationStore";
import { parseMutationTables } from "@/utils/sqlParser";
import { schemaCache } from "@/services/schemaCache";
import { trackQuery } from "@/services/queryTracker";
import { trackQueryExecution } from "@/services/aiContextService";
import { SaveQueryDialog } from "@/components/QueryHistory";
import { editorRegistry } from "@/services/editorRegistry";
import { clearRustSchema, syncSchemaToRust } from "@/hooks/useRustSchemaSync";
import { clearCompletionCache } from "@/components/CodeEditor/languages/sql/optimized-completion";
import { clearProviderCache } from "@/components/CodeEditor/languages/sql/metadataProvider";
import {
  buildRunAllPlan,
  extractStatementsForRunAll,
} from "./query-execution-plan";
import {
  orchestrateRunAllExecution,
  type BatchStatementResult,
} from "./query-batch-orchestrator";
import { useAcpStore } from "@/stores/acpStore";
import { useTabLoadingStore } from "@/stores/tabLoadingStore";
import { queryActionDispatcher } from "@/services/queryActionDispatcher";
import { QueryPanelLayout } from "./QueryPanelLayout";
import { useQueryPanelState } from "./useQueryPanelState";
import {
  buildResultViewPresentation,
  createEmptyResultViewPresentation,
  type ResultViewPresentation,
} from "./query-result-view";
import { parseShowplanSet, SET_COMMAND_MAP, type ShowplanFormat } from "./showplan-state-tracker";

interface QueryPanelProps {
  panelId: string;
  tabId: string;
  connectionId: string;
  database: string;
  schema?: string;
  dbType?: string;
  className?: string;
  initialSql?: string;
  isInteractive?: boolean;
}

interface ExecuteSingleStatementOptions {
  recordAsLastExecuted?: boolean;
  suppressAutoRefresh?: boolean;
  internalTxnStep?: boolean;
  runContext?: "single" | "batch";
  preserveInputSql?: boolean;
  pinSession?: boolean;
}

interface ExecuteSingleStatementResult {
  success: boolean;
  cancelled?: boolean;
  sql: string;
  result: QueryResult;
  presentation: ResultViewPresentation;
  errorMessage?: string;
}

function getDdlSuccessMessage(sqlUpper: string): string {
  const objectLabel = (() => {
    if (sqlUpper.includes("MATERIALIZED VIEW")) return "Materialized view";
    if (sqlUpper.includes(" TABLE ")) return "Table";
    if (sqlUpper.includes(" VIEW ")) return "View";
    if (sqlUpper.includes(" INDEX ")) return "Index";
    if (sqlUpper.includes(" SCHEMA ")) return "Schema";
    if (sqlUpper.includes(" TYPE ")) return "Type";
    if (sqlUpper.includes(" FUNCTION ")) return "Function";
    if (sqlUpper.includes(" PROCEDURE ")) return "Procedure";
    if (sqlUpper.includes(" TRIGGER ")) return "Trigger";
    if (sqlUpper.includes(" SEQUENCE ")) return "Sequence";
    return "Object";
  })();

  const action = sqlUpper.startsWith("CREATE ")
    ? "created"
    : sqlUpper.startsWith("ALTER ")
      ? "altered"
      : sqlUpper.startsWith("DROP ")
        ? "dropped"
        : "updated";

  return `${objectLabel} ${action} successfully`;
}

export const QueryPanel = memo(function QueryPanel({
  panelId,
  tabId,
  connectionId,
  database,
  schema = "public",
  dbType = "postgres",
  className,
  initialSql = "",
  isInteractive: interactiveOverride,
}: QueryPanelProps) {
  // Subscribe to boolean only — avoids re-rendering when another panel gets focused
  const isPanelFocused = usePanelFocusStore(
    (state) => state.focusedPanelId === panelId,
  );
  const isInteractive = interactiveOverride ?? isPanelFocused;
  const {
    activeBatchResultIndex,
    batchResults,
    deferredQuery,
    detectedDialect,
    effectiveConnectionId,
    executionStatus,
    handleEditorChange,
    hasQuery,
    inTransaction,
    isBatchExecuting,
    isExecuting,
    isStreaming,
    lastExecutedQueryRef,
    lastSelectQueryRef,
    profileId,
    query,
    queryGridId,
    queryRef,
    refreshActionQuery,
    result,
    selectedDialect,
    selectedStatementCount,
    setActiveBatchResultIndex,
    setBatchResults,
    setDetectedDialect,
    setExecutionStatus,
    setIsBatchExecuting,
    setIsExecuting,
    setIsStreaming,
    setQuery,
    setQueryState,
    setRefreshActionQuery,
    setResult,
    setSelectedDialect,
    setSelectedStatementCount,
    setShowOutline,
    setShowplanMode,
    setShowResults,
    setShowSaveDialog,
    showOutline,
    showplanMode,
    showResults,
    showSaveDialog,
    persistSql,
  } = useQueryPanelState({
    tabId,
    panelId,
    connectionId,
    database,
    schema,
    dbType,
    initialSql,
  });

  // Editor ref for focusing
  const editorRef = useRef<SqlEditorRef>(null);

  // Register editor with the global registry for AI commands
  useEffect(() => {
    const editorId = `${panelId}:${tabId}`;

    // Register this editor
    editorRegistry.register({
      id: editorId,
      connectionId,
      database,
      schema,
      getRef: () => editorRef.current,
    });

    // Cleanup on unmount
    return () => {
      editorRegistry.unregister(editorId);
    };
  }, [panelId, tabId, connectionId, database, schema]);

  // Sync query execution loading state to tab loading store
  useEffect(() => {
    const loading = isExecuting || isStreaming;
    useTabLoadingStore.getState().setLoading(tabId, loading);
    return () => {
      useTabLoadingStore.getState().setLoading(tabId, false);
    };
  }, [tabId, isExecuting, isStreaming]);

  // Update focused editor when panel focus changes
  useEffect(() => {
    const editorId = `${panelId}:${tabId}`;
    if (isInteractive) {
      editorRegistry.setFocusedEditor(editorId);
    } else {
      editorRegistry.clearFocusedEditor(editorId);
    }
  }, [isInteractive, panelId, tabId]);

  // Ref to track if execution is in progress (prevents double-execution from duplicate events)
  const isExecutingRef = useRef(false);
  const cancelRequestedRef = useRef(false);
  // Stores full row arrays outside React state to avoid keeping all results in memory
  const batchResultRowsRef = useRef(new Map<number, unknown[][]>());
  const [singleResultPresentation, setSingleResultPresentation] =
    useState<ResultViewPresentation>(createEmptyResultViewPresentation);
  const singleResultPresentationModeRef = useRef(singleResultPresentation.mode);
  singleResultPresentationModeRef.current = singleResultPresentation.mode;
  const inTransactionRef = useRef(inTransaction);
  inTransactionRef.current = inTransaction;

  const executeSingleStatement = useCallback(
    async (
      queryToExecute?: string,
      options: ExecuteSingleStatementOptions = {},
    ): Promise<ExecuteSingleStatementResult> => {
      const {
        recordAsLastExecuted = true,
        suppressAutoRefresh = false,
        internalTxnStep = false,
        runContext = "single",
        preserveInputSql = false,
        pinSession,
      } = options;
      const isSingleRun = runContext === "single";

      if (isExecutingRef.current && isSingleRun) {
        logger.info("[executeSingleStatement] Skipped - already executing");
        const alreadyRunningResult: QueryResult = {
          columns: [],
          rows: [],
          rowCount: 0,
          error: "Query execution is already in progress",
        };
        return {
          success: false,
          sql: "",
          result: alreadyRunningResult,
          presentation: buildResultViewPresentation({
            sql: queryToExecute ?? "",
            result: alreadyRunningResult,
          }),
          errorMessage: "Query execution is already in progress",
        };
      }

      if (isSingleRun) {
        isExecutingRef.current = true;
        cancelRequestedRef.current = false;
      }

      let sql =
        queryToExecute ?? editorRef.current?.getValue() ?? queryRef.current;
      if (preserveInputSql) {
        if (!sql.trim()) {
          const message = "Please enter a query to execute";
          const emptyQueryResult: QueryResult = {
            columns: [],
            rows: [],
            rowCount: 0,
            error: message,
          };
          toast.error(message);
          return {
            success: false,
            sql,
            result: emptyQueryResult,
            presentation: buildResultViewPresentation({
              sql,
              result: emptyQueryResult,
            }),
            errorMessage: message,
          };
        }
      } else {
        sql = sql.trim().replace(/;\s*$/, "");
      }

      if (!sql) {
        const message = "Please enter a query to execute";
        const emptyQueryResult: QueryResult = {
          columns: [],
          rows: [],
          rowCount: 0,
          error: message,
        };
        toast.error(message);
        return {
          success: false,
          sql,
          result: emptyQueryResult,
          presentation: buildResultViewPresentation({
            sql,
            result: emptyQueryResult,
          }),
          errorMessage: message,
        };
      }

      // Check if this is a SET SHOWPLAN command (single-statement mode)
      if (dbType.toLowerCase() === "sqlserver") {
        const showplanSetResult = parseShowplanSet(sql);
        if (showplanSetResult) {
          setShowplanMode(showplanSetResult.enabled ? showplanSetResult.format : null);
          const message = `${showplanSetResult.enabled ? "Enabled" : "Disabled"} execution plan mode`;
          const setResult_: QueryResult = {
            columns: [],
            rows: [],
            rowCount: 0,
            message,
          };
          setResult(setResult_);
          setShowResults(true);
          if (isSingleRun) {
            isExecutingRef.current = false;
          }
          const presentation = buildResultViewPresentation({
            sql,
            result: setResult_,
          });
          return {
            success: true,
            sql,
            result: setResult_,
            presentation,
          };
        }
      }

      // SHOWPLAN wrapping for single statements
      let effectiveSql = sql;
      let singleShowplanFormat: ShowplanFormat | null = null;

      if (showplanMode && dbType.toLowerCase() === "sqlserver") {
        const setCommand =
          SET_COMMAND_MAP[showplanMode as ShowplanFormat] || showplanMode;
        effectiveSql = `SET ${setCommand} ON;\n${sql};\nSET ${setCommand} OFF;`;
        singleShowplanFormat = showplanMode as ShowplanFormat;
      }

      if (isSingleRun) {
        setIsExecuting(true);
        setExecutionStatus("executing");
      }
      setIsStreaming(true);
      if (isSingleRun) {
        setExecutionStatus("streaming");
      }
      if (isSingleRun) {
        setResult(null);
      } else {
        setResult((prev) => {
          if (prev && !prev.error && prev.rows.length > 0) return prev;
          return null;
        });
      }

      let errorMessage: string | undefined;
      const t0 = performance.now();
      let rafId: number | undefined;
      let pendingTimeout: number | undefined;

      try {
        const pageSize = 2500;
        let started = false;
        let currentColumns: string[] = [];
        let currentColumnMeta: ColumnMeta[] = [];
        let rowCount = 0;
        const accumulatedRows: unknown[][] = [];

        const renderedCountRef = { current: 0 };
        const hasRenderedOnce = { current: false };
        const getUpdateInterval = (count: number): number => {
          if (count < 5000) return 32;
          if (count < 20000) return 100;
          return 200;
        };
        let lastUpdateTime = 0;

        const commitSnapshot = (sync = false) => {
          const snapshot: QueryResult = {
            columns: currentColumns,
            columnMeta: currentColumnMeta,
            rows: accumulatedRows,
            rowCount: accumulatedRows.length,
            executionTime: 0,
          };
          if (sync) {
            setResult(snapshot);
          } else {
            startTransition(() => {
              setResult(snapshot);
            });
          }
        };

        const scheduleUpdate = () => {
          const total = accumulatedRows.length;
          if (total === 0) return;

          if (!hasRenderedOnce.current) {
            hasRenderedOnce.current = true;
            renderedCountRef.current = total;
            lastUpdateTime = performance.now();
            commitSnapshot(true);
            return;
          }

          if (pendingTimeout !== undefined) return;

          const now = performance.now();
          const delay = Math.max(
            getUpdateInterval(accumulatedRows.length) - (now - lastUpdateTime),
            0,
          );

          pendingTimeout = window.setTimeout(() => {
            pendingTimeout = undefined;
            lastUpdateTime = performance.now();

            if (rafId !== undefined) return;
            rafId = requestAnimationFrame(() => {
              rafId = undefined;
              const currentTotal = accumulatedRows.length;
              if (currentTotal <= renderedCountRef.current) return;
              renderedCountRef.current = currentTotal;
              commitSnapshot();
            });
          }, delay);
        };

        if (!effectiveConnectionId) {
          throw new Error("No active connection selected");
        }

        const sqlUpper = sql.trim().toUpperCase();
        const isTransaction =
          sqlUpper === "BEGIN" ||
          sqlUpper.startsWith("BEGIN TRANSACTION") ||
          sqlUpper === "COMMIT" ||
          sqlUpper.startsWith("COMMIT TRANSACTION") ||
          sqlUpper === "ROLLBACK" ||
          sqlUpper.startsWith("ROLLBACK TO ") ||
          sqlUpper.startsWith("ROLLBACK TRANSACTION") ||
          sqlUpper.startsWith("SAVEPOINT ") ||
          sqlUpper.startsWith("RELEASE SAVEPOINT ") ||
          sqlUpper === "START TRANSACTION";
        const shouldPinSession =
          pinSession ?? (inTransactionRef.current || isTransaction);

        const streamPromise = tableStreamingService.streamQuery(
          effectiveConnectionId,
          tabId,
          effectiveSql,
          pageSize,
          (progress) => {
            if (progress.started && progress.columns && !started) {
              started = true;
              currentColumns = progress.columns.map((c) => c.name);
              currentColumnMeta = progress.columns as unknown as ColumnMeta[];
              logger.info("[QueryPanel perf] columns received", {
                ms: Math.round(performance.now() - t0),
              });
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

            if (runContext === "single") {
              toast.error(msg);
            }
          },
          usePreferencesStore.getState().queryTimeoutSecs || undefined,
          { collectRows: false, pinSession: shouldPinSession },
        );

        const final = await streamPromise;

        const executionTime = final.executionTimeMs ?? 0;
        const hasReturning = sqlUpper.includes(" RETURNING ");
        const wasMutation = isMutationQuery(sql);
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

        if (isDDL && accumulatedRows.length === 0) {
          message = getDdlSuccessMessage(sqlUpper);
        } else if (wasMutation && hasReturning && accumulatedRows.length > 0) {
          affectedRows = final.totalRows ?? accumulatedRows.length;
          message = `${affectedRows} row(s) affected`;
        } else if (wasMutation && !hasReturning) {
          affectedRows = final.totalRows ?? 0;
        } else if (isTransaction) {
          if (
            sqlUpper.startsWith("BEGIN") ||
            sqlUpper.startsWith("START TRANSACTION")
          ) {
            message = "Transaction started";
            setQueryState(tabId, { inTransaction: true });
            if (!internalTxnStep) {
              toast.success("Transaction started", {
                description:
                  "This tab now has an active transaction. All queries in this tab will be part of this transaction until you COMMIT or ROLLBACK.",
                duration: 5000,
              });
            }
          } else if (sqlUpper.startsWith("COMMIT")) {
            message = "Transaction committed successfully";
            setQueryState(tabId, { inTransaction: false });
          } else if (
            sqlUpper.startsWith("ROLLBACK TO ") ||
            sqlUpper.startsWith("ROLLBACK TRANSACTION TO ")
          ) {
            message = "Rolled back to savepoint";
            // Transaction is still active after ROLLBACK TO — do NOT clear inTransaction
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

        const finalResult: QueryResult = {
          columns: currentColumns,
          columnMeta: currentColumnMeta,
          rows: accumulatedRows,
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
        const presentation = buildResultViewPresentation({
          sql,
          result: finalResult,
          previousMode: isSingleRun
            ? singleResultPresentationModeRef.current
            : undefined,
          showplanFormat: singleShowplanFormat,
        });

        setResult(finalResult);
        setIsStreaming(false);
        setExecutionStatus("success");
        if (isSingleRun) {
          setSingleResultPresentation(presentation);
        }

        if (effectiveConnectionId && wasMutation) {
          handleMutationCache(sql, effectiveConnectionId);
          const affectedTables = parseMutationTables(sql);
          if (effectiveConnectionId.trim()) {
            clearCompletionCache(effectiveConnectionId);
            clearProviderCache(effectiveConnectionId);
          }

          if (affectedTables.length > 0) {
            const { invalidateTable, invalidateSchema } =
              useDataInvalidationStore.getState();

            if (isDDL) {
              affectedTables.forEach(({ schema: tableSchema }) => {
                const targetSchema = tableSchema ?? schema;
                schemaCache.invalidateSchema(
                  effectiveConnectionId,
                  targetSchema,
                );
                invalidateSchema(effectiveConnectionId, database, targetSchema);
                void clearRustSchema(effectiveConnectionId, targetSchema).then(
                  () => syncSchemaToRust(effectiveConnectionId, targetSchema),
                );
              });
            }

            affectedTables.forEach(({ schema: tableSchema, table }) => {
              invalidateTable(
                effectiveConnectionId,
                database,
                tableSchema ?? "public",
                table,
              );
            });
          }

          if (!suppressAutoRefresh) {
            const lastSelectQuery = lastSelectQueryRef.current;
            if (lastSelectQuery) {
              setRefreshActionQuery(lastSelectQuery);
              toast.info("Data modified - Refreshing results...");
              setTimeout(() => {
                void executeSingleStatement(lastSelectQuery, {
                  runContext: "single",
                  suppressAutoRefresh: true,
                });
              }, 100);
            }
          }
        }

        const isSelect = isSelectQuery(sql);
        if (recordAsLastExecuted) {
          setQueryState(tabId, {
            hasUnsavedChanges: false,
            lastExecutedQuery: sql,
            ...(isSelect ? { lastSelectQuery: sql } : {}),
          });
          lastExecutedQueryRef.current = sql;
          if (isSelect) {
            lastSelectQueryRef.current = sql;
            setRefreshActionQuery(null);
          }
        }

        if (!internalTxnStep) {
          void trackQuery({
            query: sql,
            connectionId: effectiveConnectionId,
            database,
            schema,
            executionTimeMs: executionTime,
            rowCount: final.totalRows ?? rowCount,
            success: true,
            source: "editor",
          });

          void trackQueryExecution({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            query: sql,
            connectionId: effectiveConnectionId,
            database,
            schema,
            executedAt: Date.now(),
            executionTimeMs: executionTime,
            rowCount: final.totalRows ?? rowCount,
            success: true,
          });
        }

        return {
          success: true,
          sql,
          result: finalResult,
          presentation,
        };
      } catch (error) {
        const isCancellation =
          (error instanceof DOMException && error.name === "AbortError") ||
          (error instanceof Error && error.name === "AbortError") ||
          (error instanceof Error && error.message.includes("cancelled")) ||
          (error instanceof Error && error.message.includes("interrupted"));

        if (isCancellation) {
          setExecutionStatus("cancelled");

          // MSSQL KILL terminates the entire session, destroying any open
          // transaction. Clear the flag so the UI stays consistent.
          // Read from ref to avoid closing over the reactive value (which
          // would force re-creation of this callback on every toggle).
          if (
            inTransactionRef.current &&
            (dbType === "sqlserver" || dbType === "mssql")
          ) {
            setQueryState(tabId, { inTransaction: false });
            toast.warning(
              "Transaction lost — the session was terminated by cancellation",
            );
          }

          const cancelledResult: QueryResult = {
            columns: [],
            rows: [],
            rowCount: 0,
            message: "Query cancelled",
          };
          const cancelledPresentation = buildResultViewPresentation({
            sql,
            result: cancelledResult,
            previousMode: isSingleRun
              ? singleResultPresentationModeRef.current
              : undefined,
          });
          if (isSingleRun) {
            setSingleResultPresentation(cancelledPresentation);
          }
          return {
            success: false,
            cancelled: true,
            sql,
            result: cancelledResult,
            presentation: cancelledPresentation,
            errorMessage: "Query cancelled",
          };
        }

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
        const errorPresentation = buildResultViewPresentation({
          sql,
          result: errorResult,
          previousMode: isSingleRun
            ? singleResultPresentationModeRef.current
            : undefined,
        });

        setResult(errorResult);
        setExecutionStatus("error");
        if (isSingleRun) {
          setSingleResultPresentation(errorPresentation);
        }
        if (runContext === "single") {
          toast.error(errorMessage, {
            duration: 5000,
            description: "Check the console for more details",
          });
        }
        logger.error("Query execution failed:", error);

        if (!internalTxnStep) {
          void trackQuery({
            query: sql,
            connectionId: effectiveConnectionId,
            database,
            schema,
            success: false,
            error: errorMessage,
            source: "editor",
          });

          void trackQueryExecution({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            query: sql,
            connectionId: effectiveConnectionId,
            database,
            schema,
            executedAt: Date.now(),
            success: false,
            error: errorMessage,
          });
        }

        return {
          success: false,
          sql,
          result: errorResult,
          presentation: errorPresentation,
          errorMessage,
        };
      } finally {
        if (pendingTimeout !== undefined) {
          clearTimeout(pendingTimeout);
        }
        if (rafId !== undefined) {
          cancelAnimationFrame(rafId);
        }
        if (isSingleRun) {
          isExecutingRef.current = false;
          setIsExecuting(false);
        }
        setIsStreaming(false);
      }
    },
    [
      lastExecutedQueryRef,
      lastSelectQueryRef,
      queryRef,
      effectiveConnectionId,
      tabId,
      setExecutionStatus,
      setIsExecuting,
      setIsStreaming,
      setResult,
      setQueryState,
      setRefreshActionQuery,
      setShowplanMode,
      setShowResults,
      showplanMode,
      schema,
      database,
      dbType,
    ],
  );

  const resetBatchExecutionState = useCallback(() => {
    setBatchResults([]);
    setActiveBatchResultIndex(0);
    setIsBatchExecuting(false);
    batchResultRowsRef.current.clear();
  }, [setActiveBatchResultIndex, setBatchResults, setIsBatchExecuting]);

  const resolveExecutionTargetSql = useCallback(() => {
    const selectedSql = editorRef.current?.getSelection();
    if (selectedSql && selectedSql.trim().length > 0) {
      return selectedSql;
    }

    const statementAtCursor = editorRef.current?.getQueryAtCursor();
    if (statementAtCursor && statementAtCursor.trim().length > 0) {
      return statementAtCursor;
    }

    return editorRef.current?.getValue() ?? queryRef.current;
  }, [queryRef]);

  const executeBatchScript = useCallback(
    async (script: string, statements: string[]) => {
      if (isExecutingRef.current) {
        logger.info("[executeBatchScript] Skipped - already executing");
        return;
      }

      if (statements.length === 0) {
        toast.error("Please enter statements to execute");
        return;
      }

      const runPlan = buildRunAllPlan({
        statements,
        dbType,
        autoTransaction: true,
      });

      const collectedResults: BatchStatementResult[] = [];
      batchResultRowsRef.current.clear();
      const appendResult = (entry: BatchStatementResult) => {
        const index = collectedResults.length;
        collectedResults.push(entry);
        // Store full rows in ref map (outside React state) to reduce memory pressure
        batchResultRowsRef.current.set(index, entry.result.rows);
        // Only auto-focus the first result; user navigates manually after that
        const isFirst = collectedResults.length === 1;
        // Store lightweight entries in state — strip rows from non-active results
        const lightweightResults = collectedResults.map((r, i) => {
          if (i === 0) return r; // Keep active (first) result intact
          return {
            ...r,
            result: {
              ...r.result,
              rows: [] as unknown[][],
            },
          };
        });
        startTransition(() => {
          setBatchResults(lightweightResults);
          if (isFirst) {
            setActiveBatchResultIndex(0);
          }
        });
      };

      isExecutingRef.current = true;
      cancelRequestedRef.current = false;
      setIsExecuting(true);
      setIsBatchExecuting(true);
      setShowResults(true);
      setExecutionStatus("executing");
      setResult(null);
      setBatchResults([]);
      setActiveBatchResultIndex(0);

      try {
        const orchestrationResult = await orchestrateRunAllExecution({
          runPlan,
          dbType,
          isCancelRequested: () => cancelRequestedRef.current,
          onStatementResult: appendResult,
          executeStatement: async (statement, { internalTxnStep }) => {
            const statementResult = await executeSingleStatement(statement, {
              recordAsLastExecuted: false,
              suppressAutoRefresh: true,
              internalTxnStep,
              runContext: "batch",
              pinSession: runPlan.hasManualTransaction,
            });

            return {
              success: statementResult.success,
              cancelled: statementResult.cancelled,
              result: statementResult.result,
              presentation: statementResult.presentation,
            };
          },
        });

        setShowplanMode(orchestrationResult.finalShowplanState);

        const lastResult =
          orchestrationResult.statementResults[
            orchestrationResult.statementResults.length - 1
          ];
        if (lastResult) {
          setResult(lastResult.result);
        }
        const wasCancelled = orchestrationResult.cancelled;
        setExecutionStatus(wasCancelled ? "cancelled" : "success");

        if (!wasCancelled) {
          setQueryState(tabId, {
            hasUnsavedChanges: false,
            lastExecutedQuery: script,
          });
          lastExecutedQueryRef.current = script;

          toast.info(
            `Run all completed: ${orchestrationResult.successCount} succeeded, ${orchestrationResult.errorCount} failed, ${orchestrationResult.skippedCount} skipped`,
          );
        }
      } finally {
        isExecutingRef.current = false;
        setIsExecuting(false);
        setIsStreaming(false);
        setIsBatchExecuting(false);
        cancelRequestedRef.current = false;
      }
    },
    [
      dbType,
      executeSingleStatement,
      lastExecutedQueryRef,
      setActiveBatchResultIndex,
      setBatchResults,
      setExecutionStatus,
      setIsBatchExecuting,
      setIsExecuting,
      setIsStreaming,
      setQueryState,
      setResult,
      setShowplanMode,
      setShowResults,
      tabId,
    ],
  );

  const handleExecute = useCallback(
    async (queryToExecute?: string) => {
      const sqlToExecute = queryToExecute ?? resolveExecutionTargetSql();
      const statements = extractStatementsForRunAll(sqlToExecute);
      if (statements.length > 1) {
        resetBatchExecutionState();
        await executeBatchScript(sqlToExecute, statements);
        return;
      }

      resetBatchExecutionState();
      setShowResults(true);
      const singleResult = await executeSingleStatement(sqlToExecute, {
        runContext: "single",
      });
      // Populate a single batch entry so the statement tab is visible
      setBatchResults([
        {
          statementIndex: 1,
          statement: singleResult.sql,
          status: singleResult.success ? "success" : "error",
          result: singleResult.result,
          presentation: singleResult.presentation,
        },
      ]);
      setActiveBatchResultIndex(0);
    },
    [
      executeBatchScript,
      executeSingleStatement,
      resetBatchExecutionState,
      resolveExecutionTargetSql,
      setActiveBatchResultIndex,
      setBatchResults,
      setShowResults,
    ],
  );

  const handleExecuteSelection = useCallback(async () => {
    const selection = editorRef.current?.getSelection() ?? "";
    if (!selection.trim()) {
      toast.info("Select SQL text to run selection");
      return;
    }

    const statements = extractStatementsForRunAll(selection);
    if (statements.length > 1) {
      resetBatchExecutionState();
      await executeBatchScript(selection, statements);
      return;
    }

    resetBatchExecutionState();
    await executeSingleStatement(selection, {
      runContext: "single",
      preserveInputSql: true,
    });
  }, [executeBatchScript, executeSingleStatement, resetBatchExecutionState]);

  const handleExecuteAll = useCallback(async () => {
    const script = editorRef.current?.getValue() ?? queryRef.current;
    const statements = extractStatementsForRunAll(script);
    resetBatchExecutionState();
    await executeBatchScript(script, statements);
  }, [executeBatchScript, queryRef, resetBatchExecutionState]);

  const handleCancel = useCallback(() => {
    if (isExecutingRef.current) {
      cancelRequestedRef.current = true;

      // Cancel backend streaming — rejects the streamQuery promise with AbortError
      tableStreamingService.cancel();

      if (!isBatchExecuting) {
        isExecutingRef.current = false;
        setIsExecuting(false);
        setIsStreaming(false);
      }
      setExecutionStatus("cancelled");

      toast.info(
        isBatchExecuting ? "Batch cancellation requested" : "Query cancelled",
      );
    }
  }, [isBatchExecuting, setExecutionStatus, setIsExecuting, setIsStreaming]);

  const handleSelectionChange = useCallback(
    (selection: string) => {
      if (!selection.trim()) {
        setSelectedStatementCount((prev) => (prev === 0 ? prev : 0));
        return;
      }

      const statements = extractStatementsForRunAll(selection);
      const nextCount = statements.length;
      setSelectedStatementCount((prev) =>
        prev === nextCount ? prev : nextCount,
      );
    },
    [setSelectedStatementCount],
  );

  const handleBeautify = useCallback(() => {
    const currentQuery = editorRef.current?.getValue() ?? queryRef.current;
    if (!currentQuery.trim()) return;

    if (editorRef.current) {
      editorRef.current.format();
      const formattedQuery = editorRef.current.getValue();
      if (formattedQuery !== currentQuery) {
        persistSql(formattedQuery);
      }
      return;
    }

    // Fallback (should not happen in normal editor flow)
    setQuery(currentQuery);
  }, [persistSql, queryRef, setQuery]);

  const handleSaveQuery = useCallback(() => {
    if (!queryRef.current.trim()) {
      toast.error("No query to save");
      return;
    }
    setShowSaveDialog(true);
  }, [queryRef, setShowSaveDialog]);

  const handleRefreshResults = useCallback(() => {
    const queryToRefresh = refreshActionQuery ?? lastSelectQueryRef.current;
    if (!queryToRefresh) return;
    void executeSingleStatement(queryToRefresh, {
      runContext: "single",
      suppressAutoRefresh: true,
    });
  }, [executeSingleStatement, lastSelectQueryRef, refreshActionQuery]);

  const toggleResults = useCallback(() => {
    setShowResults((prev) => !prev);
  }, [setShowResults]);
  const toggleOutline = useCallback(() => {
    setShowOutline((prev) => !prev);
  }, [setShowOutline]);
  const closeOutline = useCallback(() => {
    setShowOutline(false);
  }, [setShowOutline]);

  // Subscribe to event bus for keyboard shortcuts
  useEffect(() => {
    queryActionDispatcher.register(panelId, tabId, {
      format: handleBeautify,
      execute: () => handleExecute(),
      executeAll: () => handleExecuteAll(),
      executeSelection: () => handleExecuteSelection(),
      save: handleSaveQuery,
      toggleResults,
      cancel: handleCancel,
    });

    return () => {
      queryActionDispatcher.unregister(panelId, tabId);
    };
  }, [
    handleBeautify,
    handleExecute,
    handleExecuteAll,
    handleExecuteSelection,
    handleCancel,
    handleSaveQuery,
    panelId,
    tabId,
    toggleResults,
  ]);

  // Focus panel when QueryPanel is clicked or focused
  const handleFocusPanel = useCallback(() => {
    if (panelId) {
      const state = useWorkbenchStore.getState();
      state.focusPanel(panelId);
    }
  }, [panelId]);

  // Auto-focus editor when this panel becomes focused via keyboard navigation (Cmd+[ / Cmd+])
  // but NOT when focus is already within the panel (e.g., user clicked a search input in results)
  const panelContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isInteractive) {
      requestAnimationFrame(() => {
        // Don't steal focus if something within this panel is already focused
        const activeEl = document.activeElement;
        if (
          activeEl &&
          panelContainerRef.current?.contains(activeEl) &&
          activeEl !== panelContainerRef.current
        ) {
          return;
        }
        editorRef.current?.focus();
      });
    }
  }, [isInteractive]);

  // Use transition for tab switching so the old tab stays visible while the new one renders
  const [isTabSwitching, startTabTransition] = useTransition();
  const handleBatchTabSwitch = useCallback(
    (index: number) => {
      startTabTransition(() => {
        setActiveBatchResultIndex(index);
      });
    },
    [setActiveBatchResultIndex],
  );

  const resolvedBatchResultIndex =
    activeBatchResultIndex < batchResults.length
      ? activeBatchResultIndex
      : batchResults.length - 1;
  const activeBatchResult =
    resolvedBatchResultIndex >= 0
      ? batchResults[resolvedBatchResultIndex]
      : undefined;
  // Restore full rows from ref map for the active batch result
  const displayedResult = useMemo(() => {
    if (!activeBatchResult) return result;
    const storedRows = batchResultRowsRef.current.get(resolvedBatchResultIndex);
    if (storedRows && activeBatchResult.result.rows.length === 0) {
      return { ...activeBatchResult.result, rows: storedRows };
    }
    return activeBatchResult.result;
  }, [activeBatchResult, resolvedBatchResultIndex, result]);
  const activeResultPresentation =
    activeBatchResult?.presentation ?? singleResultPresentation;

  const handleResultModeChange = useCallback(
    (mode: "table" | "json" | "explain" | "raw" | "stats") => {
      if (!activeResultPresentation.supportedModes.includes(mode)) {
        return;
      }

      if (activeBatchResult) {
        setBatchResults((prev) =>
          prev.map((entry, index) => {
            if (index !== resolvedBatchResultIndex) {
              return entry;
            }
            return {
              ...entry,
              presentation: {
                ...entry.presentation,
                mode,
              },
            };
          }),
        );
        return;
      }

      setSingleResultPresentation((prev) => {
        if (!prev.supportedModes.includes(mode)) {
          return prev;
        }
        return {
          ...prev,
          mode,
        };
      });
    },
    [
      activeBatchResult,
      activeResultPresentation.supportedModes,
      resolvedBatchResultIndex,
      setBatchResults,
    ],
  );

  const runButtonLabel = selectedStatementCount >= 2 ? "Run Selections" : "Run";
  const canRefreshResults = Boolean(
    refreshActionQuery ?? lastSelectQueryRef.current,
  );

  const handleFixWithAI = useCallback((errorMessage: string) => {
    const prompt = `Fix this SQL query error:\n\n${errorMessage}`;
    useAcpStore.getState().openWithPrompt(prompt);
  }, []);

  return (
    <>
      <QueryPanelLayout
        panelContainerRef={panelContainerRef}
        panelClassName={className}
        onPanelMouseDown={handleFocusPanel}
        inTransaction={inTransaction}
        editorRef={editorRef}
        effectiveConnectionId={effectiveConnectionId}
        database={database}
        schema={schema}
        dbType={dbType}
        query={query}
        onEditorChange={handleEditorChange}
        onSelectionChange={handleSelectionChange}
        onExecute={() => {
          void handleExecute();
        }}
        isExecuting={isExecuting}
        selectedDialect={selectedDialect}
        onDialectDetected={setDetectedDialect}
        hasQuery={hasQuery}
        showResults={showResults}
        showOutline={showOutline}
        focused={isInteractive}
        detectedDialect={detectedDialect}
        runButtonLabel={runButtonLabel}
        onExecuteAll={() => {
          void handleExecuteAll();
        }}
        onCancel={handleCancel}
        onBeautify={handleBeautify}
        onToggleResults={toggleResults}
        onToggleOutline={toggleOutline}
        onDialectChange={setSelectedDialect}
        deferredQuery={deferredQuery}
        onCloseOutline={closeOutline}
        batchResults={batchResults}
        activeBatchResultIndex={activeBatchResultIndex}
        onActiveBatchResultChange={handleBatchTabSwitch}
        isTabSwitching={isTabSwitching}
        isBatchExecuting={isBatchExecuting}
        displayedResult={displayedResult}
        isStreaming={isStreaming}
        executionStatus={executionStatus}
        queryGridId={queryGridId}
        activeResultMode={activeResultPresentation.mode}
        activeSupportedModes={activeResultPresentation.supportedModes}
        onModeChange={handleResultModeChange}
        onFixWithAI={handleFixWithAI}
        refreshNotice={
          refreshActionQuery
            ? "Data changed. Refresh results to reload the last SELECT."
            : undefined
        }
        onRefreshResults={canRefreshResults ? handleRefreshResults : undefined}
        showplanMode={showplanMode}
        resultTabGroupId={`query-result-view-mode:${tabId}`}
      />
      <SaveQueryDialog
        open={showSaveDialog}
        onOpenChange={setShowSaveDialog}
        query={query}
        profileId={profileId}
        database={database}
        schema={schema}
      />
    </>
  );
});
