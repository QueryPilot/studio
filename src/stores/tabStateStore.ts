import { create } from "zustand";
import type { ColumnMeta } from "@/types/database";
import type { SqlDialect } from "@/components/CodeEditor/types";
import {
  persistTabState as persistTabStateToDb,
  loadTabState as loadTabStateFromDb,
  removePersistedTabState as removeTabStateFromDb,
  migrateFromLocalStorage,
  type PersistedTabState,
} from "@/lib/db/tabState";
import { debouncedSyncAiContext } from "@/services/aiContextService";

// Re-export PersistedTabState for consumers
export type { PersistedTabState };

// Debounce timers for persistence
const persistenceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const PERSISTENCE_DEBOUNCE_MS = 500;

// Track pending persistence data (accumulated during debounce)
const pendingPersistence = new Map<string, Partial<PersistedTabState>>();

/**
 * Schedule debounced persistence for a tab
 */
function schedulePersistence(tabId: string, state: Partial<PersistedTabState>): void {
  // Accumulate state changes during debounce period
  const existing = pendingPersistence.get(tabId) || {};
  pendingPersistence.set(tabId, { ...existing, ...state });

  // Clear existing timer if any
  const existingTimer = persistenceTimers.get(tabId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Schedule new persistence
  const timer = setTimeout(() => {
    const toPersist = pendingPersistence.get(tabId);
    if (toPersist) {
      // Fire and forget - don't await
      void persistTabStateToDb(tabId, toPersist);
      pendingPersistence.delete(tabId);
    }
    persistenceTimers.delete(tabId);
  }, PERSISTENCE_DEBOUNCE_MS);

  persistenceTimers.set(tabId, timer);
}

/**
 * Clear pending persistence timer for a tab
 */
function clearPendingPersistence(tabId: string): void {
  const timer = persistenceTimers.get(tabId);
  if (timer) {
    clearTimeout(timer);
    persistenceTimers.delete(tabId);
  }
  pendingPersistence.delete(tabId);
}

// Store for preserving tab state across panel moves
export interface QueryResult {
  columns: string[];
  columnMeta?: ColumnMeta[];
  rows: unknown[][];
  rowCount: number;
  affectedRows?: number; // For mutation queries (UPDATE, DELETE, etc.)
  executionTime?: number;
  cursorSetupMs?: number;
  totalStreamingMs?: number;
  fetchCount?: number;
  networkMs?: number;
  conversionMs?: number;
  ipcSendMs?: number;
  message?: string; // For informational messages (e.g., DDL results, notices)
  error?: string;
}

export interface SavedExplainPlan {
  id: string;
  query: string;
  plan: QueryResult;
  timestamp: number;
  label?: string;
}

export interface MultiQueryResult {
  statementIndex: number;
  statement: string;
  result: QueryResult;
  startTime: number;
  endTime: number;
}

export type BackgroundQueryStatus = "running" | "completed" | "error" | "cancelled";

export interface BackgroundQuery {
  id: string;
  tabId: string;
  query: string;
  startTime: number;
  endTime?: number;
  status: BackgroundQueryStatus;
  result?: QueryResult;
  error?: string;
}

interface QueryState {
  query: string;
  result: QueryResult | null;
  isExecuting: boolean;
  isStreaming: boolean;
  viewMode: "table" | "json" | "explain" | "raw" | "stats";
  hasUnsavedChanges: boolean;
  lastExecutedQuery: string;
  lastSelectQuery: string | null; // Store last SELECT query for auto-refresh after mutations
  inTransaction: boolean; // Track if this tab has an active transaction
  selectedDialect?: SqlDialect | "auto"; // Selected SQL dialect (auto = auto-detect)
  tableViewType?: string; // For table tabs: "data" | "structure" | "indexes" | etc.

  // Multi-query execution support
  multiResults?: MultiQueryResult[]; // Results from multi-statement execution
  activeResultIndex?: number; // Currently viewed result tab (0-based)

  // Pinned result support
  pinnedResult?: QueryResult | null; // Pinned query result
  pinnedResultQuery?: string; // SQL query that produced the pinned result

  // Saved EXPLAIN plans for comparison
  savedExplainPlans?: SavedExplainPlan[];
}

interface TabStateStore {
  // Query panel states keyed by tabId
  queryStates: Map<string, QueryState>;

  // Background queries keyed by queryId
  backgroundQueries: Map<string, BackgroundQuery>;

  // Track which tabs have been loaded from DB
  loadedTabs: Set<string>;

  // Get query state for a tab (synchronous, returns from memory only)
  getQueryState: (tabId: string) => QueryState | undefined;

  // Load tab state from IndexedDB (async, triggers re-render when loaded)
  loadTabStateAsync: (tabId: string) => Promise<void>;

  // Update query state for a tab
  setQueryState: (
    tabId: string,
    state: Partial<QueryState>,
    connectionContext?: { connectionId: string; database: string; schema: string }
  ) => void;

  // Clear query state for a tab (when tab is closed)
  clearQueryState: (tabId: string) => void;

  // Initialize: migrate from localStorage and prepare store
  initialize: () => Promise<void>;

  // Check if any tab has unsaved changes
  hasAnyUnsavedChanges: () => boolean;

  // Pin current result
  pinResult: (tabId: string) => void;

  // Unpin result
  unpinResult: (tabId: string) => void;

  // Clear pinned result
  clearPinnedResult: (tabId: string) => void;

  // Save EXPLAIN plan for comparison
  saveExplainPlan: (tabId: string, query: string, plan: QueryResult, label?: string) => string;

  // Delete saved EXPLAIN plan
  deleteSavedExplainPlan: (tabId: string, planId: string) => void;

  // Get saved EXPLAIN plans
  getSavedExplainPlans: (tabId: string) => SavedExplainPlan[];

  // Background query management
  startBackgroundQuery: (tabId: string, query: string) => string;
  completeBackgroundQuery: (queryId: string, result: QueryResult) => void;
  failBackgroundQuery: (queryId: string, error: string) => void;
  cancelBackgroundQuery: (queryId: string) => void;
  getBackgroundQueries: (tabId?: string) => BackgroundQuery[];
  getRunningBackgroundQueriesCount: () => number;
  clearBackgroundQuery: (queryId: string) => void;
}

export const useTabStateStore = create<TabStateStore>((set, get) => ({
  queryStates: new Map(),
  backgroundQueries: new Map(),
  loadedTabs: new Set(),

  initialize: async () => {
    // Run one-time migration from localStorage to IndexedDB
    await migrateFromLocalStorage();
  },

  getQueryState: (tabId: string) => {
    // Synchronous getter - returns from memory only
    // Use loadTabStateAsync to load from IndexedDB first
    return get().queryStates.get(tabId);
  },

  loadTabStateAsync: async (tabId: string) => {
    const state = get();

    // Already loaded or already in memory
    if (state.loadedTabs.has(tabId) || state.queryStates.has(tabId)) {
      return;
    }

    // Mark as loading to prevent duplicate loads
    set((s) => ({
      loadedTabs: new Set(s.loadedTabs).add(tabId),
    }));

    // Load from IndexedDB
    const persisted = await loadTabStateFromDb(tabId);
    if (persisted) {
      const newState: QueryState = {
        query: persisted.query,
        result: null,
        isExecuting: false,
        isStreaming: false,
        viewMode: persisted.viewMode,

        hasUnsavedChanges: false,
        lastExecutedQuery: persisted.lastExecutedQuery,
        lastSelectQuery: null,
        inTransaction: false,
        selectedDialect: persisted.selectedDialect,
        tableViewType: persisted.tableViewType,
      };

      set((s) => {
        const newStates = new Map(s.queryStates);
        // Only set if not already set (another call might have set it)
        if (!newStates.has(tabId)) {
          newStates.set(tabId, newState);
        }
        return { queryStates: newStates };
      });
    }
  },

  setQueryState: (
    tabId: string,
    state: Partial<QueryState>,
    connectionContext?: { connectionId: string; database: string; schema: string }
  ) => {
    set((store) => {
      const newStates = new Map(store.queryStates);
      const existing = newStates.get(tabId) || {
        query: "",
        result: null,
        isExecuting: false,
        isStreaming: false,
        viewMode: "table" as const,

        hasUnsavedChanges: false,
        lastExecutedQuery: "",
        lastSelectQuery: null,
        inTransaction: false,
        selectedDialect: "auto" as const,
        tableViewType: undefined,
      };
      const newState = { ...existing, ...state };
      newStates.set(tabId, newState);

      // Schedule debounced persistence for lightweight fields
      // Only persist if any persistable field changed
      const persistableFields: (keyof PersistedTabState)[] = [
        "query",
        "lastExecutedQuery",
        "viewMode",
        "selectedDialect",
        "tableViewType",
      ];
      const shouldPersist = persistableFields.some(
        (field) => field in state && state[field as keyof QueryState] !== undefined
      );

      if (shouldPersist) {
        schedulePersistence(tabId, {
          query: newState.query,
          lastExecutedQuery: newState.lastExecutedQuery,
          viewMode: newState.viewMode,
          selectedDialect: newState.selectedDialect,
          tableViewType: newState.tableViewType,
        });
      }

      // Sync to AI context (for MCP tools)
      // Only sync if we have meaningful state
      if (newState.query || newState.result) {
        debouncedSyncAiContext({
          connectionId: connectionContext?.connectionId ?? null,
          database: connectionContext?.database ?? null,
          schema: connectionContext?.schema ?? null,
          query: newState.query || null,
          lastExecutedQuery: newState.lastExecutedQuery || null,
          hasResults: newState.result !== null,
          rowCount: newState.result?.rowCount ?? null,
          columnCount: newState.result?.columns?.length ?? null,
          updatedAt: Date.now(),
        });
      }

      return { queryStates: newStates };
    });
  },

  clearQueryState: (tabId: string) => {
    // Clear pending persistence timer
    clearPendingPersistence(tabId);

    // Remove from IndexedDB (fire and forget)
    void removeTabStateFromDb(tabId);

    set((store) => {
      const newStates = new Map(store.queryStates);
      newStates.delete(tabId);
      const newLoadedTabs = new Set(store.loadedTabs);
      newLoadedTabs.delete(tabId);
      return { queryStates: newStates, loadedTabs: newLoadedTabs };
    });
  },

  hasAnyUnsavedChanges: () => {
    const states = get().queryStates;
    for (const state of states.values()) {
      if (state.hasUnsavedChanges) {
        return true;
      }
    }
    return false;
  },

  pinResult: (tabId: string) => {
    set((store) => {
      const newStates = new Map(store.queryStates);
      const existing = newStates.get(tabId);
      if (existing && existing.result) {
        newStates.set(tabId, {
          ...existing,
          pinnedResult: existing.result,
          pinnedResultQuery: existing.lastExecutedQuery,
        });
      }
      return { queryStates: newStates };
    });
  },

  unpinResult: (tabId: string) => {
    set((store) => {
      const newStates = new Map(store.queryStates);
      const existing = newStates.get(tabId);
      if (existing) {
        newStates.set(tabId, {
          ...existing,
          pinnedResult: null,
          pinnedResultQuery: undefined,
        });
      }
      return { queryStates: newStates };
    });
  },

  clearPinnedResult: (tabId: string) => {
    set((store) => {
      const newStates = new Map(store.queryStates);
      const existing = newStates.get(tabId);
      if (existing) {
        newStates.set(tabId, {
          ...existing,
          pinnedResult: null,
          pinnedResultQuery: undefined,
        });
      }
      return { queryStates: newStates };
    });
  },

  saveExplainPlan: (tabId: string, query: string, plan: QueryResult, label?: string) => {
    const planId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    set((store) => {
      const newStates = new Map(store.queryStates);
      const existing = newStates.get(tabId);
      if (existing) {
        const savedPlans = existing.savedExplainPlans || [];
        newStates.set(tabId, {
          ...existing,
          savedExplainPlans: [
            ...savedPlans,
            {
              id: planId,
              query,
              plan,
              timestamp: Date.now(),
              label,
            },
          ],
        });
      }
      return { queryStates: newStates };
    });
    return planId;
  },

  deleteSavedExplainPlan: (tabId: string, planId: string) => {
    set((store) => {
      const newStates = new Map(store.queryStates);
      const existing = newStates.get(tabId);
      if (existing && existing.savedExplainPlans) {
        newStates.set(tabId, {
          ...existing,
          savedExplainPlans: existing.savedExplainPlans.filter((p) => p.id !== planId),
        });
      }
      return { queryStates: newStates };
    });
  },

  getSavedExplainPlans: (tabId: string) => {
    const state = get().queryStates.get(tabId);
    return state?.savedExplainPlans || [];
  },

  startBackgroundQuery: (tabId: string, query: string) => {
    const queryId = `bg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    set((store) => {
      const newQueries = new Map(store.backgroundQueries);
      newQueries.set(queryId, {
        id: queryId,
        tabId,
        query,
        startTime: Date.now(),
        status: "running",
      });
      return { backgroundQueries: newQueries };
    });
    return queryId;
  },

  completeBackgroundQuery: (queryId: string, result: QueryResult) => {
    set((store) => {
      const newQueries = new Map(store.backgroundQueries);
      const existing = newQueries.get(queryId);
      if (existing) {
        newQueries.set(queryId, {
          ...existing,
          status: "completed",
          endTime: Date.now(),
          result,
        });
      }
      return { backgroundQueries: newQueries };
    });
  },

  failBackgroundQuery: (queryId: string, error: string) => {
    set((store) => {
      const newQueries = new Map(store.backgroundQueries);
      const existing = newQueries.get(queryId);
      if (existing) {
        newQueries.set(queryId, {
          ...existing,
          status: "error",
          endTime: Date.now(),
          error,
        });
      }
      return { backgroundQueries: newQueries };
    });
  },

  cancelBackgroundQuery: (queryId: string) => {
    set((store) => {
      const newQueries = new Map(store.backgroundQueries);
      const existing = newQueries.get(queryId);
      if (existing) {
        newQueries.set(queryId, {
          ...existing,
          status: "cancelled",
          endTime: Date.now(),
        });
      }
      return { backgroundQueries: newQueries };
    });
  },

  getBackgroundQueries: (tabId?: string) => {
    const queries = Array.from(get().backgroundQueries.values());
    if (tabId) {
      return queries.filter((q) => q.tabId === tabId);
    }
    return queries;
  },

  getRunningBackgroundQueriesCount: () => {
    const queries = Array.from(get().backgroundQueries.values());
    return queries.filter((q) => q.status === "running").length;
  },

  clearBackgroundQuery: (queryId: string) => {
    set((store) => {
      const newQueries = new Map(store.backgroundQueries);
      newQueries.delete(queryId);
      return { backgroundQueries: newQueries };
    });
  },
}));
