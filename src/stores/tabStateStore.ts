import { create } from "zustand";
import type { ColumnMeta } from "@/types/database";
import type { SqlDialect } from "@/components/CodeEditor/types";

// Lightweight state for localStorage persistence
// Only includes fields that should survive app restarts
export interface PersistedTabState {
  tabId: string;
  query: string;
  lastExecutedQuery: string;
  viewMode: "table" | "json" | "explain" | "raw" | "stats";
  selectedDialect?: SqlDialect | "auto";
}

// Storage key pattern for localStorage
const TAB_STATE_STORAGE_KEY_PREFIX = "tab-state-";

// Debounce timers for persistence
const persistenceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const PERSISTENCE_DEBOUNCE_MS = 500;

/**
 * Get the localStorage key for a tab
 */
function getStorageKey(tabId: string): string {
  return `${TAB_STATE_STORAGE_KEY_PREFIX}${tabId}`;
}

/**
 * Persist lightweight tab state to localStorage
 */
export function persistTabState(tabId: string, state: Partial<PersistedTabState>): void {
  try {
    const key = getStorageKey(tabId);
    const existing = loadTabState(tabId);
    const toSave: PersistedTabState = {
      tabId,
      query: state.query ?? existing?.query ?? "",
      lastExecutedQuery: state.lastExecutedQuery ?? existing?.lastExecutedQuery ?? "",
      viewMode: state.viewMode ?? existing?.viewMode ?? "table",
      selectedDialect: state.selectedDialect ?? existing?.selectedDialect ?? "auto",
    };
    localStorage.setItem(key, JSON.stringify(toSave));
  } catch (error) {
    // Silently fail if localStorage is unavailable or quota exceeded
    console.warn("Failed to persist tab state:", error);
  }
}

/**
 * Load tab state from localStorage
 */
export function loadTabState(tabId: string): PersistedTabState | null {
  try {
    const key = getStorageKey(tabId);
    const stored = localStorage.getItem(key);
    if (!stored) {
      return null;
    }
    return JSON.parse(stored) as PersistedTabState;
  } catch (error) {
    // Silently fail if localStorage is unavailable or data is corrupted
    console.warn("Failed to load tab state:", error);
    return null;
  }
}

/**
 * Remove tab state from localStorage
 */
export function removePersistedTabState(tabId: string): void {
  try {
    const key = getStorageKey(tabId);
    localStorage.removeItem(key);
    // Clear any pending persistence timer
    const timer = persistenceTimers.get(tabId);
    if (timer) {
      clearTimeout(timer);
      persistenceTimers.delete(tabId);
    }
  } catch (error) {
    // Silently fail if localStorage is unavailable
    console.warn("Failed to remove persisted tab state:", error);
  }
}

/**
 * Schedule debounced persistence for a tab
 */
function schedulePersistence(tabId: string, state: Partial<PersistedTabState>): void {
  // Clear existing timer if any
  const existingTimer = persistenceTimers.get(tabId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Schedule new persistence
  const timer = setTimeout(() => {
    persistTabState(tabId, state);
    persistenceTimers.delete(tabId);
  }, PERSISTENCE_DEBOUNCE_MS);

  persistenceTimers.set(tabId, timer);
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
  appliedLimit: { originalSql: string; limit: number } | null;
  hasUnsavedChanges: boolean;
  lastExecutedQuery: string;
  lastSelectQuery: string | null; // Store last SELECT query for auto-refresh after mutations
  inTransaction: boolean; // Track if this tab has an active transaction
  selectedDialect?: SqlDialect | "auto"; // Selected SQL dialect (auto = auto-detect)

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

  // Get query state for a tab
  getQueryState: (tabId: string) => QueryState | undefined;

  // Update query state for a tab
  setQueryState: (tabId: string, state: Partial<QueryState>) => void;

  // Clear query state for a tab (when tab is closed)
  clearQueryState: (tabId: string) => void;

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

  getQueryState: (tabId: string) => {
    // Cache the result to avoid infinite loop warning from useSyncExternalStore
    // Map.get() returns the same object reference, so this is safe
    const state = get();
    const existing = state.queryStates.get(tabId);

    // If state exists in memory, return it
    if (existing) {
      return existing;
    }

    // Try to load from localStorage and initialize state
    const persisted = loadTabState(tabId);
    if (persisted) {
      // Initialize state from persisted data without triggering re-render
      // This is done lazily when first accessing the tab
      const newState: QueryState = {
        query: persisted.query,
        result: null,
        isExecuting: false,
        isStreaming: false,
        viewMode: persisted.viewMode,
        appliedLimit: null,
        hasUnsavedChanges: false,
        lastExecutedQuery: persisted.lastExecutedQuery,
        lastSelectQuery: null,
        inTransaction: false,
        selectedDialect: persisted.selectedDialect,
      };

      // Update the store with the loaded state
      const newStates = new Map(state.queryStates);
      newStates.set(tabId, newState);
      // Use setState to update without triggering re-render in this call
      useTabStateStore.setState({ queryStates: newStates });

      return newState;
    }

    return undefined;
  },

  setQueryState: (tabId: string, state: Partial<QueryState>) => {
    set((store) => {
      const newStates = new Map(store.queryStates);
      const existing = newStates.get(tabId) || {
        query: "",
        result: null,
        isExecuting: false,
        isStreaming: false,
        viewMode: "table" as const,
        appliedLimit: null,
        hasUnsavedChanges: false,
        lastExecutedQuery: "",
        lastSelectQuery: null,
        inTransaction: false,
        selectedDialect: "auto" as const,
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
        });
      }

      return { queryStates: newStates };
    });
  },

  clearQueryState: (tabId: string) => {
    // Remove from localStorage
    removePersistedTabState(tabId);

    set((store) => {
      const newStates = new Map(store.queryStates);
      newStates.delete(tabId);
      return { queryStates: newStates };
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
