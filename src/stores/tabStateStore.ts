import { create } from "zustand";
import type { ColumnMeta } from "@/types/database";
import type { SqlDialect } from "@/components/CodeEditor/types";
import type { ViewMode } from "@/types/viewMode";
import {
  persistTabState as persistTabStateToDb,
  loadTabState as loadTabStateFromDb,
  removePersistedTabState as removeTabStateFromDb,
  migrateFromLocalStorage,
  type PersistedTabState,
} from "@/lib/db/tabState";
import { debouncedSyncAiContext } from "@/services/aiContextService";
import useWorkbenchStore from "@/stores/workbenchStore";
import { useGridPreferencesStore } from "@/components/DataGrid/stores/gridPreferencesStore";
import type { TabMetadata } from "@/types/workbench";
import type { MongoWorkbenchState } from "@/types/mongoWorkbench";
import type { QueryVariable, VariableScope } from "@/lib/queryVariables/types";

// Re-export PersistedTabState for consumers
export type { PersistedTabState };

// Debounce timers for persistence
const persistenceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const PERSISTENCE_DEBOUNCE_MS = 500;

// Track pending persistence data (accumulated during debounce)
const pendingPersistence = new Map<string, Partial<PersistedTabState>>();

function findTabMetadata(
  tabId: string,
): { panelId: string; metadata: TabMetadata } | null {
  const panelContents = useWorkbenchStore.getState().panelContents;
  for (const [panelId, panel] of panelContents) {
    if (!panel.tabIds.includes(tabId)) continue;
    return {
      panelId,
      metadata: panel.metadata?.[tabId] ?? {},
    };
  }
  return null;
}

function computeGridId(tabId: string, metadata: TabMetadata): string | null {
  const connectionId =
    typeof metadata.connectionId === "string" ? metadata.connectionId : null;
  if (!connectionId) return null;

  const type = typeof metadata.type === "string" ? metadata.type : "";
  if (type === "table") {
    const database =
      typeof metadata.database === "string" ? metadata.database : "";
    const schema = typeof metadata.schema === "string" ? metadata.schema : "public";
    const table = typeof metadata.table === "string" ? metadata.table : "";
    if (!database || !table) return null;
    return `${connectionId}:${database}:${schema}:${table}`;
  }

  if (type === "mongo-collection") {
    const database =
      typeof metadata.database === "string" ? metadata.database : "";
    const collection = typeof metadata.table === "string" ? metadata.table : "";
    if (!database || !collection) return null;
    return `document:${connectionId}:${database}:${collection}`;
  }

  if (type === "redis-key") {
    const database =
      typeof metadata.database === "string" ? metadata.database : "0";
    const keyName =
      typeof metadata.table === "string" && metadata.table.length > 0
        ? metadata.table
        : "browser";
    return `keyvalue:${connectionId}:${database}:${keyName}`;
  }

  if (type === "query") {
    const database =
      typeof metadata.database === "string" ? metadata.database : "";
    const schema = typeof metadata.schema === "string" ? metadata.schema : "public";
    return `query:${connectionId}:${database}:${schema}:${tabId}`;
  }

  return null;
}

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
  viewMode: ViewMode;
  hasUnsavedChanges: boolean;
  lastExecutedQuery: string;
  lastSelectQuery: string | null; // Store last SELECT query for auto-refresh after mutations
  inTransaction: boolean; // Track if this tab has an active transaction
  selectedDialect?: SqlDialect | "auto"; // Selected SQL dialect (auto = auto-detect)
  tableViewType?: string; // For table and Mongo tabs: "data" | "structure" | "indexes" | etc.
  mongoWorkbench?: MongoWorkbenchState;
  scrollPosition?: { top: number; left: number };
  editorCursorPosition?: { line: number; ch: number };
  gridColumnWidths?: Record<string, number>;

  // Multi-query execution support
  multiResults?: MultiQueryResult[]; // Results from multi-statement execution
  activeResultIndex?: number; // Currently viewed result tab (0-based)

  // Pinned result support
  pinnedResult?: QueryResult | null; // Pinned query result
  pinnedResultQuery?: string | null; // SQL query that produced the pinned result

  // Saved EXPLAIN plans for comparison
  savedExplainPlans?: SavedExplainPlan[];

  // Query variables (session-only, not persisted to IndexedDB)
  queryVariables?: Record<string, QueryVariable>;
  variableScope?: VariableScope;
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
        mongoWorkbench: persisted.mongoWorkbench,
        scrollPosition: persisted.scrollPosition,
        editorCursorPosition: persisted.editorCursorPosition,
        gridColumnWidths: persisted.gridColumnWidths,
        pinnedResultQuery: persisted.pinnedResultQuery ?? undefined,
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
      const existing = store.queryStates.get(tabId);

      // Short-circuit: if the tab already exists and every value in the
      // incoming partial is identical to what we already have, skip all
      // work (no new Map, no persistence, no AI-context sync).
      if (existing) {
        const keys = Object.keys(state) as (keyof QueryState)[];
        const hasChange = keys.some((key) => {
          const incomingValue = state[key];
          // Skip undefined values in the partial — they aren't real updates
          if (incomingValue === undefined) return false;
          // Primitives use ===; object/array fields use reference ===
          return incomingValue !== existing[key];
        });
        if (!hasChange) {
          return store; // nothing changed — return existing state as-is
        }
      }

      const newStates = new Map(store.queryStates);
      const base = existing || {
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
        mongoWorkbench: undefined,
      };
      const newState = { ...base, ...state };
      newStates.set(tabId, newState);

      // Schedule debounced persistence for lightweight fields
      // Only persist if any persistable field changed
      // TODO: Consider separate 1000ms debounce for scrollPosition and gridColumnWidths
      const persistableFields: (keyof PersistedTabState)[] = [
        "query",
        "lastExecutedQuery",
        "viewMode",
        "selectedDialect",
        "tableViewType",
        "mongoWorkbench",
        "scrollPosition",
        "editorCursorPosition",
        "gridColumnWidths",
        "pinnedResultQuery",
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
          mongoWorkbench: newState.mongoWorkbench,
          scrollPosition: newState.scrollPosition,
          editorCursorPosition: newState.editorCursorPosition,
          gridColumnWidths: newState.gridColumnWidths,
          pinnedResultQuery: newState.pinnedResultQuery,
        });
      }

      // Sync to AI context snapshot (consumed by `querypilot agent` CLI)
      // Only sync if we have meaningful state
      if (newState.query || newState.result) {
        const located = findTabMetadata(tabId);
        const metadata = located?.metadata ?? {};
        const gridId = computeGridId(tabId, metadata);
        const prefs = gridId
          ? useGridPreferencesStore.getState().preferences[gridId]
          : undefined;
        const firstSort = prefs?.sortColumns[0];

        debouncedSyncAiContext({
          connectionId:
            connectionContext?.connectionId ??
            (typeof metadata.connectionId === "string" ? metadata.connectionId : null),
          database:
            connectionContext?.database ??
            (typeof metadata.database === "string" ? metadata.database : null),
          schema:
            connectionContext?.schema ??
            (typeof metadata.schema === "string" ? metadata.schema : null),
          query: newState.query || null,
          lastExecutedQuery: newState.lastExecutedQuery || null,
          hasResults: newState.result !== null,
          rowCount: newState.result?.rowCount ?? null,
          columnCount: newState.result ? newState.result.columns.length : null,
          updatedAt: Date.now(),
          panelId: located?.panelId ?? null,
          tabId,
          tabType: typeof metadata.type === "string" ? metadata.type : null,
          title: typeof metadata.title === "string" ? metadata.title : null,
          filter: prefs?.quickFilter?.value ?? null,
          sortColumn: firstSort?.columnId ?? null,
          sortDirection: firstSort?.direction ?? null,
          viewType:
            newState.tableViewType ??
            (typeof metadata.viewType === "string" ? metadata.viewType : null),
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
          pinnedResultQuery: null,
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
          pinnedResultQuery: null,
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
