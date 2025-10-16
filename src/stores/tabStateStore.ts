import { create } from "zustand";
import type { ColumnMeta } from "@/types/database";

// Store for preserving tab state across panel moves
export interface QueryResult {
  columns: string[];
  columnMeta?: ColumnMeta[];
  rows: unknown[][];
  rowCount: number;
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
}

export const useTabStateStore = create<TabStateStore>((set, get) => ({
  queryStates: new Map(),

  getQueryState: (tabId: string) => {
    return get().queryStates.get(tabId);
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
}));
