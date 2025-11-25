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
  error?: string;
}

interface QueryState {
  query: string;
  result: QueryResult | null;
  isExecuting: boolean;
  isStreaming: boolean;
  viewMode: "table" | "json";
  appliedLimit: { originalSql: string; limit: number } | null;
  hasUnsavedChanges: boolean;
  lastExecutedQuery: string;
  lastSelectQuery: string | null; // Store last SELECT query for auto-refresh after mutations
  inTransaction: boolean; // Track if this tab has an active transaction
  selectedDialect?: SqlDialect | "auto"; // Selected SQL dialect (auto = auto-detect)
}

interface TabStateStore {
  // Query panel states keyed by tabId
  queryStates: Map<string, QueryState>;

  // Get query state for a tab
  getQueryState: (tabId: string) => QueryState | undefined;

  // Update query state for a tab
  setQueryState: (tabId: string, state: Partial<QueryState>) => void;

  // Clear query state for a tab (when tab is closed)
  clearQueryState: (tabId: string) => void;

  // Check if any tab has unsaved changes
  hasAnyUnsavedChanges: () => boolean;
}

export const useTabStateStore = create<TabStateStore>((set, get) => ({
  queryStates: new Map(),

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
}));
