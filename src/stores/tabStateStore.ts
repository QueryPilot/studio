import { create } from "zustand";
import type { ColumnMeta } from "@/types/database";
import type { SqlDialect } from "@/components/CodeEditor/types";

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
    return state.queryStates.get(tabId);
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
      newStates.set(tabId, { ...existing, ...state });
      return { queryStates: newStates };
    });
  },

  clearQueryState: (tabId: string) => {
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
