import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SqlDialect } from "@/components/CodeEditor/types";
import type { ViewMode } from "@/types/viewMode";
import { useShallow } from "zustand/react/shallow";
import useWorkbenchStore from "@/stores/workbenchStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useTabStateStore, type QueryResult } from "@/stores/tabStateStore";
import {
  type BatchStatementResult,
} from "./query-batch-orchestrator";
import { resolveDialectFromDbType } from "./query-dialect";
import type { QueryExecutionStatus } from "./queryExecutionState";

const QUERY_STORE_SYNC_DEBOUNCE_MS = 150;
const TAB_METADATA_SYNC_DEBOUNCE_MS = 1000;

interface UseQueryPanelStateOptions {
  tabId: string;
  panelId: string;
  connectionId: string;
  database: string;
  schema?: string;
  dbType: string;
  initialSql: string;
}

export function useQueryPanelState({
  tabId,
  panelId,
  connectionId,
  database,
  schema,
  dbType,
  initialSql,
}: UseQueryPanelStateOptions) {
  const effectiveSchema = schema ?? "public";
  const setQueryState = useTabStateStore((state) => state.setQueryState);
  const loadTabStateAsync = useTabStateStore(
    (state) => state.loadTabStateAsync,
  );
  const globalState = useTabStateStore(
    useShallow((state) => {
      const queryState = state.queryStates.get(tabId);
      if (!queryState) return null;
      return {
        query: queryState.query,
        result: queryState.result,
        isExecuting: queryState.isExecuting,
        isStreaming: queryState.isStreaming,
        viewMode: queryState.viewMode,
        selectedDialect: queryState.selectedDialect,
        inTransaction: queryState.inTransaction,
        lastExecutedQuery: queryState.lastExecutedQuery,
        lastSelectQuery: queryState.lastSelectQuery,
      };
    }),
  );

  useEffect(() => {
    void loadTabStateAsync(tabId);
  }, [tabId, loadTabStateAsync]);

  const hasLoadedFromPersistence = useRef(false);
  const [query, setQueryInternal] = useState<string>(
    globalState?.query ?? initialSql,
  );
  const [result, setResultInternal] = useState<QueryResult | null>(
    globalState?.result || null,
  );
  const [isExecuting, setIsExecutingInternal] = useState(
    globalState?.isExecuting || false,
  );
  const [isStreaming, setIsStreamingInternal] = useState(
    globalState?.isStreaming || false,
  );
  const [executionStatus, setExecutionStatus] =
    useState<QueryExecutionStatus>(globalState?.result ? "success" : "idle");
  const [viewMode, setViewModeInternal] = useState<ViewMode>(
    globalState?.viewMode || "table",
  );
  const [isExplainResult, setIsExplainResult] = useState(false);
  const [selectedDialect, setSelectedDialect] = useState<SqlDialect | "auto">(
    resolveDialectFromDbType(dbType),
  );
  const [detectedDialect, setDetectedDialect] =
    useState<SqlDialect>(resolveDialectFromDbType(dbType));
  const deferredQuery = useDeferredValue(query);
  const hasQuery = query.trim().length > 0;
  const [showResults, setShowResults] = useState(result !== null);
  const [showOutline, setShowOutline] = useState(false);
  const [showVariablePanel, setShowVariablePanel] = useState(false);
  const [showVariableBar, setShowVariableBar] = useState(true);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [refreshActionQuery, setRefreshActionQuery] = useState<string | null>(
    null,
  );
  const [showplanMode, setShowplanMode] = useState<string | null>(null);
  const [batchResults, setBatchResults] = useState<BatchStatementResult[]>([]);
  const [activeBatchResultIndex, setActiveBatchResultIndex] = useState(0);
  const [isBatchExecuting, setIsBatchExecuting] = useState(false);
  const [selectedStatementCount, setSelectedStatementCount] = useState(0);

  const inTransaction = globalState?.inTransaction || false;
  const queryRef = useRef(query);
  const lastExecutedQueryRef = useRef(globalState?.lastExecutedQuery || "");
  const lastSelectQueryRef = useRef(globalState?.lastSelectQuery || null);

  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  useEffect(() => {
    lastExecutedQueryRef.current = globalState?.lastExecutedQuery || "";
  }, [globalState?.lastExecutedQuery]);

  useEffect(() => {
    lastSelectQueryRef.current = globalState?.lastSelectQuery || null;
  }, [globalState?.lastSelectQuery]);

  useEffect(() => {
    if (globalState && !hasLoadedFromPersistence.current) {
      hasLoadedFromPersistence.current = true;
      if (globalState.query && !query) {
        setQueryInternal(globalState.query);
      }
      setViewModeInternal(globalState.viewMode);
    }
  }, [globalState, query]);

  useEffect(() => {
    const connectionDialect = resolveDialectFromDbType(dbType);
    setSelectedDialect(connectionDialect);
    setDetectedDialect(connectionDialect);
    setShowplanMode(null);
  }, [connectionId, dbType]);

  const setQuery = useCallback((value: string) => {
    queryRef.current = value;
    setQueryInternal((prev) => (prev === value ? prev : value));
  }, []);

  const setResult = useCallback(
    (
      value:
        | QueryResult
        | null
        | ((prev: QueryResult | null) => QueryResult | null),
    ) => {
      if (typeof value === "function") {
        setResultInternal(value);
        return;
      }
      setResultInternal(value);
    },
    [],
  );

  const setIsExecuting = useCallback((value: boolean) => {
    setIsExecutingInternal(value);
  }, []);

  const setIsStreaming = useCallback((value: boolean) => {
    setIsStreamingInternal(value);
  }, []);

  const setViewMode = useCallback((value: ViewMode) => {
    setViewModeInternal(value);
  }, []);

  const updateTabMetadata = useWorkbenchStore(
    (state) => state.updateTabMetadata,
  );
  const effectiveConnectionId = useMemo(
    () => connectionId || "",
    [connectionId],
  );
  const profileId = useMemo(() => {
    if (!effectiveConnectionId) return undefined;
    const connection =
      useConnectionStore.getState().getConnection(effectiveConnectionId);
    return connection?.profile.id;
  }, [effectiveConnectionId]);

  const queryGridId = useMemo(
    () => `query:${effectiveConnectionId}:${database}:${effectiveSchema}:${tabId}`,
    [effectiveConnectionId, database, effectiveSchema, tabId],
  );

  const isInitialStateSync = useRef(true);
  const isInitialQuerySync = useRef(true);
  const querySyncTimerRef = useRef<number | null>(null);
  const resultRef = useRef(result);
  resultRef.current = result;

  useEffect(() => {
    if (isInitialStateSync.current) {
      isInitialStateSync.current = false;
      return;
    }

    const includeResult = !isStreaming && !isExecuting;
    setQueryState(
      tabId,
      {
        ...(includeResult ? { result: resultRef.current } : {}),
        isExecuting,
        isStreaming,
        viewMode,
        selectedDialect,
        hasUnsavedChanges:
          queryRef.current.trim() !== lastExecutedQueryRef.current.trim(),
      },
      { connectionId: effectiveConnectionId, database, schema: effectiveSchema },
    );
  }, [
    isExecuting,
    isStreaming,
    viewMode,
    selectedDialect,
    tabId,
    setQueryState,
    effectiveConnectionId,
    database,
    effectiveSchema,
  ]);

  useEffect(() => {
    if (isInitialQuerySync.current) {
      isInitialQuerySync.current = false;
      return;
    }

    if (querySyncTimerRef.current) {
      clearTimeout(querySyncTimerRef.current);
      querySyncTimerRef.current = null;
    }

    querySyncTimerRef.current = window.setTimeout(() => {
      querySyncTimerRef.current = null;
      setQueryState(
        tabId,
        {
          query,
          hasUnsavedChanges: query.trim() !== lastExecutedQueryRef.current.trim(),
        },
        { connectionId: effectiveConnectionId, database, schema: effectiveSchema },
      );
    }, QUERY_STORE_SYNC_DEBOUNCE_MS);
  }, [
    query,
    tabId,
    setQueryState,
    effectiveConnectionId,
    database,
    effectiveSchema,
  ]);

  const lastPersistedRef = useRef<string>(globalState?.query ?? initialSql);
  const persistTimerRef = useRef<number | null>(null);
  const persistSql = useCallback(
    (value: string) => {
      if (!panelId || !tabId) return;
      if (value === lastPersistedRef.current) return;
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      persistTimerRef.current = window.setTimeout(() => {
        lastPersistedRef.current = value;
        updateTabMetadata(panelId, tabId, { sql: value });
      }, TAB_METADATA_SYNC_DEBOUNCE_MS);
    },
    [panelId, tabId, updateTabMetadata],
  );

  const handleEditorChange = useCallback(
    (value: string) => {
      setQuery(value);
      persistSql(value);
    },
    [persistSql, setQuery],
  );

  useEffect(() => {
    return () => {
      if (querySyncTimerRef.current) {
        clearTimeout(querySyncTimerRef.current);
        querySyncTimerRef.current = null;
        const latestQuery = queryRef.current;
        setQueryState(
          tabId,
          {
            query: latestQuery,
            hasUnsavedChanges:
              latestQuery.trim() !== lastExecutedQueryRef.current.trim(),
          },
          { connectionId: effectiveConnectionId, database, schema: effectiveSchema },
        );
      }
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [
    tabId,
    setQueryState,
    effectiveConnectionId,
    database,
    effectiveSchema,
  ]);

  useEffect(() => {
    if (isExecuting || result !== null || batchResults.length > 0) {
      setShowResults(true);
    }
  }, [batchResults.length, isExecuting, result]);

  return {
    batchResults,
    deferredQuery,
    detectedDialect,
    effectiveConnectionId,
    executionStatus,
    globalState,
    handleEditorChange,
    hasQuery,
    inTransaction,
    isBatchExecuting,
    isExecuting,
    isExplainResult,
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
    setIsExplainResult,
    setIsStreaming,
    setQuery,
    setQueryState,
    setRefreshActionQuery,
    setResult,
    setSelectedDialect,
    setSelectedStatementCount,
    setShowOutline,
    setShowVariablePanel,
    setShowVariableBar,
    setShowplanMode,
    setShowResults,
    setShowSaveDialog,
    setViewMode,
    showOutline,
    showVariablePanel,
    showVariableBar,
    showplanMode,
    showResults,
    showSaveDialog,
    viewMode,
    activeBatchResultIndex,
    persistSql,
  };
}
